// Start the Google OAuth flow: stash a signed state (+ post-login destination)
// in a short-lived cookie and redirect the browser to Google's consent screen.
import { redirect } from '@sveltejs/kit';

import { authConfig, authUrl, redirectUriFor, randomToken, sign, OAUTH_COOKIE } from '$lib/server/auth';

export function GET({ url, cookies }) {
  const { enabled, cfg } = authConfig();
  if (!enabled) throw redirect(303, '/');

  const next = url.searchParams.get('next') || '/';
  const state = randomToken();
  const redirectUri = redirectUriFor(cfg, url.origin);

  // Bind the state + destination to a signed, http-only cookie so the callback
  // can verify the round-trip (CSRF) and know where to send the user.
  cookies.set(OAUTH_COOKIE, sign(JSON.stringify({ state, next }), cfg.cookieSecret), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 600, // 10 minutes to complete sign-in
  });

  throw redirect(303, authUrl(cfg, redirectUri, state));
}
