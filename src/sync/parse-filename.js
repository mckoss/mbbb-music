// Turn a classified Drive file plus its source-folder song context into the
// detected song/instrument metadata and the canonical local path used in
// data/<source-slug>/<song-title-slug>/.
//
// The canonical filename is the slugified ORIGINAL Drive filename — never
// rebuilt from the parent folder. In by-instrument index folders the parent
// folder is not the song, so the original filename is the only place the song
// title survives; preserving it keeps those files identifiable. Detected
// instrument/key/part still populate the catalog metadata, but do not drive the
// filename.

import { slugify, slugifyStem } from './slugify.js';
import { detectInstrument, detectKey, detectPartNumber } from './instruments.js';

/**
 * Strip a known leading song prefix from a filename stem so instrument/key
 * detection isn't confused by song words, and so the canonical filename does
 * not double up the song slug.
 */
function stripSongPrefix(stemSlug, songSlug) {
  if (songSlug && stemSlug.startsWith(songSlug + '-')) {
    return stemSlug.slice(songSlug.length + 1);
  }
  return stemSlug;
}

/**
 * @typedef {Object} ParsedAsset
 * @property {string} songTitle       Display song title (from the source folder).
 * @property {string} sourceSlug      Slug for the source library (path prefix), or ''.
 * @property {string} songSlug        Slug for the song folder.
 * @property {string|null} instrument Detected instrument label, or null.
 * @property {string|null} instrumentSlug
 * @property {string|null} key        Detected key slug (e.g. "bflat"), or null.
 * @property {number|null} partNumber Detected part number, or null.
 * @property {string} canonicalName   Canonical lowercase filename.
 * @property {string} localPath       Relative path: <source-slug>/<song-slug>/<canonicalName>.
 */

/**
 * Derive canonical metadata + local path for an accepted asset.
 *
 * The local path is prefixed with the source library slug so two sources can
 * never collide on a same-named song folder: <source-slug>/<song-slug>/<file>.
 *
 * @param {Object} params
 * @param {string} [params.sourceLabel] Source library label (becomes the path prefix).
 * @param {string} params.originalName  Original Drive filename.
 * @param {string} params.songTitle     Song title (typically the source folder name).
 * @param {string} params.ext           Canonical extension from classification.
 * @returns {ParsedAsset}
 */
export function parseAsset({ sourceLabel, originalName, songTitle, ext }) {
  const sourceSlug = slugify(sourceLabel || '');
  const songSlug = slugify(songTitle);
  const stemSlug = slugifyStem(originalName);
  const descriptor = stripSongPrefix(stemSlug, songSlug);
  const descriptorText = descriptor.replace(/-/g, ' ');

  const inst = detectInstrument(descriptorText) ?? detectInstrument(originalName);
  const instrumentSlug = inst ? inst.slug : null;
  const key = detectKey(originalName);
  const partNumber = detectPartNumber(originalName);

  // Keep the slugified original filename verbatim (only normalizing the
  // extension to the classified one). This preserves song titles embedded in
  // the filename — the sole place they appear for files in index folders.
  const canonicalName = `${stemSlug || 'part'}.${ext}`;

  const dir = [sourceSlug, songSlug].filter(Boolean).join('/');

  return {
    songTitle,
    sourceSlug,
    songSlug,
    instrument: inst ? inst.label : null,
    instrumentSlug,
    key,
    partNumber,
    canonicalName,
    localPath: `${dir}/${canonicalName}`,
  };
}
