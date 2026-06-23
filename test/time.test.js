import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatPacificDateTime } from '../src/lib/time.ts';

test('formatPacificDateTime displays UTC log timestamps in Pacific time', () => {
  assert.equal(formatPacificDateTime('2026-06-23T22:05:00.000Z'), 'Jun 23, 2026, 3:05 PM PDT');
});

test('formatPacificDateTime leaves invalid timestamps readable', () => {
  assert.equal(formatPacificDateTime('not-a-date'), 'not-a-date');
});
