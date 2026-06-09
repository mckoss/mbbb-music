import { error, json } from '@sveltejs/kit';

import { getPageCount } from '$lib/server/render';

const SHA_RE = /^[a-f0-9]{64}$/;

/**
 * Page count for a score. Immutable per content hash (the count for a given
 * sha can never change), so it caches forever alongside the rendered pages.
 */
export async function GET({ params }) {
  const sha = params.sha ?? '';
  if (!SHA_RE.test(sha)) throw error(400, 'invalid content hash');

  const pages = await getPageCount(sha);
  if (pages == null) throw error(404, 'not a renderable score');

  return json({ pages }, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
}
