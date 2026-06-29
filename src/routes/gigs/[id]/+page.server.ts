// Gig detail + setlist editor. The page is viewable by any approved member;
// every mutating action is limited to admins and organizers (re-checked
// defensively). Songs are chosen from the catalog filtered to the statuses used
// for a current set (Always/Active/Learning).
import { error, fail, redirect } from '@sveltejs/kit';

import {
  updateGig,
  deleteGig,
  duplicateGig,
  addSet,
  removeSet,
  addSong,
  removeSong,
  moveSong,
} from '$lib/server/gigs';
import { canEditGigs, type GigTime } from '$lib/gig';

function requireGigEditor(locals: App.Locals) {
  if (!canEditGigs(locals.user?.role)) throw error(403, 'Admins and organizers only');
}

// Parse repeated start[]/end[] form fields into a GigTime[] (blank rows drop).
function parseTimes(form: FormData): GigTime[] {
  const starts = form.getAll('start').map((s) => String(s));
  const ends = form.getAll('end').map((s) => String(s));
  const out: GigTime[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].trim();
    const end = (ends[i] ?? '').trim();
    if (!start) continue;
    out.push(end ? { start, end } : { start });
  }
  return out;
}

// The page data (gig + catalog) comes from already-loaded layout data via the
// universal load in +page.ts, so opening a gig is instant and works offline.
// A gig-view is logged from the client (see +page.svelte) instead of here, so
// the view still records (and replays when offline) without a server round-trip.

export const actions = {
  // Update the gig's top-level info fields (name/date/times/location/notes).
  updateInfo: async ({ request, params, locals }) => {
    requireGigEditor(locals);
    const form = await request.formData();
    const gig = updateGig(params.id, {
      name: String(form.get('name') ?? ''),
      date: String(form.get('date') ?? ''),
      times: parseTimes(form),
      location: {
        name: String(form.get('locationName') ?? ''),
        address: String(form.get('locationAddress') ?? ''),
      },
      notes: String(form.get('notes') ?? ''),
      canceled: form.get('canceled') === 'on',
    });
    if (!gig) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  addSet: async ({ request, params, locals }) => {
    requireGigEditor(locals);
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim() || undefined;
    if (!addSet(params.id, name)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  removeSet: async ({ request, params, locals }) => {
    requireGigEditor(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    if (!removeSet(params.id, setId)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  addSong: async ({ request, params, locals }) => {
    requireGigEditor(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    const slug = String(form.get('slug') ?? '');
    if (!slug) return fail(400, { message: 'No song selected' });
    if (!addSong(params.id, setId, slug)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  removeSong: async ({ request, params, locals }) => {
    requireGigEditor(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    const slug = String(form.get('slug') ?? '');
    if (!removeSong(params.id, setId, slug)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  moveSong: async ({ request, params, locals }) => {
    requireGigEditor(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    const slug = String(form.get('slug') ?? '');
    const dir = String(form.get('dir') ?? '') === 'up' ? 'up' : 'down';
    if (!moveSong(params.id, setId, slug, dir)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  duplicateGig: async ({ params, locals }) => {
    requireGigEditor(locals);
    const gig = duplicateGig(params.id);
    if (!gig) return fail(404, { message: 'Gig not found' });
    throw redirect(303, `/gigs/${gig.id}`);
  },

  deleteGig: async ({ params, locals }) => {
    requireGigEditor(locals);
    deleteGig(params.id);
    // The client redirects to /gigs after a successful delete.
    return { deleted: true };
  },
};
