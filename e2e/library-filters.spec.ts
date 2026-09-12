import { test, expect } from '@playwright/test';

for (const route of ['/', '/library-status']) {
  test(`${route} exposes matching title and status filters`, async ({ page }) => {
    await page.goto(route);
    const filters = page.getByRole('group', { name: 'Filter by status' });
    for (const status of ['Always', 'Active', 'Learning', 'Archive', 'Unfiled']) {
      await expect(filters.getByRole('button', { name: status, exact: true }))
        .toHaveAttribute('aria-pressed', status === 'Archive' ? 'false' : 'true');
    }
    // The isolated fixture has two unfiled songs ("Example" and the whole-band
    // "Band Chart"); title filtering must not remove the table's instrument columns
    // or change any catalog metadata.
    const search = page.getByRole('searchbox', { name: 'Search titles' });
    await search.fill('  EXAMPLE  ');
    await expect(page.locator('.count').first()).toContainText('1 of 2');
    await filters.getByRole('button', { name: 'Unfiled', exact: true }).click();
    await expect(page.locator('.count').first()).toContainText('0 of 2');
    await expect(page.locator('.empty')).toBeVisible();
    await filters.getByRole('button', { name: 'Unfiled', exact: true }).click();
    await expect(page.locator('.count').first()).toContainText('1 of 2');
    await search.fill('no matching song');
    await expect(page.locator('.count').first()).toContainText('0 of 2');
    await search.fill('');
    await expect(page.locator('.count').first()).toContainText('2 of 2');
    if (route === '/library-status') {
      await expect(page.getByRole('columnheader', { name: 'MuseScore (Master)' })).toBeVisible();
    }
  });
}
