import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

import { error } from '@sveltejs/kit';

import { ensureRenderedPage } from '$lib/server/render';

const SHA_RE = /^[a-f0-9]{64}$/;
// Any 1-based page number (no leading zeros). The actual upper bound is the
// PDF's page count, range-checked in ensureRenderedPage (out-of-range → 404).
const PAGE_RE = /^([1-9][0-9]*)\.webp$/;

/**
 * A rasterized score page as lossless WebP, rendered on demand and cached on
 * disk. Addressed by the PDF's content hash, so the bytes are permanent — served
 * `immutable`. A render-engine/DPI change is busted by the `?r=` the client adds
 * (see render-rev.ts); it's ignored here.
 */
export async function GET({ params }) {
  const sha = params.sha ?? '';
  if (!SHA_RE.test(sha)) throw error(400, 'invalid content hash');

  const m = PAGE_RE.exec(params.page ?? '');
  if (!m) throw error(400, 'invalid page');
  const page = Number(m[1]);

  const path = await ensureRenderedPage(sha, page);
  if (!path) throw error(404, 'page not found');

  const stat = statSync(path);
  const headers = new Headers({
    'content-type': 'image/webp',
    'content-length': String(stat.size),
    'cache-control': 'public, max-age=31536000, immutable',
  });
  const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers });
}
