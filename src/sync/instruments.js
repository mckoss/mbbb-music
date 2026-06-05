// Instrument and key detection used to parse messy Drive part filenames into
// canonical metadata. Labels and tunings follow the player-facing list in
// docs/design.md. Detection is best-effort: an unrecognized filename still
// syncs, it just carries a null instrument for an admin to resolve later.

/**
 * Canonical player-facing instruments. `slug` is used in filenames; `match`
 * lists lowercase substrings (longest/most specific first) that map a source
 * filename to this instrument. Order in the array matters: more specific
 * instruments must precede the generic families they contain (e.g. "baritone
 * saxophone" before "baritone").
 *
 * @typedef {{ label: string, slug: string, defaultKey: string|null, match: string[] }} Instrument
 * @type {Instrument[]}
 */
export const INSTRUMENTS = [
  { label: 'Alto saxophone', slug: 'alto-sax', defaultKey: 'eflat', match: ['alto saxophone', 'alto sax', 'altosax', 'alto'] },
  { label: 'Soprano saxophone', slug: 'soprano-sax', defaultKey: 'bflat', match: ['soprano saxophone', 'soprano sax', 'soprano'] },
  { label: 'Tenor saxophone', slug: 'tenor-sax', defaultKey: 'bflat', match: ['tenor saxophone', 'tenor sax', 'tenorsax'] },
  { label: 'Baritone saxophone', slug: 'bari-sax', defaultKey: 'eflat', match: ['baritone saxophone', 'bari saxophone', 'bari sax', 'bari-sax'] },
  { label: 'Clarinet', slug: 'clarinet', defaultKey: 'bflat', match: ['clarinet'] },
  { label: 'Flute', slug: 'flute', defaultKey: null, match: ['flute'] },
  { label: 'Trumpet', slug: 'trumpet', defaultKey: 'bflat', match: ['trumpet', 'cornet'] },
  { label: 'Mellophone', slug: 'mellophone', defaultKey: 'f', match: ['mellophone'] },
  { label: 'French horn', slug: 'french-horn', defaultKey: 'f', match: ['french horn', 'horn in f', 'mellophonium'] },
  { label: 'Trombone', slug: 'trombone', defaultKey: 'bflat', match: ['trombone'] },
  { label: 'Euphonium', slug: 'euphonium', defaultKey: 'bflat', match: ['euphonium', 'baritone horn', 'baritone'] },
  { label: 'Tuba', slug: 'tuba', defaultKey: 'bflat', match: ['sousaphone', 'tuba'] },
  { label: 'Melodica', slug: 'melodica', defaultKey: null, match: ['melodica'] },
  { label: 'Drums / percussion', slug: 'drums', defaultKey: null, match: ['drum set', 'drumset', 'drum kit', 'snare drum', 'bass drum', 'tenor drum', 'marching tenor', 'cymbal', 'congas', 'percussion', 'drums', 'drum'] },
];

/**
 * Detect an instrument from a source filename (extension already stripped is
 * fine; the search is substring based and case-insensitive).
 *
 * @param {string} text
 * @returns {Instrument | null}
 */
export function detectInstrument(text) {
  const haystack = String(text ?? '').toLowerCase();
  for (const inst of INSTRUMENTS) {
    if (inst.match.some((needle) => haystack.includes(needle))) {
      return inst;
    }
  }
  return null;
}

const KEY_PATTERNS = [
  { slug: 'bflat', re: /\b(b[-\s]?flat|b♭|in\s*b\b)/i },
  { slug: 'eflat', re: /\b(e[-\s]?flat|e♭)/i },
  { slug: 'aflat', re: /\b(a[-\s]?flat|a♭)/i },
  { slug: 'fsharp', re: /\b(f[-\s]?sharp|f♯)/i },
  { slug: 'f', re: /\b(in\s*f|horn in f)\b/i },
  { slug: 'c', re: /\b(concert|in\s*c)\b/i },
];

/**
 * Detect a written key/transposition token from a source filename. Returns a
 * key slug like "bflat" or null when none is present.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function detectKey(text) {
  const haystack = String(text ?? '');
  for (const { slug, re } of KEY_PATTERNS) {
    if (re.test(haystack)) return slug;
  }
  return null;
}

/**
 * Detect a trailing part number, e.g. "Trumpet 2" or "Trumpet - 2". Returns the
 * integer part number or null. A leading "1" with no sibling is still recorded
 * so downstream code can decide whether to keep it.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function detectPartNumber(text) {
  const m = String(text ?? '')
    .replace(/\.[^.]+$/, '')
    .match(/(?:^|[\s_-])(\d{1,2})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
