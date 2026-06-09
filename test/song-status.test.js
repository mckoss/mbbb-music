import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStatus, ASSIGNABLE_STATUSES, ALL_STATUSES, DEFAULT_STATUS } from '../src/lib/song-status.ts';

test('normalizeStatus keeps the four assignable statuses', () => {
  for (const s of ASSIGNABLE_STATUSES) assert.equal(normalizeStatus(s), s);
});

test('normalizeStatus clears Unfiled and unknown values to null', () => {
  assert.equal(normalizeStatus('Unfiled'), null);
  assert.equal(normalizeStatus(''), null);
  assert.equal(normalizeStatus('Bogus'), null);
  assert.equal(normalizeStatus(undefined), null);
});

test('status model: Unfiled is the default and the last display group', () => {
  assert.equal(DEFAULT_STATUS, 'Unfiled');
  assert.deepEqual(ALL_STATUSES, [...ASSIGNABLE_STATUSES, 'Unfiled']);
});
