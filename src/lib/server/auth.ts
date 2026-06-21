// Server-only web authentication: Google OAuth (authorization-code flow) and a
// signed, stateless session cookie. The cookie holds only the verified email,
// HMAC-signed with auth.cookieSecret; the role is resolved live per request
// (see users.ts) so revoking access takes effect immediately.

import { randomBytes } from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';

import { loadConfig } from '../../sync/config.js';
import { sign, unsign, makeSession, readSession, SESSION_MAX_AGE } from './cookie-sign.js';

export { sign, unsign, makeSession, readSession };

export const SESSION_COOKIE = 'mbbb_session';
export const OAUTH_COOKIE = 'mbbb_oauth';

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
  admins: string[];
  redirectUri?: string;
}

/** Read the web-auth config. `enabled` is false until the essentials are set. */
export function authConfig(): { enabled: boolean; cfg: AuthConfig } {
  const a = (loadConfig().auth || {}) as Partial<AuthConfig>;
  const cfg: AuthConfig = {
    clientId: a.clientId ?? '',
    clientSecret: a.clientSecret ?? '',
    cookieSecret: a.cookieSecret ?? '',
    admins: (a.admins ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean),
    redirectUri: a.redirectUri,
  };
  // Local/LAN dev escape hatch: MBBB_NO_AUTH=1 forces open mode (no sign-in)
  // even when full auth config is present, so config.json stays production-ready
  // and can be copied to the server as-is. See `npm run dev:no-auth`.
  const forceOpen = /^(1|true|yes|on)$/i.test(process.env.MBBB_NO_AUTH ?? '');
  const enabled = !forceOpen && Boolean(cfg.clientId && cfg.clientSecret && cfg.cookieSecret);
  return { enabled, cfg };
}

// --- Session cookie ---------------------------------------------------------

/** Cookie options for the session cookie (30-day, httpOnly, lax). */
export function sessionCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: SESSION_MAX_AGE,
  };
}

// --- Google OAuth -----------------------------------------------------------

function client(cfg: AuthConfig, redirectUri: string): OAuth2Client {
  return new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri });
}

/** The redirect URI Google calls back to (config override, else this origin). */
export function redirectUriFor(cfg: AuthConfig, origin: string): string {
  return cfg.redirectUri || `${origin}/auth/callback`;
}

/** Build the Google consent URL to redirect the browser to. */
export function authUrl(cfg: AuthConfig, redirectUri: string, state: string): string {
  return client(cfg, redirectUri).generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  });
}

/** Exchange an auth code for the verified Google identity. */
export async function exchangeCode(
  cfg: AuthConfig,
  redirectUri: string,
  code: string
): Promise<{ email: string; name: string | null; picture: string | null } | null> {
  const c = client(cfg, redirectUri);
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) return null;
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: cfg.clientId });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) return null;
  return { email: payload.email.toLowerCase(), name: payload.name ?? null, picture: payload.picture ?? null };
}

/** A random opaque token (for OAuth state / nonces). */
export function randomToken(): string {
  return randomBytes(24).toString('base64url');
}
