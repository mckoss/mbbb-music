// A member's avatar, resolved by precedence:
//   1. an uploaded blob (data/avatars/<sha>)
//   2. their Google account photo (redirect to the googleusercontent URL)
//   3. Gravatar, if the address has one (fetched so we can fall through cleanly)
//   4. a generated initials placeholder (SVG)
// Gated to approved members by the auth hook (the roster is all-members-visible).

import { redirect } from '@sveltejs/kit';

import { getProfile } from '$lib/server/members';
import { photoOf } from '$lib/server/users';
import { readAvatar, gravatarUrl, initialsSvg } from '$lib/server/avatars';

// Avatars are addressed by a mutable email, not a content hash, so don't cache
// them immutably — a short private cache keeps the roster snappy while letting an
// updated photo show through soon after.
const CACHE = 'private, max-age=300';

export async function GET({ params }) {
  const email = (params.email ?? '').toLowerCase();
  const profile = getProfile(email);

  // 1. Uploaded avatar.
  if (profile.avatarSha) {
    const a = readAvatar(profile.avatarSha);
    if (a) return new Response(new Uint8Array(a.buf), { headers: { 'content-type': a.type, 'cache-control': CACHE } });
  }

  // 2. Google account photo.
  const photo = photoOf(email);
  if (photo) throw redirect(302, photo);

  // 3. Gravatar (resolved server-side so a miss falls through to initials).
  try {
    const res = await fetch(gravatarUrl(email), { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? 'image/jpeg';
      return new Response(buf, { headers: { 'content-type': type, 'cache-control': CACHE } });
    }
  } catch {
    // network/timeout — fall through to the placeholder
  }

  // 4. Initials placeholder.
  return new Response(initialsSvg(profile.fullName, email), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': CACHE },
  });
}
