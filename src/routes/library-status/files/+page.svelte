<script lang="ts">
  import { page } from '$app/state';
  import type { Inventory, InvNode } from '$lib/server/inventory';
  import type { Catalog } from '$lib/types';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';

  const inv = $derived(page.data.inventory as Inventory);

  // Friendly open URL when the file is in the player catalog; otherwise fall
  // back to the raw blob (this health view also lists duplicates / non-catalog
  // files that have no slug name).
  const assetIndex = $derived(assetIndexFor(page.data.catalog as Catalog));
  const fileHref = (sha: string | null) =>
    sha ? (urlForSha(assetIndex, sha) ?? `/blob/${sha}`) : '#';

  const primaryLoc = (p: { source: string | null; path: string[]; name: string | null }) =>
    [p.source, ...(p.path ?? []), p.name].filter(Boolean).join(' / ');

  /** Total files in a node and its descendants — for the folder summary count. */
  function countFiles(node: InvNode): number {
    return node.files.length + node.folders.reduce((n, f) => n + countFiles(f), 0);
  }
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
      Every scanned file, nested exactly as it sits in Drive — the full folder
      hierarchy, not a flattened list. The same content can appear in several
      places (a song folder, a by-instrument index, a shortcut from another
      archive…); only one copy — the <strong>Primary</strong> — is used by the
      library. Nothing is hidden: every other appearance, including
      <span class="sc">↗ shortcuts</span>, is shown where it lives and points at its
      primary. A real song folder is always preferred over an index/container as the
      primary.
    </p>
    <p class="count">
      {inv.totals.files} appearances · {inv.totals.primaries} primary · {inv.totals.duplicates} duplicate
    </p>
  </header>

  {#if inv.sources.length === 0}
    <p class="empty">No files yet — run a sync first.</p>
  {:else}
    {#each inv.sources as src (src.source)}
      <div class="source">
        <h3>📦 {src.source} <span class="meta">{src.fileCount} file{src.fileCount === 1 ? '' : 's'}{src.dupCount ? ` · ${src.dupCount} dup` : ''}</span></h3>
        <div class="tree">
          {@render treeNode(src.root)}
        </div>
      </div>
    {/each}
  {/if}
</section>

{#snippet treeNode(node: InvNode)}
  {#each node.folders as fol (fol.name)}
    <details open={countFiles(fol) <= 40}>
      <summary>
        <span class="fname">📁 {fol.name}</span>
        <span class="meta">{countFiles(fol)} file{countFiles(fol) === 1 ? '' : 's'}</span>
      </summary>
      <div class="children">
        {@render treeNode(fol)}
      </div>
    </details>
  {/each}
  {#if node.files.length}
    <ul>
      {#each node.files as f, i (f.driveFileId + ':' + i)}
        <li class:dup={!f.isPrimary}>
          {#if f.viaShortcut}<span class="sc" title="Reached via a Drive shortcut">↗</span>{/if}
          <a class="file" href={fileHref(f.sha256)} target="_blank" rel="noopener">{f.name}</a>
          {#if f.isPrimary}
            <span class="badge primary">Primary</span>
          {:else if f.primary}
            <span class="badge dupof">↳ primary in {primaryLoc(f.primary)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

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
    margin-bottom: 6px;
    color: var(--accent-strong);
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .source h3 .meta {
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 400;
  }
  .tree {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    padding: 6px 8px;
  }
  details {
    margin: 2px 0;
  }
  summary {
    cursor: pointer;
    padding: 4px 6px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 0.85rem;
    border-radius: 4px;
  }
  summary:hover {
    background: var(--panel);
  }
  summary .meta {
    color: var(--muted);
    font-size: 0.76rem;
    white-space: nowrap;
  }
  /* Indent nested folders/files, with a guide line down each level. */
  .children {
    margin-left: 10px;
    padding-left: 10px;
    border-left: 1px solid var(--line);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 2px 0 4px 16px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 8px;
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
  .sc {
    color: var(--accent-strong);
    font-weight: 700;
    font-size: 0.8rem;
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
