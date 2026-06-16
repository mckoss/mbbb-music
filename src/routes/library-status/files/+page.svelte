<script lang="ts">
  import { page } from '$app/state';
  import type { Inventory } from '$lib/server/inventory';

  const inv = $derived(page.data.inventory as Inventory);
  const loc = (p: { source: string | null; folder: string | null; name: string | null }) =>
    [p.source, p.folder].filter(Boolean).join(' / ');
</script>

<section class="files">
  <header>
    <p class="kicker">Library Info</p>
    <nav class="tabs">
      <a href="/library-status">Coverage</a>
      <a class="active" aria-current="page" href="/library-status/files">Files</a>
    </nav>
    <h2>File browser</h2>
    <p class="body">
      Every scanned file, by its original Drive location. The same content can live
      in several folders (a song folder, a by-instrument index, …); only one copy —
      the <strong>Primary</strong> — is used by the library. Duplicates aren't hidden
      here: each points at where its primary lives. A real song folder is always
      preferred over an index/container folder as the primary.
    </p>
    <p class="count">
      {inv.totals.files} files · {inv.totals.primaries} primary · {inv.totals.duplicates} duplicate
    </p>
  </header>

  {#if inv.sources.length === 0}
    <p class="empty">No files yet — run a sync first.</p>
  {:else}
    {#each inv.sources as src (src.source)}
      <div class="source">
        <h3>{src.source}</h3>
        {#each src.folders as fol (fol.folder)}
          <details>
            <summary>
              <span class="fname">📁 {fol.folder}</span>
              <span class="meta">{fol.files.length} file{fol.files.length === 1 ? '' : 's'}{fol.dupCount ? ` · ${fol.dupCount} dup` : ''}</span>
            </summary>
            <ul>
              {#each fol.files as f (f.driveFileId)}
                <li class:dup={!f.isPrimary}>
                  <a class="file" href={f.sha256 ? `/blob/${f.sha256}` : '#'} target="_blank" rel="noopener">{f.name}</a>
                  {#if f.isPrimary}
                    <span class="badge primary">Primary</span>
                  {:else if f.primary}
                    <span class="badge dupof">↳ primary in {loc(f.primary)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </details>
        {/each}
      </div>
    {/each}
  {/if}
</section>

<style>
  .files {
    max-width: 1000px;
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
    max-width: 80ch;
  }
  .count {
    color: var(--muted);
    font-size: 0.82rem;
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin: 6px 0;
  }
  .tabs a {
    padding: 5px 14px;
    border: 1px solid var(--line);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-decoration: none;
    background: var(--paper);
  }
  .tabs a.active {
    color: var(--ink);
    background: var(--panel);
    border-color: var(--accent-strong);
  }
  .source h3 {
    font-size: 0.95rem;
    margin-bottom: 4px;
    color: var(--accent-strong);
  }
  details {
    border: 1px solid var(--line);
    border-radius: 6px;
    margin-bottom: 6px;
    background: var(--paper);
  }
  summary {
    cursor: pointer;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.85rem;
  }
  summary .meta {
    color: var(--muted);
    font-size: 0.76rem;
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 0.82rem;
  }
  li.dup .file {
    color: var(--muted);
  }
  .file {
    color: var(--accent-strong);
    text-decoration: none;
    word-break: break-word;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 700;
    border-radius: 4px;
    padding: 1px 7px;
    white-space: nowrap;
  }
  .badge.primary {
    background: #e6f4ea;
    color: #2e7d4f;
    border: 1px solid #b6dcc4;
  }
  .badge.dupof {
    background: var(--panel);
    color: var(--muted);
    border: 1px solid var(--line);
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 16px;
  }
</style>
