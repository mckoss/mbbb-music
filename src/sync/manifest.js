// The sync manifest (data/manifest.json) is the small, diffable record that
// drives incremental refreshes. It maps each Drive file id to its provenance,
// checksum/size, canonical local path, detected metadata, and sync status, so a
// later run can classify each source file as new, changed, unchanged, deleted,
// or ignored without re-downloading unchanged assets.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const MANIFEST_VERSION = 1;

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
 * @param {string} manifestPath
 * @param {object} manifest
 */
export async function saveManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Decide whether a Drive file differs from its manifest entry. Prefers the
 * md5 checksum, then version, then modifiedTime+size as fallbacks (Drive does
 * not always supply a checksum).
 *
 * @param {object} prev  Existing manifest entry.
 * @param {object} file  Current Drive file.
 * @returns {boolean}
 */
export function isChanged(prev, file) {
  if (prev.md5Checksum && file.md5Checksum) {
    return prev.md5Checksum !== file.md5Checksum;
  }
  if (prev.version != null && file.version != null) {
    return String(prev.version) !== String(file.version);
  }
  const sameTime = prev.modifiedTime === file.modifiedTime;
  const sameSize = String(prev.size ?? '') === String(file.size ?? '');
  return !(sameTime && sameSize);
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
