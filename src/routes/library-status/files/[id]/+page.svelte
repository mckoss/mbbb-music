<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog } from '$lib/types';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { viewHref, viewKind } from '$lib/view';
  import { instrumentDisplay } from '$lib/format';
  import { enhance } from '$app/forms';

  let { data } = $props();
  const h = $derived(data.handling);

  const STATE_TONE: Record<string, string> = {
    'in-library': 'good',
    duplicate: 'info',
    extra: 'warn',
    'kept-out': 'warn',
    unplaced: 'warn',
    pending: 'warn',
    ignored: 'muted',
    removed: 'bad',
    unreachable: 'bad',
    failed: 'bad',
    archived: 'muted',
    'link-only': 'info',
  };

  const STATUS_TEXT: Record<string, string> = {
    synced: 'Synced',
    pending: 'Waiting to download',
    deleted: 'Removed from Drive',
    unreachable: 'Unreachable shortcut',
    error: 'Download failed',
  };
  const statusText = (s: string | null) =>
    !s ? '—' : s.startsWith('ignored') ? `Not imported (${s.split('|')[1] ?? 'ignored'})` : (STATUS_TEXT[s] ?? s);

  const READ_AS = [
    { key: 'song', label: 'Song' },
    { key: 'instrument', label: 'Instrument' },
    { key: 'key', label: 'Key' },
    { key: 'part', label: 'Part' },
    { key: 'role', label: 'Role' },
    { key: 'clef', label: 'Clef' },
    { key: 'format', label: 'Format' },
    { key: 'type', label: 'Type' },
    { key: 'hidden', label: 'Hidden' },
  ] as const;
  const shownRows = $derived(
    READ_AS.filter((r) => data.detected[r.key] != null || data.effective[r.key] != null),
  );

  const KIND_TEXT: Record<string, string> = {
    added: 'Added',
    updated: 'Updated',
    restored: 'Restored',
    removed: 'Removed',
    ignored: 'First seen (not imported)',
  };

  const sizeText = (n: number | null) =>
    n == null ? null : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  const crumbs = (l: { source: string | null; path: string[] }) => [l.source ?? '(unknown source)', ...l.path];

  // Open through the in-app viewer, via the friendly URL when the file is in the catalog.
  const openHref = $derived.by(() => {
    if (!data.sha256) return null;
    const url = urlForSha(assetIndexFor(page.data.catalog as Catalog), data.sha256) ?? `/blob/${data.sha256}`;
    return viewHref({ sha: data.sha256, kind: viewKind(data.assetType), title: data.name, from: page.url.pathname, url });
  });
</script>

<svelte:head><title>{data.name} · Files · MBBB Music</title></svelte:head>

<section class="file">
  <header>
    <p class="kicker"><a href="/library-status/files">Library Info · Files</a></p>
    <h2>{data.name}</h2>
    <div class="actions">
      <a class="btn" href={`/library-status/files?file=${encodeURIComponent(data.id)}#f-${data.id}`}>Show in Drive tree</a>
      {#if openHref}<a class="btn" href={openHref}>Open</a>{/if}
      {#if data.status !== 'deleted'}
        <a class="btn ghost" href={data.driveUrl} target="_blank" rel="noopener">Open in Drive ↗</a>
      {/if}
      {#if data.canArchive}
        <form method="POST" action="?/archive" use:enhance>
          <input type="hidden" name="archived" value={data.archived ? 'false' : 'true'} />
          <button class="btn ghost" type="submit">{data.archived ? 'Unarchive' : 'Archive'}</button>
        </form>
      {/if}
    </div>
    {#if data.canArchive && !data.archived}
      <p class="muted small">Archive takes this file out of the library for everyone. It is reversible (Unarchive, or revert it on Corrections).</p>
    {/if}
  </header>

  {#if h}
    <div class="panel handling {STATE_TONE[h.state] ?? 'muted'}">
      <h3>How the library handles it</h3>
      <p class="headline">{h.headline}</p>
      {#if h.detail}<p>{h.detail}</p>{/if}
      {#if h.canonical}
        <p>
          The copy in use:
          <a href={`/library-status/files/${h.canonical.id}`}><strong>{h.canonical.name}</strong></a>
          {#if h.canonical.location}<span class="muted">in {h.canonical.location}</span>{/if}
        </p>
      {/if}
      {#if h.placements.length}
        <ul class="placements">
          {#each h.placements as p, i (i)}
            <li>
              <div class="where">
                <strong>{p.song.title}</strong>
                <span class="as">{p.bucketLabel}</span>
                {#if p.instrument}
                  <span class="chip">
                    {instrumentDisplay(p.instrument, p.key)}{#if p.part}{' '}part {p.part}{/if}
                  </span>
                {/if}
                {#if p.format}<span class="chip">{p.format}</span>{/if}
                {#if p.default === true}<span class="chip good">default</span>{/if}
                {#if p.default === false}<span class="chip">alternate</span>{/if}
              </div>
              {#each p.notes as n, j (j)}<p class="note">{n}</p>{/each}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="panel">
    <h3>Where it is in Drive</h3>
    <ul class="locations">
      {#each data.locations as l, i (i)}
        <li>
          <span class="crumbs">
            {#each crumbs(l) as c, j (j)}{#if j}<span class="sep">/</span>{/if}<span>{c}</span>{/each}<span class="sep">/</span><strong>{l.name}</strong>
          </span>
          {#if l.viaShortcut}<span class="chip">via shortcut</span>{/if}
          {#if i === 0 && data.locations.length > 1}<span class="chip">home</span>{/if}
        </li>
      {/each}
    </ul>
    {#if data.folderUrl}<a class="muted small" href={data.folderUrl} target="_blank" rel="noopener">Open its folder in Drive ↗</a>{/if}
  </div>

  <div class="panel">
    <h3>Sync</h3>
    <dl class="facts">
      <dt>Status</dt><dd>{statusText(data.status)}{#if data.archived}{' '}· archived{/if}</dd>
      {#if data.removedAt}<dt>Removed from Drive</dt><dd>{data.removedAt}</dd>{/if}
      {#if data.lastSynced}<dt>Last synced</dt><dd>{data.lastSynced}</dd>{/if}
      {#if data.modified}<dt>Modified in Drive</dt><dd>{data.modified}</dd>{/if}
      {#if data.mimeType}<dt>Drive type</dt><dd>{data.mimeType}</dd>{/if}
      {#if sizeText(data.size)}<dt>Size</dt><dd>{sizeText(data.size)}</dd>{/if}
      {#if data.sha256}<dt>Content</dt><dd class="mono" title={data.sha256}>{data.sha256.slice(0, 16)}…</dd>{/if}
      <dt>Drive file id</dt><dd class="mono">{data.id}</dd>
    </dl>
  </div>

  {#if shownRows.length}
    <div class="panel">
      <h3>Read as</h3>
      <p class="muted small">What the sync read from the file's name and folder, and the result after any corrections.</p>
      <table class="readas">
        <thead><tr><th></th><th>From the filename</th><th>After corrections</th></tr></thead>
        <tbody>
          {#each shownRows as r (r.key)}
            {@const a = data.detected[r.key]}
            {@const b = data.effective[r.key]}
            <tr class:changed={a !== b}>
              <th>{r.label}</th>
              <td>{a ?? '—'}</td>
              <td>{b ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="panel">
    <h3>Corrections</h3>
    {#if data.edits.length}
      <ul class="edits">
        {#each data.edits as e (e.id)}
          <li class:reverted={e.reverted}>
            <span class="chip">{e.scope}</span>
            <strong>{e.field}</strong> = <span class="mono">{e.value ?? '(cleared)'}</span>
            <span class="muted">by {e.by}, {e.at}</span>
            {#if e.reverted}<span class="chip">reverted</span>{/if}
          </li>
        {/each}
      </ul>
      <a class="small" href="/corrections">Manage corrections</a>
    {:else}
      <p class="muted">No saved corrections for this file or its folder.</p>
    {/if}
  </div>

  {#if data.history}
    <div class="panel">
      <h3>Sync history</h3>
      {#if data.history.length}
        <ul class="history">
          {#each data.history as r (r.runId)}
            <li>
              <a href={`/admin/sync-history/${r.runId}`}>{r.when}</a>
              <span class="chip">{KIND_TEXT[r.change.kind] ?? r.change.kind}</span>
              {#if r.change.fields?.length}
                <ul class="fields">
                  {#each r.change.fields as f (f.field)}
                    <li>
                      <span class="label">{f.label}</span>
                      {#if f.field === 'content'}
                        new content
                      {:else}
                        <span class="from">{f.from ?? '—'}</span> → <strong>{f.to ?? '—'}</strong>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">No recorded sync has changed this file. (Sync history starts with v1.59.)</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .file {
    max-width: 1000px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  h2 {
    font-size: clamp(1.3rem, 3vw, 1.8rem);
    overflow-wrap: anywhere;
  }

  h3 {
    font-size: 1rem;
    margin: 0 0 8px;
  }

  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.72rem;
    font-weight: 800;
  }

  .kicker a {
    color: var(--accent-strong);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 14px;
    border-radius: 6px;
    background: var(--accent-strong);
    color: #fff;
    font-weight: 700;
    font-size: 0.86rem;
    text-decoration: none;
  }

  button.btn {
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    font-size: 0.86rem;
  }

  .btn.ghost {
    background: transparent;
    color: var(--accent-strong);
    border: 1px solid var(--accent-strong);
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 14px 18px;
  }

  .muted {
    color: var(--muted);
  }

  .small {
    font-size: 0.82rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }

  .handling {
    border-left: 5px solid var(--line);
  }

  .handling.good {
    border-left-color: #5aa652;
  }

  .handling.info {
    border-left-color: #4a7fc0;
  }

  .handling.warn {
    border-left-color: #d29a2a;
  }

  .handling.bad {
    border-left-color: #c2493d;
  }

  .headline {
    font-size: 1.05rem;
    font-weight: 700;
  }

  .placements {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }

  .placements > li {
    padding: 8px 0;
    border-top: 1px solid var(--line);
  }

  .where {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 10px;
  }

  .as {
    color: var(--muted);
  }

  .note {
    margin: 4px 0 0;
    font-size: 0.86rem;
  }

  .chip {
    display: inline-block;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 1px 9px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .chip.good {
    background: #e3f2e1;
    color: #1f5f1a;
    border-color: #b9dcb4;
  }

  .locations,
  .edits,
  .history {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
  }

  .locations li,
  .edits li,
  .history > li {
    padding: 6px 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: baseline;
  }

  .locations li + li,
  .edits li + li,
  .history > li + li {
    border-top: 1px solid var(--line);
  }

  .crumbs {
    overflow-wrap: anywhere;
  }

  .sep {
    color: var(--muted);
    padding: 0 4px;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 0;
    font-size: 0.9rem;
  }

  .facts dt {
    color: var(--muted);
  }

  .facts dd {
    margin: 0;
  }

  .readas {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    margin-top: 6px;
  }

  .readas th,
  .readas td {
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
  }

  .readas thead th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .readas tr.changed td:last-child {
    font-weight: 700;
    color: var(--accent-strong);
  }

  .reverted {
    opacity: 0.6;
  }

  .reverted strong,
  .reverted .mono {
    text-decoration: line-through;
  }

  .fields {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    width: 100%;
    font-size: 0.85rem;
  }

  .label {
    display: inline-block;
    min-width: 84px;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .from {
    text-decoration: line-through;
    color: var(--muted);
  }
</style>
