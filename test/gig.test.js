import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeGig,
  normalizeTimes,
  normalizeLocation,
  normalizeSets,
  isValidDate,
  isValidTime,
  formatGigDate,
  formatGigTime,
  formatGigTimeRange,
  mapsUrl,
  compareByDate,
  canEditGigs,
} from '../src/lib/gig.ts';
import {
  listGigs,
  getGig,
  createGig,
  duplicateGig,
  updateGig,
  deleteGig,
  addSet,
  removeSet,
  addSong,
  removeSong,
  moveSong,
} from '../src/lib/server/gigs.ts';

// --- Pure model -------------------------------------------------------------

test('date/time validators', () => {
  assert.equal(isValidDate('2026-06-14'), true);
  assert.equal(isValidDate('2026-6-14'), false);
  assert.equal(isValidDate('nope'), false);
  assert.equal(isValidTime('09:30'), true);
  assert.equal(isValidTime('9:30'), false);
  assert.equal(isValidTime('24:99'), true); // shape-only check; UI restricts values
});

test('normalizeTimes drops invalid rows and bad ends', () => {
  const t = normalizeTimes([
    { start: '14:00', end: '16:00' },
    { start: '18:30' },
    { start: '', end: '20:00' },
    { start: 'bad' },
    { start: '19:00', end: 'bad' },
  ]);
  assert.deepEqual(t, [{ start: '14:00', end: '16:00' }, { start: '18:30' }, { start: '19:00' }]);
});

test('normalizeLocation collapses empty to undefined', () => {
  assert.equal(normalizeLocation({ name: '', address: '' }), undefined);
  assert.deepEqual(normalizeLocation({ name: 'Park', address: '' }), { name: 'Park' });
  assert.deepEqual(normalizeLocation({ address: '1 Main St' }), { address: '1 Main St' });
});

test('normalizeSets assigns ids and filters slugs', () => {
  const sets = normalizeSets([
    { name: 'A', songSlugs: ['x', 'y', 5] },
    { songSlugs: null },
  ]);
  assert.equal(sets.length, 2);
  assert.ok(sets[0].id);
  assert.equal(sets[0].name, 'A');
  assert.deepEqual(sets[0].songSlugs, ['x', 'y']);
  assert.deepEqual(sets[1].songSlugs, []);
});

test('makeGig defaults name, blanks bad date, and ensures one set', () => {
  const g = makeGig({});
  assert.equal(g.name, 'Untitled gig');
  assert.equal(g.date, '');
  assert.equal(g.sets.length, 1);
  assert.ok(g.id);

  const g2 = makeGig({ name: 'Fair', date: '2026-07-04', sets: [{ songSlugs: ['a'] }] });
  assert.equal(g2.date, '2026-07-04');
  assert.deepEqual(g2.sets[0].songSlugs, ['a']);
});

test('formatting helpers', () => {
  assert.match(formatGigDate('2026-06-14'), /2026/);
  assert.equal(formatGigDate(''), 'No date');
  assert.equal(formatGigTime('14:30'), '2:30 PM');
  assert.equal(formatGigTime('00:05'), '12:05 AM');
  assert.equal(formatGigTimeRange({ start: '14:00', end: '16:00' }), '2:00 PM – 4:00 PM');
  assert.equal(formatGigTimeRange({ start: '09:00' }), '9:00 AM');
  assert.match(mapsUrl('1 Main St, Town'), /maps\/search\/\?api=1&query=1%20Main%20St/);
});

test('compareByDate orders ascending', () => {
  const a = makeGig({ name: 'A', date: '2026-01-01' });
  const b = makeGig({ name: 'B', date: '2026-12-01' });
  assert.ok(compareByDate(a, b) < 0);
  assert.ok(compareByDate(b, a) > 0);
});

test('canEditGigs allows admins and organizers only', () => {
  assert.equal(canEditGigs('admin'), true);
  assert.equal(canEditGigs('organizer'), true);
  assert.equal(canEditGigs('member'), false);
  assert.equal(canEditGigs(null), false);
  assert.equal(canEditGigs(undefined), false);
});

// --- Store (against a temp dir; never the real data/) -----------------------

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-gigs-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('store: create/list/get/update/delete round-trips', async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(listGigs(dir), []);

    const gig = createGig({ name: 'Summer Fair', date: '2026-07-04' }, dir);
    assert.ok(gig.id);
    assert.equal(listGigs(dir).length, 1);
    assert.deepEqual(getGig(gig.id, dir).name, 'Summer Fair');

    // It actually persisted to gigs.json in the temp dir.
    const onDisk = JSON.parse(await readFile(join(dir, 'gigs.json'), 'utf8'));
    assert.equal(onDisk.gigs.length, 1);

    const updated = updateGig(
      gig.id,
      { name: 'Renamed', notes: 'bring stands', location: { address: '1 Main St' } },
      dir
    );
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.notes, 'bring stands');
    assert.deepEqual(updated.location, { address: '1 Main St' });

    // Clearing notes removes the key.
    const cleared = updateGig(gig.id, { notes: '' }, dir);
    assert.equal(cleared.notes, undefined);

    assert.equal(deleteGig(gig.id, dir), true);
    assert.equal(deleteGig(gig.id, dir), false);
    assert.deepEqual(listGigs(dir), []);
  });
});

test('store: duplicateGig copies info and setlists into a new gig', async () => {
  await withTempDir(async (dir) => {
    const original = createGig(
      {
        name: 'Summer Fair',
        date: '2026-07-04',
        times: [{ start: '14:00', end: '16:00' }],
        location: { name: 'Town Green', address: '1 Main St' },
        notes: 'Bring stands',
        sets: [
          { id: 'set-a', name: 'Main', songSlugs: ['song-a', 'song-b'] },
          { id: 'set-b', name: 'Encore', songSlugs: ['song-c'] },
        ],
      },
      dir
    );

    const copy = duplicateGig(original.id, dir);

    assert.ok(copy);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.name, 'Summer Fair Copy');
    assert.equal(copy.date, original.date);
    assert.deepEqual(copy.times, original.times);
    assert.deepEqual(copy.location, original.location);
    assert.equal(copy.notes, original.notes);
    assert.deepEqual(
      copy.sets.map((s) => ({ name: s.name, songSlugs: s.songSlugs })),
      original.sets.map((s) => ({ name: s.name, songSlugs: s.songSlugs }))
    );
    assert.notEqual(copy.sets[0].id, original.sets[0].id);
    assert.equal(listGigs(dir).length, 2);
  });
});

test('store: setlist add/remove sets and songs', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig({ name: 'Gig', date: '2026-08-01' }, dir);
    const setId = gig.sets[0].id;

    let g = addSong(gig.id, setId, 'song-a', dir);
    g = addSong(gig.id, setId, 'song-b', dir);
    g = addSong(gig.id, setId, 'song-a', dir); // duplicate ignored
    assert.deepEqual(g.sets[0].songSlugs, ['song-a', 'song-b']);

    g = removeSong(gig.id, setId, 'song-a', dir);
    assert.deepEqual(g.sets[0].songSlugs, ['song-b']);

    g = addSet(gig.id, 'Encore', dir);
    assert.equal(g.sets.length, 2);
    assert.equal(g.sets[1].name, 'Encore');

    const encoreId = g.sets[1].id;
    g = removeSet(gig.id, encoreId, dir);
    assert.equal(g.sets.length, 1);
  });
});

test('store: moveSong reorders and clamps at the ends', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig({ name: 'Gig', date: '2026-08-01' }, dir);
    const setId = gig.sets[0].id;
    addSong(gig.id, setId, 'a', dir);
    addSong(gig.id, setId, 'b', dir);
    addSong(gig.id, setId, 'c', dir);

    let g = moveSong(gig.id, setId, 'c', 'up', dir);
    assert.deepEqual(g.sets[0].songSlugs, ['a', 'c', 'b']);

    g = moveSong(gig.id, setId, 'a', 'up', dir); // already first — no-op
    assert.deepEqual(g.sets[0].songSlugs, ['a', 'c', 'b']);

    g = moveSong(gig.id, setId, 'b', 'down', dir); // already last — no-op
    assert.deepEqual(g.sets[0].songSlugs, ['a', 'c', 'b']);

    g = moveSong(gig.id, setId, 'a', 'down', dir);
    assert.deepEqual(g.sets[0].songSlugs, ['c', 'a', 'b']);
  });
});

test('store: unknown id returns null/false', async () => {
  await withTempDir(async (dir) => {
    assert.equal(getGig('nope', dir), null);
    assert.equal(updateGig('nope', { name: 'x' }, dir), null);
    assert.equal(duplicateGig('nope', dir), null);
    assert.equal(addSet('nope', undefined, dir), null);
    assert.equal(deleteGig('nope', dir), false);
  });
});
