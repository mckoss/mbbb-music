import { test, expect } from '@playwright/test';

// A page image that fails to load on a live connection (a dropped packet on
// wifi, a slow cold render) must not leave the reader stuck on an error: the
// pager retries by itself, and once its retries are spent it offers "Try again"
// and a real download — never a raw-PDF link, which in the installed iPad app
// replaces the whole app with no way back.
//
// Service workers are blocked so these requests reach the network layer the
// test controls; the retry logic under test lives in the page (PdfPager).
test.use({ serviceWorkers: 'block' });

const perform = '/?view=score&song=band-chart&instrument=trumpet&mode=performance';
const pageImages = '**/render/*/*.webp*';

test('a page image that fails a couple of times loads by itself', async ({ page }) => {
  let failuresLeft = 2;
  let requests = 0;
  await page.route(pageImages, (route) => {
    requests += 1;
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return route.abort('failed');
    }
    return route.continue();
  });

  await page.goto(perform);
  const img = page.locator('.pager img');
  await expect(img).toHaveAttribute('alt', /page 2$/, { timeout: 30_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
    timeout: 30_000,
  }).toBe(true);
  await expect(page.locator('.status.error')).toHaveCount(0);
  expect(requests).toBeGreaterThanOrEqual(3);
});

test('after its retries, the error offers Try again and a download, and recovers', async ({ page }) => {
  await page.route(pageImages, (route) => route.abort('failed'));
  await page.goto(perform);

  const error = page.locator('.status.error');
  await expect(error).toBeVisible({ timeout: 45_000 });
  const download = error.locator('a.download');
  await expect(download).toHaveAttribute('download', /\.pdf$/);
  await expect(download).toHaveAttribute('href', /[?&]dl\b/);
  await expect(download).not.toHaveAttribute('target', '_blank');

  // The connection is fine again; one tap recovers without leaving the viewer.
  await page.unroute(pageImages);
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(error).toHaveCount(0, { timeout: 30_000 });
  const img = page.locator('.pager img');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
    timeout: 30_000,
  }).toBe(true);
});
