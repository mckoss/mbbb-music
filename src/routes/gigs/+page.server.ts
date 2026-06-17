// Gig list. Viewable by any approved member; admins and organizers may create
// gig packets (the action re-checks the role defensively).
import { error, redirect } from '@sveltejs/kit';

import { listGigs, createGig } from '$lib/server/gigs';
import { canEditGigs, compareByDate } from '$lib/gig';

function requireGigEditor(locals: App.Locals) {
  if (!canEditGigs(locals.user?.role)) throw error(403, 'Admins and organizers only');
}

export function load() {
  // Sorted by date so the soonest gig leads the list.
  const gigs = [...listGigs()].sort(compareByDate);
  return { gigs };
}

export const actions = {
  // Create a blank gig and jump straight to its detail page for editing.
  create: async ({ locals }) => {
    requireGigEditor(locals);
    const gig = createGig({ name: 'New gig', date: '' });
    throw redirect(303, `/gigs/${gig.id}`);
  },
};
