<script lang="ts">
  import { enhance } from '$app/forms';
  import { RENDER_REV } from '$lib/render-rev';
  import { instrumentLabel } from '../../../../sync/instruments.js';

  let { data, form } = $props();

  // Where the chart's own labels place each instrument — resolved on the server by
  // the same rule the viewer applies, so this page shows exactly what players get.
  const detectedPages = $derived(data.detectedPages);
  const effective = $derived({ ...detectedPages, ...data.overrides });
  // Instruments first, in catalog order, so the table reads like the band.
  const rows = $derived(
    data.instruments.map((i: { slug: string; label: string }) => ({
      slug: i.slug,
      label: i.label,
      detected: detectedPages[i.slug] ?? null,
      override: data.overrides[i.slug] ?? null,
      page: effective[i.slug] ?? null,
    }))
  );
  const placed = $derived(rows.filter((r: { page: number | null }) => r.page != null).length);
</script>

<svelte:head><title>Start pages — MBBB Music</title></svelte:head>

<main>
  <a href="/library-status/parts">← Manage parts</a>
  <h1>Start pages</h1>
  <p class="chart">
    <strong>{data.songTitle}</strong> ·
    <a href={`/blob/${data.sha}`} target="_blank" rel="noopener">{data.chartName || 'View chart'}</a>
    · {data.pageCount} page{data.pageCount === 1 ? '' : 's'}
  </p>
  <p>
    A whole-band chart holds every player's part in one PDF. The viewer opens it at
    the page where the reader's own part starts, read from the part names printed on
    each page. Correct any that came out wrong — a blank page number clears the
    correction and returns that instrument to what the chart says.
  </p>

  {#if form?.message}<p class="alert" role="alert">{form.message}</p>{/if}

  {#if data.detected.length}
    <h2>What the chart says</h2>
    <ol class="detected">
      {#each data.detected as entry (entry.page)}
        <li>
          <a href={`/view/${data.sha}#page-${entry.page}`}>Page {entry.page}</a>
          <strong>{entry.label}</strong>
          <span>{entry.instruments.map((s: string) => instrumentLabel(s) ?? s).join(', ')}</span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="alert">
      No part names were found in this PDF — it may be a scan with no text, a single
      part, or a conductor score. Players see page 1 unless you set pages below.
    </p>
  {/if}

  <h2>Where players land <span class="count">{placed} of {rows.length} instruments</span></h2>
  <div class="rows">
    {#each rows as row (row.slug)}
      <article class:unplaced={row.page == null}>
        <div class="who">
          <strong>{row.label}</strong>
          <p>
            {#if row.override != null}
              Page {row.override} (set by hand{row.detected != null ? `; chart says ${row.detected}` : ''})
            {:else if row.detected != null}
              Page {row.detected} — from the chart
            {:else}
              Not in this chart — opens at page 1
            {/if}
          </p>
        </div>
        <form method="POST" action="?/setPage" use:enhance>
          <input type="hidden" name="instrument" value={row.slug} />
          <label>
            <span class="eyebrow">Page</span>
            <input
              type="number"
              name="page"
              min="1"
              max={data.pageCount}
              value={row.override ?? ''}
              placeholder={row.detected != null ? String(row.detected) : '—'}
              inputmode="numeric"
            />
          </label>
          <button>{row.override != null ? 'Update' : 'Set page'}</button>
        </form>
        {#if row.page != null}
          <a class="thumb" href={`/view/${data.sha}`} title={`Page ${row.page}`}>
            <img src={`/render/${data.sha}/${row.page}.webp?r=${RENDER_REV}`} alt={`Page ${row.page}`} loading="lazy" />
          </a>
        {/if}
      </article>
    {/each}
  </div>
</main>

<style>
  main { max-width: 1100px; margin: auto; padding: 24px; }
  h1 { margin: 16px 0 8px; }
  h2 { margin: 28px 0 8px; font-size: 1.05rem; }
  p { margin: 8px 0; }
  .chart { overflow-wrap: anywhere; }
  .count { font-weight: 400; color: var(--muted, #6b6a63); }
  .alert { padding: 12px; border-radius: 8px; background: var(--paper, #f5f3ed); }
  .detected { margin: 8px 0 0 20px; }
  .detected li { margin: 4px 0; }
  .detected strong { margin: 0 8px; }
  .detected span { color: var(--muted, #6b6a63); }
  .rows { display: grid; gap: 12px; margin-top: 12px; }
  article {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
    padding: 12px 16px;
    border: 1px solid var(--line, #ccc);
    border-radius: 8px;
  }
  article.unplaced { border-style: dashed; }
  .who { flex: 1; min-width: 200px; }
  .who p { color: var(--muted, #6b6a63); font-size: 0.9rem; }
  form { display: flex; gap: 10px; align-items: end; }
  label { display: flex; flex-direction: column; gap: 4px; }
  .eyebrow { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b6a63); }
  input, button { min-height: 44px; padding: 8px 12px; }
  input { width: 92px; }
  .thumb img { width: 64px; border: 1px solid var(--line, #ccc); background: #fff; }
</style>
