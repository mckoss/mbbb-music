// Provide the signed-in user to every page, and the catalog + gig list only to
// approved (role-bearing) users — so a signed-in-but-unapproved visitor on
// /pending never receives them. Loaded server-side (built from server-only
// state) rather than via a client fetch.
//
// The full gig list is shared here (not just on /gigs) so the gig detail page
// can render from already-loaded data — instant, and fully available offline
// without a per-gig fetch. getGig() is literally listGigs().find(), so the list
// already carries everything the detail page needs (only chart *images* depend
// on the download/score cache).
import { getCatalog } from '$lib/server/library';
import { listGigs } from '$lib/server/gigs';
import { getMemberRsvps } from '$lib/server/rsvps';
import { compareByDate } from '$lib/gig';

const EMPTY_CATALOG = {
  tunes: [],
  instruments: [],
  extras: [],
  sources: [],
  sourceUrls: {},
  uniqueCount: 0,
  liveCount: 0,
};

export function load({ locals }) {
  const user = locals.user;
  const approved = Boolean(user?.role);
  const catalog = approved ? getCatalog() : EMPTY_CATALOG;
  const gigs = approved ? [...listGigs()].sort(compareByDate) : [];
  // The signed-in member's own replies, by gig id, so every page can mark its
  // calendars and nudge about gigs still awaiting a reply without a per-gig fetch.
  const myRsvps = approved && user ? getMemberRsvps(user.email) : {};
  return { user, catalog, gigs, myRsvps };
}
