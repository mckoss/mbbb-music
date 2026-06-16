<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog } from '$lib/types';
  import { instrumentSlug, printFormat } from '$lib/stores';
  import { scoreSearch } from '$lib/nav';
  import {
    listCachedScores,
    ejectShas,
    clearCachedScores,
    storageEstimate,
    type CachedSong,
  } from '$lib/offline';

  const catalog = $derived(page.data.catalog as Catalog);

  let songs = $state<CachedSong[]>([]);
  let usage = $state<{ usage: number; quota: number } | null>(null);
  let loaded = $state(false);
  let supported = $state(true);

  async function refresh() {
    if (typeof caches === 'undefined') {
      supported = false;
      loaded = true;
      return;
    }
    songs = await listCachedScores(catalog);
    usage = await storageEstimate();
    loaded = true;
  }

  // Reload whenever we land here (and after the catalog is ready).
  $effect(() => {
    void catalog;
    void refresh();
  });

  const totalPages = $derived(songs.reduce((n, s) => n + s.pages, 0));
  const totalBytes = $derived(songs.reduce((n, s) => n + s.bytes, 0));

  async function eject(s: CachedSong) {
    await ejectShas(s.shas);
    await refresh();
  }

  async function clearAll() {
    if (!confirm('Remove all saved scores from this device?')) return;
    await clearCachedScores();
    await refresh();
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Link a cached song back to its score view, in the current instrument/format.
  const openHref = (slug: string) =>
    '/' + scoreSearch({ song: slug, instrument: $instrumentSlug, format: $printFormat });
</script>

<section class="offline">
  <header>
    <p class="kicker">Offline</p>
    <h2>Saved scores</h2>
    <p class="body">
      Every score you open is saved on this device automatically, so it's there
      with no wifi. Manage what's kept below.
      <strong>Tip:</strong> add this app to your Home Screen so saved scores aren't
      cleared after a week of not opening it.
    </p>
    {#if usage}
      <p class="usage">
        Using {fmtBytes(usage.usage)}{usage.quota ? ` of ~${fmtBytes(usage.quota)} available` : ''} on this
        device.
      </p>
    {/if}
  </header>

  {#if !supported}
    <p class="empty">This browser doesn't support offline storage.</p>
  {:else if loaded && songs.length === 0}
    <p class="empty">No saved scores yet — open a score and it'll be saved here.</p>
  {:else if songs.length > 0}
    <div class="summary">
      <span>{songs.length} song{songs.length === 1 ? '' : 's'} · {totalPages} page{totalPages === 1 ? '' : 's'} · {fmtBytes(totalBytes)}</span>
      <button class="clear" onclick={clearAll}>Clear all</button>
    </div>
    <ul class="list">
      {#each songs as s (s.songSlug)}
        <li class="row">
          <div class="meta">
            {#if s.songSlug !== 'other'}
              <a class="title" href={openHref(s.songSlug)}>{s.songTitle}</a>
            {:else}
              <span class="title">{s.songTitle}</span>
            {/if}
            <span class="sub">{s.pages} page{s.pages === 1 ? '' : 's'} · {fmtBytes(s.bytes)}</span>
          </div>
          <button class="eject" onclick={() => eject(s)}>Eject</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .offline {
    max-width: 760px;
    margin: 0 auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: var(--accent-strong);
    font-weight: 700;
  }

  .body {
    color: var(--muted);
    max-width: 65ch;
  }

  .usage {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.85rem;
    color: var(--muted);
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }

  .clear {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid #b3261e;
    border-radius: 6px;
    background: transparent;
    color: #b3261e;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
  }

  .meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-weight: 700;
    color: var(--ink);
    text-decoration: none;
  }

  a.title:hover {
    text-decoration: underline;
    color: var(--accent-strong);
  }

  .sub {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .eject {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    color: var(--accent-strong);
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .empty {
    color: var(--muted);
    padding: 16px;
    text-align: center;
  }
</style>
