import { test, expect } from '@playwright/test';

// Every test here writes admin corrections, and the whole suite shares ONE server
// and data dir — so two of them running at once fight over the same corrections
// state and each sees the other's edits. Serial mode keeps this file's tests in a
// single worker, one after another. (Keep new corrections-writing tests in this
// file for the same reason.)
test.describe.configure({ mode: 'serial' });

/**
 * Wait for the client to hydrate before driving a control.
 *
 * `selectOption` sets the native <select> and dispatches `change`; if Svelte
 * hasn't attached its handler yet the event lands on nothing, the choice is never
 * recorded, and the assertion that it was remembered fails — intermittently, and
 * only under the load of a full parallel run. The part-choices store writes itself
 * to localStorage as soon as its module runs, so a non-null key is proof the
 * client bundle is live.
 */
async function hydrated(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => localStorage.getItem('mbbb_part_choices') !== null);
}

test('shared roles, remembered choices, and reversible admin exclusions', async ({ page }) => {
  const score = '/?view=score&song=example&instrument=trumpet&format=letter';
  await page.goto(score);
  const picker = page.getByRole('combobox', { name: 'Part', exact: true });
  await expect(picker.locator('option')).toHaveCount(2);
  await hydrated(page);
  await picker.selectOption({ label: 'Harmony (B♭, treble clef)' });
  await page.goto('/');
  await page.goto(score);
  await expect(picker.locator('option:checked')).toHaveText('Harmony (B♭, treble clef)');
  await page.reload();
  await expect(picker.locator('option:checked')).toHaveText('Harmony (B♭, treble clef)');

  await page.goto('/library-status/parts');
  await page.getByRole('combobox', { name: 'Filter by song', exact: true }).selectOption('example');
  await page.getByRole('combobox', { name: 'Filter by instrument', exact: true }).selectOption('trumpet');
  const harmony = page.locator('article').filter({ hasText: 'Example-Harmony' });
  await expect(harmony).toHaveCount(1);
  await harmony.getByRole('button', { name: 'Hide for this instrument', exact: true }).click();
  await expect(harmony.getByRole('button', { name: 'Restore for this instrument' })).toBeVisible();

  await page.goto(score);
  await expect(page.locator('.overlay .sub')).toContainText('Melody');
  await hydrated(page);
  await page.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('clarinet');
  await expect(picker.locator('option')).toHaveCount(2);

  await page.goto('/library-status/parts');
  await page.getByRole('combobox', { name: 'Filter by instrument', exact: true }).selectOption('trumpet');
  await harmony.getByRole('button', { name: 'Restore for this instrument' }).click();
  await expect(harmony.getByRole('button', { name: 'Hide for this instrument', exact: true })).toBeVisible();
  await harmony.getByRole('button', { name: 'Hide for all instruments' }).click();
  await expect(harmony.getByRole('button', { name: 'Restore globally' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by instrument', exact: true }).selectOption('clarinet');
  await expect(harmony.getByRole('button', { name: 'Restore globally' })).toBeVisible();
  await harmony.getByRole('button', { name: 'Restore globally' }).click();
  await expect(harmony.getByRole('button', { name: 'Hide for this instrument', exact: true })).toBeVisible();
});

// The whole-band fixture chart prints "Clarinet" on page 1, "Trumpet" on page 2, a
// continuation page 3, and "Euphonium" on page 4 (see e2e/seed.mjs).
const perform = (instrument: string) =>
  `/?view=score&song=band-chart&instrument=${instrument}&mode=performance`;

// Each page is rasterized on first request, so a page nobody has opened yet can
// take a moment to appear the first time through.
const shows = (page: import('@playwright/test').Page, n: number) =>
  expect(page.locator('.pager img')).toHaveAttribute('alt', new RegExp(`page ${n}$`), { timeout: 20_000 });

/** Open the collapsed section a chart's "Start pages" link lives in. */
async function openStartPages(page: import('@playwright/test').Page) {
  await page.goto('/library-status/parts');
  await page.getByRole('group').filter({ hasText: 'whole-band charts' }).locator('summary').click();
  await page.locator('article.band').filter({ hasText: 'Band Chart' })
    .getByRole('link', { name: 'Start pages' }).click();
  return page.locator('article').filter({ has: page.getByText('Trumpet', { exact: true }) }).first();
}

test('an admin can correct where an instrument lands', async ({ page }) => {
  const row = await openStartPages(page);
  await expect(row).toContainText('Page 2 — from the chart');
  await row.locator('input[name=page]').fill('4');
  await row.getByRole('button').click();
  await expect(row).toContainText('Page 4 (set by hand; chart says 2)');

  // The correction is what the player now gets.
  await page.goto(perform('trumpet'));
  await shows(page, 4);

  // Clearing it returns the instrument to what the chart itself says.
  const again = await openStartPages(page);
  await again.locator('input[name=page]').fill('');
  await again.getByRole('button').click();
  await expect(again).toContainText('Page 2 — from the chart');
  await page.goto(perform('trumpet'));
  await shows(page, 2);
});
