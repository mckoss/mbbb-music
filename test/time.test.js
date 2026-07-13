import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatPacificDateTime, formatLastSeen } from '../src/lib/time.ts';

test('formatPacificDateTime displays UTC log timestamps in Pacific time', () => {
  assert.equal(formatPacificDateTime('2026-06-23T22:05:00.000Z'), 'Jun 23, 2026, 3:05 PM PDT');
});

test('formatPacificDateTime leaves invalid timestamps readable', () => {
  assert.equal(formatPacificDateTime('not-a-date'), 'not-a-date');
});

// "now" is Jun 23, 2026 5:30pm Pacific.
const NOW = new Date('2026-06-24T00:30:00.000Z');

test('formatLastSeen names today, yesterday, and days ago — with the time of day', () => {
  assert.equal(formatLastSeen('2026-06-24T00:04:00.000Z', NOW), 'Today @ 5:04pm');
  assert.equal(formatLastSeen('2026-06-22T16:12:00.000Z', NOW), 'Yesterday @ 9:12am');
  assert.equal(formatLastSeen('2026-06-17T15:30:00.000Z', NOW), '6 days ago @ 8:30am');
});

test('formatLastSeen counts Pacific calendar days, not 24-hour spans', () => {
  // 11:50pm Pacific yesterday is only ~40 minutes before "now" in Pacific terms,
  // but it is still the previous calendar day.
  assert.equal(formatLastSeen('2026-06-23T06:50:00.000Z', NOW), 'Yesterday @ 11:50pm');
  // 12:10am Pacific today — barely today, and named that way.
  assert.equal(formatLastSeen('2026-06-23T07:10:00.000Z', NOW), 'Today @ 12:10am');
});

test('formatLastSeen falls back to a date beyond a month', () => {
  assert.equal(formatLastSeen('2026-03-05T03:15:00.000Z', NOW), 'Mar 4, 2026 @ 7:15pm');
});

test('formatLastSeen leaves invalid timestamps readable', () => {
  assert.equal(formatLastSeen('not-a-date', NOW), 'not-a-date');
});
