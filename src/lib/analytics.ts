// Keep member identifiers, score hashes, gig IDs, and query strings out of GA4.
const MEASUREMENT_ID = 'G-WYSGHSNPYC';
const PUBLIC_ROUTES = new Set([
  '/', '/activity', '/corrections', '/extras', '/gigs', '/library-status',
  '/library-status/files', '/library-status/generated-scores',
  '/library-status/parts', '/login', '/members', '/offline', '/pending',
  '/profile', '/shows'
]);

export function analyticsPath(pathname: string): string {
  if (PUBLIC_ROUTES.has(pathname)) return pathname;
  if (/^\/gigs\/[^/]+$/.test(pathname)) return '/gigs/detail';
  if (/^\/library-status\/parts\/[^/]+$/.test(pathname)) return '/library-status/parts/detail';
  if (/^\/members\/[^/]+$/.test(pathname)) return '/members/profile';
  if (/^\/view\/[^/]+$/.test(pathname)) return '/view/item';
  return '/other';
}

let initialized = false;

export function trackAnalyticsPage(url: URL): void {
  if (typeof window === 'undefined' || url.hostname !== 'mbbb-music.mckoss.com') return;
  const path = analyticsPath(url.pathname);
  const safeLocation = `${url.origin}${path}`;
  let referrer = '';
  try {
    const source = new URL(document.referrer);
    if (source.origin !== url.origin) referrer = source.origin;
  } catch {
    // No external referrer.
  }
  const dataLayer = ((window as Window & { dataLayer?: unknown[] }).dataLayer ??= []);
  // gtag commands use Arguments objects; arrays have a different data-layer meaning.
  function gtag(..._args: unknown[]): void {
    dataLayer.push(arguments);
  }
  if (!initialized) {
    // Set safe URL values before the tag loads or creates its session event.
    gtag('js', new Date());
    gtag('set', { page_location: safeLocation, page_referrer: referrer });
    gtag('config', MEASUREMENT_ID, { send_page_view: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
    initialized = true;
  }
  gtag('set', { page_location: safeLocation, page_referrer: referrer });
  gtag('event', 'page_view', {
    page_location: safeLocation,
    page_referrer: referrer,
    page_title: path === '/' ? 'MBBB Music' : `MBBB Music: ${path}`
  });
}
