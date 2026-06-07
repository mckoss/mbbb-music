import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

import { error } from '@sveltejs/kit';

import { getAsset, casPath } from '$lib/server/library';

const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  musescore: 'application/octet-stream',
  image: 'image/jpeg',
  doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  archive: 'application/zip',
};

/**
 * The Content-Type to serve. For images we trust the Drive-reported mime so a
 * non-JPEG isn't mislabeled; otherwise the per-asset-type default applies.
 */
function contentTypeOf(meta: { assetType: string; mimeType: string | null }): string {
  if (meta.assetType === 'image' && meta.mimeType && /^image\//.test(meta.mimeType)) {
    return meta.mimeType;
  }
  return CONTENT_TYPE[meta.assetType] ?? 'application/octet-stream';
}

const SHA_RE = /^[a-f0-9]{64}$/;

/**
 * Stream a content-addressed blob. Serves only hashes present in the manifest
 * (so a path can never escape the CAS or read arbitrary files), with the right
 * Content-Type, Range support (audio scrubbing), and immutable caching since the
 * bytes are addressed by their own hash. `?dl=<name>` forces a download.
 */
export async function GET({ params, request, url }) {
  const sha = params.sha ?? '';
  if (!SHA_RE.test(sha)) throw error(400, 'invalid content hash');

  const meta = getAsset(sha);
  if (!meta) throw error(404, 'unknown asset');

  const path = casPath(sha);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw error(404, 'blob missing from store');
  }

  const total = stat.size;
  const headers = new Headers({
    'content-type': contentTypeOf(meta),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
  });

  const dl = url.searchParams.get('dl');
  if (dl) headers.set('content-disposition', `attachment; filename="${dl.replace(/["\r\n]/g, '')}"`);

  // Range request (e.g. audio seeking). Single range only.
  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
      }
      headers.set('content-range', `bytes ${start}-${end}/${total}`);
      headers.set('content-length', String(end - start + 1));
      const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
      return new Response(body, { status: 206, headers });
    }
  }

  headers.set('content-length', String(total));
  const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers });
}
