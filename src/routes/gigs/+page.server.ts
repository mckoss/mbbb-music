// Gig list. Viewable by any approved member; only an admin may create a gig
// (the action re-checks the role defensively, mirroring library-status).
import { error, redirect } from '@sveltejs/kit';

import { listGigs, createGig } from '$lib/server/gigs';
import { compareByDate } from '$lib/gig';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

export function load() {
  // Sorted by date so the soonest gig leads the list.
  const gigs = [...listGigs()].sort(compareByDate);
  return { gigs };
}

export const actions = {
  // Create a blank gig and jump straight to its detail page for editing.
  create: async ({ locals }) => {
    requireAdmin(locals);
    const gig = createGig({ name: 'New gig', date: '' });
    throw redirect(303, `/gigs/${gig.id}`);
  },
};
