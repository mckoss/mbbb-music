<script lang="ts">
  import '../app.css';
  import { page, navigating, updated } from '$app/state';
  import { browser, version } from '$app/environment';
  import { base } from '$app/paths';
  import { goto, invalidateAll, afterNavigate } from '$app/navigation';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import { instrumentDisplay } from '$lib/format';
  import ScoreOverlay from '$lib/components/ScoreOverlay.svelte';
  import { warmCorePages } from '$lib/offline';
  import { startActivitySync } from '$lib/track';
  import type { Catalog, SessionUser } from '$lib/types';

  let {
    data,
    children,
  }: { data: { catalog: Catalog; user: SessionUser | null }; children: import('svelte').Snippet } =
    $props();

  const user = $derived(data.user ?? null);
  // Only an approved (role-bearing) user sees the app chrome; everyone else
  // (login / pending) gets a bare page.
  const authed = $derived(Boolean(user?.role));
  const isAdmin = $derived(user?.role === 'admin');

  const instruments = $derived(data.catalog.instruments ?? []);

  // Instrument/format live in the cookie-backed stores but can be overridden by
  // the URL (shareable links). Mirror any URL value into the store on navigation.
  $effect(() => {
    const ui = page.url.searchParams.get('instrument');
    if (ui && ui !== $instrumentSlug) instrumentSlug.set(ui);
    const uf = page.url.searchParams.get('format');
    if ((uf === 'letter' || uf === 'lyre') && uf !== $printFormat) printFormat.set(uf);
  });

  // Default the global instrument to the first one once the catalog is known.
  // A saved (cookie-restored) choice is kept as long as it still exists in the
  // catalog; an empty or stale value falls back to the first instrument.
  $effect(() => {
    if (instruments.length === 0) return;
    if (!instruments.some((i) => i.slug === $instrumentSlug)) {
      instrumentSlug.set(instruments[0].slug);
    }
  });

  // A selector change updates the store (persists to cookie) and reflects into
  // the URL (replaceState — shareable, no history churn).
  function setParam(key: string, value: string) {
    const p = new URLSearchParams(page.url.search);
    p.set(key, value);
    goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
  function setInstrument(value: string) {
    instrumentSlug.set(value);
    setParam('instrument', value);
  }
  function setFormat(value: PrintFormat) {
    printFormat.set(value);
    setParam('format', value);
  }

  const path = $derived(page.url.pathname);
  const overlayOpen = $derived(page.url.searchParams.get('view') === 'score');

  let warmedFor = $state<string | null>(null);
  $effect(() => {
    if (!authed || !user?.email || warmedFor === user.email) return;
    warmedFor = user.email;
    startActivitySync();
    void warmCorePages();
  });

  // Refresh nudge. When the service worker's background revalidate finds newer
  // data for the page we're on (or the shared catalog), it posts a message; we
  // surface a small, dismissible prompt rather than swapping content under the
  // user's hands (which matters mid-performance) — tapping it reloads the data.
  let updateReady = $state(false);

  // Does an updated data URL pertain to what we're currently looking at?
  function nudgeRelevant(url: string): boolean {
    try {
      const p = new URL(url, location.origin).pathname;
      if (p === '/api/catalog') return true; // catalog feeds every page
      if (p.endsWith('/__data.json')) {
        const route = p.slice(0, -'/__data.json'.length) || '/';
        return route === page.url.pathname;
      }
    } catch {
      // Malformed URL — ignore.
    }
    return false;
  }

  $effect(() => {
    if (!browser || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'content-updated' && nudgeRelevant(e.data.url)) updateReady = true;
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  });

  // Keep the service worker's connectivity view current. Its own navigator.onLine
  // is unreliable (stuck true on iOS), but the window's online/offline events are
  // dependable — so the SW can serve the offline page instantly instead of
  // waiting out a network timeout.
  $effect(() => {
    if (!browser || !('serviceWorker' in navigator)) return;
    const report = () =>
      navigator.serviceWorker.controller?.postMessage({ type: 'connectivity', online: navigator.onLine });
    report();
    void navigator.serviceWorker.ready.then(report);
    addEventListener('online', report);
    addEventListener('offline', report);
    navigator.serviceWorker.addEventListener('controllerchange', report);
    return () => {
      removeEventListener('online', report);
      removeEventListener('offline', report);
      navigator.serviceWorker.removeEventListener('controllerchange', report);
    };
  });

  // A navigation supersedes any pending nudge for the page we just left.
  let nudgePath = $state('');
  $effect(() => {
    if (page.url.pathname !== nudgePath) {
      nudgePath = page.url.pathname;
      updateReady = false;
    }
  });

  async function applyUpdate() {
    updateReady = false;
    await invalidateAll();
  }

  // App-version update offer. We deliberately don't poll in the background;
  // instead we ask SvelteKit to check the deployed version.json on each
  // client-side navigation (afterNavigate also fires once on first mount). When
  // the running build is behind the deploy, surface an "Update to X.Y.Z" button
  // by the version number. `updated.check()` reports whether a newer build
  // exists; we read version.json for the actual number to show.
  let newVersion = $state<string | null>(null);

  async function checkVersion() {
    if (!browser) return;
    try {
      if (!(await updated.check())) return;
      const res = await fetch(`${base}/_app/version.json`, { cache: 'no-store' });
      if (res.ok) newVersion = (await res.json())?.version ?? null;
    } catch {
      // Offline or fetch failed — leave the offer hidden.
    }
  }
  afterNavigate(() => void checkVersion());

  // Hand off to the new build. The reload MUST run under the new worker, not the
  // old one: navigations are served stale-while-revalidate from a version-scoped
  // `pages-<version>` cache, so reloading while the old worker still controls the
  // page hands back a previously-cached (older) document — the "jumped backwards
  // a version" bug. The new worker's pages cache is empty when it activates, so a
  // reload then fetches the fresh document. It calls clients.claim() on activate,
  // which fires `controllerchange` — that's our signal to reload.
  //
  // Installing the new worker precaches the whole app shell and can take several
  // seconds on a phone; the old code's blind 3s timeout fired mid-install, under
  // the old worker. So we wait for the worker to actually take over instead.
  let reloading = false;
  let updating = $state(false);
  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    location.reload();
  }
  async function applyVersionUpdate() {
    if (!browser || !('serviceWorker' in navigator)) return reloadOnce();
    updating = true;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return reloadOnce();
      // Reload the instant the new worker takes control (see above).
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });

      await reg.update(); // fetch the new worker; it skip-waits on install itself
      const next = reg.waiting ?? reg.installing;
      if (next) {
        // Nudge it to activate as soon as it finishes installing (belt-and-
        // suspenders alongside the worker's own skipWaiting()).
        const activate = () => {
          if (next.state === 'installed') next.postMessage('skip-waiting');
        };
        activate();
        next.addEventListener('statechange', activate);
        // Safety net only — if controllerchange somehow never arrives, reload
        // after a generous wait so the button is never a dead end. Long enough
        // that a real install finishes (and fires controllerchange) first.
        setTimeout(reloadOnce, 15000);
      } else {
        // No pending worker: the active worker is already current, so the page is
        // just stale in memory — reload straight onto it (its cache is fresh).
        reloadOnce();
      }
    } catch {
      reloadOnce();
    }
  }

  // Themed loading indicator for navigations that actually have to wait (a genuine
  // network round-trip). Most navigations are instant (data is already loaded), so
  // only show after a short delay — no flash on quick ones, clear feedback that a
  // tap registered when it isn't, instead of an apparently-dead click.
  let navPending = $state(false);
  $effect(() => {
    if (!browser) return;
    if (!navigating.to) {
      navPending = false;
      return;
    }
    const t = setTimeout(() => (navPending = true), 200);
    return () => clearTimeout(t);
  });
</script>

{#if authed && !overlayOpen}
  <header class="masthead">
    <div class="brand">
      <enhanced:img
        class="logo"
        src="$lib/assets/mbbb-logo.png?w=300"
        alt="Mutiny Bay Brass Band logo"
      />
      <div class="brand-text">
        <p class="eyebrow brand-eyebrow">Mutiny Bay Brass Band</p>
        <h1>Music Portfolio</h1>
        <p class="desc">Browse the music library, choose an instrument and part, and assemble gig packets in set-list order.</p>
        <p class="version">
          v {version}
          {#if newVersion && newVersion !== version}
            <button
              class="update-link"
              onclick={applyVersionUpdate}
              disabled={updating}
              title="A new version is available — tap to reload and update"
            >
              {updating ? 'Updating…' : `Update to ${newVersion}`}
            </button>
          {/if}
        </p>
      </div>
    </div>

    <div class="right">
      <div class="account">
        <span class="who">{user?.email}{#if isAdmin}<span class="badge">admin</span>{/if}</span>
        <form method="POST" action="/auth/logout"><button type="submit" class="signout">Sign out</button></form>
      </div>
      <div class="globals">
        <label>
          <span class="eyebrow">Instrument</span>
          <select value={$instrumentSlug} onchange={(e) => setInstrument(e.currentTarget.value)}>
            {#each instruments as inst (inst.slug)}
              <option value={inst.slug}>{instrumentDisplay(inst.label, inst.key)}</option>
            {/each}
          </select>
        </label>
        <label>
          <span class="eyebrow">Format</span>
          <select value={$printFormat} onchange={(e) => setFormat(e.currentTarget.value as PrintFormat)}>
            <option value="letter">Letter</option>
            <option value="lyre">Lyre</option>
          </select>
        </label>
      </div>
    </div>
  </header>

  <nav class="tabs">
    <a href="/" class:active={path === '/'}>Collection</a>
    <a href="/extras" class:active={path.startsWith('/extras')}>Extra Files</a>
    <a href="/gigs" class:active={path.startsWith('/gigs')}>Gig Packets</a>
    <a href="/offline" class:active={path.startsWith('/offline')}>Offline</a>
    <a href="/library-status" class:active={path.startsWith('/library-status')}>Library Status</a>
    <a href="/members" class:active={path === '/members' || path.startsWith('/members/')}>Members</a>
    <a href="/profile" class:active={path.startsWith('/profile')}>My Profile</a>
    {#if isAdmin}
      <a href="/admin/users" class:active={path.startsWith('/admin/users')}>Users</a>
      <a href="/admin/activity" class:active={path.startsWith('/admin/activity')}>Activity</a>
    {/if}
  </nav>
{/if}

<main class:hidden={overlayOpen} class:bare={!authed}>
  {@render children()}
</main>

{#if navPending}
  <!-- Spinning eighth note: feedback for a navigation that has to wait. -->
  <div class="nav-spinner" role="status" aria-label="Loading">
    <span class="note">♫</span>
  </div>
{/if}

{#if updateReady}
  <!-- Eventually-fresh nudge: sits below the perform/score overlays (z-index
       1000) so it never interrupts a performance; surfaces once they exit. -->
  <div class="update-nudge" role="status">
    <span>Newer content is available.</span>
    <button onclick={applyUpdate}>Refresh</button>
    <button class="dismiss" onclick={() => (updateReady = false)} aria-label="Dismiss">✕</button>
  </div>
{/if}

<ScoreOverlay />

<style>
  .nav-spinner {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 50;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .nav-spinner .note {
    font-size: 1.5rem;
    color: #f2d36b;
    line-height: 1;
    animation: note-spin 0.9s linear infinite;
  }

  @keyframes note-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .update-nudge {
    position: fixed;
    left: 50%;
    bottom: 20px;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    background: #202124;
    color: #fffdf7;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    font-size: 0.85rem;
    max-width: calc(100vw - 32px);
  }

  .update-nudge button {
    min-height: 36px;
    padding: 0 14px;
    border-radius: 6px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .update-nudge .dismiss {
    padding: 0 10px;
    background: transparent;
    border-color: rgba(255, 253, 247, 0.35);
  }

  .masthead {
    background: #050505;
    color: #fffdf7;
    padding: 28px clamp(16px, 4vw, 48px);
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-end;
    justify-content: space-between;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: clamp(14px, 3vw, 28px);
  }

  /* Matches the prototype: scales with the viewport up to 150px, circular with a
     drop shadow. Source emitted at 300px (?w=300) to stay crisp at the 150px
     max on 2× screens. The ≤980px rule below fixes it at 116px. */
  .logo {
    width: clamp(92px, 12vw, 150px);
    height: auto;
    flex: 0 0 auto;
    border-radius: 50%;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.38);
  }

  .brand-eyebrow {
    color: #f2d36b;
  }

  h1 {
    font-size: clamp(2rem, 5vw, 3.5rem);
    line-height: 1.05;
    margin: 6px 0 8px;
  }

  .desc {
    color: #dfddd4;
    font-size: 0.95rem;
    max-width: 46ch;
  }

  .version {
    margin-top: 8px;
    color: #8d8a80;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* New-build offer: brand-gold pill next to the version, distinct from the muted
     version text so it reads as an action. */
  .update-link {
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid #f2d36b;
    background: rgba(242, 211, 107, 0.16);
    color: #f2d36b;
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .update-link:hover {
    background: rgba(242, 211, 107, 0.28);
  }

  .update-link:disabled {
    cursor: progress;
    opacity: 0.7;
  }

  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.82rem;
    color: #dfddd4;
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .badge {
    text-transform: uppercase;
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #050505;
    background: #f2d36b;
    border-radius: 999px;
    padding: 2px 7px;
  }

  .signout {
    min-height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.35);
    background: transparent;
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.76rem;
    cursor: pointer;
  }

  .globals {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }

  .globals label {
    display: inline-flex;
    flex-direction: column;
    gap: 5px;
  }

  .globals span {
    color: #dfddd4;
  }

  .globals select {
    min-height: 44px;
    min-width: 160px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #1a1a1a;
    color: #fffdf7;
    padding: 0 10px;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0 28px;
    padding: 0 clamp(16px, 4vw, 48px);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .tabs a {
    text-decoration: none;
    color: var(--muted);
    font-size: 0.84rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 16px 0;
    border-bottom: 3px solid transparent;
  }

  .tabs a.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }

  main {
    padding: clamp(16px, 3vw, 32px) clamp(16px, 4vw, 48px);
  }

  main.hidden {
    display: none;
  }

  /* Login / pending pages: no chrome, just a centered page. */
  main.bare {
    padding: 0;
  }

  @media (max-width: 980px) {
    .masthead {
      flex-direction: column;
      align-items: stretch;
    }

    .logo {
      width: 116px;
    }
  }

  /* Phones (portrait): let the tab bar wrap to multiple rows instead of running
     off the edge, with tighter spacing so it stays compact. */
  @media (max-width: 600px) {
    .tabs {
      gap: 2px 18px;
      padding: 4px 16px;
    }

    .tabs a {
      padding: 10px 0;
      font-size: 0.76rem;
      letter-spacing: 0.03em;
    }

    /* Keep the masthead within the viewport: let the text column shrink next to
       the logo (min-width:0) and the blurb wrap to the available width instead
       of its 46ch desktop measure, and let the global selectors share the row. */
    .brand-text {
      min-width: 0;
    }

    .desc {
      max-width: none;
    }

    .globals {
      width: 100%;
    }

    .globals label {
      flex: 1 1 0;
      min-width: 0;
    }

    .globals select {
      min-width: 0;
      width: 100%;
    }
  }
</style>
