// Shared player-facing catalog types, mirroring the shape returned by
// GET /api/catalog (built server-side in src/sync/catalog.js).

import type { SongStatus } from './song-status';

// --- Auth -------------------------------------------------------------------
// Roles, highest-privilege first. 'admin' can view + manage users; 'organizer'
// can manage gig packets; 'member' can view the library. A null role means
// signed-in but not yet approved (the /pending state).
export type Role = 'admin' | 'member' | 'organizer';

export interface SessionUser {
  email: string;
  name: string | null;
  role: Role | null;
}

export interface CatalogPart {
  sha256: string;
  driveFileId?: string; // canonical Drive file id, for targeting metadata corrections
  folderId?: string; // song-folder Drive id, for folder-level song reassignment
  folder?: string | null; // song-folder name (display)
  instrumentSlug: string;
  instrument: string | null;
  key: string | null;
  partNumber: number | null; // first part number (sorting/dedup)
  partNumbers?: number[]; // every number a combined chart covers ("1 & 2" → [1,2])
  format: string; // 'letter' | 'lyre'
  originalName: string | null;
  source: string | null; // canonical source label this copy came from
  generated?: boolean; // app-generated (MuseScore output) — masks manual copies
  modifiedTime?: string | null; // Drive last-modified ISO time
}

export interface CatalogAsset {
  sha256: string;
  driveFileId?: string; // canonical Drive file id, for targeting metadata corrections
  folderId?: string; // song-folder Drive id, for folder-level song reassignment
  folder?: string | null; // song-folder name (display)
  originalName: string | null;
  source: string | null; // canonical source label this copy came from
  assetType?: string;
  instrumentSlug?: string; // set on audio: the isolated-part instrument, if any
  generated?: boolean; // app-generated (MuseScore output) — masks manual copies
  museScore?: boolean; // set on audio: the app-generated full-band "MuseScore Audio" mix
  modifiedTime?: string | null; // Drive last-modified ISO time
}

// A manually-created score/part hidden by an app-generated replacement. Kept off
// the player/score views but surfaced (clickable) on the Library Status masked
// row. `bucket` records which column it came from; the part fields are present
// only when it came from `parts`.
export interface MaskedItem extends CatalogAsset {
  bucket: 'parts' | 'scores';
  instrument?: string | null;
  key?: string | null;
  partNumber?: number | null;
  partNumbers?: number[];
  format?: string;
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

// Count-in tempo for the practice player, resolved from the song's MuseScore
// file (opening tempo/time signature) with optional human overrides. All values
// are in FELT beats — the count a bandleader would give (6/8 → 2 beats per bar).
export interface TuneTempo {
  bpm: number; // felt-beat BPM the count-in ticks at
  beatsPerBar: number; // felt beats per bar (6/8 → 2, 4/4 → 4)
  timeSig: string; // display signature as written, e.g. "6/8"
  pickupBeats?: number; // felt beats of anacrusis; playback starts this many beats early
  source: 'score' | 'override';
}

export interface Tune {
  slug: string; // stable identity (derived from the sync); gig setlists + status key on it
  displaySlug?: string; // slug-like, for download filenames / user-facing slug uses
  title: string;
  videoUrl?: string; // human-entered reference-video link (YouTube), not a synced asset
  tempo?: TuneTempo; // count-in tempo (absent when no .mscz and no override)
  status: SongStatus; // admin-assigned, or 'Unfiled' when unannotated
  lastModified: string | null;
  parts: CatalogPart[];
  scores: CatalogAsset[]; // instrument-less true PDFs (full/band scores)
  notes: CatalogAsset[]; // Google Docs exported to PDF — viewable, never a printable score
  audio: CatalogAsset[];
  musescore: CatalogAsset[];
  images: CatalogAsset[];
  files: CatalogAsset[];
  unreachable: UnreachableItem[];
  masked: MaskedItem[]; // manual scores/parts hidden by a generated replacement
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
