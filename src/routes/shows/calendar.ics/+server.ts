// The public, subscribable show calendar: /shows/calendar.ics
//
// Unauthenticated by design (see isPublic in hooks.server.ts). A subscribed
// calendar client — Google's crawler, Apple's, Outlook's — fetches this URL on
// its own schedule with no cookie of ours, so a login redirect here would land
// in someone's calendar as an HTML file instead of a feed.
//
// It publishes only publicShows(): a gig's name, date, times, location and
// public blurb. Band-only notes, setlists and RSVPs are not in the projection
// and cannot leak through this endpoint.
import { listGigs } from '$lib/server/gigs';
import { publicShows } from '$lib/gig';
import { buildCalendar } from '$lib/ics';

export function GET({ url, request }) {
  const shows = publicShows(listGigs());

  // DTSTAMP is "when this feed was generated". Quantized to the hour so an
  // unchanged calendar produces byte-identical output — otherwise the ETag would
  // differ on every request and every poller would re-download a feed that
  // hasn't changed.
  const stamp = new Date();
  stamp.setMinutes(0, 0, 0);

  const body = buildCalendar(shows, { origin: url.origin, stamp });

  // Weak ETag over the body: pollers send If-None-Match and get a cheap 304 when
  // nothing has moved. Content-derived, so any real edit invalidates it.
  const etag = `W/"${hash(body)}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  return new Response(body, {
    headers: {
      // charset matters: iOS rejects a calendar it can't decode.
      'content-type': 'text/calendar; charset=utf-8',
      // Named for humans: this is what shows up in a Downloads tray if someone
      // opens it directly rather than subscribing.
      'content-disposition': 'inline; filename="mutiny-bay-brass-band.ics"',
      'cache-control': 'public, max-age=3600',
      etag,
    },
  });
}

/** FNV-1a over the body — a short, stable content tag. Not a security hash. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
