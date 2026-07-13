import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeText,
  foldLine,
  icsDate,
  icsDateTime,
  nextDay,
  eventWindow,
  showEvent,
  buildCalendar,
  webcalUrl,
  googleSubscribeUrl,
} from '../src/lib/ics.ts';

const OPTS = { origin: 'https://music.example.com', stamp: new Date('2026-07-13T17:00:00Z') };

/** The value of `name` in a folded/CRLF calendar body (unfolds continuations). */
function prop(ics, name) {
  const unfolded = ics.replace(/\r\n /g, '');
  const line = unfolded.split('\r\n').find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
  return line ?? null;
}

// --- Subscribe links --------------------------------------------------------

test('webcalUrl swaps the scheme so a client subscribes instead of downloading', () => {
  assert.equal(
    webcalUrl('https://mbbb-music.mckoss.com/shows/calendar.ics'),
    'webcal://mbbb-music.mckoss.com/shows/calendar.ics'
  );
  assert.equal(webcalUrl('http://localhost:5199/shows/calendar.ics'), 'webcal://localhost:5199/shows/calendar.ics');
});

test('googleSubscribeUrl passes webcal:// in cid, not https://', () => {
  const url = googleSubscribeUrl('https://mbbb-music.mckoss.com/shows/calendar.ics');

  // This is the bug this test exists to prevent: Google's add-by-URL endpoint
  // rejects an https:// cid with "Unable to add this calendar; check the URL".
  const cid = new URL(url).searchParams.get('cid');
  assert.equal(cid, 'webcal://mbbb-music.mckoss.com/shows/calendar.ics');
  assert.ok(!cid.startsWith('https:'), 'cid must not carry the https:// URL');

  assert.equal(new URL(url).origin, 'https://calendar.google.com');
  // The scheme's colon and slashes have to survive as encoded characters.
  assert.match(url, /cid=webcal%3A%2F%2F/);
});

// --- Text escaping ----------------------------------------------------------

test('escapeText escapes the RFC 5545 specials', () => {
  assert.equal(escapeText('Langley, WA; the barn'), 'Langley\\, WA\\; the barn');
  assert.equal(escapeText('line one\nline two'), 'line one\\nline two');
  assert.equal(escapeText('back\\slash'), 'back\\\\slash');
  // Backslash must be escaped first, or the escapes we add get re-escaped.
  assert.equal(escapeText('a\\,b'), 'a\\\\\\,b');
});

// --- Line folding -----------------------------------------------------------

test('foldLine leaves a short line alone', () => {
  assert.equal(foldLine('SUMMARY:Short'), 'SUMMARY:Short');
});

test('foldLine wraps at 75 octets with a leading-space continuation', () => {
  const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
  const lines = folded.split('\r\n');
  assert.ok(lines.length > 1, 'expected the line to fold');
  assert.ok(lines[0].length <= 75);
  for (const line of lines.slice(1)) {
    assert.equal(line[0], ' ', 'continuation lines start with a space');
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  }
  // Unfolding gets the original back.
  assert.equal(folded.replace(/\r\n /g, ''), `SUMMARY:${'x'.repeat(200)}`);
});

test('foldLine never splits a multi-byte character', () => {
  // Em-dashes are 3 bytes each: a naive character-count fold would cut one apart.
  const line = `SUMMARY:${'—'.repeat(60)}`;
  const folded = foldLine(line);
  for (const part of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75);
  }
  assert.equal(folded.replace(/\r\n /g, ''), line);
});

// --- Date arithmetic --------------------------------------------------------

test('icsDate / icsDateTime format as iCalendar expects', () => {
  assert.equal(icsDate('2026-06-14'), '20260614');
  assert.equal(icsDateTime('2026-06-14', '14:30'), '20260614T143000');
});

test('nextDay rolls months, years, and leap days', () => {
  assert.equal(nextDay('2026-06-14'), '2026-06-15');
  assert.equal(nextDay('2026-06-30'), '2026-07-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(nextDay('2028-02-28'), '2028-02-29'); // 2028 is a leap year
});

// --- Event window -----------------------------------------------------------

test('a gig with no times is an all-day event (exclusive end)', () => {
  const w = eventWindow({ date: '2026-06-14' });
  assert.deepEqual(w, { allDay: true, start: '2026-06-14', end: '2026-06-15' });
});

test('a start with no end gets a two-hour default', () => {
  const w = eventWindow({ date: '2026-06-14', times: [{ start: '14:30' }] });
  assert.equal(w.allDay, false);
  assert.deepEqual(w.start, { date: '2026-06-14', time: '14:30' });
  assert.deepEqual(w.end, { date: '2026-06-14', time: '16:30' });
});

test('several slots span the first start to the last end', () => {
  const w = eventWindow({
    date: '2026-06-14',
    times: [
      { start: '11:00', end: '11:45' },
      { start: '14:00', end: '15:30' },
    ],
  });
  assert.deepEqual(w.start, { date: '2026-06-14', time: '11:00' });
  assert.deepEqual(w.end, { date: '2026-06-14', time: '15:30' });
});

test('a gig running past midnight ends on the next day', () => {
  const w = eventWindow({ date: '2026-06-14', times: [{ start: '21:00', end: '01:00' }] });
  assert.deepEqual(w.start, { date: '2026-06-14', time: '21:00' });
  assert.deepEqual(w.end, { date: '2026-06-15', time: '01:00' });
});

test('a late start with no end rolls its default duration into the next day', () => {
  const w = eventWindow({ date: '2026-06-14', times: [{ start: '23:30' }] });
  assert.deepEqual(w.end, { date: '2026-06-15', time: '01:30' });
});

// --- VEVENT -----------------------------------------------------------------

const SHOW = {
  id: 'abc123',
  name: 'Maxwelton Parade',
  date: '2026-07-04',
  times: [{ start: '11:00', end: '13:00' }],
  location: { name: 'Maxwelton Beach', address: '6799 Maxwelton Rd, Clinton, WA' },
  publicNotes: 'Come early — the parade fills up.',
  rev: 3,
};

test('a timed event carries TZID-tagged local times, not UTC', () => {
  const ics = showEvent(SHOW, OPTS).join('\r\n');
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20260704T110000/);
  assert.match(ics, /DTEND;TZID=America\/Los_Angeles:20260704T130000/);
});

test('an all-day event uses VALUE=DATE', () => {
  const ics = showEvent({ id: 'x', name: 'Fair', date: '2026-08-01' }, OPTS).join('\r\n');
  assert.match(ics, /DTSTART;VALUE=DATE:20260801/);
  assert.match(ics, /DTEND;VALUE=DATE:20260802/);
});

test('SEQUENCE comes from the gig rev, defaulting to 0', () => {
  assert.ok(showEvent(SHOW, OPTS).includes('SEQUENCE:3'));
  assert.ok(showEvent({ id: 'x', name: 'N', date: '2026-08-01' }, OPTS).includes('SEQUENCE:0'));
});

test('the UID is stable and host-independent', () => {
  const here = showEvent(SHOW, OPTS);
  const moved = showEvent(SHOW, { ...OPTS, origin: 'https://elsewhere.example' });
  const uid = 'UID:gig-abc123@mutinybaybrassband.com';
  assert.ok(here.includes(uid));
  // Moving the app to a new domain must NOT mint a new UID — that would
  // duplicate every event on every subscriber's calendar.
  assert.ok(moved.includes(uid));
});

test('a canceled show is CANCELLED, not omitted', () => {
  const ics = showEvent({ ...SHOW, canceled: true }, OPTS).join('\r\n');
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /SUMMARY:CANCELED: Maxwelton Parade/);
});

test("the event URL is the host's page when there is one, else our shows page", () => {
  // No host page: the calendar entry points back at us.
  const ours = showEvent(SHOW, OPTS).join('\r\n');
  assert.match(ours, /URL:https:\/\/music\.example\.com\/shows/);

  // With one, the host's page wins — it's what someone tapping the event wants.
  const hosted = showEvent({ ...SHOW, eventUrl: 'https://whidbeyislandfair.com/' }, OPTS).join('\r\n');
  assert.match(hosted, /URL:https:\/\/whidbeyislandfair\.com\//);
  // ...and our page stays reachable from the description either way.
  assert.match(hosted, /music\.example\.com\/shows/);
  assert.match(hosted, /Event info: https:\/\/whidbeyislandfair\.com\//);
});

test('location and public blurb are published; the description links back', () => {
  const ics = showEvent(SHOW, OPTS).join('\r\n');
  assert.match(ics, /LOCATION:Maxwelton Beach\\, 6799 Maxwelton Rd\\, Clinton\\, WA/);
  assert.match(ics, /Come early/);
  assert.match(ics, /https:\/\/music\.example\.com\/shows/);
});

// --- Whole calendar ---------------------------------------------------------

test('buildCalendar emits a well-formed, CRLF-terminated VCALENDAR', () => {
  const ics = buildCalendar([SHOW], OPTS);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  // Every line break is CRLF — iOS rejects bare newlines.
  assert.equal(ics.split('\n').length - 1, ics.split('\r\n').length - 1);
  assert.ok(ics.includes('BEGIN:VTIMEZONE'));
  assert.ok(ics.includes('TZID:America/Los_Angeles'));
  assert.equal(prop(ics, 'X-WR-CALNAME'), 'X-WR-CALNAME:Mutiny Bay Brass Band');
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

test('buildCalendar drops gigs with no date (they have nowhere to go)', () => {
  const ics = buildCalendar([SHOW, { id: 'nodate', name: 'TBD', date: '' }], OPTS);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

test('an unchanged calendar is byte-identical (so the ETag holds)', () => {
  assert.equal(buildCalendar([SHOW], OPTS), buildCalendar([SHOW], OPTS));
});
