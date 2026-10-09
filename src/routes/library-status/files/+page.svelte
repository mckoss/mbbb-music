<script lang="ts">
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import type { Inventory, InvNode, InvFileRow } from '$lib/server/inventory';
  import type { Catalog } from '$lib/types';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import HelpPopup from '$lib/components/HelpPopup.svelte';
  import { viewHref, viewKindFromName } from '$lib/view';
  import { fmtDate } from '$lib/format';

  const inv = $derived(page.data.inventory as Inventory);

  // Friendly open URL when the file is in the player catalog; otherwise fall
  // back to the raw blob (this health view also lists duplicates / non-catalog
  // files that have no slug name).
  const assetIndex = $derived(assetIndexFor(page.data.catalog as Catalog));
  const fileHref = (sha: string | null) =>
    sha ? (urlForSha(assetIndex, sha) ?? `/blob/${sha}`) : '#';

  // Open a file through the in-app viewer (back affordance), choosing the right
  // presentation from the friendly URL's extension. The friendly path's extension
  // is more reliable than the raw Drive name (notes become .pdf there).
  const viewLink = (sha: string | null, name: string | null): string => {
    if (!sha) return '#';
    const url = fileHref(sha);
    return viewHref({ sha, kind: viewKindFromName(url), title: name ?? '', from: page.url.pathname, url });
  };

  const primaryLoc = (p: { source: string | null; path: string[]; name: string | null }) =>
    [p.source, ...(p.path ?? []), p.name].filter(Boolean).join(' / ');

  // A folder is all-dup when every file in its subtree is a duplicate (and it
  // holds at least one file) — then the whole folder carries the "Dup" tag.
  const allDup = (node: InvNode) => node.fileCount > 0 && node.dupCount === node.fileCount;

  // Tags for files the library doesn't use (primary/dup are handled above).
  const STATE_TAG: Record<string, { label: string; title: string }> = {
    archived: { label: 'Archived', title: 'Archived by an admin — out of the library' },
    ignored: { label: 'Not stored', title: 'Not stored by the app — listed on Extra Files as a Drive link (or OS junk)' },
    removed: { label: 'Removed', title: 'Removed from Drive before it was downloaded' },
    unreachable: { label: 'Unreachable', title: 'A shortcut to a file the sync cannot read' },
    failed: { label: 'Failed', title: 'The download failed' },
    pending: { label: 'Pending', title: 'Waiting to download' },
  };

  const infoHref = (id: string) => `/library-status/files/${encodeURIComponent(id)}`;

  // --- Pinpoint: ?file=<Drive id> opens the folders down to that file -------
  const target = $derived(page.url.searchParams.get('file'));
  const contains = (node: InvNode, id: string): boolean =>
    node.files.some((f) => f.driveFileId === id) || node.folders.some((f) => contains(f, id));

  // Re-runs on every target change (a "Show in tree" click stays on this page).
  $effect(() => {
    const id = target;
    if (!id) return;
    tick().then(() => document.getElementById(`f-${id}`)?.scrollIntoView({ block: 'center' }));
  });

  // --- Search: by file name, folder path, or Drive file id ------------------
  let query = $state('');
  interface Hit {
    row: InvFileRow;
    where: string[];
  }
  const allRows = $derived.by(() => {
    const out: Hit[] = [];
    const walk = (node: InvNode, where: string[]) => {
      for (const f of node.files) out.push({ row: f, where });
      for (const fol of node.folders) walk(fol, [...where, fol.name]);
    };
    for (const src of inv.sources) walk(src.root, [src.source]);
    return out;
  });
  // Deleted in Drive but still in the library — the queue to review and archive.
  const removedKept = $derived(allRows.filter((h) => h.row.removedFromDrive && h.row.state === 'primary'));

  const MAX_HITS = 200;
  const hits = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allRows.filter(
      (h) => h.row.driveFileId === query.trim() || `${h.where.join(' / ')} / ${h.row.name}`.toLowerCase().includes(q),
    );
  });
</script>

<section class="files">
  <header>
    <p class="kicker">Library Info</p>
    <nav class="tabs">
      <a href="/library-status">Coverage</a>
      <a class="active" aria-current="page" href="/library-status/files">Files</a>
      <a href="/library-status/generated-scores">Generated</a>
    </nav>
    <div class="title-row">
      <h2>File browser</h2>
      <HelpPopup title="About the file browser" label="About the file browser">
        <p>
          Every scanned file, nested exactly as it sits in Drive — the full folder
          hierarchy, not a flattened list.
        </p>
        <p>
          The same content can appear in several places (a song folder, a
          by-instrument index, a shortcut from another archive…); only one copy is the
          one the library uses. A real song folder is always preferred over an
          index/container. Every other copy is tagged <span class="badge dup-tag">Dup</span>;
          a folder whose files are <em>all</em> duplicates is tagged
          <span class="badge dup-tag">Dup</span> too. Primary copies carry no tag.
        </p>
        <p>
          Nothing is hidden: every other appearance, including
          <span class="sc">↗ shortcuts</span>, is shown where it lives. The date is each
          file's last-modified time (YYYY-MM-DD), so you can tell current from stale copies.
        </p>
        <p>
          Files the library doesn't use are listed too, tagged <em>Archived</em>,
          <em>Not imported</em>, <em>Removed</em>, <em>Unreachable</em>, <em>Failed</em>, or
          <em>Pending</em>. A file deleted in Drive stays in the library, tagged
          <em>Not in Drive</em>, until an admin archives it. Click any file to see exactly how
          it is handled.
        </p>
      </HelpPopup>
    </div>
    <p class="count">
      {inv.totals.files} appearances · {inv.totals.primaries} primary · {inv.totals.duplicates} duplicate{#if inv.totals.unused}{' '}· {inv.totals.unused} not used{/if}
    </p>
    <input
      class="search"
      type="search"
      placeholder="Find a file by name, folder, or Drive file id"
      aria-label="Find a file"
      bind:value={query}
    />
    <p class="hint">Click a file to see how the library handles it.</p>
  </header>

  {#if removedKept.length && !query.trim()}
    <details class="review">
      <summary>
        <strong>{removedKept.length} file{removedKept.length === 1 ? '' : 's'} removed from Drive, still in the library</strong>
        <span class="meta">Open one to archive it</span>
      </summary>
      <ul>
        {#each removedKept as h (h.row.driveFileId)}
          <li>
            <span class="hit">
              <a class="file" href={infoHref(h.row.driveFileId)}>{h.row.name}</a>
              <span class="path">{h.where.join(' / ')}</span>
            </span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if query.trim()}
    <div class="results">
      <p class="count">{hits.length} match{hits.length === 1 ? '' : 'es'}{hits.length > MAX_HITS ? ` — showing the first ${MAX_HITS}` : ''}</p>
      <ul>
        {#each hits.slice(0, MAX_HITS) as h, i (h.row.driveFileId + ':' + i)}
          <li class:dup={h.row.state === 'dup'} class:unused={STATE_TAG[h.row.state]}>
            <span class="hit">
              <a class="file" href={infoHref(h.row.driveFileId)}>{h.row.name}</a>
              <span class="path">{h.where.join(' / ')}</span>
            </span>
            {@render tags(h.row)}
            <a class="locate" href={`?file=${encodeURIComponent(h.row.driveFileId)}#f-${h.row.driveFileId}`} onclick={() => (query = '')}>Show in tree</a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if query.trim()}
    <!-- The tree is hidden while searching. -->
  {:else if inv.sources.length === 0}
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
    <!-- All folders start collapsed; the viewer expands what they need. -->
    <details open={!!target && contains(fol, target)}>
      <summary>
        <span class="fname"
          >📁 {fol.name}{#if allDup(fol)} <span class="badge dup-tag" title="Every file in this folder is a duplicate of a higher-priority copy">Dup</span>{/if}</span
        >
        <span class="meta">{fol.fileCount} file{fol.fileCount === 1 ? '' : 's'}</span>
      </summary>
      <div class="children">
        {@render treeNode(fol)}
      </div>
    </details>
  {/each}
  {#if node.files.length}
    <ul>
      {#each node.files as f, i (f.driveFileId + ':' + i)}
        <li
          id={target === f.driveFileId ? `f-${f.driveFileId}` : undefined}
          class:dup={f.state === 'dup'}
          class:unused={STATE_TAG[f.state]}
          class:target={target === f.driveFileId}
        >
          {#if f.viaShortcut}<span class="sc" title="Reached via a Drive shortcut">↗</span>{/if}
          <a class="file" href={infoHref(f.driveFileId)}>{f.name}</a>
          {@render tags(f)}
          {#if f.sha256}<a class="open" href={viewLink(f.sha256, f.name)} title="Open the file">open</a>{/if}
          {#if f.modifiedTime}<span class="date">{fmtDate(f.modifiedTime)}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet tags(f: InvFileRow)}
  {#if f.removedFromDrive}
    <span class="badge state-tag gone" title="Deleted in Drive; still in the library until archived">Not in Drive</span>
  {/if}
  {#if f.state === 'dup'}
    <span
      class="badge dup-tag"
      title={f.primary ? `Primary copy: ${primaryLoc(f.primary)}` : 'Duplicate of a higher-priority copy'}
      >Dup</span
    >
  {:else if STATE_TAG[f.state]}
    <span class="badge state-tag {f.state}" title={STATE_TAG[f.state].title}>{STATE_TAG[f.state].label}</span>
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
  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
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
  .badge.dup-tag {
    background: #f3e6e6;
    color: #9a3b3b;
    border: 1px solid #e0bcbc;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  /* The folder-name "Dup" tag sits inline after the name, not pushed right. */
  summary .fname .badge.dup-tag {
    font-weight: 700;
  }
  .date {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 16px;
  }
  .search {
    width: 100%;
    min-height: 44px;
    margin-top: 10px;
    padding: 8px 12px;
    font-size: 1rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
  }
  .hint {
    color: var(--muted);
    font-size: 0.78rem;
    margin-top: 4px;
  }
  .results ul {
    padding-left: 0;
    gap: 0;
  }
  .results li {
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }
  .hit {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 260px;
  }
  .path {
    color: var(--muted);
    font-size: 0.74rem;
    word-break: break-word;
  }
  .locate,
  .open {
    font-size: 0.74rem;
    color: var(--muted);
  }
  li.unused .file {
    color: var(--muted);
  }
  li.target {
    background: #fff3c4;
    outline: 2px solid #e2b93b;
    border-radius: 4px;
    padding: 2px 4px;
  }
  .badge.state-tag {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: #eeeeea;
    color: #55554f;
    border: 1px solid #d6d6cf;
  }
  .badge.state-tag.removed,
  .badge.state-tag.unreachable,
  .badge.state-tag.failed {
    background: #f8e3e1;
    color: #8a2219;
    border-color: #e6bab5;
  }
  .badge.state-tag.gone {
    background: #fbf0d9;
    color: #7a5208;
    border-color: #ecd4a0;
  }
  .review {
    border: 1px solid #ecd4a0;
    background: #fdf7ea;
    border-radius: 6px;
    padding: 6px 10px;
  }
  .review ul {
    padding-left: 0;
  }
  .badge.state-tag.pending {
    background: #fbf0d9;
    color: #7a5208;
    border-color: #ecd4a0;
  }
</style>
