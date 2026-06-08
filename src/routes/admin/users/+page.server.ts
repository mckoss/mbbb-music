// Admin-only user management. The hook already restricts /admin/* to admins;
// each action re-checks defensively.
import { error, fail } from '@sveltejs/kit';

import { listUsers, setRole, removeUser, ROLES } from '$lib/server/users';
import type { Role } from '$lib/types';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
  return locals.user.email;
}

export function load({ locals }) {
  requireAdmin(locals);
  return { users: listUsers(), roles: ROLES, me: locals.user!.email, authOpen: locals.authOpen };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const actions = {
  add: async ({ request, locals }) => {
    const me = requireAdmin(locals);
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const role = String(form.get('role') ?? '') as Role;
    if (!EMAIL_RE.test(email)) return fail(400, { message: `"${email}" is not a valid email.` });
    if (!ROLES.includes(role)) return fail(400, { message: 'Pick a valid role.' });
    setRole(email, role, me);
    return { message: `Granted ${role} to ${email}.` };
  },

  setRole: async ({ request, locals }) => {
    const me = requireAdmin(locals);
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const role = String(form.get('role') ?? '') as Role;
    if (!ROLES.includes(role)) return fail(400, { message: 'Pick a valid role.' });
    setRole(email, role, me);
    return { message: `Updated ${email} to ${role}.` };
  },

  remove: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    removeUser(email);
    return { message: `Removed ${email}.` };
  },
};
