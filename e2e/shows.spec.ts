// The public /shows page — the one route an anonymous visitor may read. The
// security-critical invariant is the allowlist projection (publicShows): a
// hidden gig, and any gig's band-only notes, must never reach this page. Also
// covers the subscribe controls, which are client-rendered from the feed URL.
import { test, expect } from '@playwright/test';

test.describe('public shows page', () => {
  test('lists public shows but never hidden gigs or band-only notes', async ({ page }) => {
    await page.goto('/shows');

    await expect(page.getByRole('heading', { name: 'Shows', exact: true })).toBeVisible();

    // Public shows appear by name (in the upcoming or past section, depending on
    // the date — the blurb only renders for upcoming shows, so that's covered by
    // the feed spec instead, which is date-independent).
    await expect(page.getByText('Maxwelton Fourth of July Parade')).toBeVisible();

    // A canceled public show still shows, marked Canceled.
    const canceled = page.locator('#show-e2e-canceled');
    await expect(canceled).toContainText('Cascade Festival Set');
    await expect(canceled).toContainText('Canceled');

    // Privacy allowlist: the hidden gig, its name, address and secret band notes
    // must be nowhere on the page — signed in or not.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Private Corporate Holiday Party');
    expect(body).not.toContain('PAYCODE-SECRET-9931');
    expect(body).not.toContain('1 Private Way');
    // e2e-parade's band-only note (call time / pay / contact) must not leak; only
    // its publicNotes may show.
    expect(body).not.toContain('Call time 10:30');
    expect(body).not.toContain('Pay: $150');
    // The hidden rehearsal is off the public page too.
    expect(body).not.toContain('RSVP Fixture Rehearsal');
  });

  test('subscribe controls point at the calendar feed', async ({ page }) => {
    await page.goto('/shows');

    // Google's add-by-URL link must carry the webcal:// feed in cid (see $lib/ics).
    const googleHref = await page
      .getByRole('link', { name: 'Add to Google Calendar' })
      .getAttribute('href');
    const cid = new URL(googleHref!).searchParams.get('cid');
    expect(cid).toMatch(/^webcal:\/\/.*\/shows\/calendar\.ics$/);

    // Apple/Outlook gets the raw webcal:// URL.
    const appleHref = await page
      .getByRole('link', { name: 'Add to Apple Calendar or Outlook' })
      .getAttribute('href');
    expect(appleHref).toMatch(/^webcal:\/\/.*\/shows\/calendar\.ics$/);

    // The copyable feed URL is the https(s):// form.
    await expect(page.locator('.feed code')).toHaveText(/^https?:\/\/.*\/shows\/calendar\.ics$/);
  });

  test('the copy button copies the feed URL to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/shows');

    const feedUrl = await page.locator('.feed code').innerText();
    const copy = page.getByRole('button', { name: 'Copy', exact: true });

    // Retry the click until hydration has wired the handler (the button flips to
    // "Copied" only after navigator.clipboard.writeText resolves).
    await expect(async () => {
      await copy.click();
      await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(feedUrl);
  });
});
