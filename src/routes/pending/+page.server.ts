import { redirect } from '@sveltejs/kit';

export function load({ locals }) {
  if (!locals.user) throw redirect(303, '/login');
  if (locals.user.role) throw redirect(303, '/');
  return { email: locals.user.email };
}
