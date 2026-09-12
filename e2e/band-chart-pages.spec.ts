import { test, expect } from '@playwright/test';

// A whole-band chart — every player's part in one PDF — must stay readable, and
// must open at the reader's OWN part rather than page 1. The fixture chart prints
// "Clarinet" on page 1, "Trumpet" on page 2, a continuation page 3, and
// "Euphonium" on page 4 (see e2e/seed.mjs).
const perform = (instrument: string) =>
  `/?view=score&song=band-chart&instrument=${instrument}&mode=performance`;

// Each page is rasterized on first request, so a page nobody has opened yet can
// take a moment to appear the first time through.
const shows = (page: import('@playwright/test').Page, n: number) =>
  expect(page.locator('.pager img')).toHaveAttribute('alt', new RegExp(`page ${n}$`), { timeout: 20_000 });

test('a whole-band chart opens at the reader’s part and still pages', async ({ page }) => {
  await page.goto(perform('trumpet'));
  await shows(page, 2);
  await expect(page.locator('.start-note')).toContainText('Opened at page 2 — Trumpet');

  // Paging still works from wherever it landed — the regression that started this
  // was a chart that couldn't be paged through at all.
  await page.locator('.tapzone.right').click();
  await shows(page, 3);
  await page.locator('.tapzone.left').click();
  await shows(page, 2);

  // The same chart re-aims for a different instrument.
  await page.goto(perform('euphonium'));
  await shows(page, 4);

  // An instrument the chart never names is not sent anywhere misleading.
  await page.goto(perform('tenor-sax'));
  await shows(page, 1);
  await expect(page.locator('.start-note')).toHaveCount(0);
});
