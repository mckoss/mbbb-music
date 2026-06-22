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

/** The content hash in a `/render/<sha>/…` path, or null if it isn't one. */
export function shaFromRenderPath(pathname: string): string | null {
  return /^\/render\/([a-f0-9]{64})\//.exec(pathname)?.[1] ?? null;
}

// Minimal catalog shapes (a structural subset — both player and server catalogs
// satisfy them). Mirrors the approach in asset-urls.ts.
interface PartLike {
  sha256: string;
  instrumentSlug: string;
  instrument: string | null;
  key: string | null;
  partNumber: number | null;
  partNumbers?: number[];
}
interface AssetLike {
  sha256: string;
  originalName: string | null;
}
interface TuneLike {
  slug: string;
  title: string;
  parts: PartLike[];
  scores: AssetLike[];
  notes: AssetLike[];
}

export interface ShaSong {
  songSlug: string;
  songTitle: string;
  /** A short label for the specific chart this hash is (e.g. "Trumpet (B♭) 2"). */
  label: string;
}

function partLabel(p: PartLike): string {
  const nums = p.partNumbers?.length ? p.partNumbers : p.partNumber != null ? [p.partNumber] : [];
  const numText = nums.length <= 1 ? (nums[0] ?? '') : `${nums.slice(0, -1).join(', ')} & ${nums[nums.length - 1]}`;
  return [p.instrument || p.instrumentSlug, p.key, numText].filter(Boolean).join(' ');
}

/**
 * Map every renderable PDF hash (instrument parts, full scores, notes) to the
 * song it belongs to, so a flat list of cached `/render/<sha>` pages can be
 * grouped and labelled by song. Pure — fed the catalog's tunes.
 */
export function buildShaSongMap(catalog: { tunes: TuneLike[] }): Map<string, ShaSong> {
  const map = new Map<string, ShaSong>();
  for (const t of catalog.tunes) {
    const add = (sha: string, label: string) => {
      if (!map.has(sha)) map.set(sha, { songSlug: t.slug, songTitle: t.title, label });
    };
    for (const p of t.parts) add(p.sha256, partLabel(p));
    t.scores.forEach((s, i) => add(s.sha256, t.scores.length > 1 ? `Full score ${i + 1}` : 'Full score'));
    t.notes.forEach((n, i) => add(n.sha256, t.notes.length > 1 ? `Notes ${i + 1}` : 'Notes'));
  }
  return map;
}
