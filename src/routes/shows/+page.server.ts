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

  // This month and the next two, for the calendar strip. Derived from the Pacific
  // date rather than `new Date()` on both sides: the server runs in UTC, so a
  // client-computed month could disagree with the rendered one and flicker on
  // hydration — and around a month boundary they'd differ outright.
  const [year, month] = today.split('-').map(Number);
  const months = [0, 1, 2].map((i) => {
    const d = new Date(year, month - 1 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return {
    // The calendar spans this month and the next two, so it needs the past shows
    // too — a gig earlier this month is still on the grid.
    shows,
    upcoming,
    past,
    months,
    today,
    // Absolute, so the subscribe links and the copyable feed URL work off-site.
    feedUrl: `${url.origin}/shows/calendar.ics`,
  };
}
