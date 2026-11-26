// A minimal Standard MIDI File reader and the conversion-fidelity check
// (PLAN.md "Verification"): compare the note events of LilyPond's MIDI against
// MuseScore's MIDI for the same song, part by part.
//
// Only what the check needs is parsed: note-on events with their absolute time
// (in beats) and channel, per track. Everything else is skipped.

/**
 * @typedef {Object} MidiTrack
 * @property {string} name
 * @property {Array<{ beat: number, note: number, channel: number }>} notes
 */

/**
 * @param {Uint8Array} buf
 * @returns {{ ticksPerBeat: number, tracks: MidiTrack[] }}
 */
export function parseMidi(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o, n) => String.fromCharCode(...buf.subarray(o, o + n));
  if (str(0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const headerLen = dv.getUint32(4);
  const ntracks = dv.getUint16(10);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const ticksPerBeat = division;

  const tracks = [];
  let off = 8 + headerLen;
  for (let t = 0; t < ntracks && off + 8 <= buf.length; t++) {
    const len = dv.getUint32(off + 4);
    const isTrack = str(off, 4) === 'MTrk';
    const end = off + 8 + len;
    let p = off + 8;
    off = end;
    if (!isTrack) continue;

    const readVar = () => {
      let v = 0;
      for (;;) {
        const b = buf[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
    };
    let tick = 0;
    let status = 0;
    let name = '';
    const notes = [];
    while (p < end) {
      const delta = readVar();
      let b = buf[p];
      if (b === 0xff) {
        const type = buf[p + 1];
        p += 2;
        const n = readVar();
        // LilyPond writes a large bogus delta on the track-name event of some
        // tracks; it carries no musical time, so it is not added to the clock.
        if (type === 0x03) name = new TextDecoder().decode(buf.subarray(p, p + n));
        else tick += delta;
        p += n;
        continue;
      }
      tick += delta;
      if (b === 0xf0 || b === 0xf7) {
        p++;
        p += readVar();
        continue;
      }
      if (b & 0x80) {
        status = b;
        p++;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const d1 = buf[p];
      if (kind === 0xc0 || kind === 0xd0) {
        p += 1;
        continue;
      }
      const d2 = buf[p + 1];
      p += 2;
      if (kind === 0x90 && d2 > 0) notes.push({ beat: tick / ticksPerBeat, note: d1, channel });
    }
    tracks.push({ name, notes });
  }
  return { ticksPerBeat, tracks: tracks.filter((tr) => tr.notes.length) };
}

/** Counter of keys → occurrences. */
function tally(keys) {
  const m = new Map();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function overlap(a, b) {
  let shared = 0;
  for (const [k, n] of a) shared += Math.min(n, b.get(k) ?? 0);
  let ta = 0;
  let tb = 0;
  for (const n of a.values()) ta += n;
  for (const n of b.values()) tb += n;
  return Math.max(ta, tb) ? shared / Math.max(ta, tb) : 1;
}

/**
 * @typedef {Object} PartCheck
 * @property {string} reference   Reference (MuseScore) track name.
 * @property {boolean} drums
 * @property {number} notes       Reference note count.
 * @property {number} match       0..1 — share of note events that agree.
 */

/**
 * Compare each reference track with its best-matching candidate track. Pitched
 * tracks compare (onset, pitch) pairs; drum tracks (channel 10) compare onsets
 * only, since drum sound mapping is a choice, not a transcription. Onsets are
 * rounded to a 48th of a beat so tick-resolution differences don't count.
 *
 * @param {{ tracks: MidiTrack[] }} reference   e.g. MuseScore's MIDI
 * @param {{ tracks: MidiTrack[] }} candidate   e.g. LilyPond's MIDI
 * @returns {PartCheck[]}
 */
export function compareMidi(reference, candidate) {
  const q = (beat) => Math.round(beat * 48);
  const keyed = (tr, drums) => tally(tr.notes.map((n) => (drums ? `${q(n.beat)}` : `${q(n.beat)}:${n.note}`)));
  return reference.tracks.map((ref) => {
    const drums = ref.notes.every((n) => n.channel === 9);
    const refKeys = keyed(ref, drums);
    let best = 0;
    for (const cand of candidate.tracks) best = Math.max(best, overlap(refKeys, keyed(cand, drums)));
    return { reference: ref.name, drums, notes: ref.notes.length, match: best };
  });
}
