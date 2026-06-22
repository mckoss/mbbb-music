// The band roster: every approved member with their photo, name, and instrument.
// All-members-visible (the auth hook already requires an approved role here).
import { error } from '@sveltejs/kit';

import { listUsers } from '$lib/server/users';
import { getProfile } from '$lib/server/members';
import { instrumentLabel } from '$lib/members';

/** Last word of a display name (lowercased), for the secondary sort. */
function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toLowerCase();
}

export function load({ locals }) {
  if (!locals.user?.role) throw error(403, 'Sign in required.');

  const members = listUsers().map((u) => {
    const p = getProfile(u.email);
    // Primary instrument, or the first listed one if no primary is set.
    const instSlug = p.primaryInstrument ?? p.instruments[0] ?? null;
    const name = p.fullName || u.name || u.email;
    return {
      email: u.email,
      name,
      instrument: instSlug ? instrumentLabel(instSlug) : null,
      // Cache-buster so an updated profile refreshes the thumbnail.
      avatarRev: p.updatedAt ?? '',
      joinedDate: p.joinedDate,
      lastName: lastNameOf(name),
    };
  });

  // By seniority (earliest joined date first); members without a date sort after
  // those with one; ties and the undated group fall back to last name.
  members.sort((a, b) => {
    if (a.joinedDate && b.joinedDate) {
      if (a.joinedDate !== b.joinedDate) return a.joinedDate < b.joinedDate ? -1 : 1;
    } else if (a.joinedDate) return -1;
    else if (b.joinedDate) return 1;
    return a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' });
  });

  return { members };
}
