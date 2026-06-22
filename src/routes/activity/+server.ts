// Client beacon for view/performance events. The server attaches the identity
// (locals.user) — the client only says what kind of view it was — so the feed
// can't be attributed to someone else. Downloads and gig views are captured
// server-side instead (see hooks.server.ts and the gig load).
import { error } from '@sveltejs/kit';

import { logEvent, BEACON_TYPES, type ActivityType } from '$lib/server/activity';

export async function POST({ request, locals }) {
  const user = locals.user;
  if (!user?.role) throw error(403, 'Sign in required.');

  let body: { type?: string; label?: string; detail?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid body');
  }

  const type = String(body?.type ?? '') as ActivityType;
  if (!BEACON_TYPES.includes(type)) throw error(400, 'unsupported event type');

  const label = body?.label != null ? String(body.label).slice(0, 200) : null;
  const detail = body?.detail != null ? String(body.detail).slice(0, 200) : null;

  logEvent({ email: user.email, type, label, detail });
  return new Response(null, { status: 204 });
}
