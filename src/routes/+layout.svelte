<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { instrumentSlug, printFormat, score } from '$lib/stores';
  import { instrumentDisplay } from '$lib/format';
  import ScoreOverlay from '$lib/components/ScoreOverlay.svelte';
  import type { Catalog } from '$lib/types';

  let { data, children }: { data: { catalog: Catalog }; children: import('svelte').Snippet } =
    $props();

  const instruments = $derived(data.catalog.instruments ?? []);

  // Default the global instrument to the first one once the catalog is known.
  // A saved (cookie-restored) choice is kept as long as it still exists in the
  // catalog; an empty or stale value falls back to the first instrument.
  $effect(() => {
    if (instruments.length === 0) return;
    if (!instruments.some((i) => i.slug === $instrumentSlug)) {
      instrumentSlug.set(instruments[0].slug);
    }
  });

  const path = $derived(page.url.pathname);
  const overlayOpen = $derived($score != null);
</script>

{#if !overlayOpen}
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
      </div>
    </div>

    <div class="globals">
      <label>
        <span class="eyebrow">Instrument</span>
        <select bind:value={$instrumentSlug}>
          {#each instruments as inst (inst.slug)}
            <option value={inst.slug}>{instrumentDisplay(inst.label, inst.key)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="eyebrow">Format</span>
        <select bind:value={$printFormat}>
          <option value="letter">Letter</option>
          <option value="lyre">Lyre</option>
        </select>
      </label>
    </div>
  </header>

  <nav class="tabs">
    <a href="/" class:active={path === '/'}>Collection</a>
    <a href="/extras" class:active={path.startsWith('/extras')}>Extra Files</a>
    <a href="/gigs" class:active={path.startsWith('/gigs')}>Gig Packets</a>
  </nav>
{/if}

<main class:hidden={overlayOpen}>
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
    gap: 28px;
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

  @media (max-width: 980px) {
    .masthead {
      flex-direction: column;
      align-items: stretch;
    }

    .logo {
      width: 116px;
    }
  }
</style>
