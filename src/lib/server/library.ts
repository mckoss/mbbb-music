// Server-side access to the synced library. Reads data/manifest.json (via the
// existing loadConfig) and the content-addressable store, derives the
// player-facing catalog with the shared model, and caches it until the manifest
// file changes on disk. Server-only ($lib/server is never bundled to the client).

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { buildCatalog, liveAssets } from '../../sync/catalog.js';

export interface AssetMeta {
  assetType: string;
  originalName: string | null;
  mimeType: string | null;
}

interface Loaded {
  mtimeMs: number;
  catalog: ReturnType<typeof buildCatalog>;
  assets: Map<string, AssetMeta>;
  casDir: string;
}

const EMPTY: Loaded = {
  mtimeMs: -1,
  catalog: { tunes: [], instruments: [], uniqueCount: 0, liveCount: 0 },
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
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

  const manifest = JSON.parse(readFileSync(cfg.manifestPath, 'utf8'));
  const sourceLabels = (cfg.sources || []).map((s: { label: string }) => s.label).filter(Boolean);
  const catalog = buildCatalog(manifest, sourceLabels);

  // Index every live blob's type/name so the blob endpoint can set the right
  // Content-Type and refuse hashes that aren't part of the library.
  const assets = new Map<string, AssetMeta>();
  for (const e of liveAssets(manifest)) {
    if (e.sha256 && !assets.has(e.sha256)) {
      assets.set(e.sha256, { assetType: e.assetType, originalName: e.originalName ?? null, mimeType: e.mimeType ?? null });
    }
  }

  cached = { mtimeMs: stat.mtimeMs, catalog, assets, casDir: resolve(cfg.dataDir, 'cas') };
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
