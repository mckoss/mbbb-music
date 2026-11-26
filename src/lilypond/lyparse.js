// Structural parsing of the LilyPond source that `musicxml2ly` writes.
//
// musicxml2ly emits a predictable shape:
//
//   \version … \header { … } #(set-global-staff-size …) \paper { … } \layout { … }
//   PartPOneVoiceOne = { …notes… }        ← one variable per voice
//   …
//   \score { << \new Staff << … \context Voice = "PartPOneVoiceOne" { \PartPOneVoiceOne } >> … >> \layout {} }
//   \score { \unfoldRepeats \articulate << … >> \midi { \tempo 4 = 140 } }
//
// The pipeline keeps the variables (the music) and replaces everything around
// them: its own header, paper, and score blocks per output (full score, each
// part, MIDI). These helpers find those pieces without a full LilyPond parser —
// just balanced-bracket scanning that skips strings and comments.

/**
 * Index just past the bracket that closes the one opening at `openIdx`.
 * `open`/`close` are '{'/'}' or '<<'/'>>'. Skips "strings" and % comments
 * (including %{ block comments %}). Returns -1 when unbalanced.
 *
 * @param {string} text
 * @param {number} openIdx  Index of the opening bracket.
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
export function matchClose(text, openIdx, open, close) {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      // Skip a string literal, honouring backslash escapes.
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '%') {
      if (text[i + 1] === '{') {
        const end = text.indexOf('%}', i + 2);
        i = end < 0 ? text.length : end + 2;
      } else {
        const nl = text.indexOf('\n', i);
        i = nl < 0 ? text.length : nl + 1;
      }
      continue;
    }
    if (text.startsWith(open, i)) {
      depth++;
      i += open.length;
      continue;
    }
    if (text.startsWith(close, i)) {
      depth--;
      i += close.length;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Find top-level `\name { … }` blocks (e.g. `\score`, `\paper`) in a file.
 * Only blocks that start a line (after optional indentation) are matched, which
 * is how musicxml2ly writes them and keeps `\layout` inside a score from
 * matching as top-level.
 *
 * @param {string} text
 * @param {string} name  Block keyword without the backslash.
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function topLevelBlocks(text, name) {
  const re = new RegExp(`^\\\\${name}\\s*\\{`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const end = matchClose(text, open, '{', '}');
    if (end < 0) break;
    out.push({ start: m.index, end, text: text.slice(m.index, end) });
    re.lastIndex = end;
  }
  return out;
}

/**
 * The music variables musicxml2ly defined, as a map name → full assignment text
 * (`Name = { … }` or `Name = \relative x { … }`), in source order.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function musicVariables(text) {
  const vars = new Map();
  const re = /^([A-Za-z]+)\s*=\s*(\\relative\s+[a-g](?:is|es)*[',]*\s*|\\drummode\s*)?\{/gm;
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const end = matchClose(text, open, '{', '}');
    if (end < 0) break;
    vars.set(m[1], text.slice(m.index, end));
    re.lastIndex = end;
  }
  return vars;
}

/**
 * Short variable definitions musicxml2ly adds before the music (e.g.
 * `otherdynamics = #(make-dynamic-script "…")`). Returned verbatim so generated
 * files keep compiling.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function schemeDefinitions(text) {
  return [...text.matchAll(/^[A-Za-z]+\s*=\s*#\(.*\)\s*$/gm)].map((m) => m[0]);
}

/**
 * The simultaneous-music expression (`<< … >>`) inside a `\score` block.
 *
 * @param {string} scoreText
 * @returns {string|null}
 */
export function scoreMusic(scoreText) {
  const open = scoreText.indexOf('<<');
  if (open < 0) return null;
  const end = matchClose(scoreText, open, '<<', '>>');
  return end < 0 ? null : scoreText.slice(open, end);
}

/**
 * The tempo of a `\midi { \tempo 4 = 140 }` block, as written, or null.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function midiTempo(text) {
  const m = text.match(/\\midi\s*\{[^}]*?(\\tempo\s+[^}]+?)\s*\}/);
  return m ? m[1].trim() : null;
}

/**
 * @typedef {Object} StaffBlock
 * @property {'Staff'|'DrumStaff'|'RhythmicStaff'} kind
 * @property {string} text            The full `\new Staff << … >>` expression.
 * @property {string|null} name       Its `instrumentName`, if set.
 * @property {string[]} voices        Music variables it plays (`\PartP…`).
 */

/**
 * Every `\new Staff` / `\new DrumStaff` / `\new RhythmicStaff` expression in a score's music, in order.
 * Staff groups are flattened away: each staff is returned on its own, which is
 * what a single-instrument part needs.
 *
 * @param {string} music
 * @returns {StaffBlock[]}
 */
export function staves(music) {
  const out = [];
  const re = /\\new\s+(Staff|DrumStaff|RhythmicStaff)\b/g;
  let m;
  while ((m = re.exec(music))) {
    let i = m.index + m[0].length;
    // Optional `\with { … }` between the context and its music.
    const rest = music.slice(i);
    const withM = rest.match(/^\s*\\with\s*\{/);
    if (withM) {
      const wOpen = i + withM[0].length - 1;
      i = matchClose(music, wOpen, '{', '}');
      if (i < 0) break;
    }
    const open = music.indexOf('<<', i);
    if (open < 0) break;
    const end = matchClose(music, open, '<<', '>>');
    if (end < 0) break;
    const text = music.slice(m.index, end);
    const nameM = text.match(/instrumentName\s*=\s*(?:"((?:[^"\\]|\\.)*)"|\\markup)/);
    const voices = [...text.matchAll(/\{\s*\\([A-Za-z]+)\s*\}/g)].map((v) => v[1]);
    out.push({ kind: /** @type {'Staff'|'DrumStaff'|'RhythmicStaff'} */ (m[1]), text, name: nameM ? (nameM[1] ?? null) : null, voices });
    re.lastIndex = end;
  }
  return out;
}

/**
 * Split a musicxml2ly file into the parts the generator reuses.
 *
 * @param {string} text
 * @returns {{ header: string|null, schemeDefs: string[], variables: Map<string,string>, music: string|null, tempo: string|null, staves: StaffBlock[] }}
 */
export function parseConverted(text) {
  const scores = topLevelBlocks(text, 'score');
  const layoutScore = scores.find((s) => !/\\midi\b/.test(s.text) || /\\layout\b/.test(s.text)) ?? scores[0];
  const music = layoutScore ? scoreMusic(layoutScore.text) : null;
  const header = topLevelBlocks(text, 'header')[0]?.text ?? null;
  return {
    header,
    schemeDefs: schemeDefinitions(text),
    variables: musicVariables(text),
    music,
    tempo: midiTempo(text),
    staves: music ? staves(music) : [],
  };
}
