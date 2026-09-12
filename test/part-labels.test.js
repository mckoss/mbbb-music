import { test } from 'node:test';
import assert from 'node:assert/strict';

import { instrumentsForLabel, labelForPage, buildPartPages, startPages } from '../src/sync/part-labels.js';

// Page geometry the band's charts actually use: US Letter portrait, part name in
// the left margin (x ~22-42) above the first system (y ~130-140), rehearsal marks
// and performance notes inboard over the staff.
const W = 612;
const H = 792;
const at = (text, x, y) => ({ text, x, y });

test('a named instrument resolves, alone or combined', () => {
  assert.deepEqual(instrumentsForLabel('Trumpet'), ['trumpet']);
  assert.deepEqual(instrumentsForLabel('Flute/Melodica'), ['flute', 'melodica']);
  assert.deepEqual(instrumentsForLabel('Alto/Bari sax'), ['alto-sax', 'bari-sax']);
  // A qualifier the vocabulary doesn't know must not lose the instrument.
  assert.deepEqual(instrumentsForLabel('Trumpet/Clarinet high'), ['trumpet', 'clarinet']);
});

test('a transposition label resolves to every instrument that reads it', () => {
  assert.deepEqual(instrumentsForLabel('Bb melody'), ['trumpet', 'clarinet', 'tenor-sax', 'soprano-sax', 'euphonium']);
  assert.deepEqual(instrumentsForLabel('Eb bass line'), ['alto-sax', 'bari-sax']);
  assert.deepEqual(instrumentsForLabel('F melody'), ['french-horn', 'mellophone']);
});

test('a notation-only label resolves, including the "cleff" misspelling', () => {
  // "C bass cleff" names no role, so the filename classifier declines it — but as a
  // part label above a staff it fully describes who reads the page.
  assert.deepEqual(instrumentsForLabel('C bass cleff'), ['trombone', 'euphonium', 'tuba']);
  assert.deepEqual(instrumentsForLabel('C bass clef'), ['trombone', 'euphonium', 'tuba']);
});

test('bare drum names resolve as page labels', () => {
  assert.deepEqual(instrumentsForLabel('Snare'), ['drums']);
  assert.deepEqual(instrumentsForLabel('Bass Drum'), ['drums']);
});

test('the left margin, not the vocabulary, is what excludes annotations', () => {
  // Stay Human prints "(Melodica/reeds soli)" over the staff ABOVE each part name.
  // Taking the topmost instrument-ish text would label every page "Melodica".
  const page = [
    at('Stay Human', 240, 48),
    at('by Jon Batiste & Stay Human', 36, 79),
    at('(Melodica/reeds soli)', 209, 105),
    at('Trumpet', 32, 139),
  ];
  const hit = labelForPage(page, W, H);
  assert.equal(hit.label, 'Trumpet');
  assert.deepEqual(hit.instruments, ['trumpet']);
});

test('measure numbers in the margin are not part names', () => {
  const page = [at('51', 24, 22), at('55', 24, 102), at('59', 24, 181)];
  assert.equal(labelForPage(page, W, H), null);
});

test('a continuation page carries no label', () => {
  assert.equal(labelForPage([], W, H), null);
});

test('a parts compilation indexes each part to its opening page', () => {
  const header = (y) => [at('Rock Anthem', 233, 48), at('for School of HONK', 36, 76)].map((it) => ({ ...it, y: it.y + y * 0 }));
  const pages = [
    [...header(0), at('C melody', 32, 139)],
    [...header(0), at('Bb melody', 32, 139)],
    [...header(0), at('Eb melody', 32, 139)],
    [...header(0), at('C bass cleff', 32, 139)],
    [at('12', 24, 26)], // continuation
    [...header(0), at('Bb bass line', 32, 139)],
  ];
  const sizes = pages.map(() => ({ width: W, height: H }));
  const index = buildPartPages(pages, sizes);
  assert.deepEqual(
    index.map((e) => [e.page, e.label]),
    [[1, 'C melody'], [2, 'Bb melody'], [3, 'Eb melody'], [4, 'C bass cleff'], [6, 'Bb bass line']]
  );

  const starts = startPages(index);
  // A trumpet reads B♭ treble: the melody on page 2, not the bass line on page 6 —
  // both label it no more precisely than "B♭", so the earlier page wins.
  assert.equal(starts.trumpet, 2);
  // A tuba is a C instrument, so "C melody" on page 1 names it — but page 4 names
  // its CLEF, and that is the page actually written for it.
  assert.equal(starts.tuba, 4);
  assert.equal(starts.trombone, 4);
  assert.equal(starts['alto-sax'], 3);
  // A flute reads C treble; only the unclefed C melody covers it.
  assert.equal(starts.flute, 1);
});

test('a repeated label never moves a part past its first page', () => {
  const sizes = [1, 2, 3].map(() => ({ width: W, height: H }));
  const index = buildPartPages(
    [[at('Trumpet', 32, 139)], [at('Trombone', 32, 139)], [at('Trumpet', 32, 139)]],
    sizes
  );
  
  assert.deepEqual(index.map((e) => e.page), [1, 2]);
  assert.equal(startPages(index).trumpet, 1);
});

test('a single part and a conductor score get no index', () => {
  const sizes = [1, 2, 3].map(() => ({ width: W, height: H }));
  // One instrument named on every page: nothing to jump to.
  assert.deepEqual(buildPartPages([[at('Trumpet', 32, 139)], [at('Trumpet', 32, 139)], []], sizes), []);
  // A conductor score's first staff repeats page after page — advertising it as
  // "the flute starts here" would be worse than saying nothing.
  assert.deepEqual(buildPartPages([[at('Flute', 32, 139)], [at('Flute', 32, 139)]], sizes), []);
});

test('an admin override beats the chart, including for an instrument it omits', () => {
  const index = [
    { page: 2, label: 'Bb melody', instruments: ['trumpet', 'clarinet'] },
    { page: 5, label: 'Trombone', instruments: ['trombone'] },
  ];
  const starts = startPages(index, { trumpet: 6, drums: 9 });
  assert.equal(starts.trumpet, 6);
  assert.equal(starts.clarinet, 2);
  assert.equal(starts.drums, 9);
});

test('a malformed override is ignored rather than sending the reader nowhere', () => {
  const index = [{ page: 3, label: 'Tuba', instruments: ['tuba'] }];
  assert.deepEqual(startPages(index, { tuba: 0, trumpet: 'x', drums: 2.5 }), { tuba: 3 });
});
