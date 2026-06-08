<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Tune } from '$lib/types';
  import { search, instrumentSlug, printFormat } from '$lib/stores';
  import { activePdf } from '$lib/resolve';
  import { songSearch, scoreSearch } from '$lib/nav';
  import { playSha } from '$lib/audio';

  let { tunes, selectedSlug }: { tunes: Tune[]; selectedSlug: string | null } = $props();

  const filtered = $derived(
    $search.trim()
      ? tunes.filter((t) => t.title.toLowerCase().includes($search.trim().toLowerCase()))
      : tunes
  );

  // Selecting a song updates the URL (?song=<slug>), adding a history entry so
  // Back/Forward move between songs and the choice survives a refresh.
  function selectTune(t: Tune) {
    if (t.slug === selectedSlug) return; // no-op: avoid a duplicate history entry
    goto(songSearch(page.url.searchParams, t.slug), { keepFocus: true, noScroll: true });
  }

  function openScore(t: Tune) {
    const active = activePdf(t, $instrumentSlug, $printFormat);
    if (!active) return;
    goto(
      scoreSearch({
        song: t.slug,
        instrument: $instrumentSlug,
        format: $printFormat,
        part: active.isScore ? null : active.partNumber,
      }),
      { keepFocus: true, noScroll: true }
    );
  }

  function playAudio(t: Tune) {
    selectTune(t);
    const a = t.audio[0];
    if (a) playSha(a.sha256, t.title);
  }

  function hasPdf(t: Tune): boolean {
    return activePdf(t, $instrumentSlug, $printFormat) != null;
  }
</script>

<section class="list-pane">
  <header>
    <h2>Complete Collection</h2>
    <p class="count">{filtered.length} of {tunes.length} titles</p>
    <input
      class="search"
      type="search"
      placeholder="Search titles…"
      bind:value={$search}
      aria-label="Search titles"
    />
  </header>

  <ul class="tiles">
    {#each filtered as t (t.slug)}
      <li class="tile" class:selected={selectedSlug === t.slug}>
        <button class="title" onclick={() => selectTune(t)}>{t.title}</button>
        <div class="actions">
          <button class="act" onclick={() => openScore(t)} disabled={!hasPdf(t)}>Score</button>
          <button class="act" onclick={() => playAudio(t)} disabled={t.audio.length === 0}>
            Audio
          </button>
        </div>
      </li>
    {/each}
    {#if filtered.length === 0}
      <li class="empty">No titles match “{$search}”.</li>
    {/if}
  </ul>
</section>

<style>
  .list-pane {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    /* Pin the list and bound it to the viewport so a long catalog scrolls
       inside the pane (instead of leaving the card over-tall) while the detail
       pane drives the page scroll. */
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
  }

  h2 {
    font-size: 1.1rem;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .search {
    width: 100%;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 12px;
    background: var(--paper);
    color: var(--ink);
  }

  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    /* Fill the remaining pane height and scroll internally (min-height:0 lets a
       flex child shrink below its content so overflow-y actually kicks in). */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* On a stacked (single-column) layout, don't pin the list to the viewport —
     let it sit in normal flow with a sensible cap so it doesn't fill the screen. */
  @media (max-width: 980px) {
    .list-pane {
      position: static;
      max-height: none;
    }

    .tiles {
      flex: none;
      max-height: 60vh;
    }
  }

  .tile {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 8px 4px 12px;
    background: var(--panel);
  }

  .tile.selected {
    background: #edf4f3;
    border-color: var(--accent);
  }

  .title {
    flex: 1;
    text-align: left;
    border: 0;
    background: none;
    color: var(--ink);
    font-size: 0.84rem;
    font-weight: 600;
    padding: 8px 0;
    min-height: 44px;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .act {
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #f7f5ef;
    color: var(--accent-strong);
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .act:disabled {
    color: var(--muted);
    background: var(--paper);
    cursor: not-allowed;
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 12px;
  }
</style>
