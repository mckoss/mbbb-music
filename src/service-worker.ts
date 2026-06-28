/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline support for the band's library. The headline use case: walk into a
// gig with no wifi and still pull up the setlist's charts.
//
// The request-routing strategy (and the all-important network timeouts) live in
// the pure, unit-tested src/lib/sw-core.ts; this file is the thin worker shell:
// install/activate of the version caches, the offline activity-POST queue, and
// wiring sw-core to the real Cache API and clients.
//
// Cache layout:
//  - app-shell-<version> : the built JS/CSS/static (hashed → safe cache-first).
//  - pages-<version>     : runtime cache of visited HTML + SvelteKit data loads,
//                          served stale-while-revalidate so launches are instant.
//  - mbbb-scores         : DURABLE, user-managed. Rasterized score pages
//                          (/render/.../*.webp) + page-count sidecars, plus the
//                          /blob/<sha> recordings pulled by an explicit
//                          "Download for offline". Survives version bumps
//                          (content-addressed), managed on the Offline page.
//  - mbbb-offline-meta   : DURABLE. One manifest per downloaded gig.
//  - mbbb-avatars        : roster photos (stale-while-revalidate).
//
// The version-keyed caches bust automatically on every deploy because `version`
// is kit.version.name = package.json version (see svelte.config.js).

import { build, files, version } from '$service-worker';

import { routeGet, appShellCache, pagesCache, type SwEnv } from '$lib/sw-core';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_SHELL = appShellCache(version);
const PAGES = pagesCache(version);
const ACTIVITY_QUEUE = 'mbbb-activity-queue';
const ACTIVITY_QUEUE_LIMIT = 100;

// Network timeout before we fall back to cache / fail fast. We only ever wait
// this long when navigator.onLine claims we're connected but the server is
// unreachable (e.g. a captive portal); a truly offline device skips the wait
// entirely. Standard pages get a short timeout; large media gets a longer one.
const NETWORK_TIMEOUT_MS = 4000;
const MEDIA_TIMEOUT_MS = 30000;

// Everything we can serve straight from the install-time precache.
const PRECACHE = [...build, ...files];
const PRECACHE_SET = new Set(PRECACHE);
let flushingActivity = false;

// The page shown when an uncached route is opened offline. Crucially it is NOT a
// dead end: a standalone Home-Screen app has no browser chrome, so the page must
// carry its own way out — a "Try again" link to the exact route the user wanted,
// links into the cached app, and an auto-reload the moment connectivity returns.
function offlinePage(requestedPath: string): string {
  const href = requestedPath.replace(/&/g, '&amp;').replace(/"/g, '%22').replace(/</g, '%3C');
  const link = 'display:inline-block;margin:6px 8px 6px 0;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700';
  return (
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline</title><body style="font:16px/1.5 system-ui;margin:0;padding:2rem;color:#202124;background:#faf8f2">' +
    "<h1>You're offline</h1>" +
    "<p>This page hasn't been saved for offline use. Try again once you're back online, " +
    'or open a page you’ve already saved.</p>' +
    `<p><a href="${href}" style="${link};background:#164e55;color:#fff">Try again</a>` +
    `<a href="/" style="${link};background:#fff;color:#164e55;border:1px solid #164e55">Home</a>` +
    `<a href="/offline" style="${link};background:#fff;color:#164e55;border:1px solid #164e55">Saved scores</a>` +
    `<a href="/gigs" style="${link};background:#fff;color:#164e55;border:1px solid #164e55">Gig packets</a></p>` +
    "<p id=s style=color:#5f6368;font-size:.85rem>You'll be reconnected automatically when wifi returns.</p>" +
    '<script>addEventListener("online",function(){location.reload()});' +
    'if(navigator.onLine){location.reload()}</script>'
  );
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  // Drop superseded version caches; keep the durable score/meta/avatar caches.
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

function isActivityPost(url: URL, request: Request): boolean {
  return request.method === 'POST' && url.pathname === '/activity';
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

/** Tell every open page that `url` has fresher content (drives the refresh nudge). */
function notifyUpdate(url: string): void {
  void sw.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) client.postMessage({ type: 'content-updated', url });
  });
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

  const env: SwEnv = {
    caches,
    fetch: (req, init) => fetch(req, init),
    waitUntil: (p) => event.waitUntil(p),
    notifyUpdate,
    precache: PRECACHE_SET,
    version,
    online: () => navigator.onLine,
    timeoutMs: NETWORK_TIMEOUT_MS,
    mediaTimeoutMs: MEDIA_TIMEOUT_MS,
    offlinePage,
  };
  event.respondWith(routeGet(env, request));
});

// Lets the page trigger an immediate update after a deploy.
sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') sw.skipWaiting();
  if (event.data?.type === 'flush-activity') event.waitUntil(flushQueuedActivity());
});
