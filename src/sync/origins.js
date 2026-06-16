// Per-blob provenance sidecars for the content-addressable store.
//
// The manifest (data/manifest.json) records only the CURRENT mapping from each
// Drive file to its content hash: when a native Google file is re-exported, or a
// binary file gets a new version, the entry's `sha256` is overwritten and the
// previously stored blob becomes an anonymous orphan — nothing left points at it,
// so its origin is unrecoverable from the manifest alone.
//
// An origin sidecar fixes that. The first time a blob's bytes enter the store we
// write data/cas/origins/<sha>.json, capturing where it came from and when. It is
// effectively WRITE-ONCE — the CAS is itself write-once (a given sha always means
// the same bytes), so a known origin never changes and is never overwritten. Later
// edits that orphan the blob leave this record intact, so provenance survives.
//
// The one allowed mutation is a one-way UPGRADE: a blob already in the store with
// no recoverable history is recorded as `provenance: "unknown"`. If a later sync
// runs across a real Drive file whose content matches that orphan, its now-known
// origin replaces the "unknown" record. A known origin is never downgraded.

import { mkdir, writeFile, readFile, readdir, stat, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadManifest } from './manifest.js';

/** A 64-hex CAS filename (a blob), excluding the `origins` subdir and dotfiles. */
const SHA_RE = /^[0-9a-f]{64}$/;

/** Drop keys whose value is null or undefined, so records carry no null props. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null) out[k] = v;
  }
  return out;
}

/** The origins directory living inside the CAS dir (data/cas/origins). */
export function originsDirFor(casDir) {
  return resolve(casDir, 'origins');
}

/** Path of the sidecar for a given content hash. */
export function originPath(originsDir, sha) {
  return resolve(originsDir, `${sha}.json`);
}

/**
 * Build the provenance record for a blob from a manifest entry (or, for a true
 * orphan with no surviving entry, from explicit sha/byteLength only).
 *
 * @param {object|null} entry  A manifest file entry (its `status` is volatile and
 *        dropped; everything else — driveFileId, sourceFolderLabel, originalName,
 *        originalFolder, songTitle, instrument, key, modifiedTime, … — is kept as
 *        the metadata snapshot at creation time — including the source folder and
 *        the in-source folder. Those are NOT duplicated at top level; an orphan
 *        with no entry instead records sourceFolderLabel/originalFolder as "unknown".
 * @param {object} opts
 * @param {string} [opts.sha256]      Override hash (used when `entry` is null).
 * @param {number} [opts.byteLength]  Override size (used when `entry` is null).
 * @param {string|null} [opts.createdAt]  When the blob first entered the store.
 * @param {'sync'|'recovered'|'unknown'} [opts.provenance]  How this record was sourced.
 * @returns {object}
 */
export function buildOriginRecord(entry, { sha256, byteLength, createdAt = null, provenance = 'sync' } = {}) {
  let meta = null;
  if (entry) {
    const { status, ...rest } = entry; // `status` is current sync state, not origin
    meta = rest;
  }
  const hasEntry = Boolean(meta && Object.keys(meta).length);
  // Drive reports `size` as a string; normalize byteLength to a number so every
  // record (sync-written from bytes.length, or recovered from the manifest) agrees.
  const rawLen = byteLength ?? meta?.byteLength ?? meta?.size ?? null;
  const len = rawLen != null && Number.isFinite(Number(rawLen)) ? Number(rawLen) : null;
  // Source provenance (source folder + the in-source folder, e.g. the song folder)
  // already lives inside manifestEntry, so it is NOT duplicated at top level. A true
  // orphan has no manifestEntry, so for it — and only it — those are recorded here
  // as "unknown", the one place that fact can live.
  const orphanMark = !hasEntry && provenance === 'unknown' ? 'unknown' : null;
  return compact({
    sha256: sha256 || meta?.sha256 || null,
    byteLength: len,
    createdAt,
    provenance,
    sourceFolderLabel: orphanMark,
    originalFolder: orphanMark,
    manifestEntry: hasEntry ? meta : null,
  });
}

/** Atomically (over)write a sidecar via temp-file + rename. */
async function writeOrigin(originsDir, sha, record) {
  await mkdir(originsDir, { recursive: true });
  const path = originPath(originsDir, sha);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  await rename(tmp, path); // atomic on the same filesystem
}

/**
 * Record a blob's origin under the write-once-with-upgrade policy:
 *   - no sidecar yet                          → write it          ('written')
 *   - existing 'unknown' + a known incoming    → overwrite it      ('upgraded')
 *   - existing known, or incoming also unknown → leave it          ('kept')
 *
 * So a known origin is immutable, but an orphan first seen with no history is
 * upgraded the moment a real source for its content turns up.
 *
 * @param {string} originsDir
 * @param {string} sha
 * @param {object} record  The record to write (see buildOriginRecord).
 * @returns {Promise<'written'|'upgraded'|'kept'>}
 */
export async function recordOrigin(originsDir, sha, record) {
  const existing = await loadOrigin(originsDir, sha);
  if (existing) {
    const canUpgrade = existing.provenance === 'unknown' && record.provenance !== 'unknown';
    if (!canUpgrade) return 'kept';
    await writeOrigin(originsDir, sha, record);
    return 'upgraded';
  }
  await writeOrigin(originsDir, sha, record);
  return 'written';
}

/**
 * Read a blob's origin sidecar, or null if none was recorded.
 *
 * @param {string} originsDir
 * @param {string} sha
 * @returns {Promise<object|null>}
 */
export async function loadOrigin(originsDir, sha) {
  try {
    return JSON.parse(await readFile(originPath(originsDir, sha), 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Of two manifest entries that share a content hash, pick the better origin: a
 * live entry beats a `deleted` tombstone, and otherwise the earliest `syncedAt`
 * wins (the closest record we have to who first produced the bytes). ISO-8601
 * timestamps sort lexicographically, so a string compare is correct.
 */
function preferEntry(a, b) {
  const aDeleted = a.status === 'deleted';
  const bDeleted = b.status === 'deleted';
  if (aDeleted !== bDeleted) return aDeleted ? b : a;
  return (a.syncedAt || '') <= (b.syncedAt || '') ? a : b;
}

/**
 * One-time (and idempotent) backfill: walk the blobs already in the CAS and write
 * an origin sidecar for each one that lacks one, recovering as much provenance as
 * the current manifest still records.
 *
 *   - A blob still referenced by a manifest entry inherits that entry's metadata
 *     (provenance: 'recovered'; createdAt = the entry's syncedAt, the best date
 *     we have). Among duplicate entries sharing a blob, the earliest live one wins.
 *   - A true orphan (no entry references it) gets a minimal record with its size
 *     and provenance: 'unknown' — we record that we tried and the origin is lost.
 *
 * A known sidecar is never overwritten, but a prior 'unknown' one is UPGRADED if
 * the manifest now associates that blob with a real file. Safe to re-run.
 *
 * @param {object} params
 * @param {string} params.casDir         The content-addressable store directory.
 * @param {string} params.manifestPath   Path to data/manifest.json.
 * @param {boolean} [params.dryRun]      Compute the plan without writing sidecars.
 * @param {(msg: string) => void} [params.onProgress]
 * @returns {Promise<{ blobs: number, written: number, recovered: number, orphans: number, upgraded: number, skipped: number, dryRun: boolean }>}
 */
export async function recoverOrigins({ casDir, manifestPath, dryRun = false, onProgress = () => {} }) {
  const originsDir = originsDirFor(casDir);
  const manifest = await loadManifest(manifestPath);

  // Map each content hash to the manifest entry that best represents its origin.
  const bySha = new Map();
  for (const entry of Object.values(manifest.files || {})) {
    const sha = entry.sha256;
    if (!sha) continue;
    const current = bySha.get(sha);
    bySha.set(sha, current ? preferEntry(current, entry) : entry);
  }

  // List the blobs actually on disk (ignore the origins subdir and any dotfiles).
  let names;
  try {
    names = await readdir(casDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') names = [];
    else throw err;
  }
  const blobs = names.filter((n) => SHA_RE.test(n));

  const result = { blobs: blobs.length, written: 0, recovered: 0, orphans: 0, upgraded: 0, skipped: 0, dryRun };

  for (const sha of blobs) {
    const existing = await loadOrigin(originsDir, sha);
    const entry = bySha.get(sha);

    // The record we'd write from current knowledge.
    let record;
    if (entry) {
      record = buildOriginRecord(entry, { createdAt: entry.syncedAt || null, provenance: 'recovered' });
    } else {
      const { size } = await stat(resolve(casDir, sha));
      record = buildOriginRecord(null, { sha256: sha, byteLength: size, provenance: 'unknown' });
    }

    // Apply the write-once-with-upgrade policy and tally the outcome.
    if (existing) {
      const canUpgrade = existing.provenance === 'unknown' && record.provenance !== 'unknown';
      if (!canUpgrade) {
        result.skipped += 1; // known origin, or still nothing to add — leave it
        continue;
      }
      if (!dryRun) await writeOrigin(originsDir, sha, record);
      result.upgraded += 1;
    } else if (entry) {
      if (!dryRun) await writeOrigin(originsDir, sha, record);
      result.recovered += 1;
    } else {
      if (!dryRun) await writeOrigin(originsDir, sha, record);
      result.orphans += 1;
    }
    result.written += 1;
  }

  onProgress(
    `Origins ${dryRun ? '(dry run) ' : ''}backfill: ${result.blobs} blob(s), ` +
      `${result.recovered} recovered, ${result.upgraded} upgraded from unknown, ` +
      `${result.orphans} orphan(s) with no provenance, ${result.skipped} already recorded.`,
  );
  return result;
}
