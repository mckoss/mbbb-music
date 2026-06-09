// Shared player-facing catalog types, mirroring the shape returned by
// GET /api/catalog (built server-side in src/sync/catalog.js).

import type { SongStatus } from './song-status';

// --- Auth -------------------------------------------------------------------
// Roles, highest-privilege first. 'admin' can view + manage users; 'member' and
// (future) 'organizer' can view the library. A null role means signed-in but
// not yet approved (the /pending state).
export type Role = 'admin' | 'member' | 'organizer';

export interface SessionUser {
  email: string;
  name: string | null;
  role: Role | null;
}

export interface CatalogPart {
  sha256: string;
  instrumentSlug: string;
  instrument: string | null;
  key: string | null;
  partNumber: number | null;
  format: string; // 'letter' | 'lyre'
  originalName: string | null;
  source: string | null; // canonical source label this copy came from
}

export interface CatalogAsset {
  sha256: string;
  originalName: string | null;
  source: string | null; // canonical source label this copy came from
  assetType?: string;
  instrumentSlug?: string; // set on audio: the isolated-part instrument, if any
}

// An unreachable shortcut (target not readable by the sync). No content/sha; it
// carries a Drive "request access" URL and is surfaced only on the health view.
export interface UnreachableItem {
  assetType: string;
  instrumentSlug: string | null;
  instrument: string | null;
  key: string | null;
  partNumber: number | null;
  format: string;
  originalName: string | null;
  source: string | null;
  driveUrl: string | null;
  unreachable: true;
}

export interface Tune {
  slug: string;
  title: string;
  status: SongStatus; // admin-assigned, or 'Unfiled' when unannotated
  lastModified: string | null;
  parts: CatalogPart[];
  scores: CatalogAsset[];
  audio: CatalogAsset[];
  musescore: CatalogAsset[];
  images: CatalogAsset[];
  files: CatalogAsset[];
  unreachable: UnreachableItem[];
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
  sources: string[]; // source labels in priority order (highest first)
  sourceUrls: Record<string, string>; // source label -> Google Drive folder URL
  uniqueCount: number;
  liveCount: number;
}
