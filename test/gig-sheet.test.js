// Gig-sheet import: header parsing, year inference, player matching, and the
// sync rules (never delete, never override a website reply). All data here is
// synthetic — no real band names, members or sheet ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseGigSheet,
  readHeaderDate,
  readHeaderTimes,
  cleanGigName,
  readAnswer,
  parseSheetUrl,
  parseCsv,
  classifyColor,
  headerColor,
} from '../src/lib/gig-sheet.ts';
import {
  applyGigSheet,
  matchPlayer,
  playerKey,
  readState,
  setSheetUrl,
  linkPlayer,
  sheetConflict,
  tombstoneGig,
  liftTombstone,
  RED_CANCEL_NOTE,
  GIG_SHEET_IMPORTER,
} from '../src/lib/server/gig-sheet.ts';
import { makeGig } from '../src/lib/gig.ts';

const TODAY = '2026-10-05';

test('readHeaderDate finds named, numeric and mid-text dates', () => {
  assert.deepEqual(readHeaderDate('Oct. 9 School Parade'), { month: 10, day: 9, year: null, text: 'Oct. 9' });
  assert.equal(readHeaderDate('CONFIRMED -Sunday March 22 - Meadery').month, 3);
  assert.equal(readHeaderDate('sept 20. Big Fest').month, 9);
  assert.equal(readHeaderDate('Street Parade June 21, 11am').day, 21);
  assert.deepEqual(readHeaderDate('7/27/2024 County Fair'), { month: 7, day: 27, year: 2024, text: '7/27/2024' });
  assert.equal(readHeaderDate('Historical Show 10/4 tbd').day, 4);
  assert.equal(readHeaderDate('Rehearsal, time tbd'), null);
});

test('readHeaderTimes reads ranges and single times, inheriting am/pm', () => {
  assert.deepEqual(readHeaderTimes('Art Walk 5-7pm'), [{ start: '17:00', end: '19:00' }]);
  assert.deepEqual(readHeaderTimes('Opening 12:30 - 1:15pm'), [{ start: '12:30', end: '13:15' }]);
  assert.deepEqual(readHeaderTimes('Derby 10a-12p'), [{ start: '10:00', end: '12:00' }]);
  assert.deepEqual(readHeaderTimes('Grand Opening 10:45am - 1:45 pm'), [{ start: '10:45', end: '13:45' }]);
  assert.deepEqual(readHeaderTimes('Parade 4:30pm performance'), [{ start: '16:30' }]);
  assert.deepEqual(readHeaderTimes('Parade 11-11:30 lineup 12p parade'), [{ start: '12:00' }]);
  assert.deepEqual(readHeaderTimes('two sets 11-1'), []);
  assert.deepEqual(readHeaderTimes('Party 3 a picnic'), []);
});

test('cleanGigName strips status, date, weekday and trailing detail', () => {
  const name = (h) => cleanGigName(h, readHeaderDate(h)?.text ?? null);
  assert.equal(name('CONFIRMED -June 20th - Town Pride Parade 11-11:30 lineup 12p parade'), 'Town Pride Parade');
  assert.equal(name('CONFIRMED -Sunday March 22 - Meadery 2 sets 4-6pm'), 'Meadery 2 sets');
  assert.equal(name('CONFIRMED May 2nd Sat. Meadery one set 6pm'), 'Meadery one set');
  assert.equal(name('Oct 3. HONK! Somewhere. time tbd, expect all day.'), 'HONK! Somewhere');
  assert.equal(name('Aug 23rd 7-10pm Street Dance'), 'Street Dance');
  assert.equal(name('July 11 - Private Birthday party Time 4pm CANCELLED'), 'Private Birthday party');
});

test('readAnswer and parseSheetUrl', () => {
  assert.equal(readAnswer('YES'), 'yes');
  assert.equal(readAnswer(' yes, late '), 'yes');
  assert.equal(readAnswer('no'), 'no');
  assert.equal(readAnswer('maybe'), null);
  assert.equal(readAnswer(''), null);
  const id = 'A'.repeat(44);
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=123#gid=123`), { spreadsheetId: id, gid: 123 });
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`), { spreadsheetId: id, gid: null });
  assert.equal(parseSheetUrl('https://example.com/nope'), null);
});

// A synthetic sheet in the band's shape: instrument, name, then gig columns.
function grid() {
  return [
    ['', '#', 'Oct 3 Old Parade', 'CANCELLED Oct 31 Private Costume Party', 'Nov 20 Harvest Fair', 'Dec 6th Lantern Walk 4:30-6:30p', 'Feb 14 Spring Gala'],
    ['drums', 'Alex', 'yes', 'yes', 'yes', 'yes', 'no'],
    ['trumpet', 'Sam', 'yes', 'yes', 'YES', '', 'yes'],
    ['tuba', 'Sam', '', '', 'no', 'yes', ''],
    ['clarinet', 'Robin', '', '', 'yes', '', ''],
  ];
}

test('parseGigSheet infers years from column order and keys columns by date', () => {
  const g = [['', '#', '7/27/2024 Fair', 'Dec 6 Walk', 'Feb 22 Weekend', 'Sept 1 Ferry']];
  const p = parseGigSheet(g, TODAY);
  assert.deepEqual(p.gigs.map((x) => x.date), ['2024-07-27', '2024-12-06', '2025-02-22', '2025-09-01']);

  const q = parseGigSheet(grid(), TODAY);
  // No explicit year: the run is anchored near today.
  assert.deepEqual(q.gigs.map((x) => x.date), ['2026-10-03', '2026-10-31', '2026-11-20', '2026-12-06', '2027-02-14']);
  assert.equal(q.gigs[1].canceled, true);
  assert.deepEqual(q.gigs[3].times, [{ start: '16:30', end: '18:30' }]);
  assert.equal(q.gigs[3].name, 'Lantern Walk');
  assert.equal(q.players.length, 4);
  assert.equal(q.players[0].instrument, 'drums');
  assert.equal(q.players[0].answers.get(4), 'yes');
});

const MEMBERS = [
  { email: 'alex@example.com', name: 'Alex Example', instruments: ['drums'] },
  { email: 'sam.t@example.com', name: 'Sam Trumpet', instruments: ['trumpet'] },
  { email: 'sam.b@example.com', name: 'Sam Tuba', instruments: ['tuba'] },
  { email: 'robin1@example.com', name: 'Robin One', instruments: ['flute'] },
  { email: 'robin2@example.com', name: 'Robin Two', instruments: ['flute'] },
  { email: 'old@example.com', name: 'Alex Former', instruments: ['drums'], former: true },
];

test('matchPlayer: first name, narrowed by instrument, admin links win', () => {
  const p = (name, instrument) => ({ name, instrument, answers: new Map() });
  assert.deepEqual(matchPlayer(p('Alex', 'drums'), MEMBERS, {}), { email: 'alex@example.com' });
  assert.deepEqual(matchPlayer(p('Sam', 'tuba'), MEMBERS, {}), { email: 'sam.b@example.com' });
  assert.deepEqual(matchPlayer(p('Robin', 'clarinet'), MEMBERS, {}), { unmatched: 'several' });
  assert.deepEqual(matchPlayer(p('Nobody', ''), MEMBERS, {}), { unmatched: 'none' });
  const robin = p('Robin', 'clarinet');
  assert.deepEqual(matchPlayer(robin, MEMBERS, { [playerKey(robin)]: 'robin2@example.com' }), { email: 'robin2@example.com' });
});

// In-memory stand-ins for the gig and RSVP stores.
function fakeStores(initialGigs = []) {
  const gigs = [...initialGigs];
  const rsvps = new Map(); // `${gig}|${email}` -> { status, updatedBy }
  return {
    gigs,
    rsvps,
    gigStore: {
      list: () => gigs,
      create: (input) => {
        const g = makeGig(input);
        gigs.push(g);
        return g;
      },
      update: (id, patch) => {
        const g = gigs.find((x) => x.id === id);
        if (!g) return null;
        Object.assign(g, patch);
        return g;
      },
    },
    rsvpStore: {
      get: (gigId) =>
        [...rsvps.entries()]
          .filter(([k]) => k.startsWith(`${gigId}|`))
          .map(([k, v]) => ({ email: k.split('|')[1], ...v })),
      set: (gigId, email, status, by) => rsvps.set(`${gigId}|${email}`, { status, updatedBy: by }),
    },
  };
}

function run(stores, state, g = grid(), colors = null) {
  return applyGigSheet({
    grid: g,
    colors,
    today: TODAY,
    state,
    gigs: stores.gigStore,
    rsvps: stores.rsvpStore,
    members: MEMBERS,
    trigger: 'manual',
    now: '2026-10-05T12:00:00Z',
  });
}

const emptyState = () => ({ links: {}, players: {}, applied: {}, sheet: {}, canceledBySheet: {}, tombstones: {} });
const status = (s, gig, email) => s.rsvps.get(`${gig.id}|${email}`)?.status ?? null;
const byDate = (s, date) => s.gigs.find((g) => g.date === date);

test('applyGigSheet creates every dated gig, past included, annotated and public unless private', () => {
  const s = fakeStores();
  const state = emptyState();
  const r = run(s, state);
  assert.equal(r.ok, true);
  assert.equal(r.columns, 5);
  assert.deepEqual(s.gigs.map((g) => g.date).sort(), ['2026-10-03', '2026-10-31', '2026-11-20', '2026-12-06', '2027-02-14']);
  for (const g of s.gigs) {
    assert.equal(g.importedFrom, 'gig-sheet');
    assert.match(g.notes, /^Imported from Gig sheet\./);
  }
  assert.equal(byDate(s, '2026-11-20').hidden, undefined); // public
  assert.equal(byDate(s, '2026-10-31').hidden, true); // "Private" in the header
  assert.equal(byDate(s, '2026-10-31').canceled, true);
  assert.equal(byDate(s, '2026-11-20').name, 'Harvest Fair');
  assert.equal(Object.keys(state.links).length, 5);

  // Re-running changes nothing: links hold, no duplicates, no new RSVPs.
  const again = run(s, state);
  assert.equal(again.created.length, 0);
  assert.equal(again.rsvpCount, 0);
  assert.equal(s.gigs.length, 5);
});

test('applyGigSheet sets Yes and No for matched members, past gigs too, skipping canceled gigs', () => {
  const s = fakeStores();
  const state = emptyState();
  const r = run(s, state);
  const old = byDate(s, '2026-10-03');
  const fair = byDate(s, '2026-11-20');
  const walk = byDate(s, '2026-12-06');
  const gala = byDate(s, '2027-02-14');
  const party = byDate(s, '2026-10-31');
  assert.equal(status(s, old, 'alex@example.com'), 'yes'); // history comes along
  assert.equal(status(s, fair, 'alex@example.com'), 'yes');
  assert.equal(status(s, fair, 'sam.t@example.com'), 'yes');
  assert.equal(status(s, fair, 'sam.b@example.com'), 'no'); // a sheet "no" is a No
  assert.equal(status(s, gala, 'alex@example.com'), 'no');
  assert.equal(status(s, walk, 'sam.b@example.com'), 'yes');
  assert.equal(status(s, walk, 'sam.t@example.com'), null); // blank cell
  assert.equal(status(s, party, 'alex@example.com'), null); // canceled
  assert.equal(state.sheet[party.id]['alex@example.com'], 'yes'); // still remembered
  assert.equal(s.rsvps.get(`${fair.id}|alex@example.com`).updatedBy, GIG_SHEET_IMPORTER);
  assert.equal(r.rsvpCount, s.rsvps.size);
  assert.equal(r.conflicts, 0);
  assert.deepEqual(r.unmatched.map((u) => [u.name, u.reason]), [['Robin', 'several']]);
});

test('a website reply always wins and is flagged as a conflict; a cleared reply is not re-added', () => {
  const existing = makeGig({ name: 'Harvest Fair (ours)', date: '2026-11-20', notes: 'hand-made' });
  const s = fakeStores([existing]);
  s.rsvpStore.set(existing.id, 'alex@example.com', 'no', 'alex@example.com');
  const state = emptyState();
  const r = run(s, state);

  // The existing gig was linked (same date), not duplicated or edited.
  assert.deepEqual(r.linked.map((g) => g.gigId), [existing.id]);
  assert.equal(s.gigs.filter((g) => g.date === '2026-11-20').length, 1);
  assert.equal(existing.notes, 'hand-made');
  assert.equal(existing.importedFrom, undefined);
  // Alex said No on the website; the sheet's yes doesn't override it, but it's flagged.
  assert.equal(status(s, existing, 'alex@example.com'), 'no');
  assert.equal(r.conflicts, 1);
  const why = sheetConflict(s.rsvps.get(`${existing.id}|alex@example.com`), state.sheet[existing.id]['alex@example.com']);
  assert.match(why, /Gig sheet says Yes, but the website reply is No \(entered by alex@example\.com\)/);
  assert.equal(status(s, existing, 'sam.t@example.com'), 'yes');

  // Sam clears the reply on the website → the next sync leaves it cleared.
  s.rsvps.delete(`${existing.id}|sam.t@example.com`);
  run(s, state);
  assert.equal(status(s, existing, 'sam.t@example.com'), null);
});

test('sheetConflict only flags website-entered replies that disagree', () => {
  assert.equal(sheetConflict({ status: 'yes', updatedBy: 'a@example.com' }, 'yes'), null);
  assert.equal(sheetConflict({ status: 'no', updatedBy: GIG_SHEET_IMPORTER }, 'yes'), null);
  assert.equal(sheetConflict(null, 'yes'), null);
  assert.equal(sheetConflict({ status: 'maybe', updatedBy: 'a@example.com' }, undefined), null);
  assert.match(sheetConflict({ status: 'maybe', updatedBy: 'a@example.com' }, 'no'), /says No.*reply is Maybe/);
});

test('an imported reply follows the sheet; never deletes gigs', () => {
  const s = fakeStores();
  const state = emptyState();
  run(s, state);
  const fair = byDate(s, '2026-11-20');
  assert.equal(status(s, fair, 'alex@example.com'), 'yes');

  const g = grid();
  g[1][4] = 'no'; // Alex changes their mind on the sheet
  g.forEach((row) => row.splice(5, 2)); // and two columns vanish from the sheet
  const r = run(s, state, g);
  assert.equal(status(s, fair, 'alex@example.com'), 'no');
  assert.equal(r.rsvpCount, 1);
  assert.equal(s.gigs.length, 5); // the vanished columns' gigs remain
});

test('a gig deleted on the site is not re-created; same-day columns are told apart by name', () => {
  const a = makeGig({ name: 'Harvest Fair', date: '2026-11-20' });
  const b = makeGig({ name: 'Evening Dance', date: '2026-11-20' });
  const s = fakeStores([a, b]);
  const g = [
    ['', '#', 'Nov 20 evening dance 7pm', 'Nov 20 Harvest Fair noon', 'Nov 20 Mystery thing'],
    ['drums', 'Alex', 'yes', 'yes', 'yes'],
  ];
  const state = emptyState();
  const r = run(s, state, g);
  assert.deepEqual(r.linked.map((x) => x.gigId).sort(), [a.id, b.id].sort());
  // No app gig left for the third column on that day → it's created.
  assert.equal(r.created.length, 1);

  // Delete the created gig on the site: the next sync respects that.
  s.gigs.splice(s.gigs.findIndex((x) => x.id === r.created[0].gigId), 1);
  const again = run(s, state, g);
  assert.equal(again.created.length, 0);
  assert.equal(again.deleted, 1);
});

test('parseCsv handles quotes, doubled quotes and newlines in cells', () => {
  const q = '"';
  const csv = `a,b\r\n${q}Oct 3\nParade${q},${q}say ${q}${q}hi${q}${q}${q},\n`;
  assert.deepEqual(parseCsv(csv), [['a', 'b'], ['Oct 3\nParade', `say ${q}hi${q}`, '']]);
  assert.deepEqual(parseCsv('x,y'), [['x', 'y']]);
});

test('state file round-trips the sheet link and player links (temp dir only)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-gig-sheet-'));
  try {
    assert.deepEqual(readState(dir), { links: {}, players: {}, applied: {}, sheet: {}, canceledBySheet: {}, tombstones: {} });
    assert.equal(setSheetUrl('not a sheet', dir), false);
    const url = `https://docs.google.com/spreadsheets/d/${'B'.repeat(44)}/edit#gid=7`;
    assert.equal(setSheetUrl(url, dir), true);
    linkPlayer('robin|clarinet', 'Robin2@Example.com', dir);
    const st = readState(dir);
    assert.equal(st.url, url);
    assert.deepEqual(st.players, { 'robin|clarinet': 'robin2@example.com' });
    linkPlayer('robin|clarinet', '', dir);
    assert.deepEqual(readState(dir).players, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifyColor reads hue families and ignores neutrals', () => {
  assert.equal(classifyColor({ red: 1 }), 'red'); // pure red
  assert.equal(classifyColor({ red: 0.957, green: 0.8, blue: 0.8 }), 'red'); // "light red 3" fill
  assert.equal(classifyColor({ red: 0.851, green: 0.918, blue: 0.827 }), 'green'); // "light green 3"
  assert.equal(classifyColor({ green: 1 }), 'green');
  assert.equal(classifyColor({ red: 0.29, green: 0.525, blue: 0.91 }), 'blue');
  assert.equal(classifyColor({ red: 1, green: 1 }), 'other'); // yellow
  assert.equal(classifyColor({ red: 1, green: 1, blue: 1 }), null); // white
  assert.equal(classifyColor({}), null); // black (all channels omitted)
  assert.equal(classifyColor({ red: 0.6, green: 0.6, blue: 0.62 }), null); // grey
  assert.equal(classifyColor(undefined), null);
  // A colored fill wins over text color; plain fill falls back to the text.
  assert.equal(headerColor({ green: 1 }, { red: 1 }), 'green');
  assert.equal(headerColor({ red: 1, green: 1, blue: 1 }, { red: 0.8 }), 'red');
});

// Colors for the header row of grid(): Oct 3 green, Nov 20 red, Feb 14 blue.
function colorsFor(g, byCol) {
  return g.map((row, r) => row.map((_, c) => (r === 0 ? byCol[c] ?? null : null)));
}

test('a red header cancels the gig; colors can be absent', () => {
  const s = fakeStores();
  const state = emptyState();
  const g = grid();
  const r = run(s, state, g, colorsFor(g, { 2: 'green', 4: 'red', 6: 'blue' }));
  assert.equal(r.colorsRead, true);
  assert.equal(byDate(s, '2026-11-20').canceled, true); // red
  assert.equal(byDate(s, '2026-10-03').canceled, undefined); // green
  assert.equal(byDate(s, '2027-02-14').canceled, undefined); // blue means nothing
  assert.equal(byDate(s, '2026-10-31').canceled, true); // CANCELLED text
  assert.deepEqual(r.canceled.map((x) => x.date).sort(), ['2026-10-31', '2026-11-20']);
  assert.equal(status(s, byDate(s, '2026-11-20'), 'alex@example.com'), null); // no RSVPs on canceled gigs

  // Without colors (CSV fallback), a plain sync cancels only on the words.
  const s2 = fakeStores();
  const r2 = run(s2, emptyState());
  assert.equal(r2.colorsRead, false);
  assert.equal(byDate(s2, '2026-11-20').canceled, undefined);
});

test('a color-only cancellation is undone when the header stops being red', () => {
  const s = fakeStores();
  const state = emptyState();
  const g = grid();
  run(s, state, g, colorsFor(g, { 4: 'red' }));
  const fair = byDate(s, '2026-11-20');
  assert.equal(fair.canceled, true);

  // "No quorum" → "we're going after all": the header turns blue.
  const r = run(s, state, g, colorsFor(g, { 4: 'blue' }));
  assert.equal(fair.canceled, false);
  assert.deepEqual(r.uncanceled.map((x) => x.gigId), [fair.id]);
  assert.equal(status(s, fair, 'alex@example.com'), 'yes'); // RSVPs now flow
  assert.equal(state.canceledBySheet[fair.id], undefined);

  // Text cancellations stay one-way.
  const party = byDate(s, '2026-10-31');
  const g2 = grid();
  g2[0][3] = 'Oct 31 Private Costume Party';
  run(s, state, g2, colorsFor(g2, {}));
  assert.equal(party.canceled, true);
});

test("an admin's un-cancel of a red gig is respected", () => {
  const s = fakeStores();
  const state = emptyState();
  const g = grid();
  const red = colorsFor(g, { 4: 'red' });
  run(s, state, g, red);
  const fair = byDate(s, '2026-11-20');
  fair.canceled = false; // an admin un-cancels on the site
  run(s, state, g, red);
  assert.equal(fair.canceled, false);
  assert.equal(state.canceledBySheet[fair.id], 'overridden');
  run(s, state, g, red);
  assert.equal(fair.canceled, false);

  // A gig canceled by hand is never un-canceled by the sheet.
  const walk = byDate(s, '2026-12-06');
  walk.canceled = true;
  run(s, state, g, colorsFor(g, { 5: 'green' }));
  assert.equal(walk.canceled, true);
});

test('a red-title cancellation is explained in the notes, and the note goes when it is undone', () => {
  const s = fakeStores();
  const state = emptyState();
  const g = grid();
  run(s, state, g, colorsFor(g, { 4: 'red' }));
  const fair = byDate(s, '2026-11-20');
  assert.equal(fair.canceled, true);
  assert.ok(fair.notes.startsWith(RED_CANCEL_NOTE));
  assert.match(fair.notes, /Imported from Gig sheet\./); // the import note is kept
  // A text cancellation gets no color note.
  assert.ok(!byDate(s, '2026-10-31').notes.includes(RED_CANCEL_NOTE));

  run(s, state, g, colorsFor(g, { 4: 'green' }));
  assert.equal(fair.canceled, false);
  assert.ok(!fair.notes.includes(RED_CANCEL_NOTE));
  assert.match(fair.notes, /^Imported from Gig sheet\./);
});

test('a tombstone keeps a deleted gig from coming back, by column or by same-day name', () => {
  const s = fakeStores();
  const state = emptyState();
  run(s, state);
  const fair = byDate(s, '2026-11-20');
  const fairKey = Object.keys(state.links).find((k) => state.links[k] === fair.id);
  // Deleted on the site: the delete action leaves a tombstone, then removes it.
  state.tombstones[fair.id] = { gigId: fair.id, name: fair.name, date: fair.date, deletedAt: 'x', deletedBy: 'a@example.com', keys: [fairKey] };
  s.gigs.splice(s.gigs.indexOf(fair), 1);
  const r = run(s, state);
  assert.equal(r.created.length, 0);
  assert.equal(r.deleted, 1);
  assert.deepEqual(r.tombstoned.map((t) => t.gigId), [fair.id]);

  // Even if the column's key changes (another gig added the same day ahead of
  // it), the same-day name still matches the tombstone.
  const g = grid();
  g.forEach((row, i) => row.splice(4, 0, i === 0 ? 'Nov 20 Morning Market' : ''));
  const r2 = run(s, emptyStateWith(state), g);
  assert.ok(!s.gigs.some((x) => x.date === '2026-11-20' && x.name === 'Harvest Fair'));
  assert.ok(r2.created.some((x) => x.name === 'Morning Market')); // a different gig that day is fine

  // A renamed-then-deleted imported gig is still known by its sheet header.
  const s4 = fakeStores();
  const st4 = emptyState();
  st4.tombstones.yy = { gigId: 'yy', name: 'Fall Fest', date: '2026-11-20', deletedAt: 'x', deletedBy: 'a@example.com', keys: [], header: 'Nov 20 Harvest Fair' };
  run(s4, st4);
  assert.equal(byDate(s4, '2026-11-20'), undefined);

  // A hand-made gig deleted before any sync is covered by date + name too.
  const s3 = fakeStores();
  const st3 = emptyState();
  st3.tombstones.zz = { gigId: 'zz', name: 'Lantern Walk', date: '2026-12-06', deletedAt: 'x', deletedBy: 'a@example.com', keys: [] };
  run(s3, st3);
  assert.equal(byDate(s3, '2026-12-06'), undefined);
});

// Same links/tombstones, but forget column links so keys are re-resolved.
function emptyStateWith(state) {
  return { ...emptyState(), tombstones: state.tombstones };
}

test('tombstoneGig and liftTombstone persist through the state file (temp dir only)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-gig-tomb-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'gig-sheet.json'), JSON.stringify({ links: { '2026-11-20#0': 'g1' }, players: {}, applied: { g1: {} } }));
    tombstoneGig({ id: 'g1', name: 'Harvest Fair', date: '2026-11-20', notes: 'Imported from Gig sheet.\n\nSheet column: Nov 20 Harvest Fair' }, 'Admin@Example.com', dir, '2026-10-05T00:00:00Z');
    const st = readState(dir);
    assert.deepEqual(st.tombstones.g1, {
      gigId: 'g1', name: 'Harvest Fair', date: '2026-11-20', deletedAt: '2026-10-05T00:00:00Z', deletedBy: 'admin@example.com', keys: ['2026-11-20#0'], header: 'Nov 20 Harvest Fair',
    });
    assert.equal(st.applied.g1, undefined);
    assert.equal(liftTombstone('g1', dir), true);
    const after = readState(dir);
    assert.deepEqual(after.tombstones, {});
    assert.deepEqual(after.links, {}); // so the column re-imports as a new gig
    assert.equal(liftTombstone('g1', dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
