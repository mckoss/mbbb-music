import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, slugifyStem } from '../src/sync/slugify.js';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Bad Guy'), 'bad-guy');
  assert.equal(slugify('Track Suit'), 'track-suit');
});

test('slugify folds musical key spellings', () => {
  assert.equal(slugify('B-flat'), 'bflat');
  assert.equal(slugify('Bb'), 'bflat');
  assert.equal(slugify('E-flat'), 'eflat');
  assert.equal(slugify('Clarinet in B-flat'), 'clarinet-in-bflat');
});

test('slugify strips accents and collapses separators', () => {
  assert.equal(slugify('Café  Náïve —  Tune'), 'cafe-naive-tune');
  assert.equal(slugify('  Leading / trailing __ junk  '), 'leading-trailing-junk');
});

test('slugify handles empty / nullish input', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
});

test('slugifyStem drops the extension before slugging', () => {
  assert.equal(slugifyStem('Bad Guy - Trumpet in B-flat 2.pdf'), 'bad-guy-trumpet-in-bflat-2');
  assert.equal(slugifyStem('Track Suit.mscz'), 'track-suit');
});
