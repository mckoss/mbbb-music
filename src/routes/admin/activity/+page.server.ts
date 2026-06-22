// Admin-only site activity report. Merges the activity log (downloads, score
// views, gig views, performances) with the profile-edit history into one
// reverse-chronological feed, plus a "most recent use" summary per member.
import { error } from '@sveltejs/kit';

import { recentEvents } from '$lib/server/activity';
import { recentProfileEdits, getProfile } from '$lib/server/members';
import { listUsers } from '$lib/server/users';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

/** Server-side absolute time string, so SSR and client agree (no hydration drift). */
function fmt(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

interface FeedItem {
  at: string;
  time: string;
  email: string;
  who: string;
  type: string;
  label: string | null;
}

export function load({ locals }) {
  requireAdmin(locals);

  // email → display name (full name when known, else the stored name, else email).
  const nameOf = new Map<string, string>();
  for (const u of listUsers()) {
    nameOf.set(u.email, getProfile(u.email).fullName || u.name || u.email);
  }
  const who = (email: string) => nameOf.get(email) ?? email;

  const events: FeedItem[] = recentEvents(500).map((e) => ({
    at: e.at,
    time: fmt(e.at),
    email: e.email,
    who: who(e.email),
    type: e.type,
    label: e.label,
  }));

  // Profile edits, attributed to the actor (edited_by); the label notes whose
  // profile and which field.
  const edits: FeedItem[] = recentProfileEdits(200).map((e) => ({
    at: e.edited_at,
    time: fmt(e.edited_at),
    email: e.edited_by,
    who: who(e.edited_by),
    type: 'profile-edit',
    label: e.edited_by === e.email ? `their ${e.field}` : `${who(e.email)}'s ${e.field}`,
  }));

  const feed = [...events, ...edits]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 400);

  // Most recent authenticated use per member (first occurrence in the desc feed).
  const seen = new Map<string, { who: string; at: string; time: string }>();
  for (const item of feed) {
    if (!seen.has(item.email)) seen.set(item.email, { who: item.who, at: item.at, time: item.time });
  }
  const recent = [...seen.entries()]
    .map(([email, v]) => ({ email, ...v }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return { feed, recent };
}
