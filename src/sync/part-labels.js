// Which page of a whole-band chart holds each instrument's part.
//
// The band's arrangements are single PDFs that concatenate every player's part —
// "rock-anthem-parts.pdf", "soh-rock-lobster - all parts.pdf". Engravers (MuseScore
// and its exports) print the part name once, at the LEFT MARGIN above the first
// system of each part's opening page; continuation pages carry only measure
// numbers. So the first page whose left margin names an instrument is where that
// instrument's part starts, and a player can be sent straight there.
//
// This module is the pure half: text items in, page index out. The PDF I/O lives
// in $lib/server/part-pages, so this stays unit-testable with no pdf.js.

import { detectInstrument, detectKey } from './instruments.js';
import { sharedPartMetadata, compatibleInstruments } from './shared-parts.js';

// The part name sits in the left margin. Rehearsal marks and performance notes
// ("(Melodica/reeds soli)") sit inboard over the staff and name instruments too,
// so the margin test — not the vocabulary — is what keeps them out: in the band's
// charts the label lands at 3-7% of page width and the annotations at 34%+.
const LEFT_MARGIN = 0.12;
// Part names ride above the first system, in the top half even on a page whose
// header block is tall. Lyrics and chord symbols below are thereby ignored.
const TOP_BAND = 0.5;

// Percussion charts name the drum, not the family, and the filename vocabulary in
// instruments.js deliberately requires the qualified form ("snare drum") so that a
// song called "Snare" can't be mistaken for a part. A page label is unambiguous —
// it names a staff — so bare drum names resolve here.
const LABEL_ALIASES = [
  [/^(snare|kick|toms?|quads?|tenors)$/, 'drums'],
  [/^(perc|percussion)\b/, 'drums'],
];

/** A page label may name several instruments at once ("Trumpet/Clarinet high"). */
function splitLabel(label) {
  return String(label ?? '')
    .split(/[/,&]|\band\b/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

// How precisely a label pins an instrument. A chart routinely offers the same
// player two pages — "C melody" is written for every C instrument, while "C bass
// cleff" is the bass-clef rendering of it — and the tuba belongs on the second.
// Ranking by precision, not page order, is what sends each reader to the page
// actually written for them.
const NAMED = 2; // "Trombone" — the label says the instrument
const NOTATED = 1; // "C bass cleff" — the label fixes the clef
const TRANSPOSED = 0; // "C melody" — only the transposition, so every C instrument

/**
 * Instrument slugs a page label resolves to, each with how precisely the label
 * named it. Both vocabularies are tried: a named instrument ("Baritone Sax"),
 * then a shared chart's role + transposition ("Bb melody" → every B♭ instrument).
 *
 * @param {string} label
 * @returns {Map<string, number>} slug → precision
 */
export function resolveLabel(label) {
  const out = new Map();
  const add = (slug, precision) => {
    if (!out.has(slug) || out.get(slug) < precision) out.set(slug, precision);
  };
  for (const piece of splitLabel(label)) {
    const inst = detectInstrument(piece);
    if (inst) {
      add(inst.slug, NAMED);
      continue;
    }
    const folded = piece.toLowerCase().replace(/[_-]+/g, ' ').trim();
    const alias = LABEL_ALIASES.find(([pattern]) => pattern.test(folded));
    if (alias) {
      add(alias[1], NAMED);
      continue;
    }
    const meta = sharedPartMetadata(piece) ?? notationOnly(piece);
    if (!meta) continue;
    const precision = meta.clef ? NOTATED : TRANSPOSED;
    for (const slug of compatibleInstruments(meta)) add(slug, precision);
  }
  return out;
}

/**
 * Instrument slugs a page label resolves to, in label order and de-duplicated.
 *
 * @param {string} label
 * @returns {string[]}
 */
export function instrumentsForLabel(label) {
  return [...resolveLabel(label).keys()];
}

/**
 * A page label that states only the notation — "C bass cleff", "Bb treble clef" —
 * with none of the role words sharedPartMetadata requires. That's a complete
 * description of who can read the page, so resolve it here. Filenames stay on the
 * stricter role-gated reading: a *name* carrying a stray clef word is not evidence
 * of a shared chart, but a part label printed above the staff is.
 *
 * @param {string} label
 * @returns {{ role: null, clef: string, key: string|null } | null}
 */
function notationOnly(label) {
  const text = String(label ?? '').toLowerCase().replace(/[_-]+/g, ' ');
  const clef = /\bbass cleff?\b/.test(text) ? 'bass' : /\btreble cleff?\b/.test(text) ? 'treble' : null;
  if (!clef) return null;
  const key = detectKey(label) || (/\bc\b/.test(text) ? 'c' : /\bf\b/.test(text) ? 'f' : null);
  return { role: null, clef, key };
}

/**
 * The part label on one page, or null when nothing in the left margin names an
 * instrument (a continuation page, or a chart that isn't a parts compilation).
 *
 * @param {{ text: string, x: number, y: number }[]} items  Text runs, with `x`/`y`
 *   in page points from the TOP-LEFT corner (y already flipped from PDF space).
 * @param {number} width   Page width in points.
 * @param {number} height  Page height in points.
 * @returns {{ label: string, instruments: string[], precision: Record<string, number> } | null}
 */
export function labelForPage(items, width, height) {
  const margin = width * LEFT_MARGIN;
  const band = height * TOP_BAND;
  const candidates = (items ?? [])
    .filter((it) => it.x < margin && it.y < band)
    // Measure numbers and repeat counts share the margin; they never name a part.
    .filter((it) => !/^[\d\s.,:;'"|()-]*$/.test(it.text ?? ''))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of candidates) {
    const resolved = resolveLabel(c.text);
    if (resolved.size) {
      return {
        label: String(c.text).trim(),
        instruments: [...resolved.keys()],
        precision: Object.fromEntries(resolved),
      };
    }
  }
  return null;
}

/**
 * Build a whole-document page index from per-page text.
 *
 * Only a genuine parts compilation gets an index: a single-instrument part and a
 * conductor score both name the same instruments on every page, so requiring TWO
 * distinct labelled start pages rejects them. Without that guard a one-part PDF
 * would claim "your part starts on page 1" — true but useless — and a conductor
 * score would advertise a start page for whichever staff happens to be printed
 * first, which is worse than saying nothing.
 *
 * @param {{ text: string, x: number, y: number }[][]} pages  Text items per page, in order.
 * @param {{ width: number, height: number }[]} sizes  Page sizes in points, in order.
 * @returns {{ page: number, label: string, instruments: string[] }[]} Empty when the
 *   document isn't a parts compilation.
 */
export function buildPartPages(pages, sizes) {
  const found = [];
  const seen = new Set();
  pages.forEach((items, i) => {
    const size = sizes[i] ?? sizes[0];
    if (!size) return;
    const hit = labelForPage(items, size.width, size.height);
    // The same label reappearing (a part that restarts, a repeated staff name)
    // never moves the start page: the FIRST page carrying it is where to begin.
    if (!hit || seen.has(hit.label)) return;
    seen.add(hit.label);
    found.push({ page: i + 1, label: hit.label, instruments: hit.instruments, precision: hit.precision });
  });
  return found.length >= 2 ? found : [];
}

/**
 * Collapse a page index to one start page per instrument: the page whose label
 * names it most precisely, earliest page breaking a tie. `overrides`
 * (admin-entered, keyed by instrument slug) win outright, including for an
 * instrument the chart never named.
 *
 * @param {{ page: number, instruments: string[], precision?: Record<string, number> }[]} index
 * @param {Record<string, number>} [overrides]
 * @returns {Record<string, number>} instrument slug → 1-based page.
 */
export function startPages(index, overrides = {}) {
  const out = {};
  const best = {};
  for (const entry of index ?? []) {
    for (const slug of entry.instruments) {
      const precision = entry.precision?.[slug] ?? TRANSPOSED;
      const better = best[slug] == null || precision > best[slug];
      if (!better) continue;
      best[slug] = precision;
      out[slug] = entry.page;
    }
  }
  for (const [slug, page] of Object.entries(overrides ?? {})) {
    const n = Number(page);
    if (Number.isInteger(n) && n >= 1) out[slug] = n;
  }
  return out;
}
