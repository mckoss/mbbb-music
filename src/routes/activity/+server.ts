// Client beacon for view/performance events. The server attaches the identity
// (locals.user) — the client only says what kind of view it was — so the feed
// can't be attributed to someone else. Downloads and gig views are captured
// server-side instead (see hooks.server.ts and the gig load).
import { error } from '@sveltejs/kit';

import { logEvent, BEACON_TYPES, type ActivityType } from '$lib/server/activity';

export async function POST({ request, locals }) {
  const user = locals.user;
  if (!user?.role) throw error(403, 'Sign in required.');

  let body: { type?: string; label?: string; detail?: string; at?: string; replayedFromOffline?: boolean };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid body');
  }

  const type = String(body?.type ?? '') as ActivityType;
  if (!BEACON_TYPES.includes(type)) throw error(400, 'unsupported event type');

  const label = body?.label != null ? String(body.label).slice(0, 200) : null;
  const detail = body?.detail != null ? String(body.detail).slice(0, 200) : null;
  const at = body?.at != null ? normalizeBeaconTime(body.at) : undefined;
  const offline = body?.replayedFromOffline === true;

  logEvent({ email: user.email, type, label, detail, at, offline, uploadedAt: offline ? new Date().toISOString() : null });
  return new Response(null, { status: 204 });
}

function normalizeBeaconTime(at: unknown): string | undefined {
  if (typeof at !== 'string') return undefined;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return undefined;
  if (d.getTime() > Date.now() + 5 * 60_000) return undefined;
  return d.toISOString();
}
