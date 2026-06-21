// Google OAuth callback: verify the state round-trip, exchange the code for the
// verified identity, set the session cookie, and route the user on. An approved
// user lands at their destination; an unknown user lands on /pending.
import { redirect } from '@sveltejs/kit';

import {
  authConfig,
  exchangeCode,
  redirectUriFor,
  makeSession,
  unsign,
  sessionCookieOptions,
  OAUTH_COOKIE,
  SESSION_COOKIE,
} from '$lib/server/auth';
import { roleOf, rememberName, rememberPhoto } from '$lib/server/users';

/** Only allow same-site relative paths as a post-login destination. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export async function GET({ url, cookies }) {
  const { enabled, cfg } = authConfig();
  if (!enabled) throw redirect(303, '/');

  const secure = url.protocol === 'https:';
  const raw = cookies.get(OAUTH_COOKIE);
  cookies.delete(OAUTH_COOKIE, { path: '/' });

  const error = url.searchParams.get('error');
  if (error) throw redirect(303, '/login?error=denied');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stash = raw ? unsign(raw, cfg.cookieSecret) : null;
  if (!code || !state || !stash) throw redirect(303, '/login?error=state');

  let parsed: { state?: string; next?: string };
  try {
    parsed = JSON.parse(stash);
  } catch {
    throw redirect(303, '/login?error=state');
  }
  if (parsed.state !== state) throw redirect(303, '/login?error=state');

  let identity: { email: string; name: string | null; picture: string | null } | null = null;
  try {
    identity = await exchangeCode(cfg, redirectUriFor(cfg, url.origin), code);
  } catch {
    identity = null;
  }
  if (!identity) throw redirect(303, '/login?error=verify');

  // Authenticated: issue the session cookie regardless of approval, so /pending
  // can show their email and an admin can grant a role.
  cookies.set(SESSION_COOKIE, makeSession(identity.email, cfg.cookieSecret), sessionCookieOptions(secure));
  rememberName(identity.email, identity.name);
  rememberPhoto(identity.email, identity.picture);

  if (!roleOf(identity.email)) throw redirect(303, '/pending');
  throw redirect(303, safeNext(parsed.next));
}
