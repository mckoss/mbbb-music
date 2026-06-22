// Profile editor. A member edits their own profile; an admin can edit any
// member's by passing ?email=<target> (and the matching hidden field on save).
import { error, fail } from '@sveltejs/kit';

import { getProfile, editProfile } from '$lib/server/members';
import { photoOf, listUsers } from '$lib/server/users';
import { saveAvatar, loadAvatar, MAX_AVATAR_BYTES } from '$lib/server/avatars';
import { INSTRUMENT_CHOICES, SHIRT_SIZES, tenureLabel, type ProfilePatch, type ShirtSize } from '$lib/members';

function requireUser(locals: App.Locals) {
  if (!locals.user?.role) throw error(403, 'Sign in required.');
  return locals.user;
}

/**
 * Resolve whose profile is being acted on. The target defaults to the signed-in
 * user; editing anyone else requires admin and a known member.
 */
function resolveTarget(user: { email: string; role: string | null }, requested: string | null): string {
  const target = (requested ?? '').trim().toLowerCase() || user.email;
  if (target !== user.email) {
    if (user.role !== 'admin') throw error(403, 'Only an admin can edit another member.');
    if (!listUsers().some((u) => u.email === target)) throw error(404, 'Unknown member.');
  }
  return target;
}

export async function load({ locals, url }) {
  const me = requireUser(locals);
  const target = resolveTarget(me, url.searchParams.get('email'));
  const profile = getProfile(target);
  // Resolve where the displayed photo actually comes from, so the UI can name it
  // (this also warms the local cache for the avatar <img> request that follows).
  const { source } = await loadAvatar({ email: target, avatarSha: profile.avatarSha, googlePhoto: photoOf(target) });
  const isOther = target !== me.email;
  const targetName = isOther
    ? profile.fullName || listUsers().find((u) => u.email === target)?.name || target
    : null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    profile,
    instruments: INSTRUMENT_CHOICES,
    shirtSizes: SHIRT_SIZES,
    avatarSource: source,
    isOther,
    targetName,
    tenure: tenureLabel(profile.joinedDate, profile.endDate, today),
  };
}

/** A trimmed form string, or null when empty. */
function str(form: FormData, key: string): string | null {
  const v = String(form.get(key) ?? '').trim();
  return v || null;
}

export const actions = {
  save: async ({ request, locals }) => {
    const me = requireUser(locals);
    const form = await request.formData();
    const target = resolveTarget(me, String(form.get('email') ?? ''));

    // Avatar: an upload sets it; the "remove" toggle clears it (falling back to
    // the Google photo / Gravatar / initials chain). Otherwise leave it as-is.
    const avatarPatch: ProfilePatch = {};
    if (String(form.get('removeAvatar') ?? '') === '1') {
      avatarPatch.avatarSha = null;
    } else {
      const file = form.get('avatar');
      if (file && typeof file !== 'string' && file.size > 0) {
        if (file.size > MAX_AVATAR_BYTES) return fail(400, { message: 'Image too large (max 5 MB).' });
        try {
          avatarPatch.avatarSha = saveAvatar(Buffer.from(await file.arrayBuffer()));
        } catch (e) {
          return fail(400, { message: (e as Error).message });
        }
      }
    }

    // Primary instrument is excluded from the "also plays" list to avoid a dup.
    const primary = String(form.get('primaryInstrument') ?? '') || null;
    const additional = form.getAll('instruments').map(String).filter((s) => s && s !== primary);
    const shirt = String(form.get('shirtSize') ?? '') || null;

    const joinedDate = str(form, 'joinedDate');
    const endDate = str(form, 'endDate');
    if (joinedDate && endDate && endDate < joinedDate) {
      return fail(400, { message: 'End date is before the joined date.' });
    }

    const patch: ProfilePatch = {
      fullName: str(form, 'fullName'),
      phone: str(form, 'phone'),
      primaryInstrument: primary,
      instruments: additional,
      shirtSize: shirt as ShirtSize | null,
      alternateEmail: str(form, 'alternateEmail'),
      joinedDate,
      endDate,
      ...avatarPatch,
    };

    try {
      editProfile(target, patch, me.email); // edited_by = the actor (admin or self)
    } catch (e) {
      return fail(400, { message: (e as Error).message });
    }
    return { message: target === me.email ? 'Profile saved.' : 'Member profile saved.' };
  },
};
