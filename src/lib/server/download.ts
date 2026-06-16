import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

import { error } from '@sveltejs/kit';

import { assetIndexFor } from '$lib/asset-urls';
import { getCatalog, getAsset, casPath } from '$lib/server/library';

const BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  mscz: 'application/octet-stream',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
};

function contentTypeFor(filename: string, mimeType: string | null): string {
  const ext = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  if (mimeType) return mimeType;
  return 'application/octet-stream';
}

/**
 * Stream a downloadable asset addressed by its *friendly* slug path
 * (`score/<song>/<name>.pdf`, `audio/<song>/<take>.mp3`, …). The path resolves
 * to the current content sha via the catalog-derived index.
 *
 * Because slug→bytes is mutable, these are NOT served `immutable`: instead the
 * content hash is the strong `ETag` and the response is `no-cache`, so the
 * browser revalidates with `If-None-Match` and gets a cheap 304 when unchanged,
 * or fresh bytes the moment the name points at a new file — never a stale one.
 *
 * `?dl` forces a download (`Content-Disposition: attachment`); without it the
 * asset opens inline. Either way the filename is the clean last path segment.
 */
export async function streamFriendly(
  family: string,
  rest: string | undefined,
  request: Request,
  url: URL,
): Promise<Response> {
  const path = `${family}/${rest ?? ''}`;
  const sha = assetIndexFor(getCatalog()).byPath.get(path);
  if (!sha) throw error(404, 'unknown file');

  const file = casPath(sha);
  let stat;
  try {
    stat = statSync(file);
  } catch {
    throw error(404, 'blob missing from store');
  }

  const filename = (path.split('/').pop() || 'download').replace(/["\r\n]/g, '');
  const etag = `"${sha}"`;
  const headers = new Headers({
    'content-type': contentTypeFor(filename, getAsset(sha)?.mimeType ?? null),
    'accept-ranges': 'bytes',
    etag,
    'cache-control': 'no-cache',
  });

  // Revalidation: the hash is the version, so a matching If-None-Match is a 304.
  const inm = request.headers.get('if-none-match');
  if (inm && inm.replace(/^W\//, '').trim() === etag) {
    return new Response(null, { status: 304, headers });
  }

  const disposition = url.searchParams.has('dl') ? 'attachment' : 'inline';
  headers.set('content-disposition', `${disposition}; filename="${filename}"`);

  const total = stat.size;

  // Range request (e.g. seeking an inline-opened MP3). Single range only.
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
      const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
      return new Response(body, { status: 206, headers });
    }
  }

  headers.set('content-length', String(total));
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers });
}
