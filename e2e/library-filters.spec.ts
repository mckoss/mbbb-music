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
    // A search covers every song: hiding Unfiled keeps the match listed, with a
    // warning that offers to add the hidden status back to the filter.
    const unfiled = filters.getByRole('button', { name: 'Unfiled', exact: true });
    await unfiled.click();
    await expect(page.locator('.count').first()).toContainText('1 of 2');
    const note = page.locator('.hidden-note');
    await expect(note).toContainText('Showing 1 matching song from Unfiled');
    await note.getByRole('button', { name: 'Add Unfiled to filter' }).click();
    await expect(unfiled).toHaveAttribute('aria-pressed', 'true');
    await expect(note).toHaveCount(0);
    // With no search text the chips decide again.
    await unfiled.click();
    await search.fill('');
    await expect(page.locator('.count').first()).toContainText('0 of 2');
    await expect(page.locator('.empty')).toBeVisible();
    await unfiled.click();
    await search.fill('no matching song');
    await expect(page.locator('.count').first()).toContainText('0 of 2');
    await search.fill('');
    await expect(page.locator('.count').first()).toContainText('2 of 2');
    if (route === '/library-status') {
      await expect(page.getByRole('columnheader', { name: 'MuseScore (Master)' })).toBeVisible();
    }
  });
}
