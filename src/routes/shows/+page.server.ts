// The band's public show listing. This is the only route in the app an
// anonymous visitor can read (see isPublic in hooks.server.ts), so everything it
// returns goes through publicShows() — an allowlist projection that carries a
// gig's name, date, times, location and public blurb, and nothing else. Band-only
// notes, setlists and RSVPs never reach this page, signed in or not.
import { listGigs } from '$lib/server/gigs';
import { publicShows } from '$lib/gig';
import { pacificToday } from '$lib/time';

export function load({ url }) {
  const shows = publicShows(listGigs());
  // "Upcoming" is decided in band time: gig dates are bare local days, and the
  // server runs in UTC, which would retire a gig at 5pm the afternoon before.
  const today = pacificToday();

  const upcoming = shows.filter((s) => s.date >= today);
  // Most recent first — a visitor scanning past shows wants the last one, not the
  // band's first-ever gig.
  const past = shows.filter((s) => s.date < today).reverse();

  return {
    upcoming,
    past,
    // Absolute, so the subscribe links and the copyable feed URL work off-site.
    feedUrl: `${url.origin}/shows/calendar.ics`,
  };
}
