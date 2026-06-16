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

// Everything we can serve straight from the install-time precache.
const PRECACHE = [...build, ...files];
const PRECACHE_SET = new Set(PRECACHE);

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

/** Cache-first against a named cache; never falls through to network. */
async function fromCache(cacheName: string, request: Request): Promise<Response | undefined> {
  const cache = await caches.open(cacheName);
  return cache.match(request);
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

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline</title><body style="font:16px/1.5 system-ui;padding:2rem;color:#202124;background:#faf8f2">' +
  "<h1>You're offline</h1><p>This page hasn't been saved for offline use. " +
  'Open a gig you downloaded for offline, or reconnect to load it.</p>';

function offlineFallback(): Response {
  return new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // let cross-origin pass through

  // 1) Hashed build assets + static files: cache-first from the shell.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(fromCache(APP_SHELL, request).then((r) => r ?? fetch(request)));
    return;
  }

  // 2) Score pages: cache-first from the durable, user-managed scores cache.
  //    On a miss we go to the network but DO NOT store — only an explicit
  //    download populates this cache, so it never grows from casual browsing.
  if (isRenderRequest(url)) {
    event.respondWith(
      fromCache(SCORES_CACHE, request).then(
        (r) => r ?? fetch(request).catch(() => new Response(null, { status: 504 })),
      ),
    );
    return;
  }

  // 3) Navigations + data loads: network-first, falling back to the cached copy
  //    (a downloaded gig page, or any page visited while online), then a notice.
  if (request.mode === 'navigate' || isDataRequest(url)) {
    event.respondWith(
      networkFirst(PAGES, request).catch(async () => {
        const cached = await caches.match(request);
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
});
