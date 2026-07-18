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
  isPublicShow,
  publicGig,
  publicShows,
  normalizeUrl,
  urlHost,
} from '../src/lib/gig.ts';
import {
  listGigs,
  getGig,
  createGig,
  duplicateGig,
  updateGig,
  deleteGig,
  addSet,
  renameSet,
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

// --- Event URL --------------------------------------------------------------

test('normalizeUrl accepts http(s) and assumes https for a bare host', () => {
  assert.equal(normalizeUrl('https://whidbeyislandfair.com/'), 'https://whidbeyislandfair.com/');
  assert.equal(normalizeUrl('http://example.org/fair'), 'http://example.org/fair');
  // What people actually paste.
  assert.equal(normalizeUrl('whidbeyislandfair.com/schedule'), 'https://whidbeyislandfair.com/schedule');
  assert.equal(normalizeUrl('  example.org  '), 'https://example.org/');
});

test('normalizeUrl rejects anything that is not http(s)', () => {
  // The one that matters: this value becomes an href on a page the world reads.
  assert.equal(normalizeUrl('javascript:alert(document.cookie)'), undefined);
  assert.equal(normalizeUrl('JavaScript:alert(1)'), undefined);
  assert.equal(normalizeUrl('data:text/html,<script>alert(1)</script>'), undefined);
  assert.equal(normalizeUrl('mailto:someone@example.com'), undefined);
  assert.equal(normalizeUrl('file:///etc/passwd'), undefined);
  assert.equal(normalizeUrl(''), undefined);
  assert.equal(normalizeUrl(undefined), undefined);
  assert.equal(normalizeUrl('   '), undefined);
});

test('urlHost shows where a link actually goes', () => {
  assert.equal(urlHost('https://www.whidbeyislandfair.com/schedule?x=1'), 'whidbeyislandfair.com');
  assert.equal(urlHost('http://example.org'), 'example.org');
});

// --- Public projection ------------------------------------------------------
// The load-bearing security property of the whole public-shows feature: a gig's
// band-only fields must not survive the trip to an anonymous visitor.

test('publicGig publishes only public fields — never notes, sets, or hidden', () => {
  const gig = makeGig({
    name: 'Maxwelton Parade',
    date: '2026-07-04',
    times: [{ start: '11:00', end: '13:00' }],
    location: { name: 'Maxwelton Beach', address: '6799 Maxwelton Rd' },
    notes: 'Gate code 4417. Pay $600, ask for Dave, cell 555-0123.',
    publicNotes: 'Come early — the parade fills up.',
    sets: [{ id: 's1', name: 'Set 1', songSlugs: ['second-line'] }],
  });

  const pub = publicGig(gig);

  // The allowlist let the public fields through...
  assert.equal(pub.name, 'Maxwelton Parade');
  assert.equal(pub.date, '2026-07-04');
  assert.deepEqual(pub.times, [{ start: '11:00', end: '13:00' }]);
  assert.equal(pub.publicNotes, 'Come early — the parade fills up.');

  // ...and kept everything else out. This is the assertion that matters: the
  // band's notes and setlist are simply not in the object.
  assert.equal('notes' in pub, false);
  assert.equal('sets' in pub, false);
  assert.equal(JSON.stringify(pub).includes('555-0123'), false);
  assert.equal(JSON.stringify(pub).includes('Gate code'), false);
  assert.equal(JSON.stringify(pub).includes('second-line'), false);
});

test('publicGig scrubs a hostile eventUrl even if one reached the store', () => {
  // Belt and braces: normalizeUrl guards the write path, but a hand-edited
  // gigs.json must not be able to put a javascript: href on the public page.
  const hostile = { id: 'x', name: 'Fair', date: '2026-08-01', sets: [], eventUrl: 'javascript:alert(1)' };
  assert.equal('eventUrl' in publicGig(hostile), false);

  const good = { ...hostile, eventUrl: 'https://whidbeyislandfair.com/' };
  assert.equal(publicGig(good).eventUrl, 'https://whidbeyislandfair.com/');
});

test('publicGig returns copies, so a caller cannot mutate the stored gig', () => {
  const gig = makeGig({ name: 'Fair', date: '2026-08-01', location: { name: 'Park' } });
  const pub = publicGig(gig);
  pub.location.name = 'Somewhere else';
  assert.equal(gig.location.name, 'Park');
});

test('isPublicShow: public by default, opt out with hidden, and a date is required', () => {
  assert.equal(isPublicShow(makeGig({ name: 'Show', date: '2026-07-04' })), true);
  assert.equal(isPublicShow(makeGig({ name: 'Private party', date: '2026-07-04', hidden: true })), false);
  // No date → nowhere to list it.
  assert.equal(isPublicShow(makeGig({ name: 'TBD' })), false);
});

test('publicShows filters hidden/undated gigs and sorts by date', () => {
  const shows = publicShows([
    makeGig({ name: 'Later', date: '2026-09-01' }),
    makeGig({ name: 'Corporate booking', date: '2026-08-01', hidden: true }),
    makeGig({ name: 'Earlier', date: '2026-07-04' }),
    makeGig({ name: 'Undated' }),
  ]);
  assert.deepEqual(
    shows.map((s) => s.name),
    ['Earlier', 'Later']
  );
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

    // Canceling sets the flag; un-canceling removes the key (not false).
    assert.equal(updateGig(gig.id, { canceled: true }, dir).canceled, true);
    assert.equal('canceled' in updateGig(gig.id, { canceled: false }, dir), false);

    assert.equal(deleteGig(gig.id, dir), true);
    assert.equal(deleteGig(gig.id, dir), false);
    assert.deepEqual(listGigs(dir), []);
  });
});

test('store: publicNotes and hidden round-trip and clear', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig({ name: 'Show', date: '2026-07-04' }, dir);

    const shown = updateGig(gig.id, { publicNotes: 'Free, all ages.', hidden: true }, dir);
    assert.equal(shown.publicNotes, 'Free, all ages.');
    assert.equal(shown.hidden, true);

    // Clearing removes the keys rather than storing '' / false.
    const cleared = updateGig(gig.id, { publicNotes: '', hidden: false }, dir);
    assert.equal(cleared.publicNotes, undefined);
    assert.equal('hidden' in cleared, false);
  });
});

test('store: eventUrl is normalized on write and rejected when unsafe', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig({ name: 'Fair', date: '2026-08-15' }, dir);

    assert.equal(
      updateGig(gig.id, { eventUrl: 'whidbeyislandfair.com/schedule' }, dir).eventUrl,
      'https://whidbeyislandfair.com/schedule'
    );
    // A javascript: URL is dropped, not stored.
    assert.equal(updateGig(gig.id, { eventUrl: 'javascript:alert(1)' }, dir).eventUrl, undefined);
    // Clearing removes the key.
    assert.equal('eventUrl' in updateGig(gig.id, { eventUrl: '' }, dir), false);
  });
});

test('store: rev advances on calendar-visible edits, not on setlist changes', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig({ name: 'Show', date: '2026-07-04' }, dir);
    assert.equal(gig.rev, undefined, 'a fresh gig has no revisions yet');

    // A moved date is exactly what a subscriber must be told about.
    assert.equal(updateGig(gig.id, { date: '2026-07-05' }, dir).rev, 1);
    assert.equal(updateGig(gig.id, { location: { name: 'The Barn' } }, dir).rev, 2);
    assert.equal(updateGig(gig.id, { canceled: true }, dir).rev, 3);

    // A no-op write must NOT bump: it would churn every subscriber's calendar
    // for nothing.
    assert.equal(updateGig(gig.id, { name: 'Show' }, dir).rev, 3);

    // Nor should band-only edits — a setlist or a private note is invisible in
    // the feed, so there is nothing for a subscriber to re-sync.
    assert.equal(updateGig(gig.id, { notes: 'bring stands' }, dir).rev, 3);
    const withSong = addSong(gig.id, getGig(gig.id, dir).sets[0].id, 'second-line', dir);
    assert.equal(withSong.rev, 3);

    // But the public blurb is in the feed, so it does bump.
    assert.equal(updateGig(gig.id, { publicNotes: 'Free, all ages.' }, dir).rev, 4);
    // As is the host's event page — subscribers see it as the event's URL.
    assert.equal(updateGig(gig.id, { eventUrl: 'https://example.org/fair' }, dir).rev, 5);
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

test('store: renameSet sets, trims, and clears a set name', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig({ name: 'Gig', date: '2026-08-01' }, dir);
    const setId = gig.sets[0].id;

    let g = renameSet(gig.id, setId, '  Opening set  ', dir);
    assert.equal(g.sets[0].name, 'Opening set');

    // Blank (or all-whitespace) clears the name — the UI falls back to "Set N".
    g = renameSet(gig.id, setId, '   ', dir);
    assert.equal(g.sets[0].name, undefined);

    // Unknown set id: the gig is returned untouched, not an error.
    g = renameSet(gig.id, 'nope', 'Encore', dir);
    assert.equal(g.sets[0].name, undefined);

    // Unknown gig id: null, matching the other set mutations.
    assert.equal(renameSet('nope', setId, 'x', dir), null);
  });
});

test('store: updateGig leaves fields absent from the patch untouched', async () => {
  await withTempDir(async (dir) => {
    const gig = createGig(
      {
        name: 'Fair Set',
        date: '2026-08-01',
        publicNotes: 'Bring a chair',
        eventUrl: 'https://example.com/fair',
        hidden: true,
        canceled: true,
      },
      dir
    );

    // A patch naming only `name` (what a stale client's form posted) must not
    // clear the fields it never mentioned.
    const g = updateGig(gig.id, { name: 'Fair Set 2' }, dir);
    assert.equal(g.name, 'Fair Set 2');
    assert.equal(g.publicNotes, 'Bring a chair');
    assert.equal(g.eventUrl, 'https://example.com/fair');
    assert.equal(g.hidden, true);
    assert.equal(g.canceled, true);
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
