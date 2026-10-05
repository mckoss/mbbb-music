// Gig list. Viewable by any approved member; admins and organizers may create
// gig packets (the action re-checks the role defensively). Admins also drive
// the Gig-sheet import from here: save the sheet link, run a sync on demand
// (it also runs daily on its own), and link sheet players to members.
import { error, fail, redirect } from '@sveltejs/kit';

import { listGigs, createGig } from '$lib/server/gigs';
import { readState, runGigSheetSync, setSheetUrl, linkPlayer } from '$lib/server/gig-sheet';
import { listUsers } from '$lib/server/users';
import { getProfile } from '$lib/server/members';
import { canEditGigs, compareByDate } from '$lib/gig';

function requireGigEditor(locals: App.Locals) {
  if (!canEditGigs(locals.user?.role)) throw error(403, 'Admins and organizers only');
}

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

export function load({ locals }) {
  // Sorted by date so the soonest gig leads the list.
  const gigs = [...listGigs()].sort(compareByDate);
  if (locals.user?.role !== 'admin') return { gigs, gigSheet: null };

  const state = readState();
  const members = listUsers()
    .map((u) => ({ email: u.email, name: getProfile(u.email).fullName || u.name || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    gigs,
    gigSheet: { url: state.url ?? '', lastRun: state.lastRun ?? null, links: state.players, members },
  };
}

export const actions = {
  // Create a blank gig and jump straight to its detail page for editing.
  create: async ({ locals }) => {
    requireGigEditor(locals);
    const gig = createGig({ name: 'New gig', date: '' });
    throw redirect(303, `/gigs/${gig.id}`);
  },

  // Save the Gig-sheet link (optionally) and run the import now.
  syncSheet: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const url = String(form.get('url') ?? '').trim();
    if (url && url !== readState().url && !setSheetUrl(url)) {
      return fail(400, { sheetError: 'That is not a Google Sheets link.' });
    }
    const report = await runGigSheetSync('manual');
    return { sheetReport: report };
  },

  // Point a sheet player (by key) at a member login, or clear the link.
  linkPlayer: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const key = String(form.get('key') ?? '');
    if (!key) return fail(400, { sheetError: 'Missing player.' });
    linkPlayer(key, String(form.get('email') ?? ''));
    return { linkedPlayer: key };
  },
};
