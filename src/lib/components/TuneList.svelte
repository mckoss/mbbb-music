<script lang="ts">
  import type { Tune } from '$lib/types';
  import { search, selectedSlug, instrumentSlug, score } from '$lib/stores';
  import { activePdf } from '$lib/resolve';
  import { playSha } from '$lib/audio';

  let { tunes }: { tunes: Tune[] } = $props();

  const filtered = $derived(
    $search.trim()
      ? tunes.filter((t) => t.title.toLowerCase().includes($search.trim().toLowerCase()))
      : tunes
  );

  function selectTune(t: Tune) {
    selectedSlug.set(t.slug);
  }

  function openScore(t: Tune) {
    selectedSlug.set(t.slug);
    const active = activePdf(t, $instrumentSlug);
    if (active) score.set({ sha: active.sha, title: t.title, label: active.label });
  }

  function playAudio(t: Tune) {
    selectedSlug.set(t.slug);
    const a = t.audio[0];
    if (a) playSha(a.sha256, t.title);
  }

  function hasPdf(t: Tune): boolean {
    return activePdf(t, $instrumentSlug) != null;
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
      <li class="tile" class:selected={$selectedSlug === t.slug}>
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
    max-height: 68vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
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
