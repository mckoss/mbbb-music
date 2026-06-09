import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectInstrument } from '../src/sync/instruments.js';

const slugOf = (name) => detectInstrument(name)?.slug ?? null;

test('baritone saxophone is detected, not mis-filed as euphonium', () => {
  // The bug: "Baritone Sax" / "Baritone_Sax" fell through bari-sax (which only
  // matched "baritone saxophone"/"bari sax") and was caught by Euphonium's
  // generic "baritone".
  assert.equal(slugOf('Iron Man-V1.2-Baritone_Sax'), 'bari-sax');
  assert.equal(slugOf('Iron Man-V1.2-Baritone Sax'), 'bari-sax');
  assert.equal(slugOf('Bari Sax'), 'bari-sax');
  assert.equal(slugOf('Bari-Sax'), 'bari-sax');
  assert.equal(slugOf('Baritone Saxophone'), 'bari-sax');
});

test('genuine baritone-horn / euphonium parts still map to euphonium', () => {
  assert.equal(slugOf('Track Suit - Euphonium'), 'euphonium');
  assert.equal(slugOf('Song - Baritone Horn'), 'euphonium');
  assert.equal(slugOf('Song - Baritone'), 'euphonium'); // bare "baritone" is the horn
});

test('underscore-separated filenames detect like space-separated ones', () => {
  assert.equal(slugOf('Tune-Alto_Sax'), 'alto-sax');
  assert.equal(slugOf('Tune-Tenor_Sax'), 'tenor-sax');
});
