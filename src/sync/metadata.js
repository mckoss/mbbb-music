// Detect catalog metadata (song title, instrument, key, part number) from a
// Drive file's name and its song-folder context.
//
// Storage is content-addressable — every blob lives at data/cas/<sha256> — so
// there is no canonical path or filename to construct. The only output here is
// the metadata recorded alongside each file in the manifest.

import { slugify, slugifyStem } from './slugify.js';
import { detectInstrument, detectKey, detectPartNumber } from './instruments.js';

/**
 * Strip a known leading song prefix from a filename stem so instrument/key
 * detection isn't confused by the song words.
 */
function stripSongPrefix(stemSlug, songSlug) {
  if (songSlug && stemSlug.startsWith(songSlug + '-')) {
    return stemSlug.slice(songSlug.length + 1);
  }
  return stemSlug;
}

/**
 * @typedef {Object} AssetMetadata
 * @property {string} songTitle        Display song title (from the song folder).
 * @property {string} songTitleSlug    Slug of the song title (grouping/lookup key).
 * @property {string|null} instrument  Detected instrument label, or null.
 * @property {string|null} instrumentSlug
 * @property {string|null} key          Detected key slug (e.g. "bflat"), or null.
 * @property {number|null} partNumber   Detected part number, or null.
 */

/**
 * Derive catalog metadata for an accepted asset.
 *
 * @param {Object} params
 * @param {string} params.originalName  Original Drive filename.
 * @param {string} params.songTitle     Song title (typically the song folder name).
 * @returns {AssetMetadata}
 */
export function detectAssetMetadata({ originalName, songTitle }) {
  const songSlug = slugify(songTitle);
  const stemSlug = slugifyStem(originalName);
  const descriptor = stripSongPrefix(stemSlug, songSlug).replace(/-/g, ' ');

  const inst = detectInstrument(descriptor) ?? detectInstrument(originalName);
  return {
    songTitle,
    songTitleSlug: songSlug,
    instrument: inst ? inst.label : null,
    instrumentSlug: inst ? inst.slug : null,
    key: detectKey(originalName),
    // A part number is only meaningful for a known instrument ("Trumpet 2"); a
    // trailing number with no instrument ("MDL Bass Line 5") is not a part.
    partNumber: inst ? detectPartNumber(originalName) : null,
  };
}
