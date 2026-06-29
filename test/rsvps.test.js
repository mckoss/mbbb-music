import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  ensureSchema,
  setRsvpDb,
  getRsvpsDb,
  getMemberRsvpsDb,
} from '../src/lib/server/rsvps.ts';
import { isRsvpStatus, parseRsvpStatus, rsvpMark, rsvpLabel } from '../src/lib/rsvp.ts';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  return db;
}

test('a reply is stored and read back, email lowercased', () => {
  const db = freshDb();
  setRsvpDb(db, 'gig1', 'Jo@X', 'yes', 'Jo@X', '2026-06-15T00:00:00.000Z');
  const rows = getRsvpsDb(db, 'gig1');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    email: 'jo@x',
    status: 'yes',
    updatedAt: '2026-06-15T00:00:00.000Z',
    updatedBy: 'jo@x',
  });
});

test('a second reply by the same member upserts (no duplicate row)', () => {
  const db = freshDb();
  setRsvpDb(db, 'gig1', 'jo@x', 'yes', 'jo@x', '2026-06-15T00:00:00.000Z');
  setRsvpDb(db, 'gig1', 'jo@x', 'maybe', 'admin@x', '2026-06-16T00:00:00.000Z');
  const rows = getRsvpsDb(db, 'gig1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'maybe');
  assert.equal(rows[0].updatedBy, 'admin@x'); // organizer set it on their behalf
  assert.equal(rows[0].updatedAt, '2026-06-16T00:00:00.000Z');
});

test('clearing a reply (null / blank / unknown status) deletes the row', () => {
  const db = freshDb();
  setRsvpDb(db, 'gig1', 'jo@x', 'no', 'jo@x');
  assert.equal(setRsvpDb(db, 'gig1', 'jo@x', null, 'jo@x'), null);
  assert.equal(getRsvpsDb(db, 'gig1').length, 0);

  setRsvpDb(db, 'gig1', 'jo@x', 'yes', 'jo@x');
  setRsvpDb(db, 'gig1', 'jo@x', 'bogus', 'jo@x'); // unknown clears too
  assert.equal(getRsvpsDb(db, 'gig1').length, 0);
});

test('replies are scoped per gig', () => {
  const db = freshDb();
  setRsvpDb(db, 'gig1', 'jo@x', 'yes', 'jo@x');
  setRsvpDb(db, 'gig2', 'jo@x', 'no', 'jo@x');
  assert.equal(getRsvpsDb(db, 'gig1')[0].status, 'yes');
  assert.equal(getRsvpsDb(db, 'gig2')[0].status, 'no');
});

test('getMemberRsvpsDb maps a member’s replies across gigs', () => {
  const db = freshDb();
  setRsvpDb(db, 'gig1', 'jo@x', 'yes', 'jo@x');
  setRsvpDb(db, 'gig2', 'jo@x', 'maybe', 'jo@x');
  setRsvpDb(db, 'gig1', 'al@x', 'no', 'al@x'); // someone else, ignored
  assert.deepEqual(getMemberRsvpsDb(db, 'JO@X'), { gig1: 'yes', gig2: 'maybe' });
});

test('setRsvpDb rejects missing identifiers', () => {
  const db = freshDb();
  assert.throws(() => setRsvpDb(db, '', 'jo@x', 'yes', 'jo@x'));
  assert.throws(() => setRsvpDb(db, 'gig1', '', 'yes', 'jo@x'));
  assert.throws(() => setRsvpDb(db, 'gig1', 'jo@x', 'yes', ''));
});

test('rsvp vocabulary helpers', () => {
  assert.ok(isRsvpStatus('yes') && isRsvpStatus('no') && isRsvpStatus('maybe'));
  assert.ok(!isRsvpStatus('unconfirmed') && !isRsvpStatus(''));
  assert.equal(parseRsvpStatus('maybe'), 'maybe');
  assert.equal(parseRsvpStatus(''), null);
  assert.equal(parseRsvpStatus('unconfirmed'), null);
  assert.equal(rsvpMark('yes'), '✓');
  assert.equal(rsvpMark('maybe'), '?');
  assert.equal(rsvpMark('no'), '✗');
  assert.equal(rsvpMark(null), '');
  assert.equal(rsvpLabel('yes'), 'Yes');
  assert.equal(rsvpLabel(null), 'Unconfirmed');
});
