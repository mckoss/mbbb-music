<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Tune } from '$lib/types';
  import { search, instrumentSlug, printFormat } from '$lib/stores';
  import { activePdf } from '$lib/resolve';
  import { songSearch, scoreSearch } from '$lib/nav';
  import { playSha } from '$lib/audio';
  import { ALL_STATUSES, STATUS_DESC, type SongStatus } from '$lib/song-status';
  import TuneDetail from './TuneDetail.svelte';

  let { tunes, selected }: { tunes: Tune[]; selected: Tune | null } = $props();
  const selectedSlug = $derived(selected?.slug ?? null);

  // Status filter chips. Archived songs are hidden by default; toggle a chip to
  // include/exclude that status. Ephemeral (resets per visit), like the search.
  let show = $state<Record<SongStatus, boolean>>({
    Always: true,
    Active: true,
    Learning: true,
    Archive: false,
    Unfiled: true,
  });

  const filtered = $derived(
    tunes.filter(
      (t) =>
        show[t.status] &&
        (!$search.trim() || t.title.toLowerCase().includes($search.trim().toLowerCase()))
    )
  );

  // Expand the selected song — but only if it's visible under the current filter
  // (e.g. the default selection might be an Archived song that's hidden). Fall
  // back to the first visible song so the list always has one expanded entry.
  const expandedSlug = $derived(
    (filtered.find((t) => t.slug === selectedSlug) ?? filtered[0])?.slug ?? null
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
    <div class="status-filter" role="group" aria-label="Filter by status">
      {#each ALL_STATUSES as s (s)}
        <button
          type="button"
          class="chip"
          class:on={show[s]}
          title={STATUS_DESC[s]}
          aria-pressed={show[s]}
          onclick={() => (show[s] = !show[s])}
        >{s}</button>
      {/each}
    </div>
  </header>

  <ul class="tiles">
    {#each filtered as t (t.slug)}
      {#if expandedSlug === t.slug}
        <!-- The selected song expands in place: TuneDetail carries the title,
             score image, part/format pickers, Open Score and the inline player —
             replacing the old side panel. -->
        <li class="tile selected">
          <TuneDetail tune={t} instrumentSlug={$instrumentSlug} printFormat={$printFormat} />
        </li>
      {:else}
        <li class="tile">
          <button class="title" onclick={() => selectTune(t)}>{t.title}</button>
          <div class="actions">
            <button class="act" onclick={() => openScore(t)} disabled={!hasPdf(t)}>Score</button>
            <button class="act" onclick={() => playAudio(t)} disabled={t.audio.length === 0}>
              Audio
            </button>
          </div>
        </li>
      {/if}
    {/each}
    {#if filtered.length === 0}
      <li class="empty">
        {tunes.length === 0 ? 'No music in the library yet.' : `No titles match “${$search}”.`}
      </li>
    {/if}
  </ul>
</section>

<style>
  /* No card: the list sits directly on the page background (the old outer panel
     dissolved). The page scrolls naturally so a selected song can expand in
     place without an inner scroll region fighting the document. */
  .list-pane {
    display: flex;
    flex-direction: column;
    gap: 14px;
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

  .status-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .chip {
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.76rem;
    font-weight: 600;
    background: var(--paper);
    color: var(--muted);
    cursor: pointer;
  }

  .chip.on {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: #fffdf7;
  }

  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* A compact, clickable row for an unselected song. */
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

  /* The selected song is bare: TuneDetail's own card provides the chrome, so it
     reads as the expanded item. A little vertical breathing room sets it apart. */
  .tile.selected {
    display: block;
    border: 0;
    background: transparent;
    padding: 0;
    margin: 6px 0;
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
