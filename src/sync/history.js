// Preserved sync history. Every real (non-dry-run) sync writes one JSON record to
// data/sync-history/<run id>.json: when it ran, who started it, its summary
// counts, warnings and failures, the progress log, and — the point of it — a
// per-file list of what the run actually changed in the manifest (files added,
// removed, restored, and updated, with each changed field's before → after).
//
// The changes are computed by diffing the manifest as it stood before the run
// against what the run left on disk, so they reflect real outcomes (including a
// run that failed part-way) rather than the planner's intentions. Sync re-reads
// every file's metadata each run, so a classifier improvement that moves a file
// to a different instrument or part shows up here as an update too.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** How many runs to keep; older records are pruned on write. */
export const HISTORY_KEEP = 200;

const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** data/sync-history for a data dir. */
export function historyDirFor(dataDir) {
  return resolve(dataDir, 'sync-history');
}

/** A filename-safe, sortable run id from an ISO timestamp: 2026-10-07T18-04-05-123Z. */
export function runIdFor(iso) {
  return String(iso).replace(/[:.]/g, '-');
}

/** True for a well-formed run id (also guards file reads against path tricks). */
export function isRunId(id) {
  return RUN_ID.test(String(id ?? ''));
}

const partText = (e) => {
  const nums = e?.partNumbers?.length ? e.partNumbers : e?.partNumber != null ? [e.partNumber] : [];
  return nums.length ? nums.join(' & ') : null;
};
const folderText = (e) => (e?.folderPath?.length ? e.folderPath.join(' / ') : (e?.originalFolder ?? null));
// pending → synced is just a download finishing, not a state worth reporting.
const statusText = (e) => (e?.status === 'pending' ? 'synced' : (e?.status ?? null));

/**
 * The manifest fields a sync change is reported on, in display order. `get`
 * reads a comparable display value from a manifest entry (null when absent).
 */
const TRACKED = [
  { field: 'name', label: 'Name', get: (e) => e?.originalName ?? null },
  { field: 'folder', label: 'Folder', get: folderText },
  { field: 'content', label: 'Content', get: (e) => e?.sha256 ?? null },
  { field: 'song', label: 'Song', get: (e) => e?.songTitle ?? null },
  { field: 'instrument', label: 'Instrument', get: (e) => e?.instrument ?? null },
  { field: 'part', label: 'Part', get: partText },
  { field: 'key', label: 'Key', get: (e) => e?.key ?? null },
  { field: 'role', label: 'Role', get: (e) => e?.role ?? null },
  { field: 'clef', label: 'Clef', get: (e) => e?.clef ?? null },
  { field: 'type', label: 'Type', get: (e) => e?.assetType ?? null },
  { field: 'status', label: 'Status', get: statusText },
];

/** A compact description of one entry, for added/removed rows. */
function describe(e) {
  return {
    name: e.originalName ?? null,
    folder: folderText(e),
    song: e.songTitle ?? null,
    instrument: e.instrument ?? null,
    part: partText(e),
    key: e.key ?? null,
    type: e.assetType ?? null,
    status: statusText(e),
    sha256: e.sha256 ?? null,
    size: e.size != null ? Number(e.size) : null,
  };
}

/**
 * Per-file changes between two manifests' `files` maps.
 *
 * Kinds:
 *   - added     a file the library had never seen (imported)
 *   - ignored   a newly seen file the sync doesn't import (shortcut, junk, …)
 *   - removed   a file that disappeared from Drive (archived; its blob is kept)
 *   - restored  a previously removed file that is back
 *   - updated   a known file whose name, folder, content, or classification
 *               (song / instrument / part / key / …) changed
 *
 * @param {Record<string, object>} before  manifest.files before the run
 * @param {Record<string, object>} after   manifest.files after the run
 * @returns {Array<object>} sorted by kind, then song, then name
 */
export function diffSyncManifests(before = {}, after = {}) {
  const changes = [];
  for (const [id, a] of Object.entries(after || {})) {
    const b = before?.[id];
    if (!b) {
      const ignored = String(a.status ?? '').startsWith('ignored');
      changes.push({ id, kind: ignored ? 'ignored' : 'added', ...describe(a) });
      continue;
    }
    const wasGone = b.status === 'deleted';
    const isGone = a.status === 'deleted';
    if (!wasGone && isGone) {
      changes.push({ id, kind: 'removed', ...describe(b) });
      continue;
    }
    const fields = [];
    for (const t of TRACKED) {
      // Status is implied by the kind for a restore; report it only on updates.
      if (wasGone && t.field === 'status') continue;
      const from = t.get(b);
      const to = t.get(a);
      if (from !== to) fields.push({ field: t.field, label: t.label, from, to });
    }
    if (wasGone && !isGone) {
      changes.push({ id, kind: 'restored', ...describe(a), fields });
    } else if (fields.length) {
      changes.push({ id, kind: 'updated', ...describe(a), fields });
    }
  }
  const order = { added: 0, updated: 1, restored: 2, removed: 3, ignored: 4 };
  changes.sort(
    (x, y) =>
      order[x.kind] - order[y.kind] ||
      String(x.song ?? '').localeCompare(String(y.song ?? '')) ||
      String(x.name ?? '').localeCompare(String(y.name ?? '')),
  );
  return changes;
}

/** Count changes by kind: { added, updated, restored, removed, ignored }. */
export function countChanges(changes = []) {
  const counts = { added: 0, updated: 0, restored: 0, removed: 0, ignored: 0 };
  for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return counts;
}

/**
 * Write one run record (atomically) and prune the oldest beyond `keep`.
 *
 * @param {string} dir     data/sync-history
 * @param {object} record  must carry `id` (see runIdFor)
 */
export async function saveSyncRun(dir, record, { keep = HISTORY_KEEP } = {}) {
  if (!isRunId(record?.id)) throw new Error(`Invalid sync run id: ${record?.id}`);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${record.id}.json`);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8');
  await rename(tmp, path);

  const ids = await runIds(dir);
  for (const old of ids.slice(keep)) {
    await unlink(resolve(dir, `${old}.json`)).catch(() => {});
  }
}

/** Run ids on disk, newest first. */
async function runIds(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -'.json'.length))
    .filter(isRunId)
    .sort()
    .reverse();
}

/** One full run record, or null when absent/unreadable/invalid id. */
export async function loadSyncRun(dir, id) {
  if (!isRunId(id)) return null;
  try {
    return JSON.parse(await readFile(resolve(dir, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every recorded run, newest first, without the bulky per-file changes and log —
 * just what a history list needs (plus change counts by kind).
 */
export async function listSyncRuns(dir) {
  const out = [];
  for (const id of await runIds(dir)) {
    const run = await loadSyncRun(dir, id);
    if (!run) continue;
    // eslint-disable-next-line no-unused-vars
    const { changes, log, ...rest } = run;
    out.push({ ...rest, changeCounts: countChanges(changes) });
  }
  return out;
}
