// Client-side "Download for offline" for gig setlists. Scores only (per the
// feature scope): the rasterized chart pages for each song, plus the gig page
// and its data, stored in the durable caches the service worker reads.
//
// The Cache API work is thin; the interesting logic (URL building, refcounted
// removal) is pure and unit-tested in test/offline.test.js.

import { browser } from '$app/environment';

import { scoreUrls, gigPageUrls, urlsToDelete, type GigManifest } from './offline-urls';

export { scoreUrls, gigPageUrls, urlsToDelete, type GigManifest };

// Must match the names in src/service-worker.ts.
const SCORES_CACHE = 'mbbb-scores';
const META_CACHE = 'mbbb-offline-meta';

// Synthetic request key under which a gig's manifest is parked in META_CACHE.
const metaKey = (gigId: string) => `/_offline-meta/${encodeURIComponent(gigId)}`;

// --- Cache-backed operations -----------------------------------------------

function available(): boolean {
  return browser && typeof caches !== 'undefined';
}

/** All downloaded-gig manifests, newest first. */
export async function listDownloaded(): Promise<GigManifest[]> {
  if (!available()) return [];
  const cache = await caches.open(META_CACHE);
  const reqs = await cache.keys();
  const out: GigManifest[] = [];
  for (const req of reqs) {
    const res = await cache.match(req);
    if (res) out.push((await res.json()) as GigManifest);
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function isDownloaded(gigId: string): Promise<boolean> {
  if (!available()) return false;
  const cache = await caches.open(META_CACHE);
  return (await cache.match(metaKey(gigId))) != null;
}

/** The stored manifest for a gig, or null if it isn't downloaded. */
export async function getManifest(gigId: string): Promise<GigManifest | null> {
  if (!available()) return null;
  const cache = await caches.open(META_CACHE);
  const res = await cache.match(metaKey(gigId));
  return res ? ((await res.json()) as GigManifest) : null;
}

export interface DownloadProgress {
  done: number;
  total: number;
}

/**
 * Cache a gig's charts for offline use. `shas` are the resolved score hashes
 * for the chosen instrument/format. Reports progress as pages are fetched.
 */
export async function downloadGig(
  gig: { id: string; title: string; instrument: string; format: string; shas: string[] },
  onProgress?: (p: DownloadProgress) => void,
): Promise<GigManifest> {
  if (!available()) throw new Error('Offline storage is not available in this browser.');

  // Resolve each score's page count, then expand to its render URLs.
  const perScore = await Promise.all(
    gig.shas.map(async (sha) => {
      const res = await fetch(`/render/${sha}/info`);
      if (!res.ok) throw new Error(`Could not read score ${sha.slice(0, 8)} (${res.status}).`);
      const { pages } = (await res.json()) as { pages: number };
      return scoreUrls(sha, pages);
    }),
  );

  const renderUrls = perScore.flat();
  const pageUrls = gigPageUrls(gig.id);
  const allUrls = [...pageUrls, ...renderUrls];
  const pageCount = renderUrls.filter((u) => u.includes('.webp')).length;

  const cache = await caches.open(SCORES_CACHE);
  let done = 0;
  const total = allUrls.length;
  onProgress?.({ done, total });

  // Sequential keeps the progress meaningful and is gentle on a phone radio.
  for (const url of allUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res.clone());
    } catch {
      // A single missing page shouldn't abort the whole gig; the page just
      // won't be available offline. (Surfaced via the page count if needed.)
    }
    onProgress?.({ done: ++done, total });
  }

  const manifest: GigManifest = {
    gigId: gig.id,
    title: gig.title,
    instrument: gig.instrument,
    format: gig.format,
    urls: allUrls,
    pageCount,
    savedAt: new Date().toISOString(),
  };
  const meta = await caches.open(META_CACHE);
  await meta.put(
    metaKey(gig.id),
    new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }),
  );
  return manifest;
}

/** Remove a downloaded gig, keeping score pages shared with other gigs. */
export async function removeGig(gigId: string): Promise<void> {
  if (!available()) return;
  const meta = await caches.open(META_CACHE);
  const res = await meta.match(metaKey(gigId));
  if (!res) return;
  const target = (await res.json()) as GigManifest;

  const others = (await listDownloaded()).filter((m) => m.gigId !== gigId);
  const scores = await caches.open(SCORES_CACHE);
  for (const url of urlsToDelete(target, others)) await scores.delete(url);
  await meta.delete(metaKey(gigId));
}

/** Rough storage usage (bytes used / quota), when the browser exposes it. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!available() || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
