// Tempo / time-signature extraction from MuseScore files, for the practice
// player's count-in. A .mscz is a ZIP whose main entry is a .mscx XML score;
// we read just three facts from the top of the score — the opening time
// signature, the opening tempo marking, and whether the first measure is a
// short (pickup/anacrusis) bar — and map them to the *felt* beat a bandleader
// would actually count (6/8 counts in 2, 2/2 in 2, 4/4 in 4).
//
// Deliberately dependency-free: a ~40-line ZIP central-directory reader (store
// + deflate entries only, which is all MuseScore writes) and regex scans over
// the XML. Mid-score tempo/meter changes are ignored — the count-in only needs
// the top of the piece; a wrong opening marking is fixed with the per-song
// corrections override.

import { inflateRawSync } from 'node:zlib';

/**
 * Score facts as written, before any felt-beat interpretation.
 * @typedef {object} ScoreFacts
 * @property {number} sigN            Time-signature numerator.
 * @property {number} sigD            Time-signature denominator.
 * @property {number|null} qbpm      Opening tempo in quarter notes per minute
 *   (MuseScore stores quarters/second), or null when the score has no marking.
 * @property {number} pickupQuarters  Length of a short first bar in quarter
 *   notes (0 when the piece starts on a full measure).
 */

/**
 * The resolved count-in tempo attached to a tune (shared with the client as
 * `TuneTempo` in $lib/types).
 * @typedef {object} ResolvedTempo
 * @property {number} bpm            Felt-beat BPM the count-in should tick at.
 * @property {number} beatsPerBar    Felt beats per bar (6/8 → 2).
 * @property {string} timeSig        Display signature, e.g. "6/8".
 * @property {number} [pickupBeats]  Felt beats of anacrusis before the first
 *   full bar — playback starts this many beats *before* the count-in's final
 *   downbeat so the first full-bar downbeat lands on the count.
 * @property {'score'|'override'} source
 */

// Count-in tempos outside this range are almost certainly bad data (an mscz
// with a metric-modulation marking, or a typo in an override).
export const MIN_BPM = 20;
export const MAX_BPM = 300;

// --- ZIP reading -----------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

/**
 * List a ZIP's entries from its central directory.
 * @param {Buffer} buf
 * @returns {{ name: string, method: number, compSize: number, localOff: number }[]}
 */
function zipEntries(buf) {
  // The end-of-central-directory record sits at the tail, possibly followed by
  // a comment (max 64K). Scan backwards for its signature.
  let eocd = -1;
  const stop = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CENTRAL_SIG) break;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    entries.push({
      name: buf.toString('utf8', off + 46, off + 46 + nameLen),
      method: buf.readUInt16LE(off + 10),
      compSize: buf.readUInt32LE(off + 20),
      localOff: buf.readUInt32LE(off + 42),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read and decompress one entry's bytes.
 * @param {Buffer} buf
 * @param {{ method: number, compSize: number, localOff: number }} e
 * @returns {Buffer}
 */
function readEntry(buf, e) {
  // The local header repeats the name/extra fields (extra may differ from the
  // central copy, so it must be re-read here).
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported zip method ${e.method}`);
}

// --- Score parsing ---------------------------------------------------------

/** The TimeSig inside one measure's XML, or null. */
function sigOf(body) {
  const block = /<TimeSig\b[\s\S]*?<\/TimeSig>/.exec(body)?.[0];
  if (!block) return null;
  const n = /<sigN>(\d+)<\/sigN>/.exec(block);
  const d = /<sigD>(\d+)<\/sigD>/.exec(block);
  if (!n || !d || Number(n[1]) < 1 || Number(d[1]) < 1) return null;
  return { sigN: Number(n[1]), sigD: Number(d[1]) };
}

/**
 * Pull the opening facts out of .mscx XML. Regex scans in document order: the
 * first measures/TimeSig/Tempo blocks belong to the top staff.
 * @param {string} xml
 * @returns {ScoreFacts}
 */
export function parseMscx(xml) {
  // First two measures of the top staff (Measure elements don't nest).
  const measures = [];
  const measureRe = /<Measure\b([^>]*)>([\s\S]*?)<\/Measure>/g;
  let m;
  while (measures.length < 2 && (m = measureRe.exec(xml))) {
    measures.push({ attrs: m[1], body: m[2] });
  }

  const sig1 = measures[0] ? sigOf(measures[0].body) : null;
  const sig2 = measures[1] ? sigOf(measures[1].body) : null;
  let sigN = sig1?.sigN ?? 4;
  let sigD = sig1?.sigD ?? 4;
  let pickupQuarters = 0;

  if (sig1 && sig2 && sig1.sigN / sig1.sigD < sig2.sigN / sig2.sigD) {
    // Pickup notated as an explicit short first bar: a tiny signature (e.g.
    // 1/4) on measure 1 immediately re-signed to the real meter on measure 2.
    sigN = sig2.sigN;
    sigD = sig2.sigD;
    pickupQuarters = (sig1.sigN / sig1.sigD) * 4;
  } else if (measures[0]) {
    // Pickup notated as an irregular measure: same signature, but the first
    // measure carries a len="a/b" attribute giving its true (short) length.
    const len = /\blen="(\d+)\/(\d+)"/.exec(measures[0].attrs);
    if (len && Number(len[2]) > 0) {
      const frac = Number(len[1]) / Number(len[2]);
      if (frac > 0 && frac < sigN / sigD) pickupQuarters = frac * 4;
    }
  }

  // MuseScore stores tempo in quarter notes per SECOND (2.0 → ♩=120).
  let qbpm = null;
  const tempoBlock = /<Tempo\b[\s\S]*?<\/Tempo>/.exec(xml)?.[0];
  if (tempoBlock) {
    const t = /<tempo>([\d.]+)<\/tempo>/.exec(tempoBlock);
    const v = t ? Number(t[1]) * 60 : NaN;
    if (Number.isFinite(v) && v > 0) qbpm = v;
  }

  return { sigN, sigD, qbpm, pickupQuarters };
}

/**
 * Extract score facts from a .mscz buffer, or null when the buffer isn't a
 * readable MuseScore file. Parts live under Excerpts/ inside the zip — the
 * main score is the root-level .mscx.
 * @param {Buffer} buf
 * @returns {ScoreFacts | null}
 */
export function extractMsczFacts(buf) {
  try {
    const entries = zipEntries(buf);
    const scores = entries.filter((e) => e.name.endsWith('.mscx') && !e.name.includes('Excerpts/'));
    if (scores.length === 0) return null;
    // Prefer a root-level entry (MuseScore 4 nests nothing else that matches).
    const main = scores.find((e) => !e.name.includes('/')) ?? scores[0];
    return parseMscx(readEntry(buf, main).toString('utf8'));
  } catch {
    return null;
  }
}

// --- Felt-beat interpretation ---------------------------------------------

/**
 * How a meter is actually counted: compound meters (6/8, 9/8, 12/8, 6/4…) are
 * felt with a dotted beat — 6/8 is "in 2" — while simple meters count the
 * numerator (2/2 cut time is naturally "in 2" already).
 * @param {number} sigN
 * @param {number} sigD
 * @returns {{ beatsPerBar: number, unitQuarters: number }} unitQuarters is the
 *   felt beat's length in quarter notes (6/8 → 1.5, 2/2 → 2, 4/4 → 1).
 */
export function feltMeter(sigN, sigD) {
  if (sigN >= 6 && sigN % 3 === 0) {
    return { beatsPerBar: sigN / 3, unitQuarters: 3 * (4 / sigD) };
  }
  return { beatsPerBar: sigN, unitQuarters: 4 / sigD };
}

/** Parse a "N/D" signature string, or null if it isn't one. */
export function parseTimeSig(s) {
  const m = /^(\d{1,2})\/(1|2|4|8|16)$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1) return null;
  return { sigN: n, sigD: Number(m[2]) };
}

/**
 * Resolve extracted facts + human overrides into the count-in tempo. Override
 * semantics: `timeSig` replaces the meter (felt mapping re-applied); `bpm` is
 * the FELT count tempo directly. With no facts and no overrides → null (the
 * player falls back to its manual picker).
 * @param {ScoreFacts | null} facts
 * @param {{ bpm?: number | null, timeSig?: string | null }} [overrides]
 * @returns {ResolvedTempo | null}
 */
export function resolveTempo(facts, overrides = {}) {
  const sigOverride = overrides.timeSig ? parseTimeSig(overrides.timeSig) : null;
  const bpmOverride = Number.isFinite(overrides.bpm) ? Number(overrides.bpm) : null;
  if (!facts && !sigOverride && bpmOverride == null) return null;

  const sigN = sigOverride?.sigN ?? facts?.sigN ?? 4;
  const sigD = sigOverride?.sigD ?? facts?.sigD ?? 4;
  const felt = feltMeter(sigN, sigD);

  // No opening tempo marking (and no override): MuseScore's own default.
  const qbpm = facts?.qbpm ?? 120;
  const clamp = (v) => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)));
  const bpm = clamp(bpmOverride ?? qbpm / felt.unitQuarters);

  const tempo = {
    bpm,
    beatsPerBar: felt.beatsPerBar,
    timeSig: `${sigN}/${sigD}`,
    source: sigOverride || bpmOverride != null ? 'override' : 'score',
  };
  if (facts && facts.pickupQuarters > 0) {
    // Round to quarter-beat resolution so display and scheduling stay tidy.
    const beats = Math.round((facts.pickupQuarters / felt.unitQuarters) * 4) / 4;
    if (beats > 0 && beats < felt.beatsPerBar) tempo.pickupBeats = beats;
  }
  return tempo;
}
