/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline support for the band's library. The headline use case: walk into a
// gig with no wifi and still pull up the setlist's charts.
//
// Cache layout (see also src/lib/offline.ts, which fills the durable caches):
//  - app-shell-<version> : the built JS/CSS/static (hashed → safe cache-first).
//  - pages-<version>     : runtime cache of visited HTML + SvelteKit data loads,
//                          so a hard reload / Home-Screen launch works offline.
//  - mbbb-scores         : DURABLE, user-managed. Rasterized score pages
//                          (/render/.../*.webp) + page-count sidecars, populated
//                          only by an explicit "Download for offline" — never by
//                          casual browsing, so storage stays under the user's
//                          control. Survives version bumps (content-addressed).
//  - mbbb-offline-meta   : DURABLE. One manifest per downloaded gig.
//
// The version-keyed caches bust automatically on every deploy because `version`
// is kit.version.name = package.json version (see svelte.config.js).

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_SHELL = `app-shell-${version}`;
const PAGES = `pages-${version}`;
export const SCORES_CACHE = 'mbbb-scores';
export const META_CACHE = 'mbbb-offline-meta';
export const AVATARS_CACHE = 'mbbb-avatars';
const ACTIVITY_QUEUE = 'mbbb-activity-queue';
const ACTIVITY_QUEUE_LIMIT = 100;

// Everything we can serve straight from the install-time precache.
const PRECACHE = [...build, ...files];
const PRECACHE_SET = new Set(PRECACHE);
let flushingActivity = false;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  // Drop superseded version caches; keep the durable score/meta caches.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => (k.startsWith('app-shell-') || k.startsWith('pages-')) && k !== APP_SHELL && k !== PAGES)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

function isRenderRequest(url: URL): boolean {
  return url.pathname.startsWith('/render/');
}

function isDataRequest(url: URL): boolean {
  // SvelteKit client-side load data, plus the catalog endpoint.
  return url.pathname.endsWith('/__data.json') || url.pathname === '/api/catalog';
}

function isAvatarRequest(url: URL): boolean {
  return url.pathname.startsWith('/members/') && url.pathname.endsWith('/avatar');
}

function isActivityPost(url: URL, request: Request): boolean {
  return request.method === 'POST' && url.pathname === '/activity';
}

/** Cache-first against a named cache; never falls through to network. */
async function fromCache(cacheName: string, request: Request): Promise<Response | undefined> {
  const cache = await caches.open(cacheName);
  return cache.match(request);
}

/**
 * Cache-first, but populate on a miss: serve the stored copy if present, else
 * fetch and store it. This is what makes any score you *view* available offline
 * automatically. A failed network fetch (offline, uncached) yields a 504.
 */
async function cacheFirstStore(cacheName: string, request: Request): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return new Response(null, { status: 504 });
  }
}

/** Network-first; store a successful copy in `cacheName`, else fall back to it. */
async function networkFirst(cacheName: string, request: Request): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** Match an offline page/data load, allowing query-string variants of the same page. */
async function matchPage(cacheName: string, request: Request): Promise<Response | undefined> {
  const cache = await caches.open(cacheName);
  return (await cache.match(request)) ?? (await cache.match(request, { ignoreSearch: true }));
}

async function queueActivity(request: Request): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    const parsed = await request.clone().json();
    if (!parsed || typeof parsed !== 'object') return;
    payload = parsed as Record<string, unknown>;
  } catch {
    return;
  }

  const queued = {
    ...payload,
    at: typeof payload.at === 'string' ? payload.at : new Date().toISOString(),
    replayedFromOffline: true,
  };
  const cache = await caches.open(ACTIVITY_QUEUE);
  const key = new Request(`/_activity-queue/${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await cache.put(key, new Response(JSON.stringify(queued), { headers: { 'content-type': 'application/json' } }));

  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - ACTIVITY_QUEUE_LIMIT)).map((old) => cache.delete(old)));
}

async function flushQueuedActivity(): Promise<void> {
  if (flushingActivity) return;
  flushingActivity = true;
  try {
    const cache = await caches.open(ACTIVITY_QUEUE);
    const keys = await cache.keys();
    for (const key of keys) {
      const hit = await cache.match(key);
      if (!hit) {
        await cache.delete(key);
        continue;
      }
      const payload = await hit.json();
      const res = await fetch('/activity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, replayedFromOffline: true }),
      });
      if (!res.ok) break;
      await cache.delete(key);
    }
  } catch {
    // Still offline or the server is unavailable; keep queued items for later.
  } finally {
    flushingActivity = false;
  }
}

async function handleActivityPost(request: Request): Promise<Response> {
  try {
    const res = await fetch(request.clone());
    if (res.ok) void flushQueuedActivity();
    return res;
  } catch {
    await queueActivity(request);
    return new Response(null, { status: 202 });
  }
}

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline</title><body style="font:16px/1.5 system-ui;padding:2rem;color:#202124;background:#faf8f2">' +
  "<h1>You're offline</h1><p>This page hasn't been saved for offline use. " +
  'Open the saved Offline page or a downloaded gig, or reconnect to load it.</p>';

function offlineFallback(): Response {
  return new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // let cross-origin pass through

  if (isActivityPost(url, request)) {
    event.respondWith(handleActivityPost(request));
    return;
  }

  if (request.method !== 'GET') return;

  // 1) Hashed build assets + static files: cache-first from the shell.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(fromCache(APP_SHELL, request).then((r) => r ?? fetch(request)));
    return;
  }

  // 2) Score pages: cache-first, and store on a miss — so anything you view is
  //    saved offline automatically. Growth is bounded by the library's scores
  //    and managed on the Offline page (per-song eject + clear-all).
  if (isRenderRequest(url)) {
    event.respondWith(cacheFirstStore(SCORES_CACHE, request));
    return;
  }

  // 2b) Member avatars: same-origin image bytes (external sources are cached
  //     server-side). Network-first into a durable cache so a roster viewed
  //     online stays available offline; an updated photo refreshes when online.
  if (isAvatarRequest(url)) {
    event.respondWith(networkFirst(AVATARS_CACHE, request));
    return;
  }

  // 3) Navigations + data loads: network-first, falling back to the cached copy
  //    (a downloaded gig page, or any page visited while online), then a notice.
  if (request.mode === 'navigate' || isDataRequest(url)) {
    event.respondWith(
      networkFirst(PAGES, request).catch(async () => {
        const cached = await matchPage(PAGES, request);
        if (cached) return cached;
        if (request.mode === 'navigate') return offlineFallback();
        return new Response('{"type":"data","nodes":[]}', {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    return;
  }

  // 4) Anything else: cache if we have it, otherwise network.
  event.respondWith(caches.match(request).then((r) => r ?? fetch(request)));
});

// Lets the page trigger an immediate update after a deploy.
sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') sw.skipWaiting();
  if (event.data?.type === 'flush-activity') event.waitUntil(flushQueuedActivity());
});
