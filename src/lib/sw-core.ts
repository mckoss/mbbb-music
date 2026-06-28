// Pure, dependency-injected request-routing core for the service worker. The
// actual worker (src/service-worker.ts) is hard to unit-test because it imports
// the build-only `$service-worker` module and runs in a ServiceWorkerGlobalScope;
// the interesting logic — *when* we touch the network and *how long* we wait —
// lives here instead, against injected `fetch`/`caches`, so it's covered by
// test/sw-core.test.js.
//
// Strategy, by resource kind:
//  - Content-addressed (app shell, /render/<sha>/…, /blob/<sha>): cache-first and
//    NEVER revalidate — a hit is, by construction, the exact bytes wanted. The
//    only network touch is a cache *miss*, and that fetch is timeout-bounded so an
//    uncached resource offline fails fast (504) instead of hanging on the iOS
//    connection timeout (~60s) — the bug that made offline launches "blank for a
//    minute".
//  - Mutable (navigations, /__data.json, /api/catalog, avatars): stale-while-
//    revalidate — serve the cached copy instantly, refresh in the background.
//    The network is never on the path to first paint for anything seen before.
//    When a background refresh of a data load comes back *changed*, we ping the
//    page so it can offer a "refresh" nudge (eventually-fresh, user-controlled).

/** A structural subset of the Cache API we depend on (real or faked in tests). */
export interface CacheLike {
  match(request: Request | string, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  match(request: Request | string): Promise<Response | undefined>;
}

/** Everything the router needs from its environment, all injectable for tests. */
export interface SwEnv {
  caches: CacheStorageLike;
  fetch: (request: Request, init?: { signal?: AbortSignal }) => Promise<Response>;
  /** Keep the worker alive for background work (event.waitUntil); no-op-safe. */
  waitUntil: (p: Promise<unknown>) => void;
  /** Notify open pages that `url` has newer content (drives the refresh nudge). */
  notifyUpdate: (url: string) => void;
  /** Pathnames served straight from the install-time precache (app shell). */
  precache: Set<string>;
  version: string;
  /**
   * Best-effort connectivity check (navigator.onLine). Trusted only in the
   * negative: `false` means definitely offline, so we skip the network entirely
   * and fall back instantly. `true` can lie (captive portal) — there the timeout
   * still guards us.
   */
  online: () => boolean;
  /** Network timeout (ms) for standard pages/data before we fall back. */
  timeoutMs: number;
  /** Longer timeout (ms) for large media blobs, which can legitimately be slow. */
  mediaTimeoutMs: number;
  /** HTML for an uncached navigation while offline. Given the requested path so
   *  the page can offer a "try again" link back to exactly where the user was. */
  offlinePage: (requestedPath: string) => string;
}

export const appShellCache = (version: string) => `app-shell-${version}`;
export const pagesCache = (version: string) => `pages-${version}`;
export const SCORES_CACHE = 'mbbb-scores';
export const AVATARS_CACHE = 'mbbb-avatars';

// --- Request classification -------------------------------------------------

export function isRenderRequest(url: URL): boolean {
  return url.pathname.startsWith('/render/');
}
export function isBlobRequest(url: URL): boolean {
  // Content-addressed blob bytes: full-score PDFs and audio recordings.
  return url.pathname.startsWith('/blob/');
}
export function isDataRequest(url: URL): boolean {
  // SvelteKit client-side load data, plus the catalog endpoint.
  return url.pathname.endsWith('/__data.json') || url.pathname === '/api/catalog';
}
export function isAvatarRequest(url: URL): boolean {
  return url.pathname.startsWith('/members/') && url.pathname.endsWith('/avatar');
}

// --- Primitives -------------------------------------------------------------

/**
 * `fetch` that rejects (and aborts the request) after `ms`. This is the linchpin
 * fix: a bare `await fetch()` to an unreachable origin doesn't reject promptly on
 * iOS/WebKit — it waits out the OS connection timeout. Bounding it ourselves lets
 * us fall back to cache in seconds, not a minute.
 */
export function fetchWithTimeout(
  fetchFn: SwEnv['fetch'],
  request: Request,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetchFn(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/** True when two responses carry different bodies (drives the refresh nudge). */
export async function bodyChanged(a: Response, b: Response): Promise<boolean> {
  try {
    const [ta, tb] = await Promise.all([a.clone().text(), b.clone().text()]);
    return ta !== tb;
  } catch {
    return false;
  }
}

/**
 * Build a 206 Partial Content response from a fully-cached body for a `Range`
 * request. iOS Safari plays cached audio via Range requests and rejects a plain
 * 200 from the Cache API for media — so downloaded recordings only play offline
 * if we satisfy the range ourselves.
 */
export async function buildRangeResponse(full: Response, rangeHeader: string): Promise<Response> {
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return full;
  const buf = await full.clone().arrayBuffer();
  const size = buf.byteLength;

  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: bytes=-N → the last N bytes.
    const n = m[2] === '' ? 0 : Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }

  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const headers = new Headers(full.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers,
  });
}

// --- Strategies -------------------------------------------------------------

interface CacheFirstOpts {
  /** Persist a successful network response on a cache miss (score pages do; the
   *  app shell and downloaded blobs are pre-populated, so they don't). */
  store?: boolean;
  /** Override the network timeout for this request (e.g. longer for media). */
  timeoutMs?: number;
}

/**
 * Content-addressed: return the cached copy (honoring a Range request), and only
 * touch the network on a miss. When known-offline we skip the network entirely
 * (instant 504); otherwise the fetch is timeout-bounded. Never revalidates a hit.
 */
export async function cacheFirst(
  env: SwEnv,
  cacheName: string,
  request: Request,
  opts: CacheFirstOpts = {},
): Promise<Response> {
  const cache = await env.caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    const range = request.headers.get('range');
    return range ? buildRangeResponse(hit, range) : hit;
  }
  if (!env.online()) return new Response(null, { status: 504 });
  try {
    const res = await fetchWithTimeout(env.fetch, request, opts.timeoutMs ?? env.timeoutMs);
    if (opts.store && res.ok) env.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch {
    return new Response(null, { status: 504 });
  }
}

interface SwrOpts {
  /** Ping the page when a background refresh returns changed content. */
  notify?: boolean;
  /** Also match cached entries ignoring the query string (page/data variants). */
  ignoreSearch?: boolean;
  /** Response when nothing is cached and the network is unavailable. */
  fallback?: () => Response;
}

/**
 * Mutable: serve the cached copy immediately and revalidate in the background
 * (eventually-fresh). With nothing cached, await a timeout-bounded fetch, then
 * the fallback. The network never blocks first paint for a resource seen before.
 */
export async function staleWhileRevalidate(
  env: SwEnv,
  cacheName: string,
  request: Request,
  opts: SwrOpts = {},
): Promise<Response> {
  const cache = await env.caches.open(cacheName);
  const hit =
    (await cache.match(request)) ??
    (opts.ignoreSearch ? await cache.match(request, { ignoreSearch: true }) : undefined);
  const fallback = () => (opts.fallback ? opts.fallback() : new Response(null, { status: 504 }));

  // Known-offline: don't wait on a fetch that can't succeed — serve cache or fall
  // back immediately (and skip the pointless background revalidate on a hit).
  if (!env.online()) return hit ?? fallback();

  const hitForCompare = opts.notify && hit ? hit.clone() : null;
  const revalidate = (async (): Promise<Response | undefined> => {
    try {
      const res = await fetchWithTimeout(env.fetch, request, env.timeoutMs);
      if (res.ok) {
        if (hitForCompare && (await bodyChanged(hitForCompare, res))) env.notifyUpdate(request.url);
        await cache.put(request, res.clone());
      }
      return res;
    } catch {
      return undefined;
    }
  })();

  if (hit) {
    env.waitUntil(revalidate);
    return hit;
  }

  const res = await revalidate;
  if (res && res.ok) return res;
  return fallback();
}

/** Last-resort: serve from any cache, else a timeout-bounded network fetch. */
async function cacheAnyFirst(env: SwEnv, request: Request): Promise<Response> {
  const hit = await env.caches.match(request);
  if (hit) return hit;
  if (!env.online()) return new Response(null, { status: 504 });
  try {
    return await fetchWithTimeout(env.fetch, request, env.timeoutMs);
  } catch {
    return new Response(null, { status: 504 });
  }
}

const emptyDataResponse = () =>
  new Response('{"type":"data","nodes":[]}', {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Route a same-origin GET to its strategy. The caller has already handled
 * cross-origin, non-GET, and the activity POST queue.
 */
export function routeGet(env: SwEnv, request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Content-addressed → cache-first, no revalidation.
  if (env.precache.has(url.pathname)) {
    return cacheFirst(env, appShellCache(env.version), request);
  }
  if (isRenderRequest(url)) {
    // Store on view: anything you open is then available offline.
    return cacheFirst(env, SCORES_CACHE, request, { store: true });
  }
  if (isBlobRequest(url)) {
    // PDFs/recordings: served from cache when downloaded; not stored on casual
    // view, so the durable cache stays under the user's explicit control. These
    // can be large, so a slow-but-live download gets a longer timeout.
    return cacheFirst(env, SCORES_CACHE, request, { timeoutMs: env.mediaTimeoutMs });
  }

  // Mutable → stale-while-revalidate.
  if (isAvatarRequest(url)) {
    return staleWhileRevalidate(env, AVATARS_CACHE, request);
  }
  if (request.mode === 'navigate' || isDataRequest(url)) {
    const navigation = request.mode === 'navigate';
    return staleWhileRevalidate(env, pagesCache(env.version), request, {
      ignoreSearch: true,
      notify: isDataRequest(url),
      fallback: navigation
        ? () =>
            new Response(env.offlinePage(url.pathname + url.search), {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            })
        : emptyDataResponse,
    });
  }

  return cacheAnyFirst(env, request);
}
