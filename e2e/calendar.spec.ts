// Per-gig "Add to my calendar" — driven in a real browser. The pure ICS logic is
// covered by test/ics.test.js; what only a browser can prove is here: that the
// buttons render on the gig page, the Google link is a real anchor, and the
// client-side .ics actually downloads a well-formed file when clicked.
import { test, expect, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';

const GIG = '/gigs/e2e-parade';

test.describe('add a single gig to my calendar', () => {
  test('the gig page shows both calendar buttons', async ({ page }) => {
    await page.goto(GIG);

    const addCal = page.locator('.add-cal');
    await expect(addCal).toContainText('Add to my calendar');
    await expect(page.getByRole('link', { name: 'Google Calendar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apple / Outlook (.ics)' })).toBeVisible();
  });

  test('the Google Calendar link is a prefilled TEMPLATE url', async ({ page }) => {
    await page.goto(GIG);

    const href = await page.getByRole('link', { name: 'Google Calendar' }).getAttribute('href');
    expect(href).toBeTruthy();
    const url = new URL(href!);
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');

    const p = url.searchParams;
    expect(p.get('action')).toBe('TEMPLATE');
    expect(p.get('text')).toBe('Maxwelton Fourth of July Parade');
    // Local wall-clock times paired with the Pacific ctz (not UTC).
    expect(p.get('dates')).toBe('20260704T110000/20260704T130000');
    expect(p.get('ctz')).toBe('America/Los_Angeles');
    expect(p.get('location')).toBe('Maxwelton Beach, 6799 Maxwelton Rd, Clinton, WA');
    // The band-only call notes ride along in the details for a member's own copy.
    expect(p.get('details')).toContain('Call time 10:30');
  });

  test('the .ics button downloads a well-formed single-event calendar', async ({ page }) => {
    await page.goto(GIG);

    // The button's onclick is wired by Svelte at hydration; a click landing
    // before then is a silent no-op (this is a heavy page and dev-mode hydration
    // is slow). Retry the click until the download actually fires.
    const button = page.getByRole('button', { name: 'Apple / Outlook (.ics)' });
    let download!: Download;
    await expect(async () => {
      const waiter = page.waitForEvent('download', { timeout: 3000 });
      await button.click();
      download = await waiter;
    }).toPass({ timeout: 30_000 });

    // Named for a human's Downloads tray.
    expect(download.suggestedFilename()).toBe('MBBB - Maxwelton Fourth of July Parade.ics');

    const path = await download.path();
    const ics = readFileSync(path, 'utf8');

    // A valid, single-event VCALENDAR with the Pacific VTIMEZONE.
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(1);
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('SUMMARY:Maxwelton Fourth of July Parade');
    expect(ics).toContain('DTSTART;TZID=America/Los_Angeles:20260704T110000');
    // A personal copy: distinct UID from the public feed, carrying the call notes.
    expect(ics).toContain('UID:gig-e2e-parade-me@mutinybaybrassband.com');
    expect(ics).toContain('Call time 10:30');
    // A snapshot, not a subscription — no re-poll hints.
    expect(ics).not.toContain('REFRESH-INTERVAL');
  });
});
