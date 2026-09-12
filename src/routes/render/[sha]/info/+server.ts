import { error, json } from '@sveltejs/kit';

import { getPageCount } from '$lib/server/render';
import { getPartPages } from '$lib/server/part-pages';
import { startPages } from '../../../../sync/part-labels.js';

const SHA_RE = /^[a-f0-9]{64}$/;

/**
 * Page count and part-page index for a score. Both are immutable per content hash
 * (neither the page count nor where a part starts inside those bytes can change),
 * so this caches forever alongside the rendered pages — and the service worker
 * already precaches this URL with a saved score, which is what makes the
 * jump-to-my-part hint work offline on a music stand.
 *
 * Admin page overrides are deliberately NOT merged here; they arrive with the
 * catalog so this response stays a pure function of the content.
 */
export async function GET({ params }) {
  const sha = params.sha ?? '';
  if (!SHA_RE.test(sha)) throw error(400, 'invalid content hash');

  const pages = await getPageCount(sha);
  if (pages == null) throw error(404, 'not a renderable score');
  const parts = await getPartPages(sha);
  // Resolve slug -> page here rather than in the viewer: the ranking rule (a label
  // naming your clef beats one naming only your transposition) belongs with the
  // labels, and the admin page and the viewer must not drift apart on it.
  const starts = startPages(parts);
  // `precision` is the ranking input behind `starts`; it has done its job here, and
  // this response is cached forever and precached with every saved score, so only
  // what the viewer reads goes on the wire.
  const index = parts.map(({ page, label, instruments }) => ({ page, label, instruments }));

  return json({ pages, parts: index, starts }, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
}
