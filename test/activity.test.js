import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { ensureSchema, logEventDb, recentEventsDb } from '../src/lib/server/activity.ts';

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
