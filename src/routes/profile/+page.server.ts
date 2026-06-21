// The signed-in member's own profile editor. A member edits only their own
// profile here; admin editing of other members arrives with the roster (Phase 3).
import { error, fail } from '@sveltejs/kit';

import { getProfile, editProfile } from '$lib/server/members';
import { photoOf } from '$lib/server/users';
import { saveAvatar, MAX_AVATAR_BYTES } from '$lib/server/avatars';
import { INSTRUMENT_CHOICES, SHIRT_SIZES, type ProfilePatch, type ShirtSize } from '$lib/members';

function requireUser(locals: App.Locals) {
  if (!locals.user?.role) throw error(403, 'Sign in required.');
  return locals.user.email;
}

export function load({ locals }) {
  const email = requireUser(locals);
  return {
    profile: getProfile(email),
    instruments: INSTRUMENT_CHOICES,
    shirtSizes: SHIRT_SIZES,
    hasGooglePhoto: Boolean(photoOf(email)),
  };
}

/** A trimmed form string, or null when empty. */
function str(form: FormData, key: string): string | null {
  const v = String(form.get(key) ?? '').trim();
  return v || null;
}

export const actions = {
  save: async ({ request, locals }) => {
    const email = requireUser(locals);
    const form = await request.formData();

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

    const patch: ProfilePatch = {
      fullName: str(form, 'fullName'),
      phone: str(form, 'phone'),
      primaryInstrument: primary,
      instruments: additional,
      shirtSize: shirt as ShirtSize | null,
      alternateEmail: str(form, 'alternateEmail'),
      ...avatarPatch,
    };

    try {
      editProfile(email, patch, email);
    } catch (e) {
      return fail(400, { message: (e as Error).message });
    }
    return { message: 'Profile saved.' };
  },
};
