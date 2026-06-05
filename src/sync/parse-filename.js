// Turn a classified Drive file plus its source-folder song context into the
// detected song/instrument metadata and the canonical local path used in
// data/<song-title-slug>/.
//
// Score PDF naming, per docs/design.md:
//   <song-title-slug>-<instrument-slug>[-<key-slug>][-<part-number>].pdf
//   e.g. bad-guy-trumpet-bflat.pdf, bad-guy-trumpet-bflat-2.pdf
//
// MuseScore and MP3 files live in the same song folder with similarly
// slugified names.

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
 * @property {string} songSlug        Slug for the song folder.
 * @property {string|null} instrument Detected instrument label, or null.
 * @property {string|null} instrumentSlug
 * @property {string|null} key        Detected key slug (e.g. "bflat"), or null.
 * @property {number|null} partNumber Detected part number, or null.
 * @property {string} canonicalName   Canonical lowercase filename.
 * @property {string} localPath       Relative path: <song-slug>/<canonicalName>.
 */

/**
 * Derive canonical metadata + local path for an accepted asset.
 *
 * @param {Object} params
 * @param {string} params.originalName  Original Drive filename.
 * @param {string} params.songTitle     Song title (typically the source folder name).
 * @param {string} params.assetType     'pdf' | 'mp3' | 'musescore'.
 * @param {string} params.ext           Canonical extension from classification.
 * @returns {ParsedAsset}
 */
export function parseAsset({ originalName, songTitle, assetType, ext }) {
  const songSlug = slugify(songTitle);
  const stemSlug = slugifyStem(originalName);
  const descriptor = stripSongPrefix(stemSlug, songSlug);
  const descriptorText = descriptor.replace(/-/g, ' ');

  const inst = detectInstrument(descriptorText) ?? detectInstrument(originalName);
  const instrumentSlug = inst ? inst.slug : null;
  const key = detectKey(originalName);
  const partNumber = detectPartNumber(originalName);

  let canonicalName;
  if (assetType === 'pdf') {
    const parts = [songSlug];
    parts.push(instrumentSlug ?? (descriptor || 'part'));
    if (key) parts.push(key);
    if (partNumber != null) parts.push(String(partNumber));
    canonicalName = `${parts.filter(Boolean).join('-')}.${ext}`;
  } else {
    // MuseScore / MP3: keep the song slug, append any descriptor that isn't just
    // the song again, so multiple files in one folder stay distinct.
    const suffix = descriptor && descriptor !== songSlug ? `-${descriptor}` : '';
    canonicalName = `${songSlug}${suffix}.${ext}`;
  }

  return {
    songTitle,
    songSlug,
    instrument: inst ? inst.label : null,
    instrumentSlug,
    key,
    partNumber,
    canonicalName,
    localPath: `${songSlug}/${canonicalName}`,
  };
}
