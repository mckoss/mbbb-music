// Source the gig from the already-loaded layout data instead of a per-gig fetch.
// This is a *universal* load (no server round-trip), so opening a gig is instant
// and works fully offline — the layout already carries every gig (getGig is just
// listGigs().find()), and the catalog comes from the layout too. Only the chart
// images depend on the score cache. Mutations still go through the server actions
// in +page.server.ts, which re-run the layout load to refresh this.
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent }) => {
  const { gigs } = await parent();
  const gig = gigs.find((g) => g.id === params.id);
  if (!gig) throw error(404, 'Gig not found');
  return { gig };
};
