import { test } from 'node:test';
import assert from 'node:assert/strict';

import { systemStartNumbers, repairMeasures, transposeFor, prepPart, mergeParts, findTempo } from '../src/omr/score.js';
import { selectPdfParts } from '../src/omr/select-parts.js';

// Synthetic OMR output: 4/4, divisions 1. System 1 = bars 1-2 where bar 2 is a
// multi-bar rest OMR read as one bar (the PDF says system 2 starts at bar 5);
// system 2 = an empty measure and a note.
const note = (step) => `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>`;
const OMR = `<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note('C')}</measure>
<measure number="2"><attributes><measure-style><multiple-rest>1</multiple-rest></measure-style></attributes><note print-object="no"><rest measure="yes"/><duration>4</duration></note></measure>
<measure number="3"><print new-system="yes"/></measure>
<measure number="4">${note('E')}</measure>
</part></score-partwise>`;

const measuresOf = (xml) => [...xml.matchAll(/<measure\b[\s\S]*?<\/measure>/g)].map((m) => m[0]);

test('systemStartNumbers reads left-margin numbers, ignoring page numbers', () => {
  const pages = [
    { width: 600, height: 800, items: [{ text: '5', x: 40, y: 300 }, { text: '9', x: 40, y: 400 }, { text: '3', x: 300, y: 350 }] },
    { width: 600, height: 800, items: [{ text: '2', x: 40, y: 30 }, { text: '14', x: 41, y: 100 }] },
  ];
  assert.deepEqual(systemStartNumbers(pages), [5, 9, 14]);
});

test('repairMeasures expands a misread multi-bar rest and fills empty bars', () => {
  const { xml, notes } = repairMeasures(OMR, [5]);
  const ms = measuresOf(xml);
  assert.equal(ms.length, 6, 'system 1 grows from 2 to 4 bars');
  assert.match(ms[1], /<multiple-rest>3<\/multiple-rest>/);
  assert.match(ms[2], /<rest measure="yes"\/><duration>4<\/duration>/);
  assert.match(ms[4], /<rest measure="yes"\/><duration>4<\/duration>/, 'the empty bar got a full rest');
  assert.deepEqual(ms.map((m) => m.match(/number="(\d+)"/)[1]), ['1', '2', '3', '4', '5', '6']);
  assert.ok(notes.some((n) => /expanded by 2/.test(n)));
  assert.ok(notes.some((n) => /empty/.test(n)));
});

test('repairMeasures reports lines OMR missed or overfilled', () => {
  assert.ok(repairMeasures(OMR, [5, 9]).notes.some((n) => /missed 1 line at the end \(from bar 9\)/.test(n)));
  assert.ok(repairMeasures(OMR, [2]).notes.some((n) => /1 extra bar/.test(n)));
  assert.ok(repairMeasures(OMR, []).notes.some((n) => /No printed measure numbers/.test(n)));
});

test('transposeFor knows the band instruments', () => {
  assert.deepEqual(transposeFor('trumpet', 'bflat', 'G'), { diatonic: -1, chromatic: -2 });
  assert.deepEqual(transposeFor('alto-sax', 'eflat', 'G'), { diatonic: -5, chromatic: -9 });
  assert.deepEqual(transposeFor('tenor-sax', 'bflat', 'G'), { diatonic: -8, chromatic: -14 });
  assert.equal(transposeFor('trombone', 'bflat', 'F'), null, 'bass-clef trombone is concert');
  assert.deepEqual(transposeFor('trombone', 'bflat', 'G'), { diatonic: -8, chromatic: -14 }, 'treble-clef trombone is in B♭');
  assert.equal(transposeFor('flute', null, 'G'), null);
  assert.equal(transposeFor('trumpet', 'c', 'G'), null, 'a C trumpet part is concert');
});

test('prepPart names the part, adds transposition and a MIDI sound', () => {
  const p = prepPart(OMR, { id: 'P3', name: 'Trumpet 1', instrumentSlug: 'trumpet', key: 'bflat' });
  assert.match(p.scorePart, /<score-part id="P3"><part-name>Trumpet 1<\/part-name>/);
  assert.match(p.scorePart, /<midi-program>57<\/midi-program>/);
  assert.match(p.measures[0], /<transpose><diatonic>-1<\/diatonic><chromatic>-2<\/chromatic><\/transpose><\/attributes>/);
});

test('mergeParts pads short parts and sets a tempo when none was read', () => {
  const a = prepPart(OMR, { id: 'P1', name: 'Alto', instrumentSlug: 'alto-sax', key: 'eflat' });
  const b = prepPart(repairMeasures(OMR, [5]).xml, { id: 'P2', name: 'Trombone', instrumentSlug: 'trombone' });
  const { xml, notes } = mergeParts([a, b], { title: 'Synthetic & Song', tempo: 96 });
  assert.match(xml, /<work-title>Synthetic &amp; Song<\/work-title>/);
  assert.equal((xml.match(/<score-part /g) ?? []).length, 2);
  const parts = [...xml.matchAll(/<part id="(P\d)">([\s\S]*?)<\/part>/g)];
  assert.deepEqual(parts.map((p) => measuresOf(p[2]).length), [6, 6]);
  assert.ok(notes.some((n) => /^Alto: 2 bars shorter/.test(n)));
  assert.equal(findTempo(measuresOf(parts[0][2])), 96);
});

test('selectPdfParts picks one Letter PDF per part, in score order', () => {
  const tune = {
    parts: [
      { sha256: 't1l', instrumentSlug: 'trumpet', partNumber: 1, format: 'lyre', key: 'bflat' },
      { sha256: 't1L', instrumentSlug: 'trumpet', partNumber: 1, format: 'letter', key: 'bflat' },
      { sha256: 'tb', instrumentSlug: 'trombone', partNumber: null, format: 'letter' },
      { sha256: 'fl', instrumentSlug: 'flute', partNumber: null, format: 'letter' },
      { sha256: 'shared', instrumentSlug: 'trumpet', shared: true, format: 'letter' },
      { sha256: 'gen', instrumentSlug: 'tuba', generated: true, format: 'letter' },
    ],
  };
  const picked = selectPdfParts(tune);
  assert.deepEqual(picked.map((p) => p.sha256), ['fl', 't1L', 'tb']);
  assert.match(picked[1].name, /Trumpet.* 1$/);
  assert.equal(picked[1].key, 'bflat');
});
