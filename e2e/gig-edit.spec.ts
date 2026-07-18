// Editing a gig: renaming a set inline, and the stale-client guard on
// ?/updateInfo (a POST that omits a field — an older cached bundle whose form
// predates it — must leave that field untouched, not clear it).
//
// Both tests mutate the e2e-edit fixture gig, and gigs.json writes are
// whole-file read-modify-write — so run serially to avoid losing one test's
// update to the other's concurrent write.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const GIG = '/gigs/e2e-edit';

test('an organizer can rename a set inline', async ({ page }) => {
  await page.goto(GIG);

  // The unnamed fixture set renders under its fallback title.
  await expect(page.locator('.set-title h3')).toHaveText('Set 1');

  // The rename button's onclick is wired at hydration; retry until it opens.
  // exact: the add-set form's "New set name (optional)" also substring-matches.
  const input = page.getByRole('textbox', { name: 'Set name', exact: true });
  await expect(async () => {
    await page.getByRole('button', { name: 'Rename set' }).click();
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await input.fill('Opener');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.set-title h3')).toHaveText('Opener');

  // Persisted: a fresh load renders the new name from the server.
  await page.goto(GIG);
  await expect(page.locator('.set-title h3')).toHaveText('Opener');
});

test('a partial updateInfo post cannot wipe fields it did not carry', async ({
  page,
  request,
}) => {
  // Simulate a stale client: POST the updateInfo action with ONLY the name
  // field, as a cached pre-eventUrl bundle would. (Origin satisfies SvelteKit's
  // CSRF check; x-sveltekit-action selects the JSON action path.)
  const res = await request.post(`${GIG}?/updateInfo`, {
    headers: { origin: 'http://localhost:4173', 'x-sveltekit-action': 'true' },
    form: { name: 'Edit Fixture Gig' },
  });
  expect(res.ok()).toBeTruthy();

  // Nothing the POST omitted was cleared: the event link still renders, and the
  // edit form still carries the URL, notes, and hidden flag.
  await page.goto(GIG);
  await expect(page.getByRole('link', { name: /example\.com/ })).toBeVisible();

  // "Edit info" is an onclick toggle wired at hydration; retry until it opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'Edit info' }).click();
    await expect(page.locator('form.info-form')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('input[name="eventUrl"]')).toHaveValue(
    'https://example.com/edit-fixture'
  );
  await expect(page.locator('textarea[name="notes"]')).toHaveValue('Band-only edit note');
  await expect(page.locator('textarea[name="publicNotes"]')).toHaveValue('Public edit blurb');
  await expect(page.locator('input[name="hidden"]')).toBeChecked();
});
