import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeGet,
  cacheFirst,
  staleWhileRevalidate,
  fetchWithTimeout,
  buildRangeResponse,
  bodyChanged,
  isRenderRequest,
  isBlobRequest,
  isDataRequest,
  isAvatarRequest,
  isAlwaysFreshRoute,
  appShellCache,
  pagesCache,
  SCORES_CACHE,
} from '../src/lib/sw-core.js';

// --- Fakes ------------------------------------------------------------------

class FakeCache {
  constructor() {
    this.store = new Map(); // url -> Response
  }
  async match(req, opts) {
    const url = typeof req === 'string' ? req : req.url;
    const hit = this.store.get(url);
    if (hit) return hit.clone();
    if (opts?.ignoreSearch) {
      const base = url.split('?')[0];
      for (const [k, v] of this.store) if (k.split('?')[0] === base) return v.clone();
    }
    return undefined;
  }
  async put(req, res) {
    this.store.set(typeof req === 'string' ? req : req.url, res);
  }
}

class FakeCaches {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async match(req) {
    for (const c of this.caches.values()) {
      const r = await c.match(req);
      if (r) return r;
    }
    return undefined;
  }
}

// A same-origin request stand-in. (Real Request forbids constructing a
// `navigate`-mode request, so route inputs are plain objects with what
// routeGet/strategies actually read: url, mode, headers.)
function req(url, { mode, range } = {}) {
  const headers = new Headers();
  if (range) headers.set('range', range);
  return { url: `https://app.test${url}`, mode, headers };
}

const okFetch = (body, init) => async () => new Response(body, init);
const failFetch = () => {
  throw new Error('fetch should not have been called');
};
// Never resolves on its own; rejects when the timeout aborts it.
const hangingFetch = () => (_request, opts) =>
  new Promise((_resolve, reject) => {
    opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

function makeEnv(over = {}) {
  const waited = [];
  const notified = [];
  const marks = [];
  const env = {
    caches: new FakeCaches(),
    fetch: okFetch('network'),
    waitUntil: (p) => waited.push(Promise.resolve(p).catch(() => {})),
    notifyUpdate: (url) => notified.push(url),
    precache: new Set(),
    version: 'test',
    online: () => true,
    markOffline: () => marks.push('offline'),
    markReachable: () => marks.push('reachable'),
    timeoutMs: 20,
    mediaTimeoutMs: 40,
    offlinePage: (path) => `<offline-page>${path}`,
    ...over,
  };
  return { env, waited, notified, marks };
}
const settle = (waited) => Promise.all(waited);

const SHA = 'a'.repeat(64);

// --- Classification ---------------------------------------------------------

test('request classification matches each resource kind', () => {
  assert.ok(isRenderRequest(new URL(`https://x/render/${SHA}/1.webp`)));
  assert.ok(isBlobRequest(new URL(`https://x/blob/${SHA}`)));
  assert.ok(isDataRequest(new URL('https://x/gigs/a/__data.json')));
  assert.ok(isDataRequest(new URL('https://x/api/catalog')));
  assert.ok(isAvatarRequest(new URL('https://x/members/123/avatar')));
  assert.ok(!isRenderRequest(new URL('https://x/blob/abc')));
  assert.ok(isAlwaysFreshRoute(new URL('https://x/profile')));
  assert.ok(isAlwaysFreshRoute(new URL('https://x/profile/__data.json?email=a')));
  assert.ok(!isAlwaysFreshRoute(new URL('https://x/gigs')));
});

// --- fetchWithTimeout (the linchpin) ----------------------------------------

test('fetchWithTimeout rejects instead of hanging when the network never answers', async () => {
  await assert.rejects(fetchWithTimeout(hangingFetch(), req('/x'), 15));
});

test('fetchWithTimeout enforces the bound even if the fetch ignores abort', async () => {
  // A platform fetch that never settles and does not honor the abort signal.
  const neverSettles = () => new Promise(() => {});
  await assert.rejects(fetchWithTimeout(neverSettles, req('/x'), 15));
});

// --- circuit-breaker feedback ----------------------------------------------

test('a network timeout trips the breaker (markOffline)', async () => {
  const { env, marks } = makeEnv({ fetch: hangingFetch() });
  await cacheFirst(env, SCORES_CACHE, req(`/render/${SHA}/1.webp?r=1`), { store: true });
  assert.deepEqual(marks, ['offline']);
});

test('a reachable server clears the breaker (markReachable)', async () => {
  const { env, marks } = makeEnv({ fetch: okFetch('IMG') });
  await cacheFirst(env, SCORES_CACHE, req(`/render/${SHA}/1.webp?r=1`), { store: true });
  assert.deepEqual(marks, ['reachable']);
});

test('SWR with no cache marks offline when the fetch fails', async () => {
  const { env, marks } = makeEnv({ fetch: hangingFetch() });
  await routeGet(env, req('/gigs/x', { mode: 'navigate' }));
  assert.deepEqual(marks, ['offline']);
});

test('fetchWithTimeout resolves with a prompt response', async () => {
  const res = await fetchWithTimeout(okFetch('hi'), req('/x'), 1000);
  assert.equal(await res.text(), 'hi');
});

// --- cacheFirst (content-addressed) -----------------------------------------

test('cacheFirst serves a hit without touching the network', async () => {
  const { env } = makeEnv({ fetch: failFetch });
  const cache = await env.caches.open(SCORES_CACHE);
  await cache.put(req(`/render/${SHA}/1.webp?r=1`).url, new Response('IMG'));
  const res = await cacheFirst(env, SCORES_CACHE, req(`/render/${SHA}/1.webp?r=1`), { store: true });
  assert.equal(await res.text(), 'IMG');
});

test('cacheFirst on an uncached miss while offline fails fast with 504', async () => {
  const { env } = makeEnv({ fetch: hangingFetch() });
  const res = await cacheFirst(env, SCORES_CACHE, req(`/render/${SHA}/1.webp?r=1`), { store: true });
  assert.equal(res.status, 504); // resolves at all => no 60s hang
});

test('cacheFirst stores a fetched miss when store is set', async () => {
  const { env, waited } = makeEnv({ fetch: okFetch('FRESH') });
  const r = req(`/render/${SHA}/1.webp?r=1`);
  const res = await cacheFirst(env, SCORES_CACHE, r, { store: true });
  assert.equal(await res.text(), 'FRESH');
  await settle(waited);
  const cache = await env.caches.open(SCORES_CACHE);
  assert.equal(await (await cache.match(r)).text(), 'FRESH');
});

test('cacheFirst satisfies a Range request from a cached body with a 206', async () => {
  const { env } = makeEnv({ fetch: failFetch });
  const cache = await env.caches.open(SCORES_CACHE);
  await cache.put(req(`/blob/${SHA}`).url, new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
  const res = await cacheFirst(env, SCORES_CACHE, req(`/blob/${SHA}`, { range: 'bytes=2-5' }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [2, 3, 4, 5]);
});

// --- staleWhileRevalidate (mutable) -----------------------------------------

test('SWR serves the cached page instantly even when the network hangs', async () => {
  const { env } = makeEnv({ fetch: hangingFetch() });
  const cache = await env.caches.open(pagesCache('test'));
  await cache.put(req('/gigs/a').url, new Response('CACHED PAGE'));
  const res = await staleWhileRevalidate(env, pagesCache('test'), req('/gigs/a', { mode: 'navigate' }), {
    ignoreSearch: true,
  });
  assert.equal(await res.text(), 'CACHED PAGE'); // returns before the hung fetch
});

test('SWR navigation with nothing cached and offline returns the offline page with a retry path', async () => {
  const { env } = makeEnv({ fetch: hangingFetch() });
  const res = await routeGet(env, req('/gigs/summer?perform=1', { mode: 'navigate' }));
  // The offline page is handed the exact route so it can offer "try again".
  assert.equal(await res.text(), '<offline-page>/gigs/summer?perform=1');
});

test('SWR navigation follows a redirect instead of serving the offline page', async () => {
  // A navigation request is redirect:"manual", so fetching a route that
  // 3xx-redirects (`/` → `/login` when signed out, `/auth/callback`) yields an
  // opaque-redirect (status 0, !ok) — NOT a throw. The browser must get it to
  // follow the redirect; substituting the offline page locks signed-out users
  // out and the offline page's auto-reload then loops forever.
  // A real Response can't carry status 0, so model the opaque-redirect the way
  // the strategy reads it: status 0, !ok, type 'opaqueredirect'.
  const opaqueRedirect = () => async () => ({
    status: 0,
    ok: false,
    type: 'opaqueredirect',
    text: async () => '',
  });
  const { env, marks } = makeEnv({ fetch: opaqueRedirect() });
  const res = await routeGet(env, req('/', { mode: 'navigate' }));
  assert.equal(res.status, 0); // the redirect is passed through, not swallowed
  assert.ok(!(await res.text()).startsWith('<offline-page>'));
  assert.deepEqual(marks, ['reachable']); // server was reached, breaker not tripped
});

test('SWR navigation passes a 3xx redirect through to the browser', async () => {
  // Same bug class when the platform surfaces the redirect as a real 3xx
  // (rather than an opaque-redirect): it must reach the browser, not become
  // the offline page.
  const redirect303 = () => async () =>
    new Response(null, { status: 303, headers: { location: '/login' } });
  const { env } = makeEnv({ fetch: redirect303() });
  const res = await routeGet(env, req('/', { mode: 'navigate' }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
});

// --- navigator.onLine short-circuit (no waiting when known-offline) ---------

test('known-offline cacheFirst miss returns 504 without touching the network', async () => {
  const { env } = makeEnv({ online: () => false, fetch: failFetch });
  const res = await cacheFirst(env, SCORES_CACHE, req(`/render/${SHA}/1.webp?r=1`), { store: true });
  assert.equal(res.status, 504); // instant — failFetch proves no network attempt
});

test('known-offline navigation goes straight to the offline page, no fetch', async () => {
  const { env } = makeEnv({ online: () => false, fetch: failFetch });
  const res = await routeGet(env, req('/gigs/x', { mode: 'navigate' }));
  assert.equal(await res.text(), '<offline-page>/gigs/x');
});

test('known-offline SWR hit serves cache and skips the background revalidate', async () => {
  const { env, waited } = makeEnv({ online: () => false, fetch: failFetch });
  const cache = await env.caches.open(pagesCache('test'));
  await cache.put(req('/gigs/x').url, new Response('CACHED'));
  const res = await staleWhileRevalidate(env, pagesCache('test'), req('/gigs/x', { mode: 'navigate' }), {
    ignoreSearch: true,
  });
  assert.equal(await res.text(), 'CACHED');
  assert.equal(waited.length, 0); // no revalidate scheduled while offline
});

test('blob requests use the longer media timeout', async () => {
  let usedMs;
  const env = makeEnv({
    fetch: (_req, _opts) => {
      // fetchWithTimeout aborts after the timeout; capture how long it allowed.
      return new Promise((_resolve, reject) => _opts?.signal?.addEventListener('abort', () => reject(new Error('x'))));
    },
  }).env;
  // Patch fetchWithTimeout indirectly: a media miss should not 504 before 40ms.
  const start = Date.now();
  const res = await cacheFirst(env, SCORES_CACHE, req(`/blob/${SHA}`), { timeoutMs: env.mediaTimeoutMs });
  usedMs = Date.now() - start;
  assert.equal(res.status, 504);
  assert.ok(usedMs >= 35, `media miss waited ${usedMs}ms, expected ~40ms`);
});

test('SWR data load with nothing cached and offline returns an empty data shell', async () => {
  const { env } = makeEnv({ fetch: hangingFetch() });
  const res = await routeGet(env, req('/gigs/a/__data.json'));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /"nodes":\[\]/);
});

test('SWR revalidate nudges the page when the data changed', async () => {
  const { env, waited, notified } = makeEnv({ fetch: okFetch('NEW') });
  const cache = await env.caches.open(pagesCache('test'));
  const r = req('/gigs/a/__data.json');
  await cache.put(r.url, new Response('OLD'));
  const res = await routeGet(env, r);
  assert.equal(await res.text(), 'OLD'); // stale served immediately
  await settle(waited);
  assert.deepEqual(notified, [r.url]); // nudge fired
  assert.equal(await (await cache.match(r)).text(), 'NEW'); // cache refreshed
});

test('SWR revalidate caches the fresh copy before nudging', async () => {
  // A list view reacts to the nudge by reloading its data, so the fresh copy
  // must be cached *before* notifyUpdate fires — otherwise the reload re-reads
  // the stale entry. Record the order of the put and the notify and assert it.
  const order = [];
  const { env, waited } = makeEnv({ fetch: okFetch('NEW') });
  const cache = await env.caches.open(pagesCache('test'));
  const realPut = cache.put.bind(cache);
  cache.put = async (...a) => {
    order.push('put');
    return realPut(...a);
  };
  env.notifyUpdate = () => order.push('notify');
  const r = req('/gigs/__data.json');
  await realPut(r.url, new Response('OLD'));
  await routeGet(env, r);
  await settle(waited);
  assert.deepEqual(order, ['put', 'notify']);
});

test('SWR revalidate does not nudge when the data is unchanged', async () => {
  const { env, waited, notified } = makeEnv({ fetch: okFetch('SAME') });
  const cache = await env.caches.open(pagesCache('test'));
  const r = req('/gigs/a/__data.json');
  await cache.put(r.url, new Response('SAME'));
  await routeGet(env, r);
  await settle(waited);
  assert.deepEqual(notified, []);
});

test('SWR keeps data loads for distinct query strings separate (?email=A vs ?email=B)', async () => {
  // The reported bug: opening member B's editor first showed member A's data,
  // because the match ignored the query string and borrowed A's cached entry.
  // Each ?email= target must be its own cache key.
  const byEmail = () => async (request) =>
    new Response(new URL(request.url).searchParams.get('email'));
  const { env, waited } = makeEnv({ fetch: byEmail() });

  const a = await routeGet(env, req('/profile/__data.json?email=A'));
  assert.equal(await a.text(), 'A'); // miss → network → A, cached under ?email=A

  // B has nothing cached and must NOT serve A's entry.
  const b = await routeGet(env, req('/profile/__data.json?email=B'));
  assert.equal(await b.text(), 'B');
  await settle(waited);
});

test('SWR keys ignore SvelteKit transient params so a reload hits the cache', async () => {
  // The client appends ?x-sveltekit-invalidated=… to bust the HTTP cache; it
  // must not fragment ours. A reload carrying it should hit the stored entry
  // (proven by the hanging fetch never being awaited on a hit).
  const { env, waited } = makeEnv({ fetch: hangingFetch() });
  const cache = await env.caches.open(pagesCache('test'));
  await cache.put('https://app.test/gigs/__data.json', new Response('CACHED'));

  const res = await routeGet(env, req('/gigs/__data.json?x-sveltekit-invalidated=01'));
  assert.equal(await res.text(), 'CACHED');
  await settle(waited);
});

test('routeGet serves the profile editor fresh from the network, never cached, no nudge', async () => {
  // The editor must mirror the server. A cached copy (here pretending to be a
  // different member's, or your own) must never be served, and no refresh nudge
  // should fire — you can't edit offline.
  const { env, waited, notified } = makeEnv({ fetch: okFetch('FRESH') });
  const cache = await env.caches.open(pagesCache('test'));
  const url = 'https://app.test/profile/__data.json?email=b@x';
  await cache.put(url, new Response('STALE'));

  const res = await routeGet(env, req('/profile/__data.json?email=b@x'));
  assert.equal(await res.text(), 'FRESH');
  await settle(waited);
  assert.deepEqual(notified, []); // no nudge
  assert.equal(await (await cache.match(url)).text(), 'STALE'); // network copy not cached
});

test('routeGet profile editor offline returns the empty data shell, not stale cache', async () => {
  const { env } = makeEnv({ online: () => false });
  const cache = await env.caches.open(pagesCache('test'));
  await cache.put('https://app.test/profile/__data.json', new Response('STALE'));

  const res = await routeGet(env, req('/profile/__data.json'));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /"nodes":\[\]/);
});

test('routeGet profile editor navigation offline shows the offline page', async () => {
  const { env } = makeEnv({ online: () => false });
  const res = await routeGet(env, req('/profile?email=b@x', { mode: 'navigate' }));
  assert.match(await res.text(), /<offline-page>\/profile/);
});

// --- routeGet dispatch ------------------------------------------------------

test('routeGet serves precached app-shell assets cache-first', async () => {
  const { env } = makeEnv({ fetch: failFetch, precache: new Set(['/_app/immutable/x.js']) });
  const cache = await env.caches.open(appShellCache('test'));
  await cache.put(req('/_app/immutable/x.js').url, new Response('JS'));
  const res = await routeGet(env, req('/_app/immutable/x.js'));
  assert.equal(await res.text(), 'JS');
});

test('routeGet does not auto-store blob bytes on a miss (storage stays explicit)', async () => {
  const { env, waited } = makeEnv({ fetch: okFetch('PDF') });
  const r = req(`/blob/${SHA}`);
  await routeGet(env, r);
  await settle(waited);
  const cache = await env.caches.open(SCORES_CACHE);
  assert.equal(await cache.match(r), undefined); // not cached by casual fetch
});

// --- buildRangeResponse -----------------------------------------------------

const tenBytes = () => new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

test('buildRangeResponse handles open-ended and suffix ranges', async () => {
  const open = await buildRangeResponse(tenBytes(), 'bytes=5-');
  assert.equal(open.headers.get('content-range'), 'bytes 5-9/10');
  assert.deepEqual([...new Uint8Array(await open.arrayBuffer())], [5, 6, 7, 8, 9]);

  const suffix = await buildRangeResponse(tenBytes(), 'bytes=-3');
  assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
  assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())], [7, 8, 9]);
});

test('buildRangeResponse returns 416 for an unsatisfiable range', async () => {
  const res = await buildRangeResponse(tenBytes(), 'bytes=20-30');
  assert.equal(res.status, 416);
});

// --- bodyChanged ------------------------------------------------------------

test('bodyChanged compares response bodies', async () => {
  assert.equal(await bodyChanged(new Response('a'), new Response('b')), true);
  assert.equal(await bodyChanged(new Response('a'), new Response('a')), false);
});
