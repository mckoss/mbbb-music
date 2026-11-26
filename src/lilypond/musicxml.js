// Facts the LilyPond conversion needs from the MusicXML that MuseScore exports,
// read with targeted regexes (MusicXML here is machine-written and regular; a
// full XML parser would be a dependency for a handful of fields).
//
// Per part (in score order):
//   - name                     <part-name> (falls back to the part id)
//   - unpitched                true when the part has <unpitched> notes (drums)
//   - drumMap                  staff position ("b4") → General MIDI note, from
//                              each note's <instrument id> and the part's
//                              <midi-instrument><midi-unpitched> table
//   - staffLines               <staff-lines> when the part sets it (1 = one-line)

/** @param {string} s */
function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * @typedef {Object} PartInfo
 * @property {string} id
 * @property {string} name
 * @property {boolean} unpitched
 * @property {Record<string, number>} drumMap   e.g. { 'c5': 38, 'f4': 36 }
 * @property {number|null} staffLines
 */

/**
 * @param {string} xml  A MusicXML score-partwise document.
 * @returns {PartInfo[]}
 */
export function readParts(xml) {
  const scoreParts = new Map();
  for (const m of xml.matchAll(/<score-part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/score-part>/g)) {
    const [, id, body] = m;
    const name = decodeXml((body.match(/<part-name[^>]*>([\s\S]*?)<\/part-name>/)?.[1] ?? '').trim());
    // midi-unpitched is 1-based (MIDI note + 1), per the MusicXML spec.
    const midiOf = new Map();
    for (const mi of body.matchAll(/<midi-instrument\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/midi-instrument>/g)) {
      const n = mi[2].match(/<midi-unpitched>\s*(\d+)\s*<\/midi-unpitched>/);
      if (n) midiOf.set(mi[1], Number(n[1]) - 1);
    }
    scoreParts.set(id, { name, midiOf });
  }

  const parts = [];
  for (const m of xml.matchAll(/<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g)) {
    const [, id, body] = m;
    const sp = scoreParts.get(id) ?? { name: '', midiOf: new Map() };
    const staffLines = body.match(/<staff-lines>\s*(\d+)\s*<\/staff-lines>/);
    // Tally which instrument sits at each staff position; the most common wins.
    const votes = new Map();
    let unpitched = false;
    for (const n of body.matchAll(/<note\b[\s\S]*?<\/note>/g)) {
      const u = n[0].match(/<unpitched>\s*<display-step>([A-G])<\/display-step>\s*<display-octave>(\d)<\/display-octave>/);
      if (!u) continue;
      unpitched = true;
      const pos = `${u[1].toLowerCase()}${u[2]}`;
      const inst = n[0].match(/<instrument\s+id="([^"]+)"/)?.[1];
      const midi = inst != null ? sp.midiOf.get(inst) : undefined;
      if (midi == null) continue;
      const v = votes.get(pos) ?? new Map();
      v.set(midi, (v.get(midi) ?? 0) + 1);
      votes.set(pos, v);
    }
    /** @type {Record<string, number>} */
    const drumMap = {};
    for (const [pos, v] of votes) {
      drumMap[pos] = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    parts.push({ id, name: sp.name || id, unpitched, drumMap, staffLines: staffLines ? Number(staffLines[1]) : null });
  }
  return parts;
}

/**
 * The work title MusicXML carries, or null when absent / MuseScore's placeholder.
 *
 * @param {string} xml
 * @returns {string|null}
 */
export function readTitle(xml) {
  const t =
    xml.match(/<work-title>([\s\S]*?)<\/work-title>/)?.[1] ??
    xml.match(/<movement-title>([\s\S]*?)<\/movement-title>/)?.[1] ??
    null;
  const title = t ? decodeXml(t).trim() : '';
  return title && !/^untitled score$/i.test(title) ? title : null;
}
