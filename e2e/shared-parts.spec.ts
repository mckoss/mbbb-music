import { test, expect } from '@playwright/test';

test('shared roles, remembered choices, and reversible admin exclusions', async ({ page }) => {
  const score = '/?view=score&song=example&instrument=trumpet&format=letter';
  await page.goto(score);
  const picker = page.getByRole('combobox', { name: 'Part', exact: true });
  await expect(picker.locator('option')).toHaveCount(2);
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
