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
import { isJunkName } from './classify.js';

/** True for a manifest entry that still represents a present, downloaded asset. */
export function isLive(entry) {
  const status = entry.status || '';
  return status !== 'deleted' && !status.startsWith('ignored');
}

/**
 * All live (present, non-ignored, non-deleted) manifest entries, excluding OS
 * junk. The junk filter here also hides junk already recorded as `synced` in an
 * older manifest (e.g. "._x.pdf"), so the catalog is clean without a re-sync.
 */
export function liveAssets(manifest) {
  return Object.values(manifest.files || {}).filter((e) => isLive(e) && !isJunkName(e.originalName));
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

/** Is token-run `a` a leading prefix of token-run `b`? (token-level, not chars) */
function tokensPrefix(a, b) {
  if (a.length === 0 || a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Match a filename to a known song by the song title embedded in the name —
 * for files that aren't organized into per-song folders (e.g. a flat library
 * folder). A song matches when its slug is a leading token-run of the filename
 * ("bad-guy" in "bad-guy-sound-machine-trumpet") or the filename is a leading
 * token-run of the song slug ("baile" → "baile-inolvidable"); the most specific
 * (longest) known song wins. Returns { slug, title } or null.
 *
 * @param {string|null} originalName
 * @param {Array<{slug:string,title:string,tokens:string[]}>} known  Longest-slug first.
 */
export function matchKnownSong(originalName, known) {
  const fileSlug = slugifyStem(originalName || '').replace(/^(?:copy-of-)+/, '');
  if (!fileSlug) return null;
  const ft = fileSlug.split('-');
  for (const k of known) {
    if (tokensPrefix(k.tokens, ft) || tokensPrefix(ft, k.tokens)) return { slug: k.slug, title: k.title };
  }
  return null;
}

// "Voice" tokens identify a part's instrument and written key/clef. A run of
// these at the START of a name is the instrument prefix ("Trumpet Medicated
// Chicken Water") and is skipped to reach the song that follows.
const VOICE_TOKENS = new Set([
  // instruments
  'trumpet', 'cornet', 'trombone', 'tuba', 'sousaphone', 'flute', 'clarinet', 'euphonium',
  'baritone', 'bari', 'mellophone', 'melodica', 'horn', 'sax', 'saxophone', 'alto', 'tenor',
  'soprano', 'piccolo', 'drum', 'drums', 'drumset', 'snare', 'cymbal', 'cymbals', 'percussion',
  'quad', 'toms', 'tupan', 'glockenspiel', 'glock', 'bells', 'kit', 'rig', 'vocals',
  // keys / clefs / transposition
  'bass', 'treble', 'clef', 'bb', 'eb', 'ab', 'f', 'c', 'd', 'g', 'a', 'flat', 'sharp',
  'concert', 'in', 'bc', 'tc',
]);

// Format/section words. With voice tokens these mark the end of the song name,
// but unlike voice tokens they are NOT skipped at the start (so "Score and
// Parts" yields no song prefix rather than digging out "and").
const FORMAT_TOKENS = new Set([
  'score', 'parts', 'part', 'full', 'melody', 'harmony', 'lyre', 'letter', 'lyrics', 'notes',
  'finale', 'standardized', 'version', 'low', 'high', 'hi', 'lo', 'updated', 'line', 'groove', 'set',
]);

/** A token that identifies a part's instrument or key/clef. */
function isVoiceToken(t) {
  return VOICE_TOKENS.has(t);
}

/** Any descriptor token, or a bare/version number (e.g. "2", "v1", "3.1"). */
function isDescriptorToken(t) {
  return VOICE_TOKENS.has(t) || FORMAT_TOKENS.has(t) || /^v?\d+(\.\d+)*$/.test(t);
}

/**
 * The song prefix embedded in a part filename, used to cluster unfoldered files
 * that share a song. The "Copy of" prefix is stripped; a leading instrument/key
 * run is skipped (so "Trumpet Medicated Chicken Water" → "medicated-chicken-
 * water"); then the run of tokens up to the first descriptor is the song
 * ("anthrax-trumpet-in-bb" → "anthrax"). Returns '' when no song name remains.
 */
export function songPrefixOf(name) {
  const slug = slugifyStem(name || '').replace(/^(?:copy-of-)+/, '');
  if (!slug) return '';
  const tokens = slug.split('-');
  let i = 0;
  while (i < tokens.length && isVoiceToken(tokens[i])) i++; // skip a leading instrument/key run
  const out = [];
  for (; i < tokens.length; i++) {
    if (isDescriptorToken(tokens[i])) break;
    out.push(tokens[i]);
  }
  return out.join('-');
}

/** Title-case a song slug for display: "we-are-number-one" → "We Are Number One". */
function titleCaseSlug(slug) {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Build the player-facing catalog: tunes grouped by song, each with its
 * per-instrument parts, full scores, audio, and MuseScore sources. Every unique
 * content blob appears once, attributed to its canonical song.
 *
 * Files in a real per-song folder are attributed to that folder. Files that are
 * NOT foldered by song — those in a `looseSourceLabels` source, or in an
 * index/admin container folder — are matched by the song embedded in their
 * filename and merged into the matching foldered song; anything that matches no
 * known song is returned in `extras` (surfaced on the Extra Files tab), never as
 * a bogus "Misc" song.
 *
 * @param {object} manifest
 * @param {string[]} [sourceLabels]       Configured source labels in priority order.
 * @param {string[]} [looseSourceLabels]  Labels of sources NOT foldered by song.
 * @returns {{ tunes: Tune[], instruments: {slug:string,label:string}[], extras: CatalogAsset[], uniqueCount:number, liveCount:number }}
 */
export function buildCatalog(manifest, sourceLabels = [], looseSourceLabels = []) {
  const pri = sourcePriority(sourceLabels, manifest);
  const { canonical, liveCount } = canonicalByContent(manifest, pri);
  const loose = new Set(looseSourceLabels || []);

  // A real per-song folder: not a loose (unfoldered) source, has a folder, and
  // that folder isn't an index/admin container.
  const isRealSongFolder = (e) =>
    !loose.has(e.sourceFolderLabel) && e.originalFolder && !isContainerFolder(e.originalFolder);

  // Known songs are the real per-song folders; loose/container files match into
  // these by filename. Longest slug first so the most specific song wins.
  const knownMap = new Map();
  for (const e of canonical.values()) {
    if (!isRealSongFolder(e)) continue;
    const slug = songSlugOf(e);
    if (slug && !knownMap.has(slug)) knownMap.set(slug, e.songTitle || slug);
  }
  const known = [...knownMap.entries()]
    .map(([slug, title]) => ({ slug, title, tokens: slug.split('-') }))
    .sort((a, b) => b.tokens.length - a.tokens.length);

  const bySong = new Map();
  const extras = [];
  const extraOf = (e) => ({ sha256: e.sha256, originalName: e.originalName || null, assetType: e.assetType });

  const getSong = (slug, title) => {
    let song = bySong.get(slug);
    if (!song) {
      song = { slug, title, lastModified: null, parts: [], scores: [], audio: [], musescore: [], images: [], files: [] };
      bySong.set(slug, song);
    }
    return song;
  };

  const addAsset = (song, e) => {
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
  };

  // Pass 1: foldered files go to their folder's song; an unfoldered file goes to
  // a known song matched by its filename, else it's held for prefix-clustering.
  const pending = [];
  for (const e of canonical.values()) {
    if (isRealSongFolder(e)) {
      addAsset(getSong(songSlugOf(e), e.songTitle || '(unknown)'), e);
      continue;
    }
    const match = matchKnownSong(e.originalName, known);
    if (match) addAsset(getSong(match.slug, match.title), e);
    else pending.push(e);
  }

  // Pass 2: cluster the still-unmatched files by the song prefix embedded in
  // their names. A prefix shared by 2+ files becomes a new song (these are
  // unfoldered songs not in the library, e.g. the HONK set); a lone file with no
  // sibling sharing its prefix is an Extra File.
  const byPrefix = new Map();
  for (const e of pending) {
    const prefix = songPrefixOf(e.originalName);
    if (!prefix) {
      extras.push(extraOf(e));
      continue;
    }
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(e);
  }
  for (const [prefix, group] of byPrefix) {
    if (group.length >= 2) {
      const song = getSong(prefix, titleCaseSlug(prefix));
      for (const e of group) addAsset(song, e);
    } else {
      for (const e of group) extras.push(extraOf(e));
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

  extras.sort((a, b) => (a.originalName || '').localeCompare(b.originalName || ''));

  return { tunes, instruments, extras, uniqueCount: canonical.size, liveCount };
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
