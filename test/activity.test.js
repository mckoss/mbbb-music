import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  ensureSchema,
  logEventDb,
  recentEventsDb,
  touchSeenDb,
  lastSeenDb,
  usageByMemberDb,
  songUsageByMemberDb,
} from '../src/lib/server/activity.ts';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  return db;
}

const ev = (over = {}) => ({ email: 'jo@x', type: 'download', label: 'Freedom (Trumpet)', ...over });

test('an event is recorded and returned newest-first', () => {
  const db = freshDb();
  logEventDb(db, ev({ at: '2026-06-15T00:00:00.000Z' }));
  logEventDb(db, ev({ type: 'gig-view', label: 'Summer Gig', at: '2026-06-15T01:00:00.000Z' }));
  const rows = recentEventsDb(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, 'Summer Gig'); // newest first
  assert.equal(rows[1].type, 'download');
});

test('identical events within the dedup window collapse; outside it, both log', () => {
  const db = freshDb();
  const a = logEventDb(db, ev({ at: '2026-06-15T00:00:00.000Z' }));
  const b = logEventDb(db, ev({ at: '2026-06-15T00:00:30.000Z' })); // +30s, same → collapsed
  const c = logEventDb(db, ev({ at: '2026-06-15T00:05:00.000Z' })); // +5m → logs
  assert.ok(a);
  assert.equal(b, null);
  assert.ok(c);
  assert.equal(recentEventsDb(db).length, 2);
});

test('different label / type / user are distinct (not deduped)', () => {
  const db = freshDb();
  logEventDb(db, ev({ at: '2026-06-15T00:00:00.000Z' }));
  logEventDb(db, ev({ label: 'Other Song (Flute)', at: '2026-06-15T00:00:10.000Z' }));
  logEventDb(db, ev({ type: 'score-view', at: '2026-06-15T00:00:10.000Z' }));
  logEventDb(db, ev({ email: 'al@x', at: '2026-06-15T00:00:10.000Z' }));
  assert.equal(recentEventsDb(db).length, 4);
});

test('email is lowercased on store', () => {
  const db = freshDb();
  logEventDb(db, ev({ email: 'Jo@X', at: '2026-06-15T00:00:00.000Z' }));
  assert.equal(recentEventsDb(db)[0].email, 'jo@x');
});

// --- Last seen ---------------------------------------------------------------

test('last seen keeps the latest time per member, and never goes backwards', () => {
  const db = freshDb();
  touchSeenDb(db, 'jo@x', '2026-06-15T00:00:00.000Z');
  touchSeenDb(db, 'jo@x', '2026-06-16T00:00:00.000Z');
  touchSeenDb(db, 'jo@x', '2026-06-01T00:00:00.000Z'); // stale write (e.g. a slow request)
  touchSeenDb(db, 'Al@X', '2026-06-14T00:00:00.000Z');

  const seen = lastSeenDb(db);
  assert.equal(seen.get('jo@x'), '2026-06-16T00:00:00.000Z');
  assert.equal(seen.get('al@x'), '2026-06-14T00:00:00.000Z'); // lowercased
  assert.equal(seen.get('nobody@x'), undefined);
});

// --- Summary aggregates ------------------------------------------------------

const SINCE = '2026-06-01T00:00:00.000Z';

test('usage counts split recent from all-time, per member and feature', () => {
  const db = freshDb();
  logEventDb(db, ev({ type: 'score-view', label: 'Freedom', at: '2026-05-01T00:00:00.000Z' })); // old
  logEventDb(db, ev({ type: 'score-view', label: 'Freedom', at: '2026-06-10T00:00:00.000Z' })); // recent
  logEventDb(db, ev({ type: 'print', label: 'Freedom', at: '2026-06-11T00:00:00.000Z' }));
  logEventDb(db, ev({ email: 'al@x', type: 'score-view', label: 'Freedom', at: '2026-06-12T00:00:00.000Z' }));

  const rows = usageByMemberDb(db, SINCE);
  const jo = rows.find((r) => r.email === 'jo@x' && r.type === 'score-view');
  assert.equal(jo.total, 2);
  assert.equal(jo.recent, 1);
  assert.equal(jo.last_at, '2026-06-10T00:00:00.000Z');

  const print = rows.find((r) => r.type === 'print');
  assert.equal(print.total, 1);
  assert.equal(print.recent, 1);

  const al = rows.find((r) => r.email === 'al@x');
  assert.equal(al.total, 1);
});

test('song usage groups by song and kind, and ignores non-song events', () => {
  const db = freshDb();
  logEventDb(db, ev({ type: 'score-view', label: 'Freedom', at: '2026-06-10T00:00:00.000Z' }));
  logEventDb(db, ev({ type: 'practice', label: 'Freedom', at: '2026-06-11T00:00:00.000Z' }));
  logEventDb(db, ev({ type: 'performance', label: 'Freedom', at: '2026-05-11T00:00:00.000Z' })); // old
  logEventDb(db, ev({ type: 'download', label: 'Freedom (Trumpet).pdf', at: '2026-06-12T00:00:00.000Z' }));
  logEventDb(db, ev({ type: 'members-view', label: null, at: '2026-06-12T01:00:00.000Z' }));

  const rows = songUsageByMemberDb(db, SINCE);
  assert.deepEqual(
    rows.map((r) => [r.type, r.label, r.recent, r.total]).sort(),
    [
      ['performance', 'Freedom', 0, 1],
      ['practice', 'Freedom', 1, 1],
      ['score-view', 'Freedom', 1, 1],
    ].sort(),
  );
});

test('gig set runs are left out of the song list (they name a gig, not a song)', () => {
  const db = freshDb();
  logEventDb(db, ev({ type: 'performance', label: 'Summer Gig', detail: 'set:s1', at: '2026-06-10T00:00:00.000Z' }));
  logEventDb(db, ev({ type: 'practice', label: 'Freedom', detail: 'trumpet', at: '2026-06-10T00:00:00.000Z' }));

  const rows = songUsageByMemberDb(db, SINCE);
  assert.deepEqual(rows.map((r) => r.label), ['Freedom']);
  // ...but the set run still counts as a performance in the feature totals.
  const perf = usageByMemberDb(db, SINCE).find((r) => r.type === 'performance');
  assert.equal(perf.total, 1);
});

test('offline replay metadata is stored with the original activity time', () => {
  const db = freshDb();
  logEventDb(
    db,
    ev({
      at: '2026-06-15T00:00:00.000Z',
      offline: true,
      uploadedAt: '2026-06-15T02:00:00.000Z',
    }),
  );
  const row = recentEventsDb(db)[0];
  assert.equal(row.at, '2026-06-15T00:00:00.000Z');
  assert.equal(row.offline, 1);
  assert.equal(row.uploaded_at, '2026-06-15T02:00:00.000Z');
});
