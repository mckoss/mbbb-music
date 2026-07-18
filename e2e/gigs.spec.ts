// The signed-in gig list (/gigs). Unlike /shows, this is band-only and shows
// every gig — including hidden ones — as cards linking to each packet.
import { test, expect } from '@playwright/test';

test.describe('gig list', () => {
  test('lists gigs and links to the public shows page', async ({ page }) => {
    await page.goto('/gigs');

    await expect(page.getByRole('heading', { name: 'Gigs', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Public shows page/ })).toHaveAttribute(
      'href',
      '/shows'
    );

    // A public gig and a hidden one both appear here (the band sees everything).
    // .first() because an upcoming gig can also appear in the "haven't RSVP'd"
    // reminder at the top of the page, giving two links with the same name.
    await expect(
      page.getByRole('link', { name: /Maxwelton Fourth of July Parade/ }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Private Corporate Holiday Party/ }).first()
    ).toBeVisible();
  });

  test('a gig card navigates to its detail page', async ({ page }) => {
    await page.goto('/gigs');

    await page.getByRole('link', { name: /Maxwelton Fourth of July Parade/ }).first().click();

    await expect(page).toHaveURL(/\/gigs\/e2e-parade$/);
    await expect(page.getByRole('heading', { name: 'Maxwelton Fourth of July Parade' })).toBeVisible();
    // Band-only detail the public page never shows is visible here.
    await expect(page.getByText('Call time 10:30')).toBeVisible();
  });
});
