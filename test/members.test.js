import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  ensureSchema,
  editProfileFieldDb,
  editProfileDb,
  deleteProfileEditDb,
  restoreProfileEditDb,
  effectiveProfileDb,
  allProfilesDb,
  profileHistoryDb,
} from '../src/lib/server/members.ts';
import { mkdtempSync, writeFileSync as fsWriteFile, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as pathResolve } from 'node:path';
import { createHash } from 'node:crypto';

import { sniffImageType, gravatarUrl, initialsSvg, loadAvatarIn } from '../src/lib/server/avatars.ts';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  ensureSchema(db);
  return db;
}

const edit = (over = {}) => ({ email: 'jo@x', field: 'fullName', value: 'Jo Player', by: 'jo@x', ...over });

test('an edit becomes the effective value immediately, email lowercased', () => {
  const db = freshDb();
  editProfileFieldDb(db, edit({ email: 'Jo@X', at: '2026-06-15T00:00:00.000Z' }));
  const p = effectiveProfileDb(db, 'jo@x');
  assert.equal(p.email, 'jo@x');
  assert.equal(p.fullName, 'Jo Player');
  assert.equal(p.updatedBy, 'jo@x');
  assert.equal(p.updatedAt, '2026-06-15T00:00:00.000Z');
});

test('latest edit wins; deleting it reverts to the previous value', () => {
  const db = freshDb();
  editProfileFieldDb(db, edit({ by: 'jo@x', value: 'Jo P', at: '2026-06-15T00:00:00.000Z' }));
  const admin = editProfileFieldDb(db, edit({ by: 'admin@x', value: 'Josephine P', at: '2026-06-15T01:00:00.000Z' }));
  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, 'Josephine P'); // latest (admin) wins

  deleteProfileEditDb(db, admin.id, 'admin@x', '2026-06-15T02:00:00.000Z');
  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, 'Jo P'); // reverts to prior
});

test('same actor + same field collapses: prior soft-deleted, history kept', () => {
  const db = freshDb();
  editProfileFieldDb(db, edit({ by: 'jo@x', value: 'Jo P', at: '2026-06-15T00:00:00.000Z' }));
  editProfileFieldDb(db, edit({ by: 'jo@x', value: 'Jo Player', at: '2026-06-15T00:05:00.000Z' }));

  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, 'Jo Player');
  const rows = profileHistoryDb(db, 'jo@x');
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.deleted_at == null).length, 1);
});

test('a different actor does NOT collapse — competing edits coexist, latest shows', () => {
  const db = freshDb();
  editProfileFieldDb(db, edit({ by: 'jo@x', value: 'Jo P', at: '2026-06-15T00:00:00.000Z' }));
  editProfileFieldDb(db, edit({ by: 'admin@x', value: 'Josephine', at: '2026-06-15T00:05:00.000Z' }));
  assert.equal(profileHistoryDb(db, 'jo@x').filter((r) => r.deleted_at == null).length, 2);
  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, 'Josephine');
});

test('restore un-deletes an edit, bringing its value back', () => {
  const db = freshDb();
  const e = editProfileFieldDb(db, edit({ value: 'Jo P', at: '2026-06-15T00:00:00.000Z' }));
  deleteProfileEditDb(db, e.id, 'admin@x', '2026-06-15T01:00:00.000Z');
  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, null); // cleared after delete

  assert.equal(restoreProfileEditDb(db, e.id), true);
  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, 'Jo P'); // back
  assert.equal(restoreProfileEditDb(db, e.id), false); // already active — no-op
});

test('structured instruments: JSON array round-trips, unknown slug rejected', () => {
  const db = freshDb();
  editProfileFieldDb(db, edit({ field: 'instruments', value: '["trumpet","alto-sax","trumpet"]', at: '2026-06-15T00:00:00.000Z' }));
  // Deduped on store, parsed back to a list.
  assert.deepEqual(effectiveProfileDb(db, 'jo@x').instruments, ['trumpet', 'alto-sax']);

  assert.throws(() => editProfileFieldDb(db, edit({ field: 'instruments', value: '["kazoo"]' })), /unknown instrument/);
});

test('primary instrument must be a known slug; clearing is allowed', () => {
  const db = freshDb();
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'primaryInstrument', value: 'kazoo' })), /unknown instrument/);
  editProfileFieldDb(db, edit({ field: 'primaryInstrument', value: 'tuba', at: '2026-06-15T00:00:00.000Z' }));
  assert.equal(effectiveProfileDb(db, 'jo@x').primaryInstrument, 'tuba');
  editProfileFieldDb(db, edit({ field: 'primaryInstrument', value: '', at: '2026-06-15T00:01:00.000Z' }));
  assert.equal(effectiveProfileDb(db, 'jo@x').primaryInstrument, null); // cleared
});

test('shirt size constrained to the offered set', () => {
  const db = freshDb();
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'shirtSize', value: 'XXXL' })), /invalid shirt size/);
  editProfileFieldDb(db, edit({ field: 'shirtSize', value: 'XL', at: '2026-06-15T00:00:00.000Z' }));
  assert.equal(effectiveProfileDb(db, 'jo@x').shirtSize, 'XL');
});

test('alternate email validated and lowercased; login email is never a field', () => {
  const db = freshDb();
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'alternateEmail', value: 'not-an-email' })), /invalid alternate email/);
  editProfileFieldDb(db, edit({ field: 'alternateEmail', value: 'Reach.Me@Example.COM', at: '2026-06-15T00:00:00.000Z' }));
  assert.equal(effectiveProfileDb(db, 'jo@x').alternateEmail, 'reach.me@example.com');

  assert.throws(() => editProfileFieldDb(db, edit({ field: 'email', value: 'new@x' })), /not a profile field/);
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'role', value: 'admin' })), /not a profile field/);
});

test('avatar hash must be a 64-hex content hash', () => {
  const db = freshDb();
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'avatarSha', value: 'nope' })), /invalid avatar hash/);
  const sha = 'a'.repeat(64);
  editProfileFieldDb(db, edit({ field: 'avatarSha', value: sha, at: '2026-06-15T00:00:00.000Z' }));
  assert.equal(effectiveProfileDb(db, 'jo@x').avatarSha, sha);
});

test('editProfileDb applies a typed patch across fields in one call', () => {
  const db = freshDb();
  const p = editProfileDb(
    db,
    'jo@x',
    { fullName: 'Jo Player', phone: '555-0100', primaryInstrument: 'trumpet', instruments: ['flute'], shirtSize: 'M' },
    'jo@x',
    '2026-06-15T00:00:00.000Z',
  );
  assert.equal(p.fullName, 'Jo Player');
  assert.equal(p.phone, '555-0100');
  assert.equal(p.primaryInstrument, 'trumpet');
  assert.deepEqual(p.instruments, ['flute']);
  assert.equal(p.shirtSize, 'M');
});

test('editProfileDb writes only changed fields (unchanged values are no-ops)', () => {
  const db = freshDb();
  editProfileDb(db, 'jo@x', { fullName: 'Jo', primaryInstrument: 'trumpet' }, 'jo@x', '2026-06-15T00:00:00.000Z');
  const before = profileHistoryDb(db, 'jo@x').length; // 2 rows
  // Resave fullName identical, change primaryInstrument: only one new row.
  editProfileDb(db, 'jo@x', { fullName: 'Jo', primaryInstrument: 'tuba' }, 'jo@x', '2026-06-15T00:05:00.000Z');
  assert.equal(profileHistoryDb(db, 'jo@x').length, before + 1);
  assert.equal(effectiveProfileDb(db, 'jo@x').primaryInstrument, 'tuba');
  assert.equal(effectiveProfileDb(db, 'jo@x').fullName, 'Jo'); // unchanged, untouched
});

test('allProfilesDb returns one projected profile per member, sorted by email', () => {
  const db = freshDb();
  editProfileDb(db, 'zoe@x', { fullName: 'Zoe', primaryInstrument: 'drums' }, 'zoe@x', '2026-06-15T00:00:00.000Z');
  editProfileDb(db, 'al@x', { fullName: 'Al', shirtSize: 'L' }, 'al@x', '2026-06-15T00:00:00.000Z');
  const all = allProfilesDb(db);
  assert.deepEqual(all.map((p) => p.email), ['al@x', 'zoe@x']);
  assert.equal(all[1].primaryInstrument, 'drums');
});

// --- avatar helpers (pure) -------------------------------------------------

test('sniffImageType recognizes PNG/JPEG/GIF/WebP and rejects others', () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
  assert.equal(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageType(Buffer.from([0x25, 0x50, 0x44, 0x46])), null); // a PDF, not an image
});

test('gravatarUrl keys on the md5 of the trimmed lowercased email, with d=404', () => {
  // Canonical Gravatar example hash for test@example.com.
  const url = gravatarUrl('  Test@Example.com ');
  assert.match(url, /55502f40dc8b7c769880b10874abc9d0/);
  assert.match(url, /[?&]d=404/);
});

test('initialsSvg derives initials from the name, else the email', () => {
  assert.match(initialsSvg('Test Member', 'tm@x'), /aria-label="TM"/);
  assert.match(initialsSvg(null, 'jo@x'), /aria-label="JO"/);
  assert.match(initialsSvg('Test Member', 'tm@x'), /^<svg /);
});

// --- joined/end dates + tenure ---------------------------------------------

test('joined/end dates validated as real calendar dates; clearing allowed', () => {
  const db = freshDb();
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'joinedDate', value: '2020-13-40' })), /invalid date/);
  assert.throws(() => editProfileFieldDb(db, edit({ field: 'joinedDate', value: 'someday' })), /invalid date/);
  editProfileFieldDb(db, edit({ field: 'joinedDate', value: '2019-03-15', at: '2026-06-15T00:00:00.000Z' }));
  editProfileFieldDb(db, edit({ field: 'endDate', value: '2022-09-01', at: '2026-06-15T00:01:00.000Z' }));
  const p = effectiveProfileDb(db, 'jo@x');
  assert.equal(p.joinedDate, '2019-03-15');
  assert.equal(p.endDate, '2022-09-01');
});

test('tenureLabel: years + months, end-date wins, day-of-month boundary', async () => {
  const { tenureLabel, monthsBetween, formatDuration, monthYear } = await import('../src/lib/members.ts');
  // Past member: joined→end.
  assert.equal(tenureLabel('2019-03-15', '2022-05-15', '2026-01-01'), '3 years 2 months');
  // Current member: joined→today.
  assert.equal(tenureLabel('2025-01-10', null, '2026-03-10'), '1 year 2 months');
  // Not a full final month yet (today's day < joined day).
  assert.equal(monthsBetween('2025-01-20', '2025-02-10'), 0);
  assert.equal(formatDuration(0), 'less than a month');
  assert.equal(formatDuration(1), '1 month');
  assert.equal(formatDuration(12), '1 year');
  // No joined date → no tenure; reversed range → null.
  assert.equal(tenureLabel(null, null, '2026-01-01'), null);
  assert.equal(tenureLabel('2022-01-01', '2020-01-01', '2026-01-01'), null);
  assert.equal(monthYear('2019-03-15'), 'March 2019');
});

// --- avatar caching (loadAvatarIn, injected dir + fetch) -------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngResponse = () => new Response(new Uint8Array(PNG), { status: 200, headers: { 'content-type': 'image/png' } });
const notFound = () => new Response(null, { status: 404 });
const tmpDir = () => mkdtempSync(pathResolve(tmpdir(), 'mbbb-av-'));

test('loadAvatarIn: an uploaded avatar wins without any network', async () => {
  const dir = tmpDir();
  try {
    const sha = createHash('sha256').update(PNG).digest('hex');
    fsWriteFile(pathResolve(dir, sha), PNG);
    const r = await loadAvatarIn(dir, () => { throw new Error('should not fetch'); }, {
      email: 'jo@x', avatarSha: sha, googlePhoto: 'https://photo/x',
    });
    assert.deepEqual(r, { source: 'upload', sha });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAvatarIn: a Google photo is fetched once, cached, and refreshed on URL change', async () => {
  const dir = tmpDir();
  try {
    let calls = 0;
    const fetchFn = async () => { calls++; return pngResponse(); };
    const opts = { email: 'jo@x', avatarSha: null, googlePhoto: 'https://photo/url1' };
    const r1 = await loadAvatarIn(dir, fetchFn, opts);
    assert.equal(r1.source, 'google');
    const r2 = await loadAvatarIn(dir, fetchFn, opts);
    assert.deepEqual(r2, r1);
    assert.equal(calls, 1); // second view served from the local cache
    await loadAvatarIn(dir, fetchFn, { ...opts, googlePhoto: 'https://photo/url2' });
    assert.equal(calls, 2); // a new URL (e.g. updated photo at sign-in) refetches
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAvatarIn: a Gravatar hit is cached locally', async () => {
  const dir = tmpDir();
  try {
    const r = await loadAvatarIn(dir, async () => pngResponse(), { email: 'jo@x', avatarSha: null, googlePhoto: null });
    assert.equal(r.source, 'gravatar');
    assert.ok(typeof r.sha === 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAvatarIn: a Gravatar miss falls to initials and is negatively cached', async () => {
  const dir = tmpDir();
  try {
    let calls = 0;
    const fetchFn = async () => { calls++; return notFound(); };
    const opts = { email: 'jo@x', avatarSha: null, googlePhoto: null };
    assert.deepEqual(await loadAvatarIn(dir, fetchFn, opts), { source: 'initials' });
    assert.deepEqual(await loadAvatarIn(dir, fetchFn, opts), { source: 'initials' });
    assert.equal(calls, 1); // not re-probed within the TTL
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty edit history yields an empty (not missing) profile', () => {
  const db = freshDb();
  const p = effectiveProfileDb(db, 'ghost@x');
  assert.deepEqual(p, {
    email: 'ghost@x',
    fullName: null,
    phone: null,
    primaryInstrument: null,
    instruments: [],
    shirtSize: null,
    alternateEmail: null,
    joinedDate: null,
    endDate: null,
    avatarSha: null,
    updatedAt: null,
    updatedBy: null,
  });
});
