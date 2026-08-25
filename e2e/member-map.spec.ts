import { test, expect } from '@playwright/test';

const overlaps = (a: DOMRect, b: DOMRect) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

test('compact map is dots-only and expanded datablocks avoid every point', async ({ page }) => {
  await page.goto('/members');
  const preview = page.locator('.preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.map-datablock')).toHaveCount(0);
  const compactDots = preview.locator('.map-location-dot');
  await expect.poll(() => compactDots.count()).toBeGreaterThanOrEqual(2);
  await expect(compactDots.first().locator('.map-location-dot-inner')).toHaveCSS('background-color', 'rgb(36, 33, 36)');

  await preview.click();
  const dialog = page.getByRole('dialog', { name: 'Band member home map' });
  await expect(dialog).toBeVisible();
  const blocks = dialog.locator('.map-datablock');
  await expect(blocks.first()).toBeVisible();
  await expect(dialog.locator('.map-block-icon.practice')).toContainText('🏫');
  await expect(dialog.locator('.map-block-icon.ferry')).toContainText('⛴');
  await expect(dialog.locator('.map-block-icon.gig').first()).toContainText('♫');
  await expect(dialog.locator('.map-datablock-leader')).toHaveCount(await blocks.count());

  const blockRects = await blocks.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  const dotRects = await dialog.locator('.map-location-dot').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  for (let i = 0; i < blockRects.length; i++) {
    for (let j = i + 1; j < blockRects.length; j++) expect(overlaps(blockRects[i] as DOMRect, blockRects[j] as DOMRect)).toBe(false);
    for (const dot of dotRects) expect(overlaps(blockRects[i] as DOMRect, dot as DOMRect)).toBe(false);
  }
});
