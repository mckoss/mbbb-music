// App shell + error handling: the primary nav is reachable and a bad gig id
// renders a 404 rather than crashing or leaking a stack trace.
import { test, expect } from '@playwright/test';

test('the app nav links to the main sections', async ({ page }) => {
  await page.goto('/gigs');
  const nav = page.locator('nav.tabs');
  await expect(nav.getByRole('link', { name: 'Collection' })).toHaveAttribute('href', '/');
  await expect(nav.getByRole('link', { name: 'Gig Packets' })).toHaveAttribute('href', '/gigs');
  await expect(nav.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members');
});

test('an unknown gig id returns 404', async ({ page }) => {
  const res = await page.goto('/gigs/does-not-exist');
  expect(res?.status()).toBe(404);
  // SvelteKit's default error page renders the status and the thrown message.
  await expect(page.locator('body')).toContainText('404');
  await expect(page.locator('body')).toContainText('Gig not found');
});
