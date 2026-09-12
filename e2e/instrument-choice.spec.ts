import { test, expect } from '@playwright/test';

// A shared link can name an instrument the catalog doesn't have — a typo, or a
// part that was reassigned or hidden since the link was sent. The app must settle
// on a real instrument instead of thrashing between the URL's value and the
// catalog's: two effects used to fight over the store (URL → store, then
// store → first valid instrument), which crashed the page with
// effect_update_depth_exceeded and left it half-rendered.
//
// The fixture catalog's instruments come from the shared B♭ charts — clarinet,
// euphonium, soprano sax, tenor sax, trumpet — so "tuba" is a valid slug that
// this catalog does not carry.
const UNKNOWN = 'tuba';

/** Collect anything the page throws, so a reactive crash can't pass silently. */
function watchErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test('an instrument the catalog lacks settles instead of crashing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/?instrument=${UNKNOWN}`);

  const picker = page.getByRole('combobox', { name: 'Instrument', exact: true });
  // It settles on a real catalog instrument, and the page stays usable.
  await expect(picker.locator('option:checked')).toHaveText('Clarinet (B♭)');
  await expect(page.locator('.count').first()).toContainText('of 2');

  expect(errors).toEqual([]);
});

test('the score view survives an unknown instrument too', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/?view=score&song=example&instrument=${UNKNOWN}`);
  // The song has no tuba part, so the band-chart fallback is what shows — but it
  // must show something rather than dying mid-render.
  await expect(page.locator('.overlay')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an instrument the catalog does have is still honoured from the URL', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?instrument=euphonium');
  const picker = page.getByRole('combobox', { name: 'Instrument', exact: true });
  await expect(picker.locator('option:checked')).toHaveText('Euphonium (B♭)');

  // And the choice persists to the cookie, so it survives a visit with no param.
  await page.goto('/');
  await expect(picker.locator('option:checked')).toHaveText('Euphonium (B♭)');
  expect(errors).toEqual([]);
});

test('picking an instrument sticks even against a stale URL param', async ({ page }) => {
  const errors = watchErrors(page);
  // Arrive with one instrument in the URL, then choose another. The store and the
  // URL are updated in that order, so for a moment the two disagree and the
  // resolver sees the OLD param — it must land on the new choice regardless.
  await page.goto('/?instrument=trumpet');
  const picker = page.getByRole('combobox', { name: 'Instrument', exact: true });
  await expect(picker.locator('option:checked')).toHaveText('Trumpet (B♭)');
  await picker.selectOption('clarinet');
  await expect(picker.locator('option:checked')).toHaveText('Clarinet (B♭)');
  await expect(page).toHaveURL(/instrument=clarinet/);
  // Still settled a moment later — not flipped back by a late effect run.
  await page.waitForTimeout(500);
  await expect(picker.locator('option:checked')).toHaveText('Clarinet (B♭)');
  expect(errors).toEqual([]);
});
