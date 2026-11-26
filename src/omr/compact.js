// A compact, line-per-bar text notation for one part, used to show Claude what
// OMR read and to take its corrections back. MusicXML is far too verbose for a
// model to edit reliably; this keeps exactly what matters for the master score.
//
// Tokens (space separated, one bar per line):
//   C#5q  Bb4e.  F5h~    note: pitch (actual, key signature applied) + duration
//                        w h q e s t (whole … 32nd), dots, ~ = tied to the next
//   C5+E5+G5q            chord
//   F5qx                 x notehead (spoken/percussive shout)
//   rq  re.              rest;  R = whole-bar rest
//   gD5s                 grace note (takes no time)
//   3(C5e D5e E5e)       tuplet: 3 in the time of 2 (also 5, 6 → 4; 2 → 3)
//   T3/4  K-2            time signature, key (fifths) change at this bar
//   |:  :|  [1  1]       repeat start / end, ending start / end
//
// Durations are stored with a fixed 48 divisions per quarter note so every
// rebuilt bar (including triplet 16ths and dotted 32nds) has integer lengths.

export const DIVISIONS = 48;
const TYPE_TICKS = { w: 192, h: 96, q: 48, e: 24, s: 12, t: 6 };
const TYPE_NAME = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: '16th', t: '32nd' };
const NAME_TYPE = Object.fromEntries(Object.entries(TYPE_NAME).map(([k, v]) => [v, k]));
const TUPLET_NORMAL = { 2: 3, 3: 2, 5: 4, 6: 4, 7: 4 };

const ALTER_TEXT = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };
const TEXT_ALTER = { bb: -2, b: -1, '': 0, '#': 1, '##': 2, n: 0 };

const tag = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1]?.trim() ?? null;

/** Ticks (at 48/quarter) of a duration code with dots and an optional tuplet ratio. */
export function ticksOf(code, dots = 0, tuplet = null) {
  let t = TYPE_TICKS[code];
  let add = t / 2;
  for (let i = 0; i < dots; i++) {
    t += add;
    add /= 2;
  }
  if (tuplet) t = (t * tuplet.normal) / tuplet.actual;
  return t;
}

/** Expected bar length (ticks) for a time signature. */
export const barTicks = (beats, beatType) => (beats * DIVISIONS * 4) / beatType;

/**
 * Rescale every <duration> in a part so divisions are DIVISIONS throughout
 * (tracking any mid-part divisions change). Returns the part's measures.
 *
 * @param {string[]} measures
 * @returns {string[]}
 */
export function normalizeDivisions(measures) {
  let div = 1;
  return measures.map((m) => {
    const d = m.match(/<divisions>\s*(\d+)\s*<\/divisions>/);
    if (d) div = Number(d[1]);
    const scale = DIVISIONS / div;
    let out = m.replace(/<divisions>\s*\d+\s*<\/divisions>/, `<divisions>${DIVISIONS}</divisions>`);
    out = out.replace(/<duration>\s*(\d+)\s*<\/duration>/g, (_, n) => `<duration>${Math.round(Number(n) * scale)}</duration>`);
    return out;
  });
}

/** Duration code + dots for a note element (from <type>, else from its ticks). */
function durationCode(noteXml) {
  const type = tag(noteXml, 'type');
  const dots = (noteXml.match(/<dot\s*\/>/g) ?? []).length;
  if (type && NAME_TYPE[type]) return NAME_TYPE[type] + '.'.repeat(dots);
  const ticks = Number(tag(noteXml, 'duration') ?? 0);
  for (const [c, t] of Object.entries(TYPE_TICKS)) {
    if (t === ticks) return c;
    if (t * 1.5 === ticks) return `${c}.`;
  }
  return 'q';
}

function pitchText(noteXml) {
  const p = noteXml.match(/<pitch>([\s\S]*?)<\/pitch>/)?.[1];
  const u = noteXml.match(/<unpitched>([\s\S]*?)<\/unpitched>/)?.[1];
  if (p) return `${tag(p, 'step')}${ALTER_TEXT[Number(tag(p, 'alter') ?? 0)] ?? ''}${tag(p, 'octave')}`;
  if (u) return `${tag(u, 'display-step')}${tag(u, 'display-octave')}`;
  return null;
}

/**
 * One bar as compact text. Assumes divisions were normalized.
 *
 * @param {string} m  A <measure> element.
 * @returns {string}
 */
export function measureToCompact(m) {
  const out = [];
  const time = m.match(/<time\b[^>]*>\s*<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
  if (time) out.push(`T${time[1]}/${time[2]}`);
  const fifths = m.match(/<key\b[^>]*>[\s\S]*?<fifths>(-?\d+)<\/fifths>/);
  if (fifths) out.push(`K${fifths[1]}`);
  if (/<repeat\s+direction="forward"/.test(m)) out.push('|:');
  const endStart = m.match(/<ending\s+number="(\d+)[^"]*"\s+type="start"/);
  if (endStart) out.push(`[${endStart[1]}`);

  const notes = [...m.matchAll(/<note\b[\s\S]*?<\/note>/g)].map((n) => n[0]);
  let tupletOpen = null;
  let tupletCount = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (/<chord\s*\/>/.test(n)) continue; // folded into the chord head below
    const voice = tag(n, 'voice') ?? '1';
    if (voice !== '1') continue; // voice 1 only: what one player plays
    const chord = [n];
    for (let j = i + 1; j < notes.length && /<chord\s*\/>/.test(notes[j]); j++) chord.push(notes[j]);

    const tm = n.match(/<time-modification>\s*<actual-notes>(\d+)<\/actual-notes>/);
    if (tm && !tupletOpen) {
      tupletOpen = tm[1];
      tupletCount = 0;
      out.push(`${tm[1]}(`);
    } else if (!tm && tupletOpen) {
      out.push(')');
      tupletOpen = null;
    }
    // A group ends at an explicit tuplet stop, else after `actual` notes.
    const closesTuplet = tupletOpen && (/<tuplet\b[^>]*type="stop"/.test(n) || (!/<tuplet\b/.test(n) && ++tupletCount >= Number(tupletOpen)));

    if (/<rest\b/.test(n)) {
      out.push(/<rest\b[^>]*measure="yes"/.test(n) || (!tag(n, 'type') && !/<grace/.test(n) && notes.length === 1) ? 'R' : `r${durationCode(n)}`);
      if (closesTuplet) {
        out.push(')');
        tupletOpen = null;
      }
      continue;
    }
    const grace = /<grace\b/.test(n);
    const pitches = chord.map(pitchText).filter(Boolean);
    if (!pitches.length) continue;
    const x = /<notehead\b[^>]*>\s*x\s*<\/notehead>/.test(n) ? 'x' : '';
    const tie = /<tie\s+type="start"/.test(n) ? '~' : '';
    out.push(`${grace ? 'g' : ''}${pitches.join('+')}${durationCode(n)}${x}${tie}`);
    if (closesTuplet) {
      out.push(')');
      tupletOpen = null;
    }
  }
  if (tupletOpen) out.push(')');

  const endStop = m.match(/<ending\s+number="(\d+)[^"]*"\s+type="(?:stop|discontinue)"/);
  if (endStop) out.push(`${endStop[1]}]`);
  if (/<repeat\s+direction="backward"/.test(m)) out.push(':|');
  // Join tuplet brackets to their notes: "3( C5e D5e E5e )" → "3(C5e D5e E5e)".
  return out.join(' ').replace(/(\d)\( /g, '$1(').replace(/ \)/g, ')');
}

const NOTE_RE = /^(g)?((?:[A-G](?:##|bb|#|b|n)?\d)(?:\+[A-G](?:##|bb|#|b|n)?\d)*)([whqest])(\.{0,2})(x)?(~)?$/;
const REST_RE = /^r([whqest])(\.{0,2})$/;

/**
 * Parse one bar of compact text.
 *
 * @param {string} text
 * @returns {{ items: Array<object>, time: [number, number]|null, fifths: number|null, repeatStart: boolean, repeatEnd: boolean, endingStart: string|null, endingStop: string|null }}
 */
export function parseCompact(text) {
  const bar = { items: [], time: null, fifths: null, repeatStart: false, repeatEnd: false, endingStart: null, endingStop: null };
  // Split tuplet groups into marker tokens: "3(C5e D5e E5e)" → "3(", …, ")".
  const tokens = String(text)
    .replace(/(\d)\(/g, ' $1( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let tuplet = null;
  for (const tok of tokens) {
    let m;
    if ((m = tok.match(/^T(\d+)\/(\d+)$/))) bar.time = [Number(m[1]), Number(m[2])];
    else if ((m = tok.match(/^K(-?\d+)$/))) bar.fifths = Number(m[1]);
    else if (tok === '|:') bar.repeatStart = true;
    else if (tok === ':|') bar.repeatEnd = true;
    else if ((m = tok.match(/^\[(\d+)$/))) bar.endingStart = m[1];
    else if ((m = tok.match(/^(\d+)\]$/))) bar.endingStop = m[1];
    else if ((m = tok.match(/^(\d)\($/))) {
      const actual = Number(m[1]);
      if (!TUPLET_NORMAL[actual]) throw new Error(`Unsupported tuplet ${actual}`);
      tuplet = { actual, normal: TUPLET_NORMAL[actual] };
    } else if (tok === ')') {
      const group = bar.items.filter((it) => it.tuplet === tuplet);
      if (group.length) {
        group[0].tupletMark = 'start';
        group[group.length - 1].tupletMark = group.length === 1 ? null : 'stop';
      }
      tuplet = null;
    }
    else if (tok === 'R') bar.items.push({ kind: 'barRest' });
    else if ((m = tok.match(REST_RE))) bar.items.push({ kind: 'rest', code: m[1], dots: m[2].length, tuplet });
    else if ((m = tok.match(NOTE_RE))) {
      const pitches = m[2].split('+').map((p) => {
        const pm = p.match(/^([A-G])(##|bb|#|b|n)?(\d)$/);
        return { step: pm[1], alter: TEXT_ALTER[pm[2] ?? ''], octave: Number(pm[3]) };
      });
      bar.items.push({ kind: 'note', grace: Boolean(m[1]), pitches, code: m[3], dots: m[4].length, x: Boolean(m[5]), tie: Boolean(m[6]), tuplet });
    } else throw new Error(`Unreadable token "${tok}"`);
  }
  return bar;
}

/** Total ticks of a parsed bar (a whole-bar rest counts as `fullBar`). */
export function barLength(bar, fullBar) {
  let t = 0;
  for (const it of bar.items) {
    if (it.kind === 'barRest') t += fullBar;
    else if (it.kind === 'rest' || (it.kind === 'note' && !it.grace)) t += ticksOf(it.code, it.dots, it.tuplet);
  }
  return t;
}

function noteXml(it, pitch, { chord = false, tieStop = false, tupletMark = null } = {}) {
  const parts = ['<note>'];
  if (it.grace) parts.push('<grace/>');
  if (chord) parts.push('<chord/>');
  parts.push(`<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>`);
  if (!it.grace) parts.push(`<duration>${ticksOf(it.code, it.dots, it.tuplet)}</duration>`);
  if (tieStop) parts.push('<tie type="stop"/>');
  if (it.tie) parts.push('<tie type="start"/>');
  parts.push(`<voice>1</voice><type>${TYPE_NAME[it.code]}</type>`);
  for (let i = 0; i < it.dots; i++) parts.push('<dot/>');
  if (it.tuplet) parts.push(`<time-modification><actual-notes>${it.tuplet.actual}</actual-notes><normal-notes>${it.tuplet.normal}</normal-notes></time-modification>`);
  if (it.x) parts.push('<notehead>x</notehead>');
  const notations = [];
  if (tieStop) notations.push('<tied type="stop"/>');
  if (it.tie) notations.push('<tied type="start"/>');
  if (tupletMark && !chord) notations.push(`<tuplet type="${tupletMark}"/>`);
  if (notations.length) parts.push(`<notations>${notations.join('')}</notations>`);
  parts.push('</note>');
  return parts.join('');
}

/**
 * Rebuild a <measure> from compact text, keeping the original bar's
 * non-note content that the notation doesn't carry (attributes such as clef
 * and transposition, directions like tempo and dynamics, print/layout marks).
 *
 * @param {string} original   The bar being replaced (or '' for a new bar).
 * @param {string} text       Compact notation for the bar.
 * @param {{ number: number, fullBar: number, tiedFrom?: Set<string> }} ctx
 *   `tiedFrom` holds pitches tied over from the previous bar (for tie stops);
 *   it is replaced with this bar's outgoing ties.
 * @returns {string}
 */
export function compactToMeasure(original, text, ctx) {
  const bar = parseCompact(text);
  const keep = [];
  // Attributes: keep everything, then apply time/key changes from the text.
  let attrs = original.match(/<attributes>[\s\S]*?<\/attributes>/)?.[0] ?? '';
  if (bar.time) {
    const t = `<time><beats>${bar.time[0]}</beats><beat-type>${bar.time[1]}</beat-type></time>`;
    attrs = attrs ? (/<time\b/.test(attrs) ? attrs.replace(/<time\b[\s\S]*?<\/time>/, t) : attrs.replace(/(<\/key>|<divisions>\d+<\/divisions>|<attributes>)/, `$1${t}`)) : `<attributes>${t}</attributes>`;
  }
  if (bar.fifths != null) {
    const k = `<key><fifths>${bar.fifths}</fifths></key>`;
    attrs = attrs ? (/<key\b/.test(attrs) ? attrs.replace(/<key\b[\s\S]*?<\/key>/, k) : attrs.replace(/(<divisions>\d+<\/divisions>|<attributes>)/, `$1${k}`)) : `<attributes>${k}</attributes>`;
  }
  if (attrs) keep.push(attrs);
  for (const m of original.matchAll(/<(print|direction)\b[\s\S]*?<\/\1>|<print\b[^>]*\/>/g)) keep.push(m[0]);

  const notes = [];
  const tiedIn = ctx.tiedFrom ?? new Set();
  const tiedOut = new Set();
  for (const it of bar.items) {
    if (it.kind === 'barRest') notes.push(`<note><rest measure="yes"/><duration>${ctx.fullBar}</duration><voice>1</voice></note>`);
    else if (it.kind === 'rest') {
      notes.push(
        `<note><rest/><duration>${ticksOf(it.code, it.dots, it.tuplet)}</duration><voice>1</voice><type>${TYPE_NAME[it.code]}</type>${'<dot/>'.repeat(it.dots)}` +
          (it.tuplet ? `<time-modification><actual-notes>${it.tuplet.actual}</actual-notes><normal-notes>${it.tuplet.normal}</normal-notes></time-modification>` : '') +
          (it.tupletMark ? `<notations><tuplet type="${it.tupletMark}"/></notations>` : '') +
          '</note>',
      );
    } else {
      it.pitches.forEach((p, i) => {
        const key = `${p.step}${p.alter}${p.octave}`;
        notes.push(noteXml(it, p, { chord: i > 0, tieStop: tiedIn.has(key), tupletMark: it.tupletMark ?? null }));
        tiedIn.delete(key);
        if (it.tie) tiedOut.add(key);
      });
    }
  }
  if (ctx.tiedFrom) {
    ctx.tiedFrom.clear();
    for (const k of tiedOut) ctx.tiedFrom.add(k);
  }

  const left = [];
  if (bar.repeatStart || bar.endingStart) {
    left.push(
      `<barline location="left">${bar.repeatStart ? '<bar-style>heavy-light</bar-style>' : ''}${bar.endingStart ? `<ending number="${bar.endingStart}" type="start"/>` : ''}${bar.repeatStart ? '<repeat direction="forward"/>' : ''}</barline>`,
    );
  }
  const right = [];
  if (bar.repeatEnd || bar.endingStop) {
    right.push(
      `<barline location="right">${bar.repeatEnd ? '<bar-style>light-heavy</bar-style>' : ''}${bar.endingStop ? `<ending number="${bar.endingStop}" type="stop"/>` : ''}${bar.repeatEnd ? '<repeat direction="backward"/>' : ''}</barline>`,
    );
  }
  return `<measure number="${ctx.number}">${left.join('')}${keep.join('')}${notes.join('')}${right.join('')}</measure>`;
}
