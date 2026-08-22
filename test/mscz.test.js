import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import {
  parseMscx,
  extractMsczFacts,
  feltMeter,
  parseTimeSig,
  resolveTempo,
} from '../src/sync/mscz.js';

// --- zip builder (test-only): minimal store/deflate archive ------------------

/** Build a valid ZIP from { name: content } entries. */
function buildZip(files, { method = 8 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(raw.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));

    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function mscx({ sigN = 4, sigD = 4, tempo = null, firstMeasureLen = null } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20">
  <Score>
    <Staff id="1">
      <Measure${firstMeasureLen ? ` len="${firstMeasureLen}"` : ''}>
        <voice>
          <TimeSig>
            <sigN>${sigN}</sigN>
            <sigD>${sigD}</sigD>
          </TimeSig>
          ${tempo != null ? `<Tempo>\n<tempo>${tempo}</tempo>\n<text>tempo</text>\n</Tempo>` : ''}
          <Rest><durationType>measure</durationType></Rest>
        </voice>
      </Measure>
    </Staff>
  </Score>
</museScore>`;
}

// --- parseMscx ---------------------------------------------------------------

test('parses time signature, tempo, and no pickup', () => {
  const f = parseMscx(mscx({ sigN: 3, sigD: 4, tempo: 2 }));
  assert.deepEqual(f, { sigN: 3, sigD: 4, qbpm: 120, pickupQuarters: 0 });
});

test('missing tempo marking yields qbpm null', () => {
  const f = parseMscx(mscx({ sigN: 4, sigD: 4 }));
  assert.equal(f.qbpm, null);
});

test('detects a pickup measure via len=', () => {
  // 4/4 with a one-beat pickup: first measure len 1/4.
  const f = parseMscx(mscx({ sigN: 4, sigD: 4, tempo: 2, firstMeasureLen: '1/4' }));
  assert.equal(f.pickupQuarters, 1);
});

test('a full-length first measure is not a pickup', () => {
  const f = parseMscx(mscx({ sigN: 4, sigD: 4, firstMeasureLen: '4/4' }));
  assert.equal(f.pickupQuarters, 0);
});

test('pickup notated as an explicit short first-bar signature', () => {
  // 1/4 signature on measure 1, real 4/4 signature on measure 2 (the
  // "matador" idiom): meter is 4/4 with a one-quarter pickup.
  const xml = `<museScore><Score><Staff id="1">
    <Measure><voice><TimeSig><sigN>1</sigN><sigD>4</sigD></TimeSig>
      <Tempo><tempo>1.5</tempo></Tempo></voice></Measure>
    <Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig></voice></Measure>
  </Staff></Score></museScore>`;
  const f = parseMscx(xml);
  assert.deepEqual(f, { sigN: 4, sigD: 4, qbpm: 90, pickupQuarters: 1 });
});

test('a second measure without a signature keeps the opening meter', () => {
  const xml = `<museScore><Score><Staff id="1">
    <Measure><voice><TimeSig><sigN>3</sigN><sigD>4</sigD></TimeSig></voice></Measure>
    <Measure><voice><Rest/></voice></Measure>
  </Staff></Score></museScore>`;
  const f = parseMscx(xml);
  assert.equal(f.sigN, 3);
  assert.equal(f.pickupQuarters, 0);
});

test('defaults to 4/4 when no TimeSig block exists', () => {
  const f = parseMscx('<museScore><Score><Staff id="1"><Measure></Measure></Staff></Score></museScore>');
  assert.equal(f.sigN, 4);
  assert.equal(f.sigD, 4);
});

// --- extractMsczFacts --------------------------------------------------------

test('extracts facts from a deflated mscz', () => {
  const zip = buildZip({
    'META-INF/container.xml': '<container/>',
    'score.mscx': mscx({ sigN: 6, sigD: 8, tempo: 3 }),
  });
  const f = extractMsczFacts(zip);
  assert.deepEqual(f, { sigN: 6, sigD: 8, qbpm: 180, pickupQuarters: 0 });
});

test('extracts facts from a stored (uncompressed) mscz', () => {
  const zip = buildZip({ 'score.mscx': mscx({ sigN: 2, sigD: 2, tempo: 2 }) }, { method: 0 });
  const f = extractMsczFacts(zip);
  assert.deepEqual(f, { sigN: 2, sigD: 2, qbpm: 120, pickupQuarters: 0 });
});

test('prefers the root score over Excerpts/ parts', () => {
  const zip = buildZip({
    'Excerpts/trumpet.mscx': mscx({ sigN: 3, sigD: 4 }),
    'score.mscx': mscx({ sigN: 4, sigD: 4, tempo: 2 }),
  });
  assert.equal(extractMsczFacts(zip).sigN, 4);
});

test('returns null for a non-zip buffer', () => {
  assert.equal(extractMsczFacts(Buffer.from('not a zip at all')), null);
});

test('returns null for a zip with no mscx', () => {
  assert.equal(extractMsczFacts(buildZip({ 'readme.txt': 'hi' })), null);
});

// --- feltMeter ---------------------------------------------------------------

test('simple meters count the numerator', () => {
  assert.deepEqual(feltMeter(4, 4), { beatsPerBar: 4, unitQuarters: 1 });
  assert.deepEqual(feltMeter(3, 4), { beatsPerBar: 3, unitQuarters: 1 });
  assert.deepEqual(feltMeter(2, 2), { beatsPerBar: 2, unitQuarters: 2 }); // cut time in 2
});

test('compound meters are felt with a dotted beat', () => {
  assert.deepEqual(feltMeter(6, 8), { beatsPerBar: 2, unitQuarters: 1.5 });
  assert.deepEqual(feltMeter(9, 8), { beatsPerBar: 3, unitQuarters: 1.5 });
  assert.deepEqual(feltMeter(12, 8), { beatsPerBar: 4, unitQuarters: 1.5 });
});

test('3/8 stays simple (not compound)', () => {
  assert.deepEqual(feltMeter(3, 8), { beatsPerBar: 3, unitQuarters: 0.5 });
});

// --- parseTimeSig ------------------------------------------------------------

test('parses valid signatures and rejects junk', () => {
  assert.deepEqual(parseTimeSig('6/8'), { sigN: 6, sigD: 8 });
  assert.deepEqual(parseTimeSig(' 3/4 '), { sigN: 3, sigD: 4 });
  assert.equal(parseTimeSig('4/5'), null); // denominator must be a power of two
  assert.equal(parseTimeSig('0/4'), null);
  assert.equal(parseTimeSig('fast'), null);
  assert.equal(parseTimeSig(''), null);
});

// --- resolveTempo ------------------------------------------------------------

test('score facts alone resolve to felt tempo', () => {
  // 6/8 at ♩=180 → felt in 2 at dotted-quarter = 120.
  const t = resolveTempo({ sigN: 6, sigD: 8, qbpm: 180, pickupQuarters: 0 });
  assert.deepEqual(t, { bpm: 120, beatsPerBar: 2, timeSig: '6/8', source: 'score' });
});

test('no tempo marking falls back to MuseScore default 120 qbpm', () => {
  const t = resolveTempo({ sigN: 4, sigD: 4, qbpm: null, pickupQuarters: 0 });
  assert.equal(t.bpm, 120);
});

test('pickup converts to felt beats', () => {
  // 4/4, one-quarter pickup → 1 felt beat.
  const t = resolveTempo({ sigN: 4, sigD: 4, qbpm: 120, pickupQuarters: 1 });
  assert.equal(t.pickupBeats, 1);
  // 6/8, one-eighth pickup (0.5 quarters) → a third of a dotted beat, rounded to quarter-beats.
  const t2 = resolveTempo({ sigN: 6, sigD: 8, qbpm: 180, pickupQuarters: 0.5 });
  assert.equal(t2.pickupBeats, 0.25);
});

test('bpm override replaces the felt tempo', () => {
  const t = resolveTempo({ sigN: 4, sigD: 4, qbpm: 120, pickupQuarters: 0 }, { bpm: 92 });
  assert.equal(t.bpm, 92);
  assert.equal(t.source, 'override');
});

test('timeSig override remaps the felt meter', () => {
  // Score says 4/4 but the override calls it cut time: felt in 2, bpm halves.
  const t = resolveTempo({ sigN: 4, sigD: 4, qbpm: 120, pickupQuarters: 0 }, { timeSig: '2/2' });
  assert.deepEqual(t, { bpm: 60, beatsPerBar: 2, timeSig: '2/2', source: 'override' });
});

test('overrides alone work without a score', () => {
  const t = resolveTempo(null, { bpm: 100, timeSig: '3/4' });
  assert.deepEqual(t, { bpm: 100, beatsPerBar: 3, timeSig: '3/4', source: 'override' });
});

test('no facts and no overrides → null', () => {
  assert.equal(resolveTempo(null, {}), null);
  assert.equal(resolveTempo(null, { timeSig: 'junk' }), null);
});

test('bpm is clamped to a sane count-in range', () => {
  assert.equal(resolveTempo(null, { bpm: 5000 }).bpm, 300);
  assert.equal(resolveTempo({ sigN: 4, sigD: 4, qbpm: 10, pickupQuarters: 0 }, {}).bpm, 20);
});
