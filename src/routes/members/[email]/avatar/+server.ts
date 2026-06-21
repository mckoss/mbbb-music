// A member's avatar, resolved by precedence:
//   1. an uploaded blob (data/avatars/<sha>)
//   2. their Google account photo (redirect to the googleusercontent URL)
//   3. Gravatar, if the address has one (fetched so we can fall through cleanly)
//   4. a generated initials placeholder (SVG)
// Gated to approved members by the auth hook (the roster is all-members-visible).

import { getProfile } from '$lib/server/members';
import { photoOf } from '$lib/server/users';
import { loadAvatar, readAvatar, initialsSvg } from '$lib/server/avatars';

// Avatars are addressed by a mutable email, not a content hash, so don't cache
// them immutably — a short private cache keeps the roster snappy while letting an
// updated photo show through soon after. Always same-origin bytes (the external
// sources are cached locally), so the service worker can keep them for offline.
const CACHE = 'private, max-age=300';

export async function GET({ params }) {
  const email = (params.email ?? '').toLowerCase();
  const profile = getProfile(email);
  const r = await loadAvatar({ email, avatarSha: profile.avatarSha, googlePhoto: photoOf(email) });

  if (r.source !== 'initials') {
    const a = readAvatar(r.sha);
    if (a) return new Response(new Uint8Array(a.buf), { headers: { 'content-type': a.type, 'cache-control': CACHE } });
  }

  // Initials placeholder (also the fallback if a cached blob went missing).
  return new Response(initialsSvg(profile.fullName, email), {
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': CACHE },
  });
}
