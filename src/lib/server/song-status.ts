// Server-only store of admin-assigned song statuses, keyed by song slug. Lives in
// a writable data/song-status.json so annotations survive a Drive re-sync (which
// only rewrites the manifest and the content store). Mirrors users.ts.

import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { normalizeStatus } from '$lib/song-status';
import type { SongStatus } from '$lib/song-status';

interface StatusFile {
  songs: Record<string, SongStatus>;
}

function statusPath(): string {
  return resolve(loadConfig().dataDir, 'song-status.json');
}

function readFile(): StatusFile {
  try {
    const parsed = JSON.parse(readFileSync(statusPath(), 'utf8'));
    return { songs: parsed.songs ?? {} };
  } catch {
    return { songs: {} };
  }
}

function writeFileAtomic(data: StatusFile): void {
  const path = statusPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** Map of slug -> assigned status (only annotated songs appear). */
export function statusMap(): Record<string, SongStatus> {
  return readFile().songs;
}

/** mtime of the status file (for cache invalidation), or -1 when absent. */
export function statusMtimeMs(): number {
  try {
    return statSync(statusPath()).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * Set (or clear) a song's status. A value that isn't one of the four assignable
 * statuses — notably "Unfiled" — removes the annotation so the song reverts to
 * the default. Returns the stored status, or null when cleared.
 */
export function setSongStatus(slug: string, value: unknown): SongStatus | null {
  const s = String(slug || '').trim();
  if (!s) throw new Error('missing song slug');
  const status = normalizeStatus(value);
  const data = readFile();
  if (status) {
    data.songs[s] = status;
  } else {
    delete data.songs[s];
  }
  writeFileAtomic(data);
  return status;
}
