<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import { instrumentDisplay } from '$lib/format';
  import { sourceStyle } from '$lib/sources';

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);
  const instruments = $derived(catalog.instruments ?? []);
  // Source labels in priority order (highest first); index is the rank.
  const sources = $derived(catalog.sources ?? []);

  const rank = (label: string | null) => {
    const i = sources.indexOf(label ?? '');
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  // The indicator for a set of like assets (an instrument's parts, or a tune's
  // audio): the count of items, colored by the highest-priority ("primary")
  // source among them. Null when nothing is present (blank cell).
  function cellFor(items: { source: string | null }[]) {
    if (items.length === 0) return null;
    let best = items[0];
    for (const it of items) if (rank(it.source) < rank(best.source)) best = it;
    return { count: items.length, ...sourceStyle(best.source) };
  }

  function partsFor(tune: Tune, instrumentSlug: string) {
    return tune.parts.filter((p) => p.instrumentSlug === instrumentSlug);
  }

  // One row per tune: a cell per instrument (aligned to `instruments`) plus the
  // audio cell. Precomputed here so the template avoids {@const} under <tr>.
  const rows = $derived(
    tunes.map((t) => ({
      slug: t.slug,
      title: t.title,
      cells: instruments.map((inst) => cellFor(partsFor(t, inst.slug))),
      audio: cellFor(t.audio),
    }))
  );

  // Legend entries, one per configured source (in priority order).
  const legend = $derived(sources.map((s) => ({ label: s, ...sourceStyle(s) })));
</script>

<section class="status">
  <header>
    <p class="kicker">Library Health</p>
    <h2>Coverage by song &amp; instrument</h2>
    <p class="body">
      Each square marks where a score (or recording) exists and the color shows
      its primary source. The number counts every copy in the library — all parts
      and both Letter/Lyre formats. Blank means nothing is on file.
    </p>
    <p class="count">{tunes.length} songs · {instruments.length} instruments</p>

    <ul class="legend">
      {#each legend as l (l.label)}
        <li>
          <span class="swatch" style:background={l.color}></span>
          {l.name}
        </li>
      {/each}
    </ul>
  </header>

  <div class="scroller">
    <table>
      <thead>
        <tr>
          <th class="corner" scope="col">Song</th>
          {#each instruments as inst (inst.slug)}
            <th class="col-head" scope="col"><span>{instrumentDisplay(inst.label, inst.key)}</span></th>
          {/each}
          <th class="col-head audio" scope="col"><span>Audio</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.slug)}
          <tr>
            <th class="row-head" scope="row">{r.title}</th>
            {#each r.cells as c, i (i)}
              <td>
                {#if c}
                  <span class="sq" style:background={c.color} style:color={c.text} title={`${c.count} × ${c.name}`}>
                    {c.count}
                  </span>
                {/if}
              </td>
            {/each}
            <td>
              {#if r.audio}
                <span class="sq" style:background={r.audio.color} style:color={r.audio.text} title={`${r.audio.count} × ${r.audio.name}`}>
                  {r.audio.count}
                </span>
              {/if}
            </td>
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr><td class="empty" colspan={instruments.length + 2}>No songs in the library yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</section>

<style>
  .status {
    --cell: 34px;
    --song-col: 220px;
    max-width: 100%;
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

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--ink);
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.18);
  }

  .scroller {
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
    /* Bound the height so the sticky header/column have something to scroll
       against on long libraries. */
    max-height: calc(100vh - 120px);
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
  }

  th,
  td {
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  /* Square intersections: every instrument/audio column is one cell wide and
     every row one cell tall. */
  .col-head,
  td {
    width: var(--cell);
    min-width: var(--cell);
    max-width: var(--cell);
  }

  td {
    height: var(--cell);
    padding: 0;
    text-align: center;
    vertical-align: middle;
  }

  /* Rotated column headers read bottom-to-top to keep columns narrow. */
  .col-head {
    vertical-align: bottom;
    padding: 6px 0;
    background: var(--panel);
  }

  .col-head span {
    display: inline-block;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    white-space: nowrap;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink);
  }

  .col-head.audio span {
    color: var(--accent-strong);
  }

  /* Sticky song name column + sticky header row, with a sticky corner. */
  .row-head,
  .corner {
    width: var(--song-col);
    min-width: var(--song-col);
    max-width: var(--song-col);
    position: sticky;
    left: 0;
    background: var(--panel);
    text-align: left;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0 10px;
    z-index: 1;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  .corner {
    z-index: 3;
    vertical-align: bottom;
    padding-bottom: 8px;
  }

  .row-head {
    color: var(--ink);
    word-break: break-word;
  }

  tbody tr:nth-child(even) .row-head {
    background: var(--paper);
  }

  tbody tr:nth-child(even) td {
    background: rgba(0, 0, 0, 0.02);
  }

  .sq {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1;
  }

  .empty {
    padding: 16px;
    color: var(--muted);
    text-align: center;
  }
</style>
