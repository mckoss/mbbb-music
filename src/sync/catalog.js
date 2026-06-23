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
import { DEFAULT_KEY_BY_SLUG, detectPartNumbers, instrumentLabel } from './instruments.js';
import { isJunkName, NATIVE_PDF_EXPORT } from './classify.js';

/**
 * Effective asset type for routing, tolerant of older manifests. Native Google
 * editor files (Docs/Sheets/…) are exported to PDF and were historically stored
 * as `assetType: 'pdf'`; re-read them as `notes` from their mime type so a Google
 * Doc never lands in the score column (a score is always a real PDF). New syncs
 * already write `notes`, which passes straight through.
 */
function effectiveAssetType(e) {
  if (e.assetType === 'pdf' && NATIVE_PDF_EXPORT.has(e.mimeType)) return 'notes';
  return e.assetType;
}

/**
 * Apply manifest-affecting corrections, returning a NEW manifest whose entries
 * carry the corrected fields. Applied BEFORE buildCatalog so grouping, dedup, and
 * instrument columns reflect them; the machine-owned manifest on disk is never
 * touched. Handles:
 *   - file (by Drive file id): instrument/key/part, and `songSlug` to (re)assign
 *     one file to a song;
 *   - folder (by song-folder Drive id): `songSlug` to (re)assign a whole folder.
 *
 * A song's derived slug is its STABLE IDENTITY (gig setlists + status key on it),
 * so SONG-scope display corrections are NOT applied here — those are presentation
 * overlays applied at the tune level in library.ts. But (re)assigning a file/folder
 * to a song IS a grouping change, applied here by repointing `songTitleSlug` to the
 * target identity. A file-level assignment overrides its folder-level one.
 *
 * @param {object} manifest
 * @param {{file:Object, folder:Object}} overlay
 * @returns {object} a manifest with corrected entries (only touched entries cloned)
 */
export function applyCorrections(manifest, overlay) {
  const file = overlay?.file || {};
  const folder = overlay?.folder || {};
  if (Object.keys(file).length === 0 && Object.keys(folder).length === 0) return manifest;

  // Title to adopt when a file is reassigned to a song: the target song's existing
  // title (so a moved file joins under the right label regardless of iteration
  // order), or a title-cased slug for a brand-new song.
  const titleBySlug = {};
  for (const entry of Object.values(manifest.files || {})) {
    const s = songSlugOf(entry);
    if (s && !(s in titleBySlug)) titleBySlug[s] = entry.songTitle || s;
  }
  const reassign = (e, targetSlug) => {
    e.songTitleSlug = targetSlug;
    e.songTitle = titleBySlug[targetSlug] || titleCaseSlug(targetSlug);
    // An explicit assignment must beat the folder/filename heuristic in buildCatalog
    // (otherwise a file in an index/container folder would be re-grouped by name).
    e.songAssigned = true;
  };

  const files = {};
  for (const [id, entry] of Object.entries(manifest.files || {})) {
    const fpatch = file[entry.driveFileId || id];
    const folderPatch = entry.songFolderId ? folder[entry.songFolderId] : undefined;
    let e = entry;
    if (fpatch || folderPatch) {
      e = { ...entry };
      // Folder assignment first; a file-level assignment overrides it.
      if (folderPatch?.songSlug) reassign(e, folderPatch.songSlug);
      if (fpatch) {
        if (fpatch.songSlug) reassign(e, fpatch.songSlug);
        if (fpatch.instrumentSlug != null) {
          e.instrumentSlug = fpatch.instrumentSlug || null;
          e.instrument = instrumentLabel(fpatch.instrumentSlug) ?? e.instrument;
        }
        if ('key' in fpatch) e.key = fpatch.key || null;
        if ('partNumber' in fpatch) {
          const n = Number.parseInt(String(fpatch.partNumber), 10);
          e.partNumber = Number.isInteger(n) && n >= 1 ? n : null;
        }
      }
    }
    files[id] = e;
  }
  return { ...manifest, files };
}

/** True for a manifest entry that still represents a present, downloaded asset. */
export function isLive(entry) {
  const status = entry.status || '';
  return status !== 'deleted' && status !== 'unreachable' && !status.startsWith('ignored');
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
 * Classify a print format from a page's physical size in points (1/72").
 * Nominal sizes (orientation-independent): Letter 8.5×11, Lyre (flip-folio) ~5×7.
 *
 * `landscapeIsLyre` adds the rule that ANY landscape page is Lyre — true only for
 * individual instrument parts (marching flip-folios are commonly landscape), and
 * false for whole-band scores, which are often landscape at full/letter size and
 * must not be mistaken for flip-folio parts. Returns null for missing/degenerate
 * dimensions, so the caller can fall back to the filename.
 */
export function formatFromShape(widthPt, heightPt, landscapeIsLyre = false) {
  const w = widthPt / 72;
  const h = heightPt / 72;
  if (!(w > 0 && h > 0)) return null;
  if (landscapeIsLyre && w > h * 1.02) return 'lyre'; // landscape part → flip-folio
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  const dLetter = Math.hypot(shortSide - 8.5, longSide - 11);
  const dLyre = Math.hypot(shortSide - 5, longSide - 7);
  return dLyre < dLetter ? 'lyre' : 'letter';
}

/**
 * The print format of a PDF. Prefers the physical page shape (recorded at sync
 * time as pageWidthPt/pageHeightPt) — the ground truth of what prints — and falls
 * back to a 'lyre' token in the filename when the shape is unknown. Accepts a
 * manifest entry, or a bare filename string for filename-only callers/tests.
 *
 * The landscape-means-Lyre rule applies only to instrument parts (an entry with
 * an instrumentSlug); a whole-band score in landscape stays size-classified.
 *
 * With `fromName`, the page shape is ignored and the format is read purely from a
 * 'lyre' token in the filename. App-generated parts use this: the generator emits
 * both Letter and Lyre on the same 8.5×11 sheet (the Lyre art sits in the upper-
 * left for cutting), so their page geometry is identical and only the filename
 * token ("…-lyre.pdf" vs "…-letter.pdf") distinguishes the two.
 */
export function formatOf(entry, { fromName = false } = {}) {
  if (typeof entry === 'string' || entry == null) {
    return /\blyre\b/i.test(String(entry ?? '')) ? 'lyre' : 'letter';
  }
  const nameSaysLyre = /\blyre\b/i.test(String(entry.originalName ?? ''));
  if (fromName) return nameSaysLyre ? 'lyre' : 'letter';
  const isPart = Boolean(entry.instrumentSlug);
  const byShape =
    entry.pageWidthPt && entry.pageHeightPt
      ? formatFromShape(entry.pageWidthPt, entry.pageHeightPt, isPart)
      : null;
  if (byShape) return byShape;
  return nameSaysLyre ? 'lyre' : 'letter';
}

/**
 * Every part number an entry covers ("1 & 2" → [1,2]), preferring the synced
 * `partNumbers`, then re-deriving from the filename (so already-synced data and
 * the re-generated combined names both work), then falling back to a stored
 * single `partNumber`. A trailing format token ("…-part1-2-Lyre") would hide the
 * run, so it's stripped first.
 */
function effectivePartNumbers(entry) {
  if (Array.isArray(entry.partNumbers) && entry.partNumbers.length) return entry.partNumbers;
  // Drop a trailing format token that sits just before the extension (or at the
  // end), keeping any real extension so the detector strips that — not a version
  // dot like "V1.0" — and the part run ("…part1-2") survives.
  const cleaned = String(entry.originalName ?? '').replace(/[\s_-]*(lyre|letter)(?=(\.[^.]*)?$)/i, '');
  const derived = detectPartNumbers(cleaned);
  if (derived.length) return derived;
  const stored = partNumberOf(entry);
  return stored != null ? [stored] : [];
}

/** The first part number an entry covers, or null. */
function effectivePartNumber(entry) {
  return effectivePartNumbers(entry)[0] ?? null;
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
 * Pick the canonical location for one content blob. A copy in a real song folder
 * ALWAYS beats one in an index/admin container (e.g. "50 Indexed By Instrument"),
 * regardless of source priority — otherwise a duplicate filed under a by-instrument
 * index in a high-priority source would outrank the properly-filed song-folder
 * copy. Among copies of the same kind, the higher-priority source wins; ties keep
 * the first seen.
 */
function isMoreCanonical(candidate, current, pri) {
  const container = (e) => (isContainerFolder(e.originalFolder) ? 1 : 0);
  if (container(candidate) !== container(current)) return container(candidate) < container(current);
  const rank = (e) => (pri.has(e.sourceFolderLabel) ? pri.get(e.sourceFolderLabel) : Number.MAX_SAFE_INTEGER);
  if (rank(candidate) !== rank(current)) return rank(candidate) < rank(current);
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
  if ((a.partNumber ?? 0) !== (b.partNumber ?? 0)) return (a.partNumber ?? 0) - (b.partNumber ?? 0);
  return String(a.format).localeCompare(String(b.format));
}

/**
 * An isolated audio track is a single instrument's stem rather than the full-band
 * mix. Detected three ways: a detected instrument; an "isolated"/"drums only"/
 * "drum part" label; or a trailing instrument/voice suffix like "-Glockenspiel"
 * or "-Drum Kit" (caught even when the instrument isn't one we classify parts
 * for). The full-band mix is none of these, so it sorts first and becomes the
 * default recording (#4).
 */
function isIsolatedAudio(a) {
  if (a.instrumentSlug) return true;
  const n = (a.originalName || '').toLowerCase();
  if (/\bdrums?\s*only\b|\bisolated\b|\bdrum\s*part\b/.test(n)) return true;
  const tokens = slugifyStem(a.originalName || '')
    .replace(/^(?:copy-of-)+/, '')
    .split('-')
    .filter(Boolean);
  // A run of voice tokens at the end is an instrument suffix on the song name.
  return tokens.length > 0 && isVoiceToken(tokens[tokens.length - 1]);
}

/**
 * True for an app-generated full-band MuseScore mix: a `<song>-band.mp3` rendered
 * by `build-scores --audio` into a generated source's `.parts` folder. These are
 * surfaced as the song's primary "MuseScore Audio" recording — sorted first and
 * auto-selected in the players — but, unlike generated scores/parts, they never
 * mask the manually-uploaded audio (audio is absent from MASKED_WHEN_GENERATED).
 */
function isMuseScoreAudio(a) {
  return a.generated === true && /-band\.mp3$/i.test(a.originalName || '');
}

/**
 * A recording's identity, ignoring version tokens, so "Iron Man-V1.0" and
 * "Iron Man-V1.2" share a key but distinct recordings ("…cadillacs" vs
 * "Samba Breaks") do not. Strips a leading "Copy of" and any version-number
 * tokens (v1, 1.2, …) left by slugifying.
 */
function audioBaseKey(name) {
  const slug = slugifyStem(name || '').replace(/^(?:copy-of-)+/, '');
  return slug
    .split('-')
    .filter((t) => t && !/^v?\d+(\.\d+)*$/.test(t))
    .join('-');
}

/** Rank a copy by its source's priority (lower = higher priority); unknown last. */
function sourceRank(asset, pri) {
  return pri && pri.has(asset.source) ? pri.get(asset.source) : Number.MAX_SAFE_INTEGER;
}

/**
 * Order a tune's recordings so the full-band mix leads and, within one
 * recording, the highest-priority source's copy is the default (newest as a
 * tiebreak) — WITHOUT discarding any distinct file. A unique blob is never
 * hidden: lower-priority copies, older versions, and distinct stems stay
 * reachable via the recording chooser. Only byte-identical duplicates (same
 * content hash, e.g. the same mp3 mirrored across two sources) collapse.
 * Returns the fully ordered list; strips the transient `_mtime`.
 */
function dedupeAudio(audio, pri) {
  const bySha = new Map();
  for (const a of audio) if (!bySha.has(a.sha256)) bySha.set(a.sha256, a);
  const baseKey = (a) => audioBaseKey(a.originalName) || a.sha256;
  const out = [...bySha.values()].sort((a, b) => {
    // The app-generated MuseScore mix is the primary recording: always first,
    // ahead of every manual take (which all remain reachable below it).
    const ms = (isMuseScoreAudio(a) ? 0 : 1) - (isMuseScoreAudio(b) ? 0 : 1);
    if (ms) return ms;
    // Full-band mix before isolated stems (the default recording, #4)...
    const iso = (isIsolatedAudio(a) ? 1 : 0) - (isIsolatedAudio(b) ? 1 : 0);
    if (iso) return iso;
    // ...versions of one recording grouped together...
    const bk = baseKey(a).localeCompare(baseKey(b));
    if (bk) return bk;
    // ...highest-priority source first, then newest, then name desc ("V1.2"<"V1.0").
    return (
      sourceRank(a, pri) - sourceRank(b, pri) ||
      (b._mtime || '').localeCompare(a._mtime || '') ||
      (b.originalName || '').localeCompare(a.originalName || '')
    );
  });
  // eslint-disable-next-line no-unused-vars
  return out.map(({ _mtime, ...rest }) => rest);
}

/**
 * Order an instrument's parts so the highest-priority source's copy of a given
 * slot (instrument/key/part/format) is the default shown first (newest as a
 * tiebreak) — WITHOUT discarding any distinct file. A unique blob is never
 * hidden: lower-priority copies, older versions, alternate scans, and other
 * genuinely-different copies of the same slot stay reachable via the part
 * chooser. Only byte-identical duplicates (same content hash) collapse.
 * Returns the fully ordered list; strips the transient `_mtime`.
 */
function dedupeParts(parts, pri) {
  const bySha = new Map();
  for (const p of parts) if (!bySha.has(p.sha256)) bySha.set(p.sha256, p);
  const out = [...bySha.values()].sort(
    (a, b) =>
      comparePart(a, b) ||
      // Same slot: highest-priority source first, then newest, then name desc.
      sourceRank(a, pri) - sourceRank(b, pri) ||
      (b._mtime || '').localeCompare(a._mtime || '') ||
      (b.originalName || '').localeCompare(a.originalName || '')
  );
  // eslint-disable-next-line no-unused-vars
  return out.map(({ _mtime, ...rest }) => rest);
}

/**
 * @typedef {Object} CatalogPart
 * @property {string} sha256
 * @property {string} instrumentSlug
 * @property {string|null} instrument
 * @property {string|null} key           Effective key (explicit or instrument default).
 * @property {number|null} partNumber
 * @property {string|null} originalName
 * @property {string|null} source         Canonical source label this copy came from.
 *
 * @typedef {Object} CatalogAsset
 * @property {string} sha256
 * @property {string|null} originalName
 * @property {string|null} source         Canonical source label this copy came from.
 * @property {string} [assetType]         Present for images/other files, to label/route them.
 *
 * @typedef {Object} Tune
 * @property {string} slug
 * @property {string} title
 * @property {string|null} lastModified
 * @property {CatalogPart[]} parts        Per-instrument PDF parts.
 * @property {CatalogAsset[]} scores      Instrument-less true PDFs (full/band scores).
 * @property {CatalogAsset[]} notes       Google Docs/Sheets exported to PDF — viewable
 *                                        notes/chord sheets, never a printable score.
 * @property {CatalogAsset[]} audio       MP3 practice/reference tracks.
 * @property {CatalogAsset[]} musescore   MuseScore source files.
 * @property {CatalogAsset[]} images      Images (JPEG) embeddable in the view.
 * @property {CatalogAsset[]} files       Other downloadable files (docx, zip, …).
 * @property {Object[]} unreachable       Unreachable shortcuts (no content) for the health view.
 * @property {CatalogAsset[]} masked      Manually-created scores/parts hidden by an
 *                                        app-generated replacement: kept out of the
 *                                        player/score views but surfaced (clickable)
 *                                        on the File Info page. Each carries a `bucket`
 *                                        ('parts'|'scores') marking where it came from.
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

/**
 * The number of distinct "voices" in a prefix cluster of unfoldered files: each
 * instrument part counts once (version copies of the same instrument/format/part
 * collapse), and each instrument-less file (full score, audio, MuseScore) counts
 * per unique blob. A real unfoldered song has 2+ voices (e.g. several instrument
 * parts, or a part plus a full score); two versions of a single exercise (e.g.
 * "Trumpet Blues Scales" base + v3) collapse to one voice and are NOT a song.
 */
function clusterVoiceCount(group) {
  const voices = new Set();
  for (const e of group) {
    if (e.assetType === 'pdf' && e.instrumentSlug) {
      voices.add(`p:${e.instrumentSlug}|${formatOf(e)}|${effectivePartNumber(e) ?? ''}`);
    } else {
      voices.add(`x:${e.sha256}`);
    }
  }
  return voices.size;
}

/**
 * A catalog item for an unreachable shortcut (no content). Typed like a part
 * when an instrument was detected, and carries a Drive "request access" URL
 * built from the shortcut's target id.
 */
function unreachableItem(e) {
  const hasInstrument = Boolean(e.instrumentSlug);
  return {
    assetType: e.assetType || 'pdf',
    instrumentSlug: e.instrumentSlug || null,
    instrument: e.instrument || null,
    key: hasInstrument ? effectiveKey(e) : null,
    partNumber: hasInstrument ? effectivePartNumber(e) : null,
    format: formatOf(e),
    originalName: e.originalName || null,
    source: e.sourceFolderLabel || null,
    driveUrl: e.shortcutTarget ? `https://drive.google.com/file/d/${e.shortcutTarget}/view` : null,
    unreachable: true,
  };
}

/** Title-case a song slug for display: "we-are-number-one" → "We Are Number One". */
function titleCaseSlug(slug) {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Stable, collision-proof key for a (source, folder) pair (NUL-delimited). */
export const folderKey = (e) => `${e.sourceFolderLabel ?? ''}\u0000${e.originalFolder ?? ''}`;

/**
 * Detect "collection folders": a folder that holds parts for MANY different songs
 * (a by-player/by-instrument collection like "Trombone for Joseph"), rather than
 * being one song's folder. Filenames are too inconsistent to judge this by text —
 * the same song is titled differently across instruments, and many files are
 * instrument-only with no song at all — so we use CONTENT instead: where does each
 * file's canonical (primary) copy live? A real song folder's files all resolve to
 * one song; a collection's files scatter across many. A folder is flagged when its
 * files resolve to 2+ distinct song folders with no single dominant home.
 *
 * @param {object} manifest
 * @param {Map<string, object>} canonical  sha (or id) -> canonical entry, from canonicalByContent.
 * @returns {Set<string>} folderKey()s of collection folders.
 */
export function detectCollectionFolders(manifest, canonical) {
  const keyOf = (e) => e.sha256 || `id:${e.driveFileId}`;
  const byFolder = new Map(); // folderKey -> Map(targetFolderKey -> count)
  for (const e of liveAssets(manifest)) {
    if (!e.originalFolder) continue;
    const canon = canonical.get(keyOf(e)) || e;
    const counts = byFolder.get(folderKey(e)) || byFolder.set(folderKey(e), new Map()).get(folderKey(e));
    const t = folderKey(canon);
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const collections = new Set();
  for (const [fkey, counts] of byFolder) {
    let total = 0;
    let top = 0;
    for (const c of counts.values()) {
      total += c;
      if (c > top) top = c;
    }
    // Several files, spread across 2+ song folders, with no folder holding the
    // majority => a collection, not a song.
    if (total >= 3 && counts.size >= 2 && top < total / 2) collections.add(fkey);
  }
  return collections;
}

// Asset buckets that a song's app-generated scores mask: once a generated
// score/part exists for a song, the manual copies in these buckets are dropped
// from the catalog. Scores and parts only. Audio is deliberately NOT masked: the
// generated full-band mix is surfaced as the primary "MuseScore Audio" recording
// (see isMuseScoreAudio / dedupeAudio) but coexists with manual practice tracks.
const MASKED_WHEN_GENERATED = ['parts', 'scores'];

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
 * App-generated scores supersede manual ones: when a song has any score/part
 * from a `generatedSourceLabels` source, its manually-created score PDFs are
 * MASKED (dropped from the catalog the player sees, though still synced in CAS).
 * Non-score assets — audio, notes, images, and especially the MuseScore master —
 * are never masked. {@link MASKED_WHEN_GENERATED} is the extension point: add
 * 'audio' there once app-generated audio replaces the manual practice tracks.
 *
 * @param {object} manifest
 * @param {string[]} [sourceLabels]       Configured source labels in priority order.
 * @param {string[]} [looseSourceLabels]  Labels of sources NOT foldered by song.
 * @param {string[]} [generatedSourceLabels]  Labels of sources holding app-generated scores.
 * @returns {{ tunes: Tune[], instruments: {slug:string,label:string}[], extras: CatalogAsset[], sources: string[], uniqueCount:number, liveCount:number }}
 */
export function buildCatalog(manifest, sourceLabels = [], looseSourceLabels = [], generatedSourceLabels = []) {
  const pri = sourcePriority(sourceLabels, manifest);
  const { canonical, liveCount } = canonicalByContent(manifest, pri);
  const loose = new Set(looseSourceLabels || []);
  const generated = new Set(generatedSourceLabels || []);
  // Folders that hold parts for many different songs (a by-player/by-instrument
  // collection) — detected by content, not folder/file names. Their files are
  // grouped by the song each one's content belongs to, not by the folder.
  const collections = detectCollectionFolders(manifest, canonical);

  // A real per-song folder: not a loose (unfoldered) source, has a folder, and
  // that folder isn't an index/admin container or a multi-song collection.
  const isRealSongFolder = (e) =>
    !loose.has(e.sourceFolderLabel) &&
    e.originalFolder &&
    !isContainerFolder(e.originalFolder) &&
    !collections.has(folderKey(e));

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
      song = { slug, title, lastModified: null, parts: [], scores: [], notes: [], audio: [], musescore: [], images: [], files: [], unreachable: [], masked: [] };
      bySong.set(slug, song);
    }
    return song;
  };

  const addAsset = (song, e) => {
    if (e.modifiedTime && (!song.lastModified || e.modifiedTime > song.lastModified)) {
      song.lastModified = e.modifiedTime;
    }
    const isGenerated = generated.has(e.sourceFolderLabel);
    const asset = {
      sha256: e.sha256,
      driveFileId: e.driveFileId,
      folderId: e.songFolderId,
      folder: e.originalFolder || null,
      originalName: e.originalName || null,
      source: e.sourceFolderLabel || null,
      // Carry the generated flag so the masking pass can keep these and drop the
      // manual copies; a truthy value also lets the UI badge a standardized score.
      ...(isGenerated ? { generated: true } : {}),
    };
    const at = effectiveAssetType(e);
    if (at === 'pdf' && e.instrumentSlug) {
      const partNums = effectivePartNumbers(e);
      song.parts.push({
        ...asset,
        instrument: e.instrument || null,
        instrumentSlug: e.instrumentSlug,
        key: effectiveKey(e),
        partNumber: partNums[0] ?? null,
        // A combined chart carries several ("1 & 2"); omit for single parts so the
        // common case stays clean and renders from partNumber.
        ...(partNums.length > 1 ? { partNumbers: partNums } : {}),
        // Generated parts share Letter/Lyre page geometry, so classify them from
        // the filename token rather than the (identical) page shape.
        format: formatOf(e, { fromName: isGenerated }),
        _mtime: e.modifiedTime || '', // transient, used for version dedup
      });
    } else if (at === 'pdf') {
      song.scores.push(asset);
    } else if (at === 'notes') {
      // A Google Doc exported to PDF — viewable (rendered like any PDF) and
      // downloadable, but kept out of the score column and never the default.
      song.notes.push({ ...asset, assetType: 'notes' });
    } else if (at === 'mp3') {
      // Carry the detected instrument so the full-band mix (no instrument) can be
      // ordered ahead of isolated parts (drums, a single horn) as the default;
      // `_mtime` (transient) lets version copies of one recording dedupe to newest.
      const audio = { ...asset, instrumentSlug: e.instrumentSlug || undefined, _mtime: e.modifiedTime || '' };
      // Tag the app-generated full-band mix so it sorts first / auto-selects and
      // the UI can label it "MuseScore Audio" (additive — manual audio is kept).
      if (isMuseScoreAudio(audio)) audio.museScore = true;
      song.audio.push(audio);
    } else if (e.assetType === 'musescore') {
      song.musescore.push(asset);
    } else if (e.assetType === 'image') {
      song.images.push({ ...asset, assetType: e.assetType });
    } else {
      // Any other accepted type (doc, archive, …) is a generic downloadable file.
      song.files.push({ ...asset, assetType: e.assetType });
    }
  };

  // Pass 1: an explicit human assignment (songAssigned) wins outright; otherwise a
  // foldered file goes to its folder's song, and an unfoldered file to a known song
  // matched by its filename, else it's held for prefix-clustering.
  const pending = [];
  for (const e of canonical.values()) {
    if (e.songAssigned || isRealSongFolder(e)) {
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
    // Promote to a song only with 2+ distinct voices. A prefix shared by mere
    // version copies of a single part (e.g. two "Trumpet Blues Scales" PDFs) is
    // not a song — those files go to Extras.
    if (clusterVoiceCount(group) >= 2) {
      const song = getSong(prefix, titleCaseSlug(prefix));
      for (const e of group) addAsset(song, e);
    } else {
      for (const e of group) extras.push(extraOf(e));
    }
  }

  // Pass 3: unreachable shortcuts (recorded by sync, no content) are surfaced on
  // the health view. Attach each to its song — by the song folder/title embedded
  // in its metadata, falling back to a filename match — and skip any with no home.
  for (const e of Object.values(manifest.files || {})) {
    if (e.status !== 'unreachable') continue;
    let song = bySong.get(songSlugOf(e));
    if (!song) {
      const m = matchKnownSong(e.originalName, known);
      if (m) song = bySong.get(m.slug);
    }
    if (!song) continue;
    song.unreachable.push(unreachableItem(e));
  }

  // Mask manually-created scores wherever app-generated ones exist. A song with
  // any generated score/part is "generated": its manual score PDFs are removed
  // from the player-facing buckets (still synced in CAS) so the score pages show
  // only the standardized set. They are NOT discarded: each is moved to the
  // song's `masked` list (tagged with its origin bucket), so the File Info page
  // can still surface them as a clickable secondary row for comparison. The
  // MuseScore master, audio, notes, and images are untouched.
  for (const song of bySong.values()) {
    const hasGenerated = song.parts.some((p) => p.generated) || song.scores.some((s) => s.generated);
    if (!hasGenerated) continue;
    for (const bucket of MASKED_WHEN_GENERATED) {
      const kept = [];
      for (const a of song[bucket]) {
        if (a.generated) {
          kept.push(a);
        } else {
          // eslint-disable-next-line no-unused-vars
          const { _mtime, ...rest } = a; // drop the transient version-dedup field
          song.masked.push({ ...rest, bucket });
        }
      }
      song[bucket] = kept;
    }
  }

  const tunes = [...bySong.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((s) => ({
      ...s,
      parts: dedupeParts(s.parts, pri),
      audio: dedupeAudio(s.audio, pri),
    }));

  const instLabels = new Map();
  for (const t of tunes) {
    for (const p of t.parts) {
      if (!instLabels.has(p.instrumentSlug)) instLabels.set(p.instrumentSlug, p.instrument || p.instrumentSlug);
    }
    // Instruments that appear only via an unreachable part still get a column.
    for (const u of t.unreachable) {
      if (u.instrumentSlug && !instLabels.has(u.instrumentSlug)) {
        instLabels.set(u.instrumentSlug, u.instrument || u.instrumentSlug);
      }
    }
    // A masked manual part whose instrument has no generated replacement still
    // needs a column so the File Info masked row has somewhere to render it.
    for (const m of t.masked) {
      if (m.instrumentSlug && !instLabels.has(m.instrumentSlug)) {
        instLabels.set(m.instrumentSlug, m.instrument || m.instrumentSlug);
      }
    }
  }
  const instruments = [...instLabels.entries()]
    .map(([slug, label]) => ({ slug, label, key: DEFAULT_KEY_BY_SLUG[slug] ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label));

  extras.sort((a, b) => (a.originalName || '').localeCompare(b.originalName || ''));

  // Source labels in priority order (highest first), so the client can resolve
  // each asset's "primary" source and color it consistently.
  const sources = [...pri.keys()];

  return { tunes, instruments, extras, sources, uniqueCount: canonical.size, liveCount };
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
