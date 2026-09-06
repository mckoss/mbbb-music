import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStatuses, filterTunes } from '../src/lib/tune-filters.ts';

const tunes = ['Always', 'Active', 'Learning', 'Archive', 'Unfiled'].map((status) => ({
  title: `${status} Example`, status,
}));

test('collection and coverage hide only archived tunes by default', () => {
  assert.deepEqual(filterTunes(tunes, '', defaultStatuses()), tunes.filter((t) => t.status !== 'Archive'));
  const show = defaultStatuses();
  show.Archive = true;
  assert.deepEqual(filterTunes(tunes, '', show), tunes);
  assert.equal(defaultStatuses().Archive, false);
});

test('title search is trimmed, case insensitive, and combined with status filters', () => {
  const show = defaultStatuses();
  assert.deepEqual(filterTunes(tunes, '  ACTIVE ex  ', show), [tunes[1]]);
  show.Active = false;
  assert.deepEqual(filterTunes(tunes, 'active', show), []);
  assert.deepEqual(filterTunes(tunes, 'missing', show), []);
  assert.deepEqual(filterTunes([], '', show), []);
  for (const status of Object.keys(show)) show[status] = false;
  assert.deepEqual(filterTunes(tunes, '', show), []);
});
