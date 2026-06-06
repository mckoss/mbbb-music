// The sync manifest (data/manifest.json) is the small, diffable record that
// drives incremental refreshes. It maps each Drive file id to its provenance,
// SHA-256 (which is also its location in the content-addressable store,
// data/cas/<sha256>), size, detected metadata, and sync status, so a later run
// can classify each source file as new, changed, unchanged, deleted, or ignored
// and fetch only the blobs not already in the store.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const MANIFEST_VERSION = 1;

/** A fresh, empty manifest. */
export function emptyManifest() {
  return {
    version: MANIFEST_VERSION,
    generatedAt: null,
    // Persisted Drive Changes API page tokens, keyed by source folder id, for
    // future delta listing. Phase 1 populates this opportunistically.
    startPageTokens: {},
    files: {},
  };
}

/**
 * Load a manifest from disk, returning an empty manifest if the file is absent.
 *
 * @param {string} manifestPath
 * @returns {Promise<object>}
 */
export async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...emptyManifest(), ...parsed };
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyManifest();
    throw err;
  }
}

/**
 * Write a manifest to disk as pretty-printed JSON (creating parent dirs).
 *
 * Writes to a temp file and renames into place, so an interrupted write (the
 * sync persists after every download) can never truncate or remove the manifest.
 *
 * @param {string} manifestPath
 * @param {object} manifest
 */
export async function saveManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  const tmp = `${manifestPath}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await rename(tmp, manifestPath); // atomic on the same filesystem
}

/**
 * Decide whether a Drive file differs from its manifest entry. The content hash
 * is authoritative when available, but Drive omits `sha256Checksum` for some
 * files (notably Drive-side "Make a copy" duplicates). When it does, fall back to
 * mutation signals — an unmoved modifiedTime (or version) means the content is
 * unchanged and the recorded hash is still valid, so the sync can reuse it
 * instead of re-downloading just to recompute the same hash.
 *
 * @param {object} prev  Existing manifest entry (stores the hash as `sha256`).
 * @param {object} file  Current Drive file (provides `sha256Checksum`).
 * @returns {boolean}
 */
export function isChanged(prev, file) {
  if (file.sha256Checksum) return prev.sha256 !== file.sha256Checksum;
  if (prev.modifiedTime && file.modifiedTime) return prev.modifiedTime !== file.modifiedTime;
  if (prev.version && file.version) return prev.version !== file.version;
  // No checksum and no comparable mutation signal — re-fetch to be safe.
  return true;
}

/**
 * @typedef {Object} DiffEntry
 * @property {string} id              Drive file id.
 * @property {'new'|'changed'|'unchanged'|'deleted'|'ignored'} status
 * @property {object} file            The Drive file (for present files) or {} for deleted.
 * @property {import('./classify.js').Classification} [classification]
 * @property {object} [prev]          Prior manifest entry, when present.
 */

/**
 * Compare the current set of classified Drive files against the manifest.
 *
 * @param {object} manifest          Prior manifest.
 * @param {Array<{ file: object, classification: object }>} current
 *        Classified Drive files seen this run.
 * @returns {{ entries: DiffEntry[], counts: Record<string, number> }}
 */
export function diffManifest(manifest, current) {
  const entries = [];
  const seen = new Set();
  const prevFiles = manifest.files || {};

  for (const { file, classification } of current) {
    const id = file.id;
    seen.add(id);
    const prev = prevFiles[id];

    if (classification.ignored) {
      entries.push({ id, status: 'ignored', file, classification, prev });
      continue;
    }
    if (!prev || prev.status === 'deleted') {
      entries.push({ id, status: 'new', file, classification, prev });
    } else if (isChanged(prev, file)) {
      entries.push({ id, status: 'changed', file, classification, prev });
    } else {
      entries.push({ id, status: 'unchanged', file, classification, prev });
    }
  }

  // Anything previously tracked (and not already marked deleted/ignored) that we
  // no longer see is a deletion. Local content is retained; we only archive.
  for (const [id, prev] of Object.entries(prevFiles)) {
    if (seen.has(id)) continue;
    if (prev.status === 'deleted' || prev.status === 'ignored') continue;
    entries.push({ id, status: 'deleted', file: {}, prev });
  }

  const counts = entries.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});

  return { entries, counts };
}

/**
 * @typedef {Object} DuplicateGroup
 * @property {string} sha256  The shared content hash (one blob in data/cas/).
 * @property {number} count   Number of Drive files with this content.
 * @property {Array<{ id: string, originalName: string|null, sourceFolderLabel: string|null }>} files
 */

/**
 * Find Drive files that share content — the same SHA-256, regardless of source
 * folder. They already share a single blob in the store; this just surfaces them
 * for reporting. Ignored and deleted entries are excluded. Returns only groups
 * of 2+ files, largest groups first.
 *
 * @param {object} manifest
 * @returns {DuplicateGroup[]}
 */
export function findDuplicates(manifest) {
  const byHash = new Map();
  for (const [id, e] of Object.entries(manifest.files || {})) {
    if (e.ignored || e.status === 'ignored' || e.status === 'deleted') continue;
    const sha = e.sha256;
    if (!sha) continue;
    if (!byHash.has(sha)) byHash.set(sha, []);
    byHash.get(sha).push({ id, originalName: e.originalName ?? null, sourceFolderLabel: e.sourceFolderLabel ?? null });
  }

  const groups = [];
  for (const [sha256, files] of byHash) {
    if (files.length > 1) groups.push({ sha256, count: files.length, files });
  }
  groups.sort((a, b) => b.count - a.count);
  return groups;
}
