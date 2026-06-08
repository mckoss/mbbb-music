import { redirect } from '@sveltejs/kit';

export function load({ locals, url }) {
  // Already approved → straight to the app (also covers open mode).
  if (locals.user?.role) throw redirect(303, '/');
  return {
    error: url.searchParams.get('error'),
    next: url.searchParams.get('next') ?? '/',
  };
}
