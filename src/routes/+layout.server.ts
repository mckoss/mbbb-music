// Provide the signed-in user to every page, and the catalog only to approved
// (role-bearing) users — so a signed-in-but-unapproved visitor on /pending
// never receives the song list. Loaded server-side (the catalog is built from
// server-only state) rather than via a client fetch.
import { getCatalog } from '$lib/server/library';

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
  const catalog = user?.role ? getCatalog() : EMPTY_CATALOG;
  return { user, catalog };
}
