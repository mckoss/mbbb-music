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

/** Onset tolerance in beats: absorbs tick rounding and small swing-ratio differences. */
export const ONSET_TOLERANCE = 0.05;

/** Group note onsets (sorted) by pitch, or all under one key for drums. */
function onsetsByKey(tr, drums) {
  const m = new Map();
  for (const n of tr.notes) {
    const k = drums ? 0 : n.note;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n.beat);
  }
  for (const list of m.values()) list.sort((a, b) => a - b);
  return m;
}

/** Notes of `a` with a same-key note of `b` within `tol` beats (each used once). */
function matched(a, b, tol) {
  let shared = 0;
  for (const [k, xs] of a) {
    const ys = b.get(k);
    if (!ys) continue;
    let j = 0;
    for (const x of xs) {
      while (j < ys.length && ys[j] < x - tol) j++;
      if (j < ys.length && Math.abs(ys[j] - x) <= tol) {
        shared++;
        j++;
      }
    }
  }
  return shared;
}

function overlap(a, b, tol) {
  let ta = 0;
  let tb = 0;
  for (const v of a.values()) ta += v.length;
  for (const v of b.values()) tb += v.length;
  return Math.max(ta, tb) ? matched(a, b, tol) / Math.max(ta, tb) : 1;
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
 * tracks compare (onset, pitch); drum tracks (channel 10) compare onsets only,
 * since drum sound mapping is a choice, not a transcription. An onset counts as
 * the same within ONSET_TOLERANCE beats, so tick rounding and a slightly
 * different swing ratio (MuseScore exports 5:3 but plays about 3:2) don't count
 * as wrong notes.
 *
 * @param {{ tracks: MidiTrack[] }} reference   e.g. MuseScore's MIDI
 * @param {{ tracks: MidiTrack[] }} candidate   e.g. LilyPond's MIDI
 * @returns {PartCheck[]}
 */
export function compareMidi(reference, candidate, tol = ONSET_TOLERANCE) {
  return reference.tracks.map((ref) => {
    const drums = ref.notes.every((n) => n.channel === 9);
    const refKeys = onsetsByKey(ref, drums);
    let best = 0;
    for (const cand of candidate.tracks) best = Math.max(best, overlap(refKeys, onsetsByKey(cand, drums), tol));
    return { reference: ref.name, drums, notes: ref.notes.length, match: best };
  });
}
