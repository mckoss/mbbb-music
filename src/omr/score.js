// Turn per-part OMR output (Audiveris MusicXML, one file per part PDF) into a
// single multi-part master score the LilyPond pipeline can render. Pure string
// transforms over the machine-written MusicXML, so each step is unit-testable.
//
//   systemStartNumbers  measure numbers printed at the start of each system,
//                       read from the PDF's text layer (the ground truth for
//                       how many measures each system holds)
//   repairMeasures      expand multi-measure rests OMR read as a single bar,
//                       and give empty (zero-length) measures a full rest, so
//                       every part keeps the same bar count
//   prepPart            name the part, add its transposition and MIDI sound
//   mergeParts          one score-partwise document, bar counts padded equal

/**
 * @typedef {{ text: string, x: number, y: number }} TextItem
 * @typedef {{ width: number, height: number, items: TextItem[] }} PageText
 */

/**
 * Measure numbers printed at the left margin, one per system after the first,
 * in reading order. A number only counts when it is larger than the previous
 * one, which drops page numbers and stray digits.
 *
 * @param {PageText[]} pages
 * @returns {number[]}
 */
export function systemStartNumbers(pages) {
  const out = [];
  for (const page of pages) {
    const margin = page.width * 0.12;
    const nums = page.items
      .filter((it) => it.x < margin && /^\d{1,3}$/.test(it.text.trim()))
      .sort((a, b) => a.y - b.y)
      .map((it) => Number(it.text.trim()));
    for (const n of nums) if (n > 1 && n > (out.at(-1) ?? 1)) out.push(n);
  }
  return out;
}

/** Split a score-partwise part body into its <measure> elements. */
function splitMeasures(partBody) {
  return [...partBody.matchAll(/<measure\b[^>]*>[\s\S]*?<\/measure>/g)].map((m) => m[0]);
}

const startsSystem = (m) => /<print\b[^>]*new-(?:system|page)="yes"/.test(m);

/** Total duration of a measure's notes on voice 1 (chord notes excluded). */
function measureDuration(m) {
  let total = 0;
  for (const n of m.matchAll(/<note\b[\s\S]*?<\/note>/g)) {
    if (/<chord\s*\/>/.test(n[0]) || /<grace\b/.test(n[0])) continue;
    const voice = n[0].match(/<voice>\s*(\d+)\s*<\/voice>/)?.[1] ?? '1';
    if (voice !== '1') continue;
    total += Number(n[0].match(/<duration>\s*(\d+)\s*<\/duration>/)?.[1] ?? 0);
  }
  // <backup>/<forward> are ignored: voice-1 duration is what fills the bar.
  return total;
}

const isRestOnly = (m) => !/<pitch>|<unpitched>/.test(m);

function restMeasure(number, duration) {
  return `<measure number="${number}"><note><rest measure="yes"/><duration>${duration}</duration><voice>1</voice></note></measure>`;
}

/**
 * Fix bar counts in one part's OMR MusicXML.
 *
 * @param {string} xml          Audiveris MusicXML for one part.
 * @param {number[]} printed    {@link systemStartNumbers} of the source PDF.
 * @returns {{ xml: string, notes: string[] }}  repaired xml + what was done
 */
export function repairMeasures(xml, printed) {
  const partM = xml.match(/(<part\b[^>]*>)([\s\S]*?)(<\/part>)/);
  if (!partM) return { xml, notes: ['No part found'] };
  let measures = splitMeasures(partM[2]);
  const notes = [];

  // Track divisions and time signature to size a full-bar rest.
  let divisions = 1;
  let beats = 4;
  let beatType = 4;
  const fullBar = [];
  for (const m of measures) {
    divisions = Number(m.match(/<divisions>\s*(\d+)/)?.[1] ?? divisions);
    beats = Number(m.match(/<beats>\s*(\d+)/)?.[1] ?? beats);
    beatType = Number(m.match(/<beat-type>\s*(\d+)/)?.[1] ?? beatType);
    fullBar.push(Math.round((divisions * beats * 4) / beatType));
  }

  // 1. Empty (zero-length) measures get a whole-bar rest, or the part drifts.
  measures = measures.map((m, i) => {
    if (measureDuration(m) > 0 || !isRestOnly(m)) return m;
    notes.push(`Measure ${i + 1} was empty; filled with a rest.`);
    return m.replace(/<\/measure>$/, `<note><rest measure="yes"/><duration>${fullBar[i]}</duration><voice>1</voice></note></measure>`);
  });

  // 2. Expand multi-measure rests to the printed system lengths.
  const sysStart = measures.map((m, i) => (i === 0 || startsSystem(m) ? i : -1)).filter((i) => i >= 0);
  const starts = printed[0] === 1 ? printed.slice(1) : printed;
  const expectedStart = [1, ...starts];
  if (!starts.length) {
    notes.push('No printed measure numbers found; bar counts not checked.');
  } else if (sysStart.length > expectedStart.length) {
    notes.push(`OMR found more lines than the PDF numbers (${sysStart.length} vs ${expectedStart.length}); bar counts not checked.`);
  } else {
    // OMR sometimes drops whole lines (usually the last); align from the start
    // and report the lines it never read.
    if (sysStart.length < expectedStart.length) {
      const missing = expectedStart.length - sysStart.length;
      notes.push(`OMR missed ${missing} line${missing === 1 ? '' : 's'} at the end (from bar ${expectedStart[sysStart.length]}).`);
    }
    const inserts = []; // [index, count]
    for (let s = 0; s < sysStart.length - 1; s++) {
      const expected = expectedStart[s + 1] - expectedStart[s];
      const actual = sysStart[s + 1] - sysStart[s];
      const diff = expected - actual;
      if (diff === 0) continue;
      if (diff < 0) {
        notes.push(`Line ${s + 1} (bar ${expectedStart[s]}) has ${-diff} extra bar${diff === -1 ? '' : 's'}; left as read.`);
        continue;
      }
      const range = [...Array(actual).keys()].map((k) => sysStart[s] + k);
      const target =
        range.find((i) => /<multiple-rest>/.test(measures[i])) ?? range.find((i) => isRestOnly(measures[i]));
      if (target == null) {
        notes.push(`Line ${s + 1} (bar ${expectedStart[s]}) is ${diff} bar${diff === 1 ? '' : 's'} short and has no rest to expand.`);
        continue;
      }
      inserts.push([target, diff]);
      notes.push(`Bar ${expectedStart[s] + (target - sysStart[s])}: multi-bar rest expanded by ${diff}.`);
    }
    for (const [i, count] of inserts.sort((a, b) => b[0] - a[0])) {
      measures[i] = measures[i].replace(/<multiple-rest>\s*\d+\s*<\/multiple-rest>/, `<multiple-rest>${count + 1}</multiple-rest>`);
      const extra = Array.from({ length: count }, () => restMeasure(0, fullBar[i]));
      measures.splice(i + 1, 0, ...extra);
    }
  }

  // Renumber sequentially.
  measures = measures.map((m, i) => m.replace(/<measure\b[^>]*>/, (tag) => tag.replace(/\snumber="[^"]*"/, '').replace('<measure', `<measure number="${i + 1}"`)));
  const body = `\n${measures.join('\n')}\n`;
  return { xml: xml.replace(partM[0], `${partM[1]}${body}${partM[3]}`), notes };
}

/** Written → sounding interval (MusicXML <transpose>) by instrument and key. */
export function transposeFor(instrumentSlug, key, clefSign) {
  const treble = clefSign === 'G';
  const lowBrass = ['trombone', 'euphonium', 'tuba'];
  if (key === 'c') return null;
  if (lowBrass.includes(instrumentSlug)) {
    if (!treble) return null; // bass-clef low brass reads concert pitch
    return instrumentSlug === 'tuba' ? { diatonic: -15, chromatic: -26 } : { diatonic: -8, chromatic: -14 };
  }
  switch (instrumentSlug) {
    case 'trumpet':
    case 'clarinet':
    case 'soprano-sax':
      return { diatonic: -1, chromatic: -2 };
    case 'tenor-sax':
      return { diatonic: -8, chromatic: -14 };
    case 'alto-sax':
    case 'alto-horn':
      return { diatonic: -5, chromatic: -9 };
    case 'bari-sax':
      return { diatonic: -12, chromatic: -21 };
    case 'french-horn':
    case 'mellophone':
      return { diatonic: -4, chromatic: -7 };
    default:
      return null;
  }
}

/** General MIDI program (1-based) for an instrument's sound. */
export const MIDI_PROGRAM = {
  trumpet: 57, trombone: 58, tuba: 59, euphonium: 58, 'french-horn': 61, mellophone: 61, 'alto-horn': 61,
  'soprano-sax': 65, 'alto-sax': 66, 'tenor-sax': 67, 'bari-sax': 68, clarinet: 72, flute: 74, melodica: 23,
};

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @typedef {Object} PreppedPart
 * @property {string} id
 * @property {string} name
 * @property {string} scorePart   <score-part> element
 * @property {string[]} measures  <measure> elements
 */

/**
 * Prepare one part for merging: new id, display name, MIDI sound, and the
 * transposition OMR doesn't know (it reads written pitch only).
 *
 * @param {string} xml
 * @param {{ id: string, name: string, instrumentSlug?: string|null, key?: string|null }} info
 * @returns {PreppedPart}
 */
export function prepPart(xml, info) {
  const body = xml.match(/<part\b[^>]*>([\s\S]*?)<\/part>/)?.[1] ?? '';
  const measures = splitMeasures(body);
  const clef = body.match(/<clef\b[^>]*>\s*<sign>([A-Z]+)<\/sign>/)?.[1] ?? 'G';
  const t = transposeFor(info.instrumentSlug ?? '', info.key ?? null, clef);
  if (t && measures.length && !/<transpose>/.test(measures[0])) {
    const tx = `<transpose><diatonic>${t.diatonic}</diatonic><chromatic>${t.chromatic}</chromatic></transpose>`;
    measures[0] = /<\/attributes>/.test(measures[0])
      ? measures[0].replace(/<\/attributes>/, `${tx}</attributes>`)
      : measures[0].replace(/(<measure\b[^>]*>)/, `$1<attributes>${tx}</attributes>`);
  }
  const program = MIDI_PROGRAM[info.instrumentSlug ?? ''] ?? 1;
  const scorePart =
    `<score-part id="${info.id}"><part-name>${escapeXml(info.name)}</part-name>` +
    `<score-instrument id="${info.id}-I1"><instrument-name>${escapeXml(info.name)}</instrument-name></score-instrument>` +
    `<midi-instrument id="${info.id}-I1"><midi-program>${program}</midi-program></midi-instrument></score-part>`;
  return { id: info.id, name: info.name, scorePart, measures };
}

/** The first <sound tempo="…"> in a set of measures, or null. */
export function findTempo(measures) {
  for (const m of measures) {
    const t = m.match(/<sound\b[^>]*\btempo="([\d.]+)"/);
    if (t) return Number(t[1]);
  }
  return null;
}

/**
 * Merge prepared parts into one score-partwise document. Shorter parts are
 * padded with rest bars so every part has the same length; the tempo is set
 * on bar 1 when no part carries one.
 *
 * @param {PreppedPart[]} parts
 * @param {{ title: string, tempo?: number|null }} meta
 * @returns {{ xml: string, notes: string[] }}
 */
export function mergeParts(parts, meta) {
  const notes = [];
  const longest = Math.max(...parts.map((p) => p.measures.length));
  const merged = parts.map((p) => {
    const measures = [...p.measures];
    if (measures.length < longest) {
      notes.push(`${p.name ?? p.id}: ${longest - measures.length} bar${longest - measures.length === 1 ? '' : 's'} shorter than the longest part; padded with rests.`);
      const last = measures.at(-1) ?? '';
      const dur = Number(last.match(/<rest measure="yes"\/>\s*<duration>(\d+)/)?.[1] ?? 0) || null;
      for (let i = measures.length; i < longest; i++) measures.push(restMeasure(i + 1, dur ?? 4));
    }
    return { ...p, measures };
  });
  const anyTempo = merged.some((p) => findTempo(p.measures) != null);
  if (!anyTempo && meta.tempo && merged[0]?.measures.length) {
    const dir = `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${meta.tempo}</per-minute></metronome></direction-type><sound tempo="${meta.tempo}"/></direction>`;
    const m0 = merged[0].measures[0];
    merged[0].measures[0] = /<\/attributes>/.test(m0) ? m0.replace(/<\/attributes>/, `</attributes>${dir}`) : m0.replace(/(<measure\b[^>]*>)/, `$1${dir}`);
  }
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${escapeXml(meta.title)}</work-title></work>`,
    `<part-list>${merged.map((p) => p.scorePart).join('')}</part-list>`,
    ...merged.map((p) => `<part id="${p.id}">\n${p.measures.join('\n')}\n</part>`),
    '</score-partwise>',
  ].join('\n');
  return { xml, notes };
}
