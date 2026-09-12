import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveInstrument } from '../src/lib/instrument-choice.ts';

const CATALOG = [{ slug: 'clarinet' }, { slug: 'trumpet' }, { slug: 'euphonium' }];

test('a URL instrument the catalog carries wins over the stored choice', () => {
  assert.equal(resolveInstrument('trumpet', 'clarinet', CATALOG), 'trumpet');
});

test('the stored choice is kept when the URL says nothing', () => {
  assert.equal(resolveInstrument(null, 'euphonium', CATALOG), 'euphonium');
  assert.equal(resolveInstrument('', 'euphonium', CATALOG), 'euphonium');
  assert.equal(resolveInstrument(undefined, 'euphonium', CATALOG), 'euphonium');
});

test('an unknown URL instrument falls back to the stored choice, not to itself', () => {
  // Re-asserting the URL value is exactly what deadlocked the layout: the other
  // effect replaced it, this one put it back, forever.
  assert.equal(resolveInstrument('tuba', 'clarinet', CATALOG), 'clarinet');
});

test('an unknown instrument from both sources falls back to the first in the catalog', () => {
  assert.equal(resolveInstrument('tuba', 'piccolo', CATALOG), 'clarinet');
  assert.equal(resolveInstrument(null, '', CATALOG), 'clarinet');
  assert.equal(resolveInstrument(null, null, CATALOG), 'clarinet');
});

test('resolving is idempotent, which is what stops the effect looping', () => {
  // Feeding a result back in as the stored value must return that same value for
  // every combination — the fixed point the store settles on after one write.
  for (const url of [null, '', 'trumpet', 'tuba']) {
    for (const stored of ['', 'clarinet', 'tuba', 'euphonium']) {
      const once = resolveInstrument(url, stored, CATALOG);
      assert.equal(resolveInstrument(url, once, CATALOG), once, `url=${url} stored=${stored}`);
    }
  }
});

test('an empty catalog leaves a saved choice alone', () => {
  // The list isn't loaded yet, or the viewer isn't approved to see it. Either way
  // that is no reason to discard what the member picked last visit.
  assert.equal(resolveInstrument(null, 'tuba', []), 'tuba');
  assert.equal(resolveInstrument('trumpet', 'tuba', []), 'tuba');
  assert.equal(resolveInstrument(null, null, []), '');
});
