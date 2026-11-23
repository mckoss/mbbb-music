import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStatuses, filterTunes, hiddenStatusMatches } from '../src/lib/tune-filters.ts';

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

test('with no search text the status chips decide', () => {
  const show = defaultStatuses();
  show.Active = false;
  assert.deepEqual(filterTunes(tunes, '   ', show).map((t) => t.status), ['Always', 'Learning', 'Unfiled']);
  for (const status of Object.keys(show)) show[status] = false;
  assert.deepEqual(filterTunes(tunes, '', show), []);
  assert.deepEqual(filterTunes([], '', show), []);
});

test('a search covers every song, whatever the chips hide', () => {
  const show = defaultStatuses(); // Archive hidden
  assert.deepEqual(filterTunes(tunes, '  ARCHIVE ex  ', show), [tunes[3]]);
  assert.deepEqual(filterTunes(tunes, 'example', show), tunes);
  show.Active = false;
  assert.deepEqual(filterTunes(tunes, 'active', show), [tunes[1]]);
  assert.deepEqual(filterTunes(tunes, 'missing', show), []);
});

test('hiddenStatusMatches names the hidden statuses a search reaches, with counts', () => {
  const show = defaultStatuses();
  const more = [...tunes, { title: 'Archive Example Two', status: 'Archive' }];
  assert.deepEqual(hiddenStatusMatches(more, 'example', show), [{ status: 'Archive', count: 2 }]);
  show.Active = false;
  assert.deepEqual(hiddenStatusMatches(more, 'example', show), [
    { status: 'Active', count: 1 },
    { status: 'Archive', count: 2 },
  ]);
  assert.deepEqual(hiddenStatusMatches(more, 'always', show), [], 'a visible match needs no warning');
  assert.deepEqual(hiddenStatusMatches(more, '', show), [], 'no search, no warning');
  assert.deepEqual(hiddenStatusMatches(more, 'missing', show), []);
});
