// Deterministic corrections applied to musicxml2ly output (PLAN.md "fixup
// rules"). Each rule is a pure text transform so it can be unit-tested on a
// tiny synthetic snippet and re-applied on every conversion.
//
//   1. keyNone       — drop `\key c \none`, which musicxml2ly writes on
//                      percussion staves and LilyPond rejects outright.
//   2. drumify       — rewrite a percussion voice into `\drummode` with General
//                      MIDI drum names, so it prints on a drum staff and plays
//                      on the MIDI drum channel (musicxml2ly leaves drums as
//                      plain pitches, which play silent or as pitched notes).
//   3. drumStaff     — turn the staff holding a percussion voice into a
//                      DrumStaff (one-line when the source says so).
//   4. flatNames     — instrument names with "♭"/"♯" render as markup
//                      accidentals (the default text font has no ♭ glyph).
//   5. layoutBreaks  — drop the line/page breaks copied from MuseScore's
//                      full-score layout; they force one system per page in a
//                      single part. LilyPond lays out each output itself.

import { matchClose } from './lyparse.js';

/** Rule 1. */
export function keyNone(ly) {
  return ly.replace(/\\key\s+[a-g](?:is|es)*\s*\\none\b/g, '');
}

/** Rule 5. */
export function layoutBreaks(ly) {
  return ly.replace(/\\(?:pageBreak|break|noPageBreak|noBreak)\b/g, '');
}

// General MIDI percussion note → LilyPond drum pitch name (drumpitch-init.ly).
export const GM_DRUM_NAMES = {
  35: 'acousticbassdrum', 36: 'bassdrum', 37: 'sidestick', 38: 'acousticsnare',
  39: 'handclap', 40: 'electricsnare', 41: 'lowfloortom', 42: 'closedhihat',
  43: 'highfloortom', 44: 'pedalhihat', 45: 'lowtom', 46: 'openhihat',
  47: 'lowmidtom', 48: 'himidtom', 49: 'crashcymbal', 50: 'hightom',
  51: 'ridecymbal', 52: 'chinesecymbal', 53: 'ridebell', 54: 'tambourine',
  55: 'splashcymbal', 56: 'cowbell', 57: 'crashcymbalb', 58: 'vibraslap',
  59: 'ridecymbalb', 60: 'hibongo', 61: 'lobongo', 62: 'mutehiconga',
  63: 'openhiconga', 64: 'loconga', 65: 'hitimbale', 66: 'lotimbale',
  67: 'hiagogo', 68: 'loagogo', 69: 'cabasa', 70: 'maracas',
  71: 'shortwhistle', 72: 'longwhistle', 73: 'shortguiro', 74: 'longguiro',
  75: 'claves', 76: 'hiwoodblock', 77: 'lowoodblock', 78: 'mutecuica',
  79: 'opencuica', 80: 'mutetriangle', 81: 'opentriangle',
};

/** Drum name used when a staff position has no instrument mapping. */
const FALLBACK_DRUM = 'acousticsnare';

// Toms, high to low, for spreading a tenor-drum part's staff positions.
const TOMS = ['hightom', 'himidtom', 'lowmidtom', 'lowtom', 'highfloortom', 'lowfloortom'];

/**
 * The drum family a part's name implies. Marching-percussion drumsets (snare,
 * tenors, bass, cymbals) use MuseScore-specific note numbers outside General
 * MIDI, so for these families the sound comes from the family, not the number.
 * A drum kit (or anything unrecognized) keeps the General MIDI mapping.
 *
 * @param {string} partName
 * @returns {'snare'|'bass'|'cymbal'|'tenor'|'kit'}
 */
export function drumFamily(partName) {
  const n = String(partName || '').toLowerCase();
  if (/\bkit\b|drum\s*set|batterie/.test(n)) return 'kit';
  if (/snare|caisse claire|tamburo/.test(n)) return 'snare';
  if (/bass\s*drum|grosses?\s*caisses?|\bbd\b/.test(n)) return 'bass';
  if (/cymbal|crash|cymbale/.test(n)) return 'cymbal';
  if (/tenor|toms?\b|quad|quint/.test(n)) return 'tenor';
  return 'kit';
}

/**
 * Staff position → LilyPond drum name for one part.
 *
 * @param {Record<string, number>} drumMap   position → MIDI note (from MusicXML)
 * @param {string} family                    from {@link drumFamily}
 * @returns {(pos: string) => string}
 */
export function drumNamer(drumMap, family) {
  const posValue = (pos) => {
    const order = 'cdefgab';
    return Number(pos.slice(1)) * 7 + order.indexOf(pos[0]);
  };
  if (family === 'snare') return (pos) => (drumMap[pos] === 37 ? 'sidestick' : 'acousticsnare');
  if (family === 'bass') return () => 'bassdrum';
  if (family === 'cymbal') return () => 'crashcymbal';
  if (family === 'tenor') {
    const positions = Object.keys(drumMap).sort((a, b) => posValue(b) - posValue(a));
    return (pos) => {
      const i = positions.indexOf(pos);
      return TOMS[Math.min(i < 0 ? 0 : i, TOMS.length - 1)];
    };
  }
  return (pos) => GM_DRUM_NAMES[drumMap[pos]] ?? FALLBACK_DRUM;
}

/**
 * Absolute LilyPond pitch token → staff position key ("b4"), ignoring the
 * accidental. LilyPond's `c` is C3, `c'` middle C (C4).
 *
 * @param {string} letter
 * @param {string} marks   The run of ' and , after the pitch.
 */
function positionOf(letter, marks) {
  let octave = 3;
  for (const ch of marks) octave += ch === "'" ? 1 : -1;
  return `${letter}${octave}`;
}

/**
 * Rule 2: rewrite one music variable (`Name = { … }`, absolute pitches) as
 * `Name = \drummode { … }`, mapping each note to a drum name via `drumMap`
 * (staff position → GM note). Strings, comments, `\commands` and `\markup`
 * blocks are copied untouched; key signatures are dropped (meaningless on a
 * drum staff and they would parse as drum names).
 *
 * @param {string} varText
 * @param {Record<string, number>} drumMap
 * @param {string} [family]  Drum family ({@link drumFamily}); default 'kit'.
 * @returns {string}
 */
export function drumify(varText, drumMap, family = 'kit') {
  const open = varText.indexOf('{');
  if (open < 0) return varText;
  const name = varText.slice(0, open).replace(/=\s*(\\relative\s+\S+|\\drummode)?\s*$/, '= ');
  const body = varText.slice(open).replace(/\\key\s+[a-g](?:is|es)*\s*\\[a-z]+/g, '');
  const drumFor = drumNamer(drumMap, family);

  let out = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"') {
      let j = i + 1;
      while (j < body.length && body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
      out += body.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '%') {
      const nl = body.indexOf('\n', i);
      const j = nl < 0 ? body.length : nl;
      out += body.slice(i, j);
      i = j;
      continue;
    }
    if (c === '\\') {
      const m = body.slice(i).match(/^\\[A-Za-z]+/);
      const word = m ? m[0] : '\\';
      if (word === '\\markup') {
        const bOpen = body.indexOf('{', i);
        const end = bOpen < 0 ? -1 : matchClose(body, bOpen, '{', '}');
        if (end > 0) {
          out += body.slice(i, end);
          i = end;
          continue;
        }
      }
      out += word;
      i += word.length;
      continue;
    }
    const prev = i === 0 ? ' ' : body[i - 1];
    if (/[a-g]/.test(c) && /[\s<{(\[~]/.test(prev)) {
      const m = body.slice(i).match(/^([a-g])(?:isis|eses|is|es)?([',]*)(?![A-Za-z])/);
      if (m) {
        out += drumFor(positionOf(m[1], m[2]));
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return `${name}\\drummode ${out}`;
}

/**
 * Rule 3: make a staff expression a DrumStaff playing DrumVoices. A one-line
 * source staff (snare, bass drum) keeps one line with every note on it.
 *
 * @param {string} staffText  A `\new Staff << … >>` expression.
 * @param {{ oneLine?: boolean }} [opts]
 * @returns {string}
 */
export function drumStaff(staffText, opts = {}) {
  let t = staffText
    .replace(/\\new\s+(?:Rhythmic)?Staff\b/, '\\new DrumStaff')
    .replace(/\\context\s+(?:Rhythmic)?Staff\b/g, '\\context DrumStaff')
    .replace(/\\context\s+Voice\b/g, '\\context DrumVoice')
    .replace(/\\set\s+Staff\.midiInstrument\s*=\s*"[^"]*"/g, '')
    .replace(/\b(?:Rhythmic)?Staff\.(instrumentName|shortInstrumentName)/g, 'DrumStaff.$1');
  if (opts.oneLine && !/line-count/.test(t)) {
    t = t.replace(
      /\\new\s+DrumStaff\b(\s*\\with\s*\{)?/,
      (_, hasWith) =>
        '\\new DrumStaff \\with { \\override StaffSymbol.line-count = #1 drumStyleTable = #percussion-style' +
        (hasWith ? ' ' : ' } '),
    );
  }
  return t;
}

/**
 * A part name as LilyPond markup, with "Bb"/"B♭"/"F#" key letters printed with a
 * real accidental (the default text font has no ♭ glyph, and musicxml2ly drops
 * the accidental from MuseScore's display names altogether).
 *
 * @param {string} name
 * @returns {string}  `\markup { … }` or a plain "string" when no accidental.
 */
export function nameMarkup(name) {
  const pieces = String(name).split(/(?<=\b[A-G])(b|♭|#|♯)(?=\s|$|\d)/);
  if (pieces.length === 1) return JSON.stringify(String(name));
  const markup = pieces
    .filter(Boolean)
    .map((p) => (p === 'b' || p === '♭' ? '\\smaller \\flat' : p === '#' || p === '♯' ? '\\smaller \\sharp' : JSON.stringify(p)))
    .join(' ');
  return `\\markup { \\concat { ${markup} } }`;
}

/**
 * Set a staff expression's `instrumentName` to `name` (as {@link nameMarkup}).
 *
 * @param {string} staffText
 * @param {string} name
 */
export function setInstrumentName(staffText, name) {
  return staffText.replace(/(\.instrumentName\s*=\s*)(?:"(?:[^"\\]|\\.)*"|\\markup\s*\{[^}]*\}[^}]*\})/, (_, lhs) => lhs + nameMarkup(name));
}

/**
 * Rule 4: `instrumentName = "Clarinet in B♭"` → a markup with a real flat sign.
 *
 * @param {string} ly
 * @returns {string}
 */
export function flatNames(ly) {
  return ly.replace(/(instrumentName\s*=\s*)"([^"]*[♭♯][^"]*)"/g, (_, lhs, name) => {
    const pieces = name.split(/([♭♯])/).filter(Boolean);
    const markup = pieces
      .map((p) => (p === '♭' ? '\\smaller \\flat' : p === '♯' ? '\\smaller \\sharp' : JSON.stringify(p)))
      .join(' ');
    return `${lhs}\\markup { \\concat { ${markup} } }`;
  });
}
