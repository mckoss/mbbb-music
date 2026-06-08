import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sign, unsign, makeSession, readSession, SESSION_MAX_AGE } from '../src/lib/server/cookie-sign.js';

const SECRET = 'test-cookie-secret-please-ignore';

test('sign/unsign round-trips a value', () => {
  const token = sign('hello@example.com', SECRET);
  assert.equal(unsign(token, SECRET), 'hello@example.com');
});

test('unsign rejects a tampered payload', () => {
  const token = sign('member@example.com', SECRET);
  // Flip the payload but keep the old signature.
  const forged = token.replace(/^[^.]+/, Buffer.from('admin@example.com').toString('base64url'));
  assert.equal(unsign(forged, SECRET), null);
});

test('unsign rejects a different secret', () => {
  const token = sign('member@example.com', SECRET);
  assert.equal(unsign(token, 'other-secret'), null);
});

test('unsign rejects malformed tokens', () => {
  assert.equal(unsign('not-a-token', SECRET), null);
  assert.equal(unsign('', SECRET), null);
});

test('session round-trips an email (lowercased)', () => {
  const token = makeSession('Member@Example.com', SECRET);
  assert.equal(readSession(token, SECRET), 'member@example.com');
});

test('readSession rejects a missing/forged session', () => {
  assert.equal(readSession(undefined, SECRET), null);
  assert.equal(readSession(makeSession('a@b.com', SECRET), 'wrong'), null);
});

test('readSession rejects a session past the 30-day max-age', () => {
  const t0 = 1_700_000_000_000;
  const token = makeSession('a@b.com', SECRET, () => t0);
  // Still valid one second before expiry; invalid one second after.
  assert.equal(readSession(token, SECRET, () => t0 + (SESSION_MAX_AGE - 1) * 1000), 'a@b.com');
  assert.equal(readSession(token, SECRET, () => t0 + (SESSION_MAX_AGE + 1) * 1000), null);
});
