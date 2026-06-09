// Gig detail + setlist editor. The page is viewable by any approved member;
// every mutating action is admin-only (re-checked defensively, mirroring
// library-status). Songs are chosen from the catalog filtered to the statuses
// an admin would assign to a current set (Always/Active/Learning).
import { error, fail } from '@sveltejs/kit';

import { getCatalog } from '$lib/server/library';
import {
  getGig,
  updateGig,
  deleteGig,
  addSet,
  removeSet,
  addSong,
  removeSong,
  moveSong,
} from '$lib/server/gigs';
import type { GigTime } from '$lib/gig';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
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

export function load({ params }) {
  const gig = getGig(params.id);
  if (!gig) throw error(404, 'Gig not found');
  // The catalog gives titles for each song slug and the pool of songs an admin
  // can add (filtered to Always/Active/Learning on the client).
  const catalog = getCatalog();
  return { gig, catalog };
}

export const actions = {
  // Update the gig's top-level info fields (name/date/times/location/notes).
  updateInfo: async ({ request, params, locals }) => {
    requireAdmin(locals);
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
    });
    if (!gig) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  addSet: async ({ request, params, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim() || undefined;
    if (!addSet(params.id, name)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  removeSet: async ({ request, params, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    if (!removeSet(params.id, setId)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  addSong: async ({ request, params, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    const slug = String(form.get('slug') ?? '');
    if (!slug) return fail(400, { message: 'No song selected' });
    if (!addSong(params.id, setId, slug)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  removeSong: async ({ request, params, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    const slug = String(form.get('slug') ?? '');
    if (!removeSong(params.id, setId, slug)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  moveSong: async ({ request, params, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const setId = String(form.get('setId') ?? '');
    const slug = String(form.get('slug') ?? '');
    const dir = String(form.get('dir') ?? '') === 'up' ? 'up' : 'down';
    if (!moveSong(params.id, setId, slug, dir)) return fail(404, { message: 'Gig not found' });
    return { ok: true };
  },

  deleteGig: async ({ params, locals }) => {
    requireAdmin(locals);
    deleteGig(params.id);
    // The client redirects to /gigs after a successful delete.
    return { deleted: true };
  },
};
