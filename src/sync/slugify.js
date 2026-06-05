// Lowercase slug helpers used for song folders and canonical asset filenames.
//
// Slugs are intentionally readable (no hashes) so the local directory tree and
// manifest diffs stay inspectable, per docs/design.md.

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Normalize an arbitrary label into a lowercase, hyphen-separated slug.
 *
 * - Letters/numbers are kept; everything else becomes a separator.
 * - Common musical key spellings are folded so "B-flat" / "Bb" / the flat sign
 *   collapse predictably before generic separator handling.
 * - Runs of separators collapse to a single hyphen; leading/trailing hyphens
 *   are trimmed.
 *
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  if (input == null) return '';
  let s = String(input);

  // Normalize accented characters to their ASCII base where possible, then drop
  // the combining diacritical marks left behind by NFKD decomposition.
  s = s.normalize('NFKD').replace(COMBINING_MARKS, '');

  // Fold musical-key spellings into bare tokens before generic cleanup so the
  // hyphen in "B-flat" does not survive as a word boundary.
  s = s
    .replace(/♭/g, 'flat') // music flat sign
    .replace(/♯/g, 'sharp') // music sharp sign
    .replace(/\b([a-gA-G])[-\s]?flat\b/g, '$1flat')
    .replace(/\b([a-gA-G])[-\s]?sharp\b/g, '$1sharp')
    .replace(/\b([a-gA-G])b\b/g, '$1flat') // "Bb" -> "bflat"
    .replace(/\b([a-gA-G])#\b/g, '$1sharp');

  s = s.toLowerCase();

  // Replace any run of non-alphanumeric characters with a single hyphen.
  s = s.replace(/[^a-z0-9]+/g, '-');

  // Trim leading/trailing hyphens.
  s = s.replace(/^-+|-+$/g, '');

  return s;
}

/**
 * Slugify the stem of a filename (the part before the final extension).
 *
 * @param {string} filename
 * @returns {string}
 */
export function slugifyStem(filename) {
  const stem = String(filename ?? '').replace(/\.[^.]+$/, '');
  return slugify(stem);
}
