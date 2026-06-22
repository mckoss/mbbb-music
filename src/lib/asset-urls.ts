// Human, slug-based URLs for downloadable/openable assets, so the raw content
// hash never leaks into a URL bar or a saved filename. The path *is* the
// friendly name: `/score/<song>/<instrument>.pdf`, `/audio/<song>/<take>.mp3`.
//
// The mapping slug -> bytes is mutable (a re-sync can repoint a name at new
// content), so these URLs are NOT content-addressed and must not be served
// `immutable`. The download route validates with `ETag: "<sha>"` instead — see
// src/lib/server/download.ts. (Internal, never-surfaced URLs — MP3 playback and
// the /render score images — stay sha-addressed + immutable; this is only the
// user-facing layer.)
//
// Paths are namespaced per song, so name collisions are local to one song and a
// component holding just its own tunes builds the exact same paths the server
// resolves from the full catalog.

import { slugify } from '../sync/slugify.js';
import { stripCopyOf } from './format.js';

// Structural shapes — just the fields this module reads. Kept minimal so both
// the player-facing catalog (src/lib/types) and the richer server catalog
// (src/sync/catalog, which omits e.g. `status`) satisfy them without a cast.
interface PartLike {
  sha256: string;
  instrumentSlug: string;
  key: string | null;
  partNumber: number | null;
  partNumbers?: number[]; // every number a combined chart covers ("1 & 2" → [1,2])
  // Present at runtime on both catalogs; optional only because the server
  // catalog's JSDoc type omits it. Guarded before use.
  format?: string;
}
interface AssetLike {
  sha256: string;
  originalName: string | null;
  assetType?: string;
}
interface TuneLike {
  slug: string;
  displaySlug?: string;
  parts: PartLike[];
  scores: AssetLike[];
  notes: AssetLike[];
  audio: AssetLike[];
  musescore: AssetLike[];
  images: AssetLike[];
  files: AssetLike[];
}
interface CatalogLike {
  tunes: TuneLike[];
  extras?: AssetLike[];
}

export interface AssetIndex {
  /** friendly path (no leading slash) -> content sha */
  byPath: Map<string, string>;
  /** content sha -> friendly path, for building a link from an asset */
  bySha: Map<string, string>;
  /** content sha -> canonical download filename (song-prefixed, e.g.
   *  `baile-inolvidable-trumpet-bflat-part1-letter.pdf`), used for `?dl`. */
  nameBySha: Map<string, string>;
}

/** The human song segment: the display slug if set, else the identity slug. */
function songSeg(t: TuneLike): string {
  return slugify(t.displaySlug || t.slug) || t.slug;
}

/** The `part<n>` token, joining a combined chart's numbers ("part1-2"), or ''. */
function partToken(p: PartLike): string {
  const nums = p.partNumbers?.length ? p.partNumbers : p.partNumber != null ? [p.partNumber] : [];
  return nums.length ? `part${nums.join('-')}` : '';
}

/** Instrument-part PDF name: `<instrument>[-<key>][-part<n>][-lyre]`. */
function partName(p: PartLike): string {
  const bits = [p.instrumentSlug || 'part'];
  if (p.key) bits.push(slugify(p.key));
  const pt = partToken(p);
  if (pt) bits.push(pt);
  if (p.format && p.format !== 'letter') bits.push(slugify(p.format)); // 'lyre'
  return bits.filter(Boolean).join('-');
}

/** Canonical part name for a *download*: like {@link partName} but the print
 *  format is always spelled out (`-letter`/`-lyre`), so a saved file always names
 *  its format. Combined with the song prefix in {@link addTune} this yields
 *  `<song>-<instrument>[-<key>][-part<n>]-<format>.pdf`. */
function partDownloadName(p: PartLike): string {
  const bits = [p.instrumentSlug || 'part'];
  if (p.key) bits.push(slugify(p.key));
  const pt = partToken(p);
  if (pt) bits.push(pt);
  bits.push(slugify(p.format || 'letter'));
  return bits.filter(Boolean).join('-');
}

/** Slug of an asset's original name (extension stripped), or a fallback. */
function stem(a: { originalName: string | null }, fallback: string): string {
  const raw = a.originalName ? stripCopyOf(a.originalName).replace(/\.[^.]+$/, '') : '';
  return slugify(raw) || fallback;
}

/** Original-name extension (lowercased, no dot), or a per-type default. */
function ext(a: { originalName: string | null; assetType?: string }, fallback: string): string {
  const m = a.originalName?.match(/\.([a-z0-9]+)$/i);
  return (m ? m[1] : fallback).toLowerCase();
}

/**
 * Extension for an "other file" / extra. Notes (Google Docs/Sheets) are exported
 * to PDF and have no source extension, so they must be `.pdf` — otherwise they
 * fall back to `.bin` and get served as an unviewable octet/Google-mime blob.
 */
function extOf(a: { originalName: string | null; assetType?: string }): string {
  return a.assetType === 'notes' ? 'pdf' : ext(a, 'bin');
}

/**
 * Add `<dir>/<base>.<ext>` to the index, suffixing `-2`, `-3`… on collision.
 * `dlBase` (defaulting to `base`) is the canonical download filename stem recorded
 * in `nameBySha`; it's song-prefixed by the callers so a saved file is fully named.
 */
function place(
  idx: AssetIndex,
  dir: string,
  base: string,
  extension: string,
  sha: string,
  dlBase: string = base,
): void {
  let name = `${base}.${extension}`;
  for (let i = 2; idx.byPath.has(`${dir}/${name}`); i++) name = `${base}-${i}.${extension}`;
  const path = `${dir}/${name}`;
  idx.byPath.set(path, sha);
  if (!idx.bySha.has(sha)) idx.bySha.set(sha, path);
  if (!idx.nameBySha.has(sha)) idx.nameBySha.set(sha, `${dlBase}.${extension}`);
}

/** Fold one tune's downloadable assets into the index. Download names are
 *  song-prefixed so a saved file stands alone (the URL path keeps the song in the
 *  directory segment instead, to stay short). */
function addTune(idx: AssetIndex, t: TuneLike): void {
  const song = songSeg(t);

  // PDFs (parts, full scores, notes) all live under /score/<song>/.
  for (const p of t.parts) place(idx, `score/${song}`, partName(p), 'pdf', p.sha256, `${song}-${partDownloadName(p)}`);
  for (const s of t.scores) place(idx, `score/${song}`, stem(s, 'full-score'), 'pdf', s.sha256, `${song}-${stem(s, 'full-score')}`);
  for (const n of t.notes) place(idx, `score/${song}`, `notes-${stem(n, 'notes')}`, 'pdf', n.sha256, `${song}-notes-${stem(n, 'notes')}`);

  // MuseScore source.
  for (const m of t.musescore) place(idx, `source/${song}`, stem(m, 'full-score'), 'mscz', m.sha256, `${song}-${stem(m, 'full-score')}`);

  // Recordings.
  for (const a of t.audio) place(idx, `audio/${song}`, stem(a, song), 'mp3', a.sha256, `${song}-${stem(a, song)}`);

  // Images and other files keep their original extension. Notes are Google
  // Docs/Sheets exported to PDF, so they carry no usable source extension —
  // serve them as `.pdf` (like t.notes above) rather than a bare `.bin`.
  for (const im of t.images) place(idx, `file/${song}`, stem(im, 'image'), ext(im, 'jpg'), im.sha256, `${song}-${stem(im, 'image')}`);
  for (const f of t.files) place(idx, `file/${song}`, stem(f, f.assetType ?? 'file'), extOf(f), f.sha256, `${song}-${stem(f, f.assetType ?? 'file')}`);
}

/** Build the full slug→sha index from a catalog. */
export function buildAssetIndex(catalog: CatalogLike): AssetIndex {
  const idx: AssetIndex = { byPath: new Map(), bySha: new Map(), nameBySha: new Map() };
  for (const t of catalog.tunes) addTune(idx, t);
  for (const e of catalog.extras ?? []) {
    place(idx, 'file/extras', stem(e, e.assetType ?? 'file'), extOf(e), e.sha256);
  }
  return idx;
}

const cache = new WeakMap<object, AssetIndex>();

/** Memoized index for a catalog object (keyed on identity). */
export function assetIndexFor(catalog: CatalogLike): AssetIndex {
  let idx = cache.get(catalog);
  if (!idx) {
    idx = buildAssetIndex(catalog);
    cache.set(catalog, idx);
  }
  return idx;
}

/** The friendly URL (leading slash) for a content sha, or null if unmapped. */
export function urlForSha(idx: AssetIndex, sha: string): string | null {
  const path = idx.bySha.get(sha);
  return path ? `/${path}` : null;
}
