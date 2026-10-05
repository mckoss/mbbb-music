// Contacts-sheet import: column discovery, shirt sizes, member matching, and the
// fill rules (only never-edited fields; website values win). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseContactsSheet, normalizeShirtSize } from '../src/lib/contacts-sheet.ts';
import {
  applyContacts,
  matchContact,
  readContactsState,
  setContactsUrl,
  CONTACTS_IMPORTER,
} from '../src/lib/server/contacts-sheet.ts';

// The band's shape: unlabeled name and email columns, then labeled ones.
const GRID = [
  ['', '', 'phone number', 'instrument', 'shirt size', 'second shirt size', 'In group chat?'],
  ['Alex Example', 'alex@example.com', '555-010-0001', 'drums', 'L', 'XL', 'Yes'],
  ['Sam Trumpet', 'sam.other@example.com', '(555) 010-0002', 'trumpet', 'medium', '', 'Yes'],
  ['Robin', '', '555-010-0003', 'flute', '2XL', '', ''],
  ['Pat Newcomer', 'pat@example.com', '555-010-0004', 'tuba', 'S', '', 'No'],
  ['', '', '', '', '', '', ''],
];

test('parseContactsSheet finds labeled and unlabeled columns', () => {
  const rows = parseContactsSheet(GRID);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    name: 'Alex Example',
    email: 'alex@example.com',
    phone: '555-010-0001',
    instrument: 'drums',
    shirtSize: 'L', // the first shirt column, not "second shirt size"
  });
  assert.equal(rows[2].email, null);
  assert.equal(rows[2].shirtSize, 'XXL');
  assert.deepEqual(parseContactsSheet([['just', 'text']]), []);
});

test('normalizeShirtSize', () => {
  assert.equal(normalizeShirtSize('l'), 'L');
  assert.equal(normalizeShirtSize('Medium'), 'M');
  assert.equal(normalizeShirtSize('S/M'), 'S/M');
  assert.equal(normalizeShirtSize('xx-large'), 'XXL');
  assert.equal(normalizeShirtSize('huge'), null);
  assert.equal(normalizeShirtSize(''), null);
});

const MEMBERS = [
  { email: 'alex@example.com', name: 'Alex E.', alternateEmail: null, instruments: ['drums'] },
  { email: 'samt@example.com', name: 'Sam Trumpet', alternateEmail: null, instruments: ['trumpet'] },
  { email: 'robin1@example.com', name: 'Robin One', alternateEmail: null, instruments: ['flute'] },
  { email: 'robin2@example.com', name: 'Robin Two', alternateEmail: null, instruments: ['clarinet'] },
];

test('matchContact: email, then full name, then unique first name by instrument', () => {
  const c = (name, email = null, instrument = null) => ({ name, email, phone: null, instrument, shirtSize: null });
  assert.deepEqual(matchContact(c('Someone Else', 'alex@example.com'), MEMBERS), { email: 'alex@example.com' });
  assert.deepEqual(matchContact(c('Sam Trumpet', 'sam.other@example.com'), MEMBERS), { email: 'samt@example.com' });
  assert.deepEqual(matchContact(c('Robin', null, 'flute'), MEMBERS), { email: 'robin1@example.com' });
  assert.deepEqual(matchContact(c('Robin', null, 'tuba'), MEMBERS), { unmatched: 'several' });
  assert.deepEqual(matchContact(c('Pat Newcomer', 'pat@example.com'), MEMBERS), { unmatched: 'none' });
  const alt = [{ ...MEMBERS[0], alternateEmail: 'alt@example.com' }];
  assert.deepEqual(matchContact(c('X', 'alt@example.com'), alt), { email: 'alex@example.com' });
});

function fakeProfiles(seed = {}) {
  const blank = (email) => ({
    email, fullName: null, phone: null, homeAddress: null, homeLatitude: null, homeLongitude: null,
    primaryInstrument: null, instruments: [], shirtSize: null, alternateEmail: null, joinedDate: null,
    endDate: null, avatarSha: null, updatedAt: null, updatedBy: null,
  });
  const profiles = new Map(Object.entries(seed).map(([e, p]) => [e, { ...blank(e), ...p }]));
  const edited = new Map();
  const edits = [];
  return {
    edits,
    edited,
    store: {
      get: (e) => profiles.get(e) ?? blank(e),
      editedFields: (e) => edited.get(e) ?? new Set(),
      edit: (e, patch, by) => {
        edits.push({ e, patch, by });
        profiles.set(e, { ...(profiles.get(e) ?? blank(e)), ...patch });
        const set = edited.get(e) ?? new Set();
        for (const k of Object.keys(patch)) set.add(k);
        edited.set(e, set);
      },
    },
  };
}

test('applyContacts fills only blank, never-edited fields and reports differences', () => {
  const p = fakeProfiles({ 'samt@example.com': { phone: '555 010 9999', shirtSize: 'M' } });
  p.edited.set('robin1@example.com', new Set(['phone'])); // Robin cleared their phone on purpose
  const r = applyContacts({ grid: GRID, members: MEMBERS, profiles: p.store, now: '2026-10-05T00:00:00Z' });

  assert.equal(r.ok, true);
  assert.equal(r.rows, 4);
  const alex = p.edits.find((x) => x.e === 'alex@example.com');
  assert.deepEqual(alex.patch, { fullName: 'Alex Example', phone: '555-010-0001', primaryInstrument: 'drums', shirtSize: 'L' });
  assert.equal(alex.by, CONTACTS_IMPORTER);

  const sam = p.edits.find((x) => x.e === 'samt@example.com');
  // Phone and shirt were entered on the site — kept. (The roster name came from
  // the Google account; the profile's own name field was blank, so it's filled.)
  assert.deepEqual(sam.patch, { fullName: 'Sam Trumpet', primaryInstrument: 'trumpet', alternateEmail: 'sam.other@example.com' });
  assert.deepEqual(r.differences.map((d) => [d.member, d.field]), [['Sam Trumpet', 'Phone']]);

  const robin = p.edits.find((x) => x.e === 'robin1@example.com');
  assert.deepEqual(robin.patch, { primaryInstrument: 'flute', shirtSize: 'XXL' }); // no phone, no lone first name
  assert.deepEqual(r.notOnSite, [{ name: 'Pat Newcomer', email: 'pat@example.com', instrument: 'tuba' }]);

  // A second run has nothing left to fill.
  const again = applyContacts({ grid: GRID, members: MEMBERS, profiles: p.store });
  assert.equal(again.updated.length, 0);
});

test('contacts state round-trips the optional link (temp dir only)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-contacts-'));
  try {
    assert.deepEqual(readContactsState(dir), {});
    assert.equal(setContactsUrl('nope', dir), false);
    const url = `https://docs.google.com/spreadsheets/d/${'C'.repeat(44)}/edit#gid=9`;
    assert.equal(setContactsUrl(url, dir), true);
    assert.equal(readContactsState(dir).url, url);
    assert.equal(setContactsUrl('', dir), true);
    assert.deepEqual(readContactsState(dir), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
