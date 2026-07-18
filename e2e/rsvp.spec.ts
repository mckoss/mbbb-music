// The attendance RSVP flow on a gig page: a click writes to rsvps.db, and the
// reply survives a reload. Uses its own fixture gig (e2e-rsvp) so it never races
// another spec's writes. In open mode the visitor is a synthetic admin
// (open@localhost), which is who the reply is recorded for.
//
// We wait for the page to hydrate before clicking: the RSVP buttons are inside a
// `use:enhance` form, and a click during hydration falls back to a full-page
// native submit that's both slower and racier. Once hydrated, the click is a
// clean fetch. networkidle is a safe hydration signal here — the gig-view effect
// fires its /activity request only after the client mounts.
import { test, expect } from '@playwright/test';

async function openHydrated(page: import('@playwright/test').Page) {
  await page.goto('/gigs/e2e-rsvp');
  await page.waitForLoadState('networkidle');
}

test('RSVP Yes persists across a reload, and Clear removes it', async ({ page }) => {
  await openHydrated(page);

  const buttons = page.locator('.rsvp-buttons');
  const yes = () => buttons.getByRole('button', { name: 'Yes', exact: true });

  // Starts unset.
  await expect(yes()).toHaveAttribute('aria-pressed', 'false');

  // Reply Yes — an enhanced (fetch) submit; the server load re-runs and the
  // button flips to pressed.
  await yes().click();
  await expect(yes()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  await expect(buttons.getByRole('button', { name: 'Clear' })).toBeVisible();

  // Persisted: a fresh load renders Yes pressed straight from the server (from
  // rsvps.db) — this is in the SSR HTML, so no hydration wait is needed to see it.
  await page.goto('/gigs/e2e-rsvp');
  await expect(yes()).toHaveAttribute('aria-pressed', 'true');

  // Clearing removes the reply.
  await page.waitForLoadState('networkidle');
  await buttons.getByRole('button', { name: 'Clear' }).click();
  await expect(yes()).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
});
