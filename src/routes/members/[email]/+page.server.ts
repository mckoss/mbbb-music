// A single member's full roster card, viewable by any approved member. Read-only
// here (a member edits their own details on /profile; admin editing of others is
// a later step).
import { error } from '@sveltejs/kit';

import { listUsers } from '$lib/server/users';
import { getProfile } from '$lib/server/members';
import { instrumentLabel, monthYear, tenureLabel } from '$lib/members';

export function load({ params, locals }) {
  if (!locals.user?.role) throw error(403, 'Sign in required.');

  const email = (params.email ?? '').trim().toLowerCase();
  const user = listUsers().find((u) => u.email === email);
  if (!user) throw error(404, 'Unknown member.');

  const p = getProfile(email);
  const today = new Date().toISOString().slice(0, 10);
  return {
    member: {
      email,
      name: p.fullName || user.name || email,
      primary: p.primaryInstrument ? instrumentLabel(p.primaryInstrument) : null,
      instruments: p.instruments.map((s) => instrumentLabel(s)).filter(Boolean),
      phone: p.phone,
      alternateEmail: p.alternateEmail,
      shirtSize: p.shirtSize,
      joined: monthYear(p.joinedDate),
      left: monthYear(p.endDate),
      tenure: tenureLabel(p.joinedDate, p.endDate, today),
      isFormer: Boolean(p.endDate),
      role: user.role,
      updatedAt: p.updatedAt,
      avatarRev: p.updatedAt ?? '',
    },
    isSelf: locals.user.email === email,
    canEdit: locals.user.role === 'admin' || locals.user.email === email,
  };
}
