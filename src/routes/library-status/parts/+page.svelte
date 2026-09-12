<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import { onMount } from 'svelte';
  import type { Catalog } from '$lib/types';
  import { partShortLabel } from '$lib/format';
  import { INSTRUMENT_CHOICES } from '../../../sync/instruments.js';
  let { form } = $props();
  const catalog = $derived(page.data.catalog as Catalog);
  let song = $state('');
  let instrument = $state('');
  let showHidden = $state(true);
  let ready = $state(false);
  onMount(() => { ready = true; });
  const rows = $derived(catalog.tunes.filter((t) => !song || t.slug === song).flatMap((t) => [
    ...t.parts.map((p) => ({ tune: t, part: p, hidden: false })),
    ...(showHidden ? (t.hiddenParts ?? []).map((p) => ({ tune: t, part: p, hidden: true })) : []),
  ]).filter((r) => !instrument || r.part.instrumentSlug === instrument));
  const unresolved = $derived(catalog.tunes.filter((t) => !song || t.slug === song).flatMap((t) => (t.unclassified ?? []).map((part) => ({ tune: t, part }))));
  // Charts that hold the whole band in one PDF — full scores and the unassigned
  // "all parts" files. Each can carry per-instrument start pages so a player opens
  // on their own part instead of paging to find it.
  const wholeBand = $derived(catalog.tunes.filter((t) => !song || t.slug === song).flatMap((t) => [
    ...t.scores.map((part) => ({ tune: t, part })),
    ...(t.unclassified ?? []).map((part) => ({ tune: t, part })),
  ]));
</script>

<svelte:head><title>Manage parts — MBBB Music</title></svelte:head>
<main>
  <a href="/library-status">← Library Status</a>
  <h1>Manage parts</h1>
  <p>Choose which charts players see. Shared charts are candidates for several instruments; check their clef and range before choosing a part. Hiding a choice also excludes it from new packets. Files stay in the library, and you can restore them here.</p>
  <div class="filters">
    <label>Filter by song<select bind:value={song} disabled={!ready}><option value="">All songs</option>{#each catalog.tunes as t}<option value={t.slug}>{t.title}</option>{/each}</select></label>
    <label>Filter by instrument<select bind:value={instrument} disabled={!ready}><option value="">All instruments</option>{#each catalog.instruments as i}<option value={i.slug}>{i.label}</option>{/each}</select></label>
    <label class="check"><input type="checkbox" bind:checked={showHidden} />Show hidden choices</label>
  </div>
  {#if form?.message}<p role="alert">{form.message}</p>{/if}
  <p>{rows.length} choices · <a href="/corrections">Edit history</a></p>
  {#if unresolved.length}
    <details><summary>{unresolved.length} charts need an instrument</summary>
      {#each unresolved as row (row.part.sha256)}
        <article><strong>{row.tune.title}</strong><p><a href={`/blob/${row.part.sha256}`} target="_blank" rel="noopener">{row.part.originalName || 'View chart'}</a></p>
          <form method="POST" action="?/assign" use:enhance>
            <input type="hidden" name="file" value={row.part.driveFileId} />
            <label>Instrument<select name="instrument" required><option value="">Choose instrument</option>{#each INSTRUMENT_CHOICES as i}<option value={i.slug}>{i.label}</option>{/each}</select></label>
            <button>Assign instrument</button>
          </form>
          <p class="hint">Players can still read this chart — it shows in the viewer below the full scores. If it holds the whole band, set <a href={`/library-status/parts/${row.part.sha256}`}>start pages</a> instead of assigning one instrument.</p>
        </article>
      {/each}
    </details>
  {/if}
  {#if wholeBand.length}
    <details><summary>{wholeBand.length} whole-band charts</summary>
      <p class="hint">A chart holding every part in one PDF opens at the reader's own part. Check or correct where each instrument lands.</p>
      {#each wholeBand as row (row.tune.slug + row.part.sha256)}
        <article class="band">
          <div><strong>{row.tune.title}</strong>
            <p>{row.part.originalName || 'Untitled chart'}</p>
          </div>
          <a class="action" href={`/library-status/parts/${row.part.sha256}`}>Start pages</a>
        </article>
      {/each}
    </details>
  {/if}
  <div class="choices">
    {#each rows as row (row.tune.slug + row.part.sha256 + row.part.instrumentSlug)}
      <article class:hidden={row.hidden}>
        <div><strong>{row.tune.title} — {row.part.instrument}</strong>
          <p>{partShortLabel(row.part, [...row.tune.parts, ...(row.tune.hiddenParts ?? [])].filter((p) => p.instrumentSlug === row.part.instrumentSlug))} · {row.part.format === 'lyre' ? 'Lyre' : 'Letter'}{row.part.shared ? ' · Shared chart' : ''}</p>
          <a href={`/blob/${row.part.sha256}`} target="_blank" rel="noopener">{row.part.originalName || 'View chart'}</a>
          {#if row.hidden}<p>{row.part.hiddenGlobally ? 'Hidden for all instruments' : 'Hidden for this instrument'}</p>{/if}
        </div>
        {#if row.part.driveFileId}
          <form method="POST" action="?/visibility" use:enhance>
            <input type="hidden" name="file" value={row.part.driveFileId} />
            <input type="hidden" name="instrument" value={row.part.instrumentSlug} />
            {#if row.part.hiddenGlobally}
              <button name="mode" value="showAll">Restore globally</button>
            {:else}
              <button name="mode" value={row.hidden ? 'show' : 'hide'}>{row.hidden ? 'Restore for this instrument' : 'Hide for this instrument'}</button>
              <button name="mode" value="hideAll">Hide for all instruments</button>
            {/if}
          </form>
        {/if}
      </article>
    {/each}
    {#if !rows.length}<p>No choices match these filters.</p>{/if}
  </div>
</main>

<style>
  main { max-width: 1100px; margin: auto; padding: 24px; }
  h1 { margin: 16px 0; }
  p { margin: 8px 0; }
  .filters, form { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 16px 0; }
  label { display: flex; flex-direction: column; gap: 6px; }
  label.check { flex-direction: row; align-items: center; min-height: 44px; }
  select, button { min-height: 44px; padding: 8px 12px; }
  article { padding: 16px; border: 1px solid var(--line, #ccc); border-radius: 8px; margin: 12px 0; }
  article.hidden { border-style: dashed; background: var(--paper, #f5f3ed); }
  article.band { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; }
  .hint { color: var(--muted, #6b6a63); font-size: 0.9rem; }
  .action { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border: 1px solid var(--line, #ccc); border-radius: 8px; text-decoration: none; }
  a { overflow-wrap: anywhere; }
</style>
