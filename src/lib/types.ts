// Shared player-facing catalog types, mirroring the shape returned by
// GET /api/catalog (built server-side in src/sync/catalog.js).

export interface CatalogPart {
  sha256: string;
  instrumentSlug: string;
  instrument: string | null;
  key: string | null;
  partNumber: number | null;
  format: string; // 'letter' | 'lyre'
  originalName: string | null;
}

export interface CatalogAsset {
  sha256: string;
  originalName: string | null;
  assetType?: string;
}

export interface Tune {
  slug: string;
  title: string;
  lastModified: string | null;
  parts: CatalogPart[];
  scores: CatalogAsset[];
  audio: CatalogAsset[];
  musescore: CatalogAsset[];
  images: CatalogAsset[];
  files: CatalogAsset[];
}

export interface Instrument {
  slug: string;
  label: string;
  key: string | null;
}

export interface Catalog {
  tunes: Tune[];
  instruments: Instrument[];
  extras: CatalogAsset[];
  uniqueCount: number;
  liveCount: number;
}
