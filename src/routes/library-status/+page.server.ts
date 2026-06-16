// The library-status page is viewable by any approved user. Admins set a song's
// status (re-checked defensively). Any approved member may propose a metadata
// correction (`correct`) — corrections are live immediately and managed/reverted
// on the /corrections page.
import { error, fail } from '@sveltejs/kit';

import { setSongStatus } from '$lib/server/song-status';
import { editField, CORRECTABLE_FIELDS, type Scope } from '$lib/server/corrections';
import { INSTRUMENT_CHOICES } from '../../sync/instruments.js';
import { slugify } from '../../sync/slugify.js';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

// Allowed written-key slugs a part may be corrected to (plus '' to clear).
const ALLOWED_KEYS = new Set(['bflat', 'eflat', 'aflat', 'fsharp', 'f', 'c', '']);
const INSTRUMENT_SLUGS = new Set(INSTRUMENT_CHOICES.map((i) => i.slug));

/** Validate + normalize a correction's value, or return an error string. */
function normalize(scope: Scope, field: string, raw: string): { value: string } | { err: string } {
  const v = raw.trim();
  if (field === 'songSlug') {
    // (Re)assign a file/folder to a song by its identity slug.
    const s = slugify(v);
    if (!s) return { err: 'invalid song slug' };
    return { value: s };
  }
  if (scope === 'file') {
    if (field === 'instrumentSlug') {
      if (v !== '' && !INSTRUMENT_SLUGS.has(v)) return { err: 'unknown instrument' };
      return { value: v };
    }
    if (field === 'key') {
      if (!ALLOWED_KEYS.has(v)) return { err: 'unknown key' };
      return { value: v };
    }
    if (field === 'partNumber') {
      if (v === '') return { value: '' };
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n) || n < 1) return { err: 'part must be a positive integer' };
      return { value: String(n) };
    }
  } else if (scope === 'song') {
    if (field === 'displaySlug') {
      const s = slugify(v);
      if (!s) return { err: 'invalid slug' };
      return { value: s };
    }
    if (field === 'displayName') {
      if (!v) return { err: 'display name required' };
      return { value: v };
    }
  }
  return { err: 'unsupported field' };
}

const PRIVILEGED_ROLES = new Set(['admin', 'organizer']);
/**
 * Privileged corrections (admin/organizer only): the display slug, and any song
 * (re)assignment — both change identity/grouping that other things depend on.
 */
function isPrivileged(scope: Scope, field: string): boolean {
  return field === 'songSlug' || (scope === 'song' && field === 'displaySlug');
}

export const actions = {
  setStatus: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const slug = String(form.get('slug') ?? '').trim();
    if (!slug) return fail(400, { message: 'missing song' });
    setSongStatus(slug, form.get('status'));
    return { ok: true };
  },

  correct: async ({ request, locals }) => {
    const user = locals.user;
    if (!user?.role) throw error(403, 'Sign in required'); // any approved member may propose
    const form = await request.formData();
    const scope = String(form.get('scope') ?? '') as Scope;
    const targetId = String(form.get('targetId') ?? '').trim();
    const field = String(form.get('field') ?? '').trim();
    const raw = String(form.get('value') ?? '');

    if (scope !== 'file' && scope !== 'song' && scope !== 'folder') return fail(400, { message: 'bad scope' });
    if (!targetId) return fail(400, { message: 'missing target' });
    if (!CORRECTABLE_FIELDS[scope].includes(field)) return fail(400, { message: `field "${field}" not editable` });
    // Identity/grouping changes (slug rename, song reassignment) are privileged.
    if (isPrivileged(scope, field) && !PRIVILEGED_ROLES.has(user.role)) {
      throw error(403, 'This change is limited to admins and organizers');
    }

    const res = normalize(scope, field, raw);
    if ('err' in res) return fail(400, { message: res.err });

    editField({ scope, targetId, field, value: res.value, by: user.email });
    return { ok: true };
  },
};
