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
    await expect(page.locator('.call-time')).toHaveText('Call time 10:30 AM');
    await expect(page.getByText('Pay: $150')).toBeVisible();

    const info = page.locator('.info');
    const copy = info.locator('.info-copy');
    const map = info.locator('.gig-map');
    await expect(map).toBeVisible();
    await expect(map.locator('.map-location-dot.gig.highlighted')).toBeVisible();

    const wideCopy = await copy.boundingBox();
    const wideMap = await map.boundingBox();
    expect(wideCopy).not.toBeNull();
    expect(wideMap).not.toBeNull();
    expect(wideMap!.x).toBeGreaterThan(wideCopy!.x + wideCopy!.width);
    expect(Math.abs(wideMap!.width - wideMap!.height)).toBeLessThan(2);

    await page.setViewportSize({ width: 600, height: 900 });
    const narrowCopy = await copy.boundingBox();
    const narrowMap = await map.boundingBox();
    expect(narrowCopy).not.toBeNull();
    expect(narrowMap).not.toBeNull();
    expect(narrowMap!.y).toBeGreaterThanOrEqual(narrowCopy!.y + narrowCopy!.height);
    expect(Math.abs(narrowMap!.width - narrowMap!.height)).toBeLessThan(2);
  });
});
