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
import { getRsvps, setRsvp } from '$lib/server/rsvps';
import { listUsers } from '$lib/server/users';
import { getProfile } from '$lib/server/members';
import { canEditGigs, type GigTime } from '$lib/gig';
import { parseRsvpStatus, type RsvpStatus } from '$lib/rsvp';

function requireGigEditor(locals: App.Locals) {
  if (!canEditGigs(locals.user?.role)) throw error(403, 'Admins and organizers only');
}

// One attendance row in a gig's roster: enough to render [icon] (photo) Name.
interface RosterMember {
  email: string;
  name: string;
  instrumentSlug: string | null;
  avatarRev: string;
  isFormer: boolean;
  status: RsvpStatus | null;
}

// Build this gig's attendance roster from the RSVP store, joined to each
// member's display info (name / instrument / avatar). Returned by the server
// load so the page can group it into Yes / Maybe / Declined lists and offer
// organizers the not-yet-replied members in the add-member dropdown.
export function load({ params, locals }) {
  const me = locals.user?.email ?? null;
  const statusByEmail = new Map(getRsvps(params.id).map((r) => [r.email, r.status]));

  const members: RosterMember[] = listUsers().map((u) => {
    const p = getProfile(u.email);
    const instSlug = p.primaryInstrument ?? p.instruments[0] ?? null;
    return {
      email: u.email,
      name: p.fullName || u.name || u.email,
      instrumentSlug: instSlug,
      avatarRev: p.updatedAt ?? '', // cache-buster, matches the roster page
      isFormer: Boolean(p.endDate),
      status: statusByEmail.get(u.email) ?? null,
    };
  });

  const byName = (a: RosterMember, b: RosterMember) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const withStatus = (s: RsvpStatus) => members.filter((m) => m.status === s).sort(byName);

  return {
    rsvp: {
      yes: withStatus('yes'),
      maybe: withStatus('maybe'),
      no: withStatus('no'),
      // Active members who haven't replied — the organizer's add-member pool.
      notReplied: members
        .filter((m) => !m.isFormer && m.status === null)
        .sort(byName)
        .map((m) => ({ email: m.email, name: m.name })),
      myStatus: me ? statusByEmail.get(me) ?? null : null,
    },
  };
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
  // Set an attendance reply. A member always sets their own; admins/organizers
  // may also set another member's (the `email` field) — e.g. a phoned-in reply
  // or adding someone from the roster's add-member dropdown. A blank status
  // clears the reply (back to unconfirmed).
  rsvp: async ({ request, params, locals }) => {
    const user = locals.user;
    if (!user?.role) throw error(403, 'Sign in required');
    const form = await request.formData();
    const status = parseRsvpStatus(form.get('status'));
    const target = String(form.get('email') ?? '').trim().toLowerCase() || user.email;
    if (target !== user.email && !canEditGigs(user.role)) {
      throw error(403, 'Admins and organizers only');
    }
    setRsvp(params.id, target, status, user.email);
    return { ok: true };
  },

  // Update the gig's top-level info fields. Two of them are public-facing:
  // `publicNotes` is published on /shows and in the calendar feed, and `hidden`
  // takes the gig off both. `notes` stays band-only.
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
      publicNotes: String(form.get('publicNotes') ?? ''),
      eventUrl: String(form.get('eventUrl') ?? ''),
      canceled: form.get('canceled') === 'on',
      hidden: form.get('hidden') === 'on',
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
