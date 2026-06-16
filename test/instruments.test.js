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

test('hyphens (not just underscores) separate words for multi-word matchers', () => {
  // The bug: only "_" was normalized, so a fully hyphenated name slipped past
  // "tenor saxophone" entirely.
  assert.equal(slugOf('hot-to-go-tenor-saxophone.pdf'), 'tenor-sax');
  assert.equal(slugOf('tune-baritone-saxophone'), 'bari-sax');
});

test("MuseScore's foreign-language instrument names are detected", () => {
  // Real exports the band uses (French part names).
  assert.equal(slugOf('bella-ciao-for-marching-band-Trompette_en_Sib.pdf'), 'trumpet');
  assert.equal(slugOf('lorenzo-in-sicilia-banda-ionica-Saxophone_Baryton_(1).pdf'), 'bari-sax');
  assert.equal(slugOf('bella-ciao-for-marching-band-Batterie.pdf'), 'drums');
  assert.equal(slugOf('Song-Clarinette'), 'clarinet');
  // Accent-insensitive, regardless of Unicode normalization form (composed vs
  // decomposed) — MuseScore/Drive store accents either way.
  assert.equal(slugOf("Saxophone T\u00e9nor"), "tenor-sax"); // composed é (U+00E9)
  assert.equal(slugOf("Saxophone Te\u0301nor"), "tenor-sax"); // decomposed e + U+0301
  assert.equal(slugOf("Fl\u0075\u0302te"), "flute"); // decomposed u + U+0302
  // Other common languages.
  assert.equal(slugOf('Cancion - Trompeta'), 'trumpet'); // Spanish
  assert.equal(slugOf('Lied - Posaune'), 'trombone'); // German
});

test('bare French "Baryton" is NOT pulled into bari sax', () => {
  // French "Baryton" alone usually means the baritone horn, not the bari sax, so
  // only the qualified "Saxophone Baryton" maps to bari sax. Bare "Baryton" is
  // left for an admin to resolve rather than guessed wrong.
  assert.equal(slugOf('Song - Baryton'), null);
  assert.equal(slugOf('Song - Saxophone Baryton'), 'bari-sax');
});
