// Sign out: clear the session cookie. POST (from the sign-out form); GET is
// allowed too so a plain link works.
import { redirect } from '@sveltejs/kit';

import { SESSION_COOKIE } from '$lib/server/auth';

function clearAndGo(cookies: import('@sveltejs/kit').Cookies): never {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  throw redirect(303, '/login');
}

export function POST({ cookies }) {
  return clearAndGo(cookies);
}

export function GET({ cookies }) {
  return clearAndGo(cookies);
}
