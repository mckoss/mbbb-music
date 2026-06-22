<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { version } from '$app/environment';
  import { goto } from '$app/navigation';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import { instrumentDisplay } from '$lib/format';
  import ScoreOverlay from '$lib/components/ScoreOverlay.svelte';
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
        <p class="version">v {version}</p>
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
      <a href="/admin/users" class:active={path.startsWith('/admin')}>Users</a>
    {/if}
  </nav>
{/if}

<main class:hidden={overlayOpen} class:bare={!authed}>
  {@render children()}
</main>

<ScoreOverlay />

<style>
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
