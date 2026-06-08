// Shared catalog model derived from the sync manifest. Both the CLI
// (bin/library.js) and the web app read the library through these functions, so
// a file is grouped and attributed to the same song everywhere.
//
// The manifest stores one row per Drive file (many rows may share one CAS blob
// when identical bytes appear in several folders/sources). The catalog collapses
// those to one entry per unique content hash, attributing each to its canonical
// location: the copy in the highest-priority source wins, and within a source a
// real song folder beats an index/admin container (e.g. "50 Indexed By
// Instrument"). On top of that it groups by song into tunes with parts, scores,
// audio, and MuseScore sources.

import { slugify, slugifyStem } from './slugify.js';
import { DEFAULT_KEY_BY_SLUG } from './instruments.js';

/** True for a manifest entry that still represents a present, downloaded asset. */
export function isLive(entry) {
  const status = entry.status || '';
  return status !== 'deleted' && !status.startsWith('ignored');
}

/** All live (present, non-ignored, non-deleted) manifest entries. */
export function liveAssets(manifest) {
  return Object.values(manifest.files || {}).filter(isLive);
}

/**
 * The song slug for an entry. Prefers the slug stored at sync time
 * (`songTitleSlug`), falling back to slugifying the title for manifests written
 * before that field existed.
 */
export function songSlugOf(entry) {
  return entry.songTitleSlug || slugify(entry.songTitle || '') || '(unknown)';
}

/**
 * The effective written key for a part: the explicitly detected key, else the
 * instrument's default transposition (a B♭ trumpet with no key token is still
 * in B♭), else null for untransposed instruments (flute, drums).
 */
export function effectiveKey(entry) {
  if (!entry.instrumentSlug) return null;
  return entry.key || DEFAULT_KEY_BY_SLUG[entry.instrumentSlug] || null;
}

/** A valid (>= 1) part number, or null. */
function partNumberOf(entry) {
  return Number.isInteger(entry.partNumber) && entry.partNumber >= 1 ? entry.partNumber : null;
}

/**
 * The instrument-key-part descriptor for one asset, anchored on a detected
 * instrument (default key folded in). A stray key/part with no instrument is
 * not a real part, so those fall back to naming the file.
 */
export function descriptorOf(entry) {
  if (entry.instrumentSlug) {
    return [entry.instrumentSlug, effectiveKey(entry), partNumberOf(entry)]
      .filter((p) => p != null && p !== '')
      .join('-');
  }
  return `${entry.assetType || 'file'} (${entry.originalName || entry.driveFileId})`;
}

/**
 * The slug identifier a prefix can match: "<song>-<instrument>-<key>-<part>" for
 * instrument parts, or "<song>-<type>" (e.g. "unholy-musescore") for assets with
 * no detected instrument. Targets a whole song, a media type, or a single part.
 */
export function assetMatchKey(entry) {
  const songSlug = songSlugOf(entry);
  return entry.instrumentSlug ? `${songSlug}-${descriptorOf(entry)}` : `${songSlug}-${entry.assetType || 'file'}`;
}

/**
 * Every identifier a CLI prefix may match for an asset: the song/instrument (or
 * song/type) key from {@link assetMatchKey}, plus the file's own name with and
 * without its extension. This lets instrument-less files — especially loose
 * "misc" items like a logo image — be opened by name (e.g. "mutiny-bay-logo"),
 * not only by the coarse "<song>-<type>" key (e.g. "misc-image").
 */
export function matchIdentifiers(entry) {
  const ids = new Set([assetMatchKey(entry)]);
  const name = entry.originalName || '';
  const stem = slugifyStem(name); // filename without extension
  const full = slugify(name); // filename including extension
  if (stem) ids.add(stem);
  if (full) ids.add(full);
  return [...ids].filter(Boolean);
}

/**
 * Index/admin folders that hold copies organized by something other than song
 * (by instrument, by file type, notes). Their top-level folder name is NOT a
 * song, so when the same content also lives under a real song folder that copy
 * wins.
 */
export function isContainerFolder(name) {
  const n = String(name || '');
  return /indexed by instrument/i.test(n) || /^\d+\s+(notes|audio|full scores|musescore|indexed)/i.test(n);
}

/**
 * Build a source-priority lookup (label -> rank, lower = higher priority) from
 * the configured source order, appending any manifest-only labels after it.
 *
 * @param {string[]} sourceLabels  Configured source labels, in priority order.
 * @param {object} manifest
 * @returns {Map<string, number>}
 */
export function sourcePriority(sourceLabels, manifest) {
  const pri = new Map();
  let next = 0;
  for (const label of sourceLabels || []) {
    if (label && !pri.has(label)) pri.set(label, next++);
  }
  for (const e of Object.values(manifest.files || {})) {
    if (e.sourceFolderLabel && !pri.has(e.sourceFolderLabel)) pri.set(e.sourceFolderLabel, next++);
  }
  return pri;
}

/**
 * Pick the canonical location for one content blob: the copy in the
 * highest-priority source wins; within a source, a real song folder beats an
 * index/admin container; otherwise keep the first seen.
 */
function isMoreCanonical(candidate, current, pri) {
  const rank = (e) => (pri.has(e.sourceFolderLabel) ? pri.get(e.sourceFolderLabel) : Number.MAX_SAFE_INTEGER);
  if (rank(candidate) !== rank(current)) return rank(candidate) < rank(current);
  const container = (e) => (isContainerFolder(e.originalFolder) ? 1 : 0);
  if (container(candidate) !== container(current)) return container(candidate) < container(current);
  return false;
}

/**
 * Collapse the live manifest to one canonical entry per unique content blob
 * (CAS sha256), choosing the highest-priority location for each.
 *
 * @returns {{ canonical: Map<string, object>, liveCount: number }}
 */
export function canonicalByContent(manifest, pri) {
  const canonical = new Map(); // sha (or id fallback) -> entry
  let liveCount = 0;
  for (const entry of liveAssets(manifest)) {
    liveCount += 1;
    const key = entry.sha256 || `id:${entry.driveFileId}`;
    const cur = canonical.get(key);
    if (!cur || isMoreCanonical(entry, cur, pri)) canonical.set(key, entry);
  }
  return { canonical, liveCount };
}

function comparePart(a, b) {
  if (a.instrumentSlug !== b.instrumentSlug) return a.instrumentSlug.localeCompare(b.instrumentSlug);
  return (a.partNumber ?? 0) - (b.partNumber ?? 0);
}

/**
 * @typedef {Object} CatalogPart
 * @property {string} sha256
 * @property {string} instrumentSlug
 * @property {string|null} instrument
 * @property {string|null} key           Effective key (explicit or instrument default).
 * @property {number|null} partNumber
 * @property {string|null} originalName
 *
 * @typedef {Object} CatalogAsset
 * @property {string} sha256
 * @property {string|null} originalName
 * @property {string} [assetType]         Present for images/other files, to label/route them.
 *
 * @typedef {Object} Tune
 * @property {string} slug
 * @property {string} title
 * @property {string|null} lastModified
 * @property {CatalogPart[]} parts        Per-instrument PDF parts.
 * @property {CatalogAsset[]} scores      Instrument-less PDFs (full scores, notes).
 * @property {CatalogAsset[]} audio       MP3 practice/reference tracks.
 * @property {CatalogAsset[]} musescore   MuseScore source files.
 * @property {CatalogAsset[]} images      Images (JPEG) embeddable in the view.
 * @property {CatalogAsset[]} files       Other downloadable files (docx, zip, …).
 */

/**
 * Build the player-facing catalog: tunes grouped by song, each with its
 * per-instrument parts, full scores, audio, and MuseScore sources. Every unique
 * content blob appears once, attributed to its canonical song.
 *
 * @param {object} manifest
 * @param {string[]} [sourceLabels]  Configured source labels in priority order.
 * @returns {{ tunes: Tune[], instruments: {slug:string,label:string}[], uniqueCount:number, liveCount:number }}
 */
export function buildCatalog(manifest, sourceLabels = []) {
  const pri = sourcePriority(sourceLabels, manifest);
  const { canonical, liveCount } = canonicalByContent(manifest, pri);

  const bySong = new Map();
  for (const e of canonical.values()) {
    // Index/admin folders (e.g. "50 Indexed By Instrument", "20 Audio Files")
    // aren't songs. Content whose canonical home is such a folder — i.e. it has
    // no copy in a real song folder — is surfaced under Misc rather than as a
    // bogus title. (Copies that also live in a real song folder already lose the
    // dedup tiebreak to that folder, so they never reach here.)
    const container = isContainerFolder(e.originalFolder);
    const slug = container ? 'misc' : songSlugOf(e);
    if (!bySong.has(slug)) {
      bySong.set(slug, {
        slug,
        title: container ? 'Misc' : e.songTitle || '(unknown)',
        lastModified: null,
        parts: [],
        scores: [],
        audio: [],
        musescore: [],
        images: [],
        files: [],
      });
    }
    const song = bySong.get(slug);
    if (e.modifiedTime && (!song.lastModified || e.modifiedTime > song.lastModified)) {
      song.lastModified = e.modifiedTime;
    }
    const asset = { sha256: e.sha256, originalName: e.originalName || null };
    if (e.assetType === 'pdf' && e.instrumentSlug) {
      song.parts.push({
        ...asset,
        instrument: e.instrument || null,
        instrumentSlug: e.instrumentSlug,
        key: effectiveKey(e),
        partNumber: partNumberOf(e),
      });
    } else if (e.assetType === 'pdf') {
      song.scores.push(asset);
    } else if (e.assetType === 'mp3') {
      song.audio.push(asset);
    } else if (e.assetType === 'musescore') {
      song.musescore.push(asset);
    } else if (e.assetType === 'image') {
      song.images.push({ ...asset, assetType: e.assetType });
    } else {
      // Any other accepted type (doc, archive, …) is a generic downloadable file.
      song.files.push({ ...asset, assetType: e.assetType });
    }
  }

  const tunes = [...bySong.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((s) => ({ ...s, parts: s.parts.sort(comparePart) }));

  const instLabels = new Map();
  for (const t of tunes) {
    for (const p of t.parts) {
      if (!instLabels.has(p.instrumentSlug)) instLabels.set(p.instrumentSlug, p.instrument || p.instrumentSlug);
    }
  }
  const instruments = [...instLabels.entries()]
    .map(([slug, label]) => ({ slug, label, key: DEFAULT_KEY_BY_SLUG[slug] ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { tunes, instruments, uniqueCount: canonical.size, liveCount };
}

/**
 * A standardized, app-generated download filename for a part:
 * "mbbb-<song>-<instrument>[-<key>][-part<N>].pdf".
 */
export function partDownloadName(songSlug, part) {
  return (
    ['mbbb', songSlug, part.instrumentSlug, part.key, part.partNumber ? `part${part.partNumber}` : null]
      .filter(Boolean)
      .join('-') + '.pdf'
  );
}
