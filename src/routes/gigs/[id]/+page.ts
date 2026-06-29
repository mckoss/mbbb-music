// Source the gig from the already-loaded layout data instead of a per-gig fetch,
// so the gig itself (name, sets, charts) is instant and available offline — the
// layout already carries every gig (getGig is just listGigs().find()). The only
// server-loaded piece is the attendance roster (`data` from +page.server.ts):
// it's spread through here so it reaches the page, and the service worker's
// stale-while-revalidate cache keeps the last-known roster visible offline.
// Mutations still go through the server actions in +page.server.ts, which re-run
// both loads to refresh this.
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent, data }) => {
  const { gigs } = await parent();
  const gig = gigs.find((g) => g.id === params.id);
  if (!gig) throw error(404, 'Gig not found');
  return { ...data, gig };
};
