// The band roster: every approved member with their photo, name, and instrument.
// All-members-visible (the auth hook already requires an approved role here).
import { error } from '@sveltejs/kit';

import { listUsers } from '$lib/server/users';
import { getProfile } from '$lib/server/members';
import { instrumentLabel, tenureLabel } from '$lib/members';

/** Last word of a display name (lowercased), for the secondary sort. */
function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toLowerCase();
}

export function load({ locals }) {
  if (!locals.user?.role) throw error(403, 'Sign in required.');

  const today = new Date().toISOString().slice(0, 10);
  const all = listUsers().map((u) => {
    const p = getProfile(u.email);
    // Primary instrument, or the first listed one if no primary is set.
    const instSlug = p.primaryInstrument ?? p.instruments[0] ?? null;
    const name = p.fullName || u.name || u.email;
    return {
      email: u.email,
      name,
      instrumentSlug: instSlug,
      instrument: instSlug ? instrumentLabel(instSlug) : null,
      // Cache-buster so an updated profile refreshes the thumbnail.
      avatarRev: p.updatedAt ?? '',
      tenure: tenureLabel(p.joinedDate, p.endDate, today),
      joinedDate: p.joinedDate,
      lastName: lastNameOf(name),
      isFormer: Boolean(p.endDate),
    };
  });

  // Within an instrument section: by seniority (earliest joined date first);
  // members without a date sort after those with one; ties and the undated group
  // fall back to last name.
  const bySeniority = (a: (typeof all)[number], b: (typeof all)[number]) => {
    if (a.joinedDate && b.joinedDate) {
      if (a.joinedDate !== b.joinedDate) return a.joinedDate < b.joinedDate ? -1 : 1;
    } else if (a.joinedDate) return -1;
    else if (b.joinedDate) return 1;
    return a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
  };

  // One canonical list: active first (then former), each ordered by seniority.
  // The client groups it by instrument; the sort keys are dropped from the
  // payload.
  const active = all.filter((m) => !m.isFormer).sort(bySeniority);
  const former = all.filter((m) => m.isFormer).sort(bySeniority);
  const members = [...active, ...former].map(({ joinedDate, lastName, ...m }) => m);

  return { members };
}
