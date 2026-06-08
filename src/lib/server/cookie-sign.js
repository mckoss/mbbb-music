// Pure cookie/session signing primitives (no framework imports), so they're
// unit-testable under the plain node test runner. auth.ts re-exports these.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

/** Sign a value as `<value-b64url>.<hmac-b64url>`. */
export function sign(value, secret) {
  const mac = createHmac('sha256', secret).update(value).digest();
  return `${Buffer.from(value).toString('base64url')}.${mac.toString('base64url')}`;
}

/** Verify a `<value>.<hmac>` token, returning the value or null if tampered. */
export function unsign(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  let value;
  let mac;
  try {
    value = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    mac = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secret).update(value).digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  return value;
}

/** Build a signed session token for an email. */
export function makeSession(email, secret, now = () => Date.now()) {
  const payload = { email: String(email).toLowerCase(), iat: Math.floor(now() / 1000) };
  return sign(JSON.stringify(payload), secret);
}

/** Verify a session token, returning the lowercased email or null (enforces max-age). */
export function readSession(token, secret, now = () => Date.now()) {
  if (!token) return null;
  const raw = unsign(token, secret);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload.email) return null;
    if (typeof payload.iat === 'number' && now() / 1000 - payload.iat > SESSION_MAX_AGE) return null;
    return String(payload.email).toLowerCase();
  } catch {
    return null;
  }
}
