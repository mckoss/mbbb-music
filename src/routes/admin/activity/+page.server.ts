// Admin-only site activity report. The page is a per-member summary — every
// member, always listed, with when they were last on the site, which features
// they use (recent vs all-time), and which songs they've viewed, practiced, or
// performed. The raw reverse-chronological feed is kept underneath for detail.
import { error } from '@sveltejs/kit';

import { recentEvents, usageByMember, songUsageByMember, lastSeen, ACTIVITY_TYPES } from '$lib/server/activity';
import { recentProfileEdits, getProfile } from '$lib/server/members';
import { listUsers } from '$lib/server/users';
import { formatPacificDateTime, formatLastSeen } from '$lib/time';

/** The window that counts as "recent" everywhere on this page. */
const RECENT_DAYS = 30;

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

/** A song this member has opened, with how they used it. */
interface SongUse {
  title: string;
  recent: number;
  total: number;
  lastAt: string;
  last: string;
  kinds: string[]; // 'viewed' | 'practiced' | 'performed'
}

const KIND_VERB: Record<string, string> = {
  'score-view': 'viewed',
  practice: 'practiced',
  performance: 'performed',
};

export function load({ locals }) {
  requireAdmin(locals);

  const now = new Date();
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();

  const users = listUsers();
  const profiles = new Map(users.map((u) => [u.email, getProfile(u.email)]));
  const nameOf = new Map(users.map((u) => [u.email, profiles.get(u.email)!.fullName || u.name || u.email]));
  const who = (email: string) => nameOf.get(email) ?? email;

  // --- Per-member summary --------------------------------------------------

  const seenAt = lastSeen();
  const usage = usageByMember(since);
  const songUsage = songUsageByMember(since);

  // email → type → {recent, total}
  const byMember = new Map<string, Map<string, { recent: number; total: number }>>();
  for (const row of usage) {
    const m = byMember.get(row.email) ?? new Map();
    m.set(row.type, { recent: row.recent, total: row.total });
    byMember.set(row.email, m);
  }

  // email → song title → use (one row per member+song+kind is merged here).
  const songsOf = new Map<string, Map<string, SongUse>>();
  for (const row of songUsage) {
    const songs = songsOf.get(row.email) ?? new Map<string, SongUse>();
    const use = songs.get(row.label) ?? {
      title: row.label,
      recent: 0,
      total: 0,
      lastAt: '',
      last: '',
      kinds: [] as string[],
    };
    use.recent += row.recent;
    use.total += row.total;
    if (row.last_at > use.lastAt) use.lastAt = row.last_at;
    const verb = KIND_VERB[row.type];
    if (verb && !use.kinds.includes(verb)) use.kinds.push(verb);
    songs.set(row.label, use);
    songsOf.set(row.email, songs);
  }

  const members = users
    .map((u) => {
      const features = byMember.get(u.email) ?? new Map();
      const counts: Record<string, { recent: number; total: number }> = {};
      let recentTotal = 0;
      let allTotal = 0;
      for (const type of ACTIVITY_TYPES) {
        const c = features.get(type) ?? { recent: 0, total: 0 };
        counts[type] = c;
        recentTotal += c.recent;
        allTotal += c.total;
      }

      // Busiest first, by recent use then by all-time.
      const songs = [...(songsOf.get(u.email)?.values() ?? [])]
        .map((s) => ({ ...s, last: formatLastSeen(s.lastAt, now) }))
        .sort((a, b) => b.recent - a.recent || b.total - a.total || a.title.localeCompare(b.title));

      const at = seenAt.get(u.email) ?? null;
      const p = profiles.get(u.email)!;
      return {
        email: u.email,
        who: who(u.email),
        role: u.role,
        isFormer: Boolean(p.endDate),
        avatarRev: p.updatedAt ?? '',
        lastSeenAt: at,
        lastSeen: at ? formatLastSeen(at, now) : null,
        counts,
        recentTotal,
        allTotal,
        songs,
      };
    })
    // Most recently seen first; members never seen sink to the bottom, by name.
    .sort((a, b) => {
      if (a.lastSeenAt && b.lastSeenAt) return a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0;
      if (a.lastSeenAt) return -1;
      if (b.lastSeenAt) return 1;
      return a.who.localeCompare(b.who);
    });

  // --- Raw feed (detail, collapsed on the page) ----------------------------

  const events: FeedItem[] = recentEvents(500).map((e) => ({
    at: e.at,
    time: formatPacificDateTime(e.at),
    offline: Boolean(e.offline),
    email: e.email,
    who: who(e.email),
    type: e.type,
    label: e.label,
  }));

  // "joinedDate" → "joined date"; avatar is stored as a hash, so name it plainly.
  const fieldLabel = (field: string) =>
    field === 'avatarSha' ? 'photo' : field.replace(/([A-Z])/g, ' $1').toLowerCase();

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

  return { members, feed, recentDays: RECENT_DAYS };
}
