// Admin-only site activity report. Merges the activity log (downloads, score
// views, gig views, performances) with the profile-edit history into one
// reverse-chronological feed, plus a "most recent use" summary per member.
import { error } from '@sveltejs/kit';

import { recentEvents } from '$lib/server/activity';
import { recentProfileEdits, getProfile } from '$lib/server/members';
import { listUsers } from '$lib/server/users';
import { formatPacificDateTime } from '$lib/time';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

interface FeedItem {
  at: string;
  time: string;
  offline: boolean;
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

  // "joinedDate" → "joined date"; avatar is stored as a hash, so name it plainly.
  const fieldLabel = (field: string) =>
    field === 'avatarSha' ? 'photo' : field.replace(/([A-Z])/g, ' $1').toLowerCase();

  const events: FeedItem[] = recentEvents(500).map((e) => ({
    at: e.at,
    time: formatPacificDateTime(e.at),
    offline: Boolean(e.offline),
    email: e.email,
    who: who(e.email),
    type: e.type,
    label: e.label,
  }));

  // Profile edits, attributed to the actor (edited_by); the label notes whose
  // profile and which field.
  const edits: FeedItem[] = recentProfileEdits(200).map((e) => ({
    at: e.edited_at,
    time: formatPacificDateTime(e.edited_at),
    offline: false,
    email: e.edited_by,
    who: who(e.edited_by),
    type: 'profile-edit',
    label: e.edited_by === e.email ? `their ${fieldLabel(e.field)}` : `${who(e.email)}'s ${fieldLabel(e.field)}`,
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
