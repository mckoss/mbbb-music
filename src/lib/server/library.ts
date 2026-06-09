// Server-side access to the synced library. Reads data/manifest.json (via the
// existing loadConfig) and the content-addressable store, derives the
// player-facing catalog with the shared model, and caches it until the manifest
// file changes on disk. Server-only ($lib/server is never bundled to the client).

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { buildCatalog, liveAssets } from '../../sync/catalog.js';
import { statusMap, statusMtimeMs } from './song-status.js';
import { DEFAULT_STATUS } from '$lib/song-status';

export interface AssetMeta {
  assetType: string;
  originalName: string | null;
  mimeType: string | null;
}

// The builder's catalog plus a label -> Drive folder URL map added here (the
// folder ids live in the server-only config, not the manifest).
type ServerCatalog = ReturnType<typeof buildCatalog> & { sourceUrls: Record<string, string> };

interface Loaded {
  mtimeMs: number;
  statusMtimeMs: number;
  catalog: ServerCatalog;
  assets: Map<string, AssetMeta>;
  casDir: string;
}

const EMPTY: Loaded = {
  mtimeMs: -1,
  statusMtimeMs: -1,
  catalog: { tunes: [], instruments: [], extras: [], sources: [], sourceUrls: {}, uniqueCount: 0, liveCount: 0 },
  assets: new Map(),
  casDir: '',
};

let cached: Loaded | null = null;

function load(): Loaded {
  const cfg = loadConfig();
  let stat;
  try {
    stat = statSync(cfg.manifestPath);
  } catch {
    // No manifest yet (no sync has run). Serve an empty catalog rather than 500.
    return EMPTY;
  }
  // The catalog also depends on the admin status file, so a status change must
  // invalidate the cache even when the manifest is untouched.
  const sMtime = statusMtimeMs();
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.statusMtimeMs === sMtime) return cached;

  const manifest = JSON.parse(readFileSync(cfg.manifestPath, 'utf8'));
  const sources = (cfg.sources || []) as { id?: string; label: string; foldered?: boolean }[];
  const sourceLabels = sources.map((s) => s.label).filter(Boolean);
  // Sources explicitly marked `foldered: false` aren't organized into per-song
  // folders; their files are grouped by the song embedded in each filename.
  const looseLabels = sources.filter((s) => s.foldered === false).map((s) => s.label);
  // Map each source label to its Google Drive folder URL so the UI can link to
  // the source in Drive.
  const sourceUrls: Record<string, string> = {};
  for (const s of sources) {
    if (s.label && s.id) sourceUrls[s.label] = `https://drive.google.com/drive/folders/${s.id}`;
  }
  // Attach each song's admin-assigned status (default 'Unfiled') here at the
  // server boundary, so the pure sync catalog stays decoupled from the store.
  const built = buildCatalog(manifest, sourceLabels, looseLabels);
  const statuses = statusMap();
  const tunes = built.tunes.map((t) => ({ ...t, status: statuses[t.slug] ?? DEFAULT_STATUS }));
  const catalog: ServerCatalog = { ...built, tunes, sourceUrls };

  // Index every live blob's type/name so the blob endpoint can set the right
  // Content-Type and refuse hashes that aren't part of the library.
  const assets = new Map<string, AssetMeta>();
  for (const e of liveAssets(manifest)) {
    if (e.sha256 && !assets.has(e.sha256)) {
      assets.set(e.sha256, { assetType: e.assetType, originalName: e.originalName ?? null, mimeType: e.mimeType ?? null });
    }
  }

  cached = { mtimeMs: stat.mtimeMs, statusMtimeMs: sMtime, catalog, assets, casDir: resolve(cfg.dataDir, 'cas') };
  return cached;
}

/** The player-facing catalog (tunes, instruments). */
export function getCatalog() {
  return load().catalog;
}

/** Metadata for a content blob, or null when the hash is not in the library. */
export function getAsset(sha: string): AssetMeta | null {
  return load().assets.get(sha) ?? null;
}

/** Absolute path of a content blob in the CAS. */
export function casPath(sha: string): string {
  return resolve(load().casDir, sha);
}
