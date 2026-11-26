// Build LilyPond sources for every output of one song from the parsed
// musicxml2ly conversion: the full score, each part in each print format, and a
// MIDI score for audio. All of them share one "music" section — the voice
// variables, with the fixup rules applied — and differ only in header, paper,
// and the \score block around the staves.

import { parseConverted } from './lyparse.js';
import { keyNone, layoutBreaks, mergeRests, drumify, drumStaff, flatNames, drumFamily, setInstrumentName } from './fixups.js';
import { slugify } from '../sync/slugify.js';
import { detectInstrument, detectKey, detectPartNumbers, translatePartName } from '../sync/instruments.js';

export const LILYPOND_VERSION = '2.24.3';

/** Print formats, mirroring the app's PrintFormat taxonomy (letter, lyre). */
export const LY_FORMATS = {
  // Music stand: US Letter, ~1.75 mm staff space (the engraving standard). The
  // 1" top band is left empty for the app-owned header stamped afterwards
  // (src/scores/stamp.js), exactly as on the MuseScore-built parts.
  letter: {
    staffSize: 20,
    paper: [
      'paper-width = 8.5\\in',
      'paper-height = 11\\in',
      'top-margin = 1.0\\in',
      'bottom-margin = 0.5\\in',
      'left-margin = 0.6\\in',
      'right-margin = 0.6\\in',
      'ragged-last-bottom = ##t',
    ],
    compactTitle: false,
  },
  // Lyre card: 7×5.5 in, pinned to the top-left of a portrait Letter sheet
  // (same physical layout as the MuseScore-built lyre parts) at ~1.35 mm staff
  // space; a 0.5" top band for the stamped one-line "Title - Part" header.
  lyre: {
    staffSize: 15.5,
    paper: [
      'paper-width = 8.5\\in',
      'paper-height = 11\\in',
      'top-margin = 0.5\\in',
      'left-margin = 0.25\\in',
      'right-margin = 1.75\\in',
      'bottom-margin = 5.75\\in',
      'ragged-last-bottom = ##t',
    ],
    compactTitle: true,
  },
};

/** The header/date stamp's page geometry per format (points), for stampCorners. */
export const LYRE_TRIM = { width: 7 * 72, height: 5.5 * 72 };

// LilyPond prints no title block, page numbers or tagline of its own: the
// app-owned header and render date are stamped on afterwards, the same as on
// MuseScore-built parts, so both generators' PDFs look alike.
const NO_TITLES = [
  'print-page-number = ##f',
  'bookTitleMarkup = ##f',
  'scoreTitleMarkup = ##f',
  'oddHeaderMarkup = ##f',
  'evenHeaderMarkup = ##f',
  'oddFooterMarkup = ##f',
  'evenFooterMarkup = ##f',
];

/** Escape a string for a LilyPond "string literal". */
const lyString = (s) => JSON.stringify(String(s ?? ''));

/**
 * The header fields worth keeping from musicxml2ly's \header (composer etc.),
 * as a map. The title always comes from the catalog instead.
 *
 * @param {string|null} header
 */
function headerFields(header) {
  const out = {};
  if (!header) return out;
  for (const m of header.matchAll(/^\s*(composer|arranger|subtitle|poet|lyricist)\s*=\s*"((?:[^"\\]|\\.)*)"/gm)) {
    const v = m[2].trim();
    if (v && !/^untitled/i.test(v)) out[m[1]] = v;
  }
  return out;
}

/**
 * A filename-safe, catalog-recognizable slug for one part, matching the
 * MuseScore builder's naming (instrument[-key][-partN]) so the catalog detects
 * the instrument from the generated filename. Drum-family parts keep their own
 * name ("drums-snare-drum") so snare, tenors and bass stay distinct.
 *
 * @param {string} partName
 * @param {number} index
 */
export function partSlug(partName, index) {
  const name = translatePartName(partName || '');
  const inst = detectInstrument(name);
  const bits = [];
  if (!inst) bits.push(slugify(name) || `part${index + 1}`);
  else if (inst.slug === 'drums') bits.push('drums', slugify(name.replace(/\bdrums?\b/gi, '').trim()) || `part${index + 1}`);
  else bits.push(inst.slug);
  const key = inst ? detectKey(name) : null;
  if (key) bits.push(key);
  const nums = detectPartNumbers(name);
  if (nums.length) bits.push(`part${nums.join('-')}`);
  return bits.join('-').replace(/-+/g, '-');
}

/**
 * @typedef {Object} PartPlan
 * @property {string} name   Display name of the part (from the score).
 * @property {string} slug   Unique filename slug.
 * @property {string} staff  The fixed-up `\new Staff …` / `\new DrumStaff …` text.
 * @property {boolean} drums
 */

/**
 * @typedef {Object} SongSources
 * @property {string} music       Shared section: scheme defs + fixed-up variables.
 * @property {PartPlan[]} parts
 * @property {string} fullMusic   The full-band `<< … >>` with fixed-up staves.
 * @property {string|null} tempo
 * @property {Record<string,string>} header
 * @property {{ first: number, second: number, unit: number }|null} [swing]
 */

/**
 * Apply the fixup rules to a musicxml2ly conversion and plan its outputs.
 *
 * @param {string} converted         musicxml2ly output (run with --absolute).
 * @param {import('./musicxml.js').PartInfo[]} parts  From the MusicXML, score order.
 * @returns {SongSources}
 */
export function planSong(converted, parts) {
  const fixed = flatNames(mergeRests(layoutBreaks(keyNone(converted))));
  const p = parseConverted(fixed);
  if (!p.music) throw new Error('musicxml2ly output has no \\score music');

  // musicxml2ly names variables PartP<One>Voice<One> in score-part order; map
  // each variable to its source part by that order (PartPOne… → parts[0]).
  const partVarOrder = [...new Set([...p.variables.keys()].map((v) => v.replace(/Voice\w+$/, '')))];
  const partOfVar = (v) => parts[partVarOrder.indexOf(v.replace(/Voice\w+$/, ''))] ?? null;

  const variables = new Map(p.variables);
  for (const [name, text] of variables) {
    const part = partOfVar(name);
    if (part?.unpitched) variables.set(name, drumify(text, part.drumMap, drumFamily(part.name)));
  }

  const used = new Map();
  let fullMusic = p.music;
  const plans = p.staves.map((s, i) => {
    const part = s.voices.length ? partOfVar(s.voices[0]) : null;
    const drums = Boolean(part?.unpitched) || s.kind !== 'Staff';
    // The MusicXML part name keeps accidentals ("Clarinet in Bb") that
    // musicxml2ly's staff label drops ("Clarinet in B"), so it wins.
    const name = part?.name || s.name || `Part ${i + 1}`;
    let staff = drums ? drumStaff(s.text, { oneLine: part?.staffLines === 1 || s.kind === 'RhythmicStaff' }) : s.text;
    staff = setInstrumentName(staff, name);
    fullMusic = fullMusic.replace(s.text, staff);
    let slug = partSlug(name, i);
    const n = (used.get(slug) ?? 0) + 1;
    used.set(slug, n);
    if (n > 1) slug = `${slug}-${n}`;
    return { name, slug, staff, drums };
  });

  const music = [...p.schemeDefs, ...variables.values()].join('\n\n');
  return { music, parts: plans, fullMusic, tempo: p.tempo, header: headerFields(p.header) };
}

/** Staff size for a full score of `n` staves on Letter. */
export function scoreStaffSize(n) {
  return Math.max(11, Math.min(18, Math.round(20 - 0.75 * n)));
}

function headerBlock(title, fields, extra = {}) {
  const lines = [`  title = ${lyString(title)}`];
  for (const [k, v] of Object.entries({ ...fields, ...extra })) lines.push(`  ${k} = ${lyString(v)}`);
  lines.push('  tagline = ##f');
  return `\\header {\n${lines.join('\n')}\n}`;
}

function preamble(staffSize) {
  return `\\version "${LILYPOND_VERSION}"\n\\include "articulate.ly"\n#(set-global-staff-size ${staffSize})`;
}

/**
 * The full score (conductor) on Letter.
 *
 * @param {SongSources} src
 * @param {string} title
 */
export function fullScoreLy(src, title) {
  const size = scoreStaffSize(src.parts.length);
  return [
    preamble(size),
    headerBlock(title, src.header),
    `\\paper {\n  ${[...LY_FORMATS.letter.paper, ...NO_TITLES].join('\n  ')}\n}`,
    src.music,
    `\\score {\n  ${src.fullMusic}\n  \\layout {\n    \\context { \\Staff \\RemoveEmptyStaves }\n    \\context { \\DrumStaff \\RemoveEmptyStaves }\n  }\n}`,
  ].join('\n\n');
}

/**
 * One part in one print format. Multi-measure rests are compressed and the
 * staff's instrument label is hidden (the header names the part).
 *
 * @param {SongSources} src
 * @param {PartPlan} part
 * @param {string} title
 * @param {keyof typeof LY_FORMATS} format
 */
export function partLy(src, part, title, format) {
  const fmt = LY_FORMATS[format];
  return [
    preamble(fmt.staffSize),
    headerBlock(title, fmt.compactTitle ? {} : src.header, { instrument: part.name }),
    `\\paper {\n  ${[...fmt.paper, ...NO_TITLES].join('\n  ')}\n}`,
    src.music,
    // Multi-bar rests always as the modern thick bar with a number (LilyPond
    // otherwise draws old "church rest" blocks for up to 10 bars).
    `\\score {\n  \\compressMMRests ${part.staff}\n  \\layout {\n    indent = 0\n    \\context { \\Staff \\override InstrumentName.stencil = ##f \\override MultiMeasureRest.expand-limit = #1 }\n    \\context { \\DrumStaff \\override InstrumentName.stencil = ##f \\override MultiMeasureRest.expand-limit = #1 }\n  }\n}`,
  ].join('\n\n');
}

/**
 * The whole band for MIDI: repeats unfolded, articulations played, and one MIDI
 * channel per instrument (so more than 15 staves don't wrap channels).
 *
 * @param {SongSources} src
 */
export function midiLy(src) {
  // Swing (e.g. 5:3 eighths) is applied to the unfolded music before
  // articulation, so the band MP3 swings like MuseScore's playback.
  const swing = src.swing ? `\\applySwing ${src.swing.unit} #'(${src.swing.first} ${src.swing.second}) ` : '';
  return [
    `\\version "${LILYPOND_VERSION}"\n\\include "articulate.ly"${src.swing ? '\n\\include "swing.ly"' : ''}`,
    src.music,
    `\\score {\n  \\articulate ${swing}\\unfoldRepeats ${src.fullMusic}\n  \\midi {\n    ${src.tempo ?? ''}\n    \\context { \\Score midiChannelMapping = #'instrument }\n  }\n}`,
  ].join('\n\n');
}
