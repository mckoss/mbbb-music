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
  await expect(preview.locator('.map-location-dot:not(.member)').first().locator('.map-location-dot-inner')).toHaveCSS('background-color', 'rgb(36, 33, 36)');

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

test('profile map requires an explicit placement action and highlights the chosen home', async ({ page }) => {
  await page.goto('/profile');
  const map = page.locator('.home-map .map');
  await expect(map).toBeVisible();
  await expect(map).toHaveClass(/leaflet-container/);

  const latitude = page.locator('input[name="homeLatitude"]');
  const longitude = page.locator('input[name="homeLongitude"]');
  await map.click({ position: { x: 100, y: 100 } });
  await expect(latitude).toHaveValue('');
  await expect(longitude).toHaveValue('');

  await page.getByRole('button', { name: 'Place pin on map' }).click();
  await expect(map).toHaveClass(/pick-enabled/);
  await map.click({ position: { x: 120, y: 120 } });
  await expect(latitude).not.toHaveValue('');
  await expect(longitude).not.toHaveValue('');
  const pin = page.locator('.home-map .map-location-dot.member.highlighted .map-location-dot-inner');
  await expect(pin).toBeVisible();
  await expect(pin).toHaveCSS('background-color', 'rgb(122, 49, 82)');
  await expect(map).not.toHaveClass(/pick-enabled/);
});
