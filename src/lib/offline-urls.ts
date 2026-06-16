// Pure URL/manifest helpers for offline gig downloads. Kept free of `$app`/Cache
// APIs so they can be unit-tested directly (see test/offline.test.js); the
// browser-facing wrapper lives in offline.ts.

import { RENDER_REV } from './render-rev.js';

export interface GigManifest {
  gigId: string;
  title: string;
  instrument: string;
  format: string;
  /** Every URL cached for this gig (page, data, score info + pages). */
  urls: string[];
  pageCount: number;
  savedAt: string;
}

/** The render URLs for one score: its page-count sidecar + every page image. */
export function scoreUrls(sha: string, pages: number, rev: number = RENDER_REV): string[] {
  const urls = [`/render/${sha}/info`];
  for (let n = 1; n <= pages; n++) urls.push(`/render/${sha}/${n}.webp?r=${rev}`);
  return urls;
}

/** SvelteKit page + data URLs so the gig opens offline as a hard load. */
export function gigPageUrls(gigId: string): string[] {
  const id = encodeURIComponent(gigId);
  return [`/gigs/${id}`, `/gigs/${id}/__data.json`];
}

/**
 * Which of a removed gig's URLs are safe to delete: those not referenced by any
 * other still-downloaded gig (shared score pages must survive). Pure set math.
 */
export function urlsToDelete(target: GigManifest, others: GigManifest[]): string[] {
  const keep = new Set<string>();
  for (const m of others) for (const u of m.urls) keep.add(u);
  return target.urls.filter((u) => !keep.has(u));
}
