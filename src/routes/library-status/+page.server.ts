// Admin action to set a song's status. The page itself is viewable by any
// approved user (the status sections are public); only an admin may change a
// status, so the action re-checks the role defensively.
import { error, fail } from '@sveltejs/kit';

import { setSongStatus } from '$lib/server/song-status';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
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
};
