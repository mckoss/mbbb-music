// The subscribable feed at /shows/calendar.ics, hit as a calendar client would:
// no cookie, and honoring the ETag. Exercises the live endpoint end to end — the
// content type a calendar app requires, the projection, and the 304 fast path —
// which the pure buildCalendar unit tests can't observe.
import { test, expect } from '@playwright/test';

test.describe('public calendar feed', () => {
  test('serves a text/calendar VCALENDAR of the public shows', async ({ request }) => {
    const res = await request.get('/shows/calendar.ics');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/calendar');

    const body = await res.text();
    expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(body).toContain('BEGIN:VTIMEZONE');
    // The public parade is present as an event...
    expect(body).toContain('UID:gig-e2e-parade@mutinybaybrassband.com');
    expect(body).toContain('SUMMARY:Maxwelton Fourth of July Parade');
    // ...a canceled show stays in the feed, marked CANCELLED...
    expect(body).toContain('SUMMARY:CANCELED: Cascade Festival Set');
    expect(body).toContain('STATUS:CANCELLED');
  });

  test('never leaks a hidden gig or band-only notes', async ({ request }) => {
    const body = await (await request.get('/shows/calendar.ics')).text();
    expect(body).not.toContain('Private Corporate Holiday Party');
    expect(body).not.toContain('PAYCODE-SECRET-9931');
    expect(body).not.toContain('e2e-hidden');
    expect(body).not.toContain('RSVP Fixture Rehearsal');
    // e2e-parade's band-only note must not ride along; only its publicNotes may.
    expect(body).not.toContain('Call time 10:30');
    expect(body).toContain('Come early');
  });

  test('an unchanged feed returns 304 for a matching ETag', async ({ request }) => {
    const first = await request.get('/shows/calendar.ics');
    const etag = first.headers()['etag'];
    expect(etag).toBeTruthy();

    const second = await request.get('/shows/calendar.ics', {
      headers: { 'if-none-match': etag },
    });
    expect(second.status()).toBe(304);
  });
});
