// Auth gate. Resolves the signed-in user from the session cookie (role looked up
// live), then enforces access:
//   - unauthenticated            → /login
//   - authenticated, no role     → /pending
//   - member/organizer/admin     → library (+ Library Status)
//   - /admin/*                   → admin only
// /blob and /api/* are protected too (they serve the music library).
//
// When OAuth isn't configured the app runs OPEN (a synthetic admin) so local
// dev/preview keeps working until credentials are added.

import type { Handle } from '@sveltejs/kit';

import { authConfig, readSession, SESSION_COOKIE } from '$lib/server/auth';
import { roleOf } from '$lib/server/users';
import type { SessionUser } from '$lib/types';

let warnedOpen = false;

// Paths reachable without a role. /pending also needs a session (handled below).
const ALWAYS_OPEN = ['/login', '/auth/login', '/auth/callback', '/auth/logout'];

function isAsset(path: string): boolean {
  return path.startsWith('/_app/') || path === '/favicon.png' || path === '/favicon.ico' || path === '/robots.txt';
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

export const handle: Handle = async ({ event, resolve }) => {
  const { enabled, cfg } = authConfig();
  const path = event.url.pathname;

  // Open mode: not configured → everyone is a synthetic admin, no gating.
  if (!enabled) {
    if (!warnedOpen) {
      warnedOpen = true;
      console.warn(
        '[auth] OAuth is not configured (auth.clientId/clientSecret/cookieSecret missing); ' +
          'running OPEN with full access. Configure auth in config.json to require sign-in.'
      );
    }
    event.locals.authOpen = true;
    event.locals.user = { email: 'open@localhost', name: 'Open mode', role: 'admin' };
    return resolve(event);
  }

  event.locals.authOpen = false;

  const email = readSession(event.cookies.get(SESSION_COOKIE), cfg.cookieSecret);
  const role = roleOf(email);
  const user: SessionUser | null = email ? { email, name: null, role } : null;
  event.locals.user = user;

  if (isAsset(path) || ALWAYS_OPEN.includes(path)) return resolve(event);

  // /pending: the holding area for signed-in-but-unapproved users.
  if (path === '/pending') {
    if (!user) return redirectTo('/login');
    if (user.role) return redirectTo('/');
    return resolve(event);
  }

  // Everything else requires an approved (role-bearing) user.
  if (!user) {
    const next = encodeURIComponent(event.url.pathname + event.url.search);
    return redirectTo(`/login?next=${next}`);
  }
  if (!user.role) return redirectTo('/pending');

  if (path === '/admin' || path.startsWith('/admin/')) {
    if (user.role !== 'admin') return redirectTo('/');
  }

  return resolve(event);
};
