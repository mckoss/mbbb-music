<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog } from '$lib/types';
  import { stripCopyOf } from '$lib/format';
  import { audio, playSha, toggle } from '$lib/audio';

  const catalog = $derived(page.data.catalog as Catalog);
  const extras = $derived(catalog.extras ?? []);

  let q = $state('');
  const cleaned = $derived(
    extras.map((e) => ({ ...e, name: e.originalName ? stripCopyOf(e.originalName) : 'Untitled' }))
  );
  const filtered = $derived(
    q.trim() ? cleaned.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase())) : cleaned
  );

  function playAudio(e: { sha256: string; name: string }) {
    if ($audio.sha === e.sha256 && $audio.playing) toggle();
    else playSha(e.sha256, e.name);
  }
</script>

<section class="extras">
  <header>
    <p class="kicker">Extra Files</p>
    <h2>Files not tied to a song</h2>
    <p class="body">
      Documents, set lists, images and charts that aren’t organized under a song
      folder and don’t match a song in the collection. Group them into song
      folders in Drive to have them appear with their song.
    </p>
    <p class="count">{filtered.length} of {extras.length} files</p>
    <input class="search" type="search" placeholder="Search files…" bind:value={q} aria-label="Search extra files" />
  </header>

  <ul class="list">
    {#each filtered as e (e.sha256)}
      <li class="row">
        <span class="name">{e.name}</span>
        <span class="actions">
          {#if e.assetType === 'mp3'}
            <button class="act" onclick={() => playAudio(e)}>
              {$audio.sha === e.sha256 && $audio.playing ? 'Pause' : 'Play'}
            </button>
          {:else if e.assetType === 'pdf' || e.assetType === 'image'}
            <a class="act" href={`/blob/${e.sha256}`} target="_blank" rel="noopener">View</a>
          {/if}
          <a class="dl" href={`/blob/${e.sha256}?dl=${encodeURIComponent(e.name)}`} download title="Download">⤓</a>
        </span>
      </li>
    {/each}
    {#if filtered.length === 0}
      <li class="empty">{extras.length === 0 ? 'No extra files.' : `No files match “${q}”.`}</li>
    {/if}
  </ul>
</section>

<style>
  .extras {
    max-width: 1480px;
    margin: 0 auto;
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
    font-size: clamp(1.4rem, 3vw, 2rem);
  }

  .body {
    color: var(--muted);
    max-width: 70ch;
  }

  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .search {
    width: 100%;
    max-width: 420px;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 12px;
    background: var(--paper);
    color: var(--ink);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px 6px 12px;
  }

  .name {
    flex: 1;
    font-size: 0.86rem;
    word-break: break-word;
  }

  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .act {
    min-height: 40px;
    min-width: 64px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 14px;
    border: 1px solid var(--accent-strong);
    border-radius: 6px;
    text-decoration: none;
    background: var(--accent);
    color: #fffdf7;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .dl {
    min-height: 40px;
    min-width: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    text-decoration: none;
    color: var(--accent-strong);
    background: #f7f5ef;
    font-weight: 700;
    font-size: 1rem;
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 12px;
  }
</style>
