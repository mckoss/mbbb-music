// The band roster: every approved member with their photo, name, and instrument.
// All-members-visible (the auth hook already requires an approved role here).
import { error } from '@sveltejs/kit';

import { listUsers } from '$lib/server/users';
import { getProfile } from '$lib/server/members';
import { instrumentLabel } from '$lib/members';

export function load({ locals }) {
  if (!locals.user?.role) throw error(403, 'Sign in required.');

  const members = listUsers().map((u) => {
    const p = getProfile(u.email);
    // Primary instrument, or the first listed one if no primary is set.
    const instSlug = p.primaryInstrument ?? p.instruments[0] ?? null;
    return {
      email: u.email,
      name: p.fullName || u.name || u.email,
      instrument: instSlug ? instrumentLabel(instSlug) : null,
      // Cache-buster so an updated profile refreshes the thumbnail.
      avatarRev: p.updatedAt ?? '',
    };
  });
  members.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return { members };
}
