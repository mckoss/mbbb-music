// Auth gate. Resolves the signed-in user from the session cookie (role looked up
// live), then enforces access:
//   - unauthenticated            → /login
//   - authenticated, no role     → /pending
//   - member/organizer/admin     → library (+ Library Status)
//   - /admin/*                   → admin only
// /blob and /api/* are protected too (they serve the music library).
//
// The one exception is /shows — the public show listing and its calendar feed
// (see isPublic below), which anyone may read without signing in.
//
// When OAuth isn't configured the app runs OPEN (a synthetic admin) so local
// dev/preview keeps working until credentials are added.

import type { Handle } from '@sveltejs/kit';

import { authConfig, readSession, SESSION_COOKIE } from '$lib/server/auth';
import { roleOf } from '$lib/server/users';
import { logEvent, touchSeen } from '$lib/server/activity';
import { getGig } from '$lib/server/gigs';
import type { SessionUser } from '$lib/types';

let warnedOpen = false;

/** A human label if this GET is a PDF download we want to record, else null. */
function pdfDownloadLabel(path: string, params: URLSearchParams): string | null {
  // A gig's printable packet (always a PDF).
  const packet = /^\/gigs\/([^/]+)\/packet$/.exec(path);
  if (packet) {
    const inst = params.get('instrument');
    return `Packet: ${getGig(packet[1])?.name ?? packet[1]}${inst ? ` (${inst})` : ''}`;
  }
  // Friendly slug downloads explicitly flagged ?dl, PDFs only.
  if (params.has('dl') && /^\/(score|file|source)\//.test(path) && path.endsWith('.pdf')) {
    return decodeURIComponent(path.split('/').pop() ?? 'file.pdf');
  }
  // Raw blob download whose save-name is a PDF.
  if (params.has('dl') && path.startsWith('/blob/')) {
    const name = params.get('dl') ?? '';
    if (name.toLowerCase().endsWith('.pdf')) return name;
  }
  return null;
}

/**
 * Note that an approved user is here, and record the request if it's a PDF
 * download. Presence is what the activity report shows as "last seen": sessions
 * are long-lived, so an actual OAuth login says little about who is using the
 * site.
 */
function notePresence(user: SessionUser | null, method: string, path: string, params: URLSearchParams): void {
  if (!user?.role) return;
  touchSeen(user.email);
  logDownload(user, method, path, params);
}

/** Record a PDF download for an approved user (best-effort; never throws). */
function logDownload(user: SessionUser | null, method: string, path: string, params: URLSearchParams): void {
  if (!user?.role || method !== 'GET') return;
  const label = pdfDownloadLabel(path, params);
  if (label) {
    try {
      logEvent({ email: user.email, type: 'download', label, detail: path });
    } catch {
      /* analytics must not break a download */
    }
  }
}

// Paths reachable without a role. /pending also needs a session (handled below).
const ALWAYS_OPEN = ['/login', '/auth/login', '/auth/callback', '/auth/logout'];

/**
 * The public show listing and its calendar feed — the only part of this app that
 * an anonymous visitor may read, and deliberately so: the feed exists to be
 * subscribed to by calendar clients, which fetch it with no cookie and would
 * otherwise be handed the login page as their "calendar".
 *
 * This is a *route* gate, not a data gate. It says nothing about what those
 * routes may serve — they publish only what publicGig() allows through, so a
 * gig's band-only notes, setlists and RSVPs stay behind the login even here.
 * Covers /shows, /shows/calendar.ics, and SvelteKit's /shows/__data.json load.
 */
function isPublic(path: string): boolean {
  return path === '/shows' || path.startsWith('/shows/');
}

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
    if (!isAsset(path)) notePresence(event.locals.user, event.request.method, path, event.url.searchParams);
    return resolve(event);
  }

  event.locals.authOpen = false;

  const email = readSession(event.cookies.get(SESSION_COOKIE), cfg.cookieSecret);
  const role = roleOf(email);
  const user: SessionUser | null = email ? { email, name: null, role } : null;
  event.locals.user = user;

  if (isAsset(path) || ALWAYS_OPEN.includes(path) || isPublic(path)) return resolve(event);

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

  notePresence(user, event.request.method, path, event.url.searchParams);
  return resolve(event);
};
