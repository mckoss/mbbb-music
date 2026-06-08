<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune, CatalogPart, CatalogAsset, UnreachableItem } from '$lib/types';
  import { instrumentDisplay, partLabel, audioLabel, stripCopyOf } from '$lib/format';
  import { sourceStyle, UNREACHABLE_STYLE } from '$lib/sources';

  const catalog = $derived(page.data.catalog as Catalog);
  const tunes = $derived(catalog.tunes ?? []);
  const instruments = $derived(catalog.instruments ?? []);
  // Source labels in priority order (highest first); index is the rank.
  const sources = $derived(catalog.sources ?? []);

  const rank = (label: string | null) => {
    const i = sources.indexOf(label ?? '');
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  // Anything carrying a source + (optional) instrument/format/name — covers both
  // reachable assets/parts and unreachable items.
  type Sourced = { source: string | null; sha256?: string } & Partial<CatalogPart> & Partial<UnreachableItem>;

  interface CellItem {
    href: string;
    label: string;
    color: string; // popup link accent (red for unreachable)
    unreachable: boolean;
  }
  interface Cell {
    count: number;
    color: string; // square background (the principal's color; red if it's unreachable)
    text: string;
    name: string;
    items: CellItem[];
    dot: boolean; // a non-red square that still hides an unreachable file
  }

  // The indicator for a column's reachable + unreachable items. The square is
  // colored by the principal (highest-priority source, ties preferring a
  // reachable copy); it's red only when that principal is itself unreachable.
  // Each popup item is colored by its own status (red when unreachable).
  function buildCell(
    reachable: Sourced[],
    unreachable: UnreachableItem[],
    makeLabel: (a: Sourced) => string
  ): Cell | null {
    const all = [
      ...reachable.map((it) => ({ it, unreachable: false })),
      ...unreachable.map((it) => ({ it: it as Sourced, unreachable: true })),
    ];
    if (all.length === 0) return null;

    let principal = all[0];
    for (const cur of all) {
      const better =
        rank(cur.it.source) < rank(principal.it.source) ||
        (rank(cur.it.source) === rank(principal.it.source) && principal.unreachable && !cur.unreachable);
      if (better) principal = cur;
    }
    const style = principal.unreachable ? UNREACHABLE_STYLE : sourceStyle(principal.it.source);
    // A non-red square that nonetheless hides an unreachable copy gets a corner
    // dot, so a buried permissions gap is visible at a glance.
    const dot = !principal.unreachable && all.some((a) => a.unreachable);

    return {
      count: all.length,
      color: style.color,
      text: style.text,
      name: style.name,
      dot,
      items: all.map(({ it, unreachable: un }) => ({
        href: un ? (it.driveUrl ?? '#') : `/blob/${it.sha256}`,
        label: un ? `${makeLabel(it)} — unreachable` : makeLabel(it),
        color: un ? UNREACHABLE_STYLE.color : 'var(--accent-strong)',
        unreachable: un,
      })),
    };
  }

  const partItemLabel = (p: Sourced) =>
    `${partLabel(p as CatalogPart)} — ${p.format === 'lyre' ? 'Lyre' : 'Letter'}`;
  const audioItemLabel = (a: Sourced) => audioLabel(a.originalName ?? null);
  const museItemLabel = (a: Sourced) => (a.originalName ? stripCopyOf(a.originalName) : 'MuseScore file');
  const scoreItemLabel = (a: Sourced) => (a.originalName ? stripCopyOf(a.originalName) : 'Full score');

  const partsFor = (t: Tune, slug: string) => t.parts.filter((p) => p.instrumentSlug === slug);
  // Route unreachable items to the same columns as their reachable counterparts.
  const unMusescore = (t: Tune) => (t.unreachable ?? []).filter((u) => u.assetType === 'musescore');
  const unAudio = (t: Tune) => (t.unreachable ?? []).filter((u) => u.assetType === 'mp3');
  const unScore = (t: Tune) => (t.unreachable ?? []).filter((u) => u.assetType === 'pdf' && !u.instrumentSlug);
  const unFor = (t: Tune, slug: string) => (t.unreachable ?? []).filter((u) => u.instrumentSlug === slug);

  // Columns, left to right: the master MuseScore source, audio, the whole-band
  // PDF (instrument-less full scores), then one column per instrument.
  const columns = $derived([
    { key: 'musescore', label: 'MuseScore (Master)' },
    { key: 'audio', label: 'Audio' },
    { key: 'score', label: 'Whole Band (PDF)' },
    ...instruments.map((i) => ({ key: i.slug, label: instrumentDisplay(i.label, i.key) })),
  ]);

  // One row per tune; cells aligned to `columns`.
  const rows = $derived(
    tunes.map((t) => ({
      slug: t.slug,
      title: t.title,
      cells: [
        buildCell(t.musescore, unMusescore(t), museItemLabel),
        buildCell(t.audio, unAudio(t), audioItemLabel),
        buildCell(t.scores, unScore(t), scoreItemLabel),
        ...instruments.map((inst) => buildCell(partsFor(t, inst.slug), unFor(t, inst.slug), partItemLabel)),
      ] as (Cell | null)[],
    }))
  );

  // Legend: one entry per configured source (linked to its Drive folder when
  // known), plus the reserved "unreachable" red.
  const legend = $derived([
    ...sources.map((s) => ({ key: s, url: catalog.sourceUrls?.[s] ?? null, ...sourceStyle(s) })),
    { key: '__unreachable', url: null, ...UNREACHABLE_STYLE },
  ]);

  // Clicking a square: a lone file opens (full screen for a reachable file, or
  // the Drive "request access" page for an unreachable one); several open a popup
  // of links. Escape (or the ×) closes the popup.
  let popup = $state<{ title: string; items: CellItem[] } | null>(null);

  function openCell(cell: Cell | null, colLabel: string, songTitle: string) {
    if (!cell) return;
    if (cell.count === 1) {
      const href = cell.items[0].href;
      if (href && href !== '#') window.open(href, '_blank', 'noopener');
      return;
    }
    popup = { title: `${songTitle} — ${colLabel}`, items: cell.items };
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && popup) popup = null;
  }
</script>

<svelte:window onkeydown={onKey} />

<section class="status">
  <header>
    <p class="kicker">Library Health</p>
    <h2>Coverage by song &amp; instrument</h2>
    <p class="body">
      Each square marks where a score (or recording) exists and the color shows
      its primary source. The number counts every copy in the library — all parts
      and both Letter/Lyre formats. <strong>Red</strong> flags a part that's only a
      shortcut the sync can't read (a permissions gap to fix in Drive). Click a
      square to open it (a single file opens full screen; several open a list).
      Blank means nothing is on file.
    </p>
    <p class="count">{tunes.length} songs · {instruments.length} instruments</p>

    <ul class="legend">
      {#each legend as l (l.key)}
        <li>
          <span class="swatch" style:background={l.color}></span>
          {#if l.url}
            <a href={l.url} target="_blank" rel="noopener">{l.name}</a>
          {:else}
            {l.name}
          {/if}
        </li>
      {/each}
    </ul>
  </header>

  <div class="scroller">
    <table>
      <thead>
        <tr>
          <th class="corner" scope="col">Song</th>
          {#each columns as col (col.key)}
            <th class="col-head" class:special={col.key === 'musescore' || col.key === 'audio' || col.key === 'score'} scope="col">
              <span>{col.label}</span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.slug)}
          <tr>
            <th class="row-head" scope="row">{r.title}</th>
            {#each r.cells as c, i (i)}
              <td>
                {#if c}
                  <button
                    class="sq"
                    style:background={c.color}
                    style:color={c.text}
                    title={c.dot
                      ? `${c.count} × ${c.name} — includes an unreachable copy — click to open`
                      : `${c.count} × ${c.name} — click to open`}
                    onclick={() => openCell(c, columns[i].label, r.title)}
                  >
                    {c.count}
                    {#if c.dot}<span class="dot" aria-hidden="true"></span>{/if}
                  </button>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
        {#if rows.length === 0}
          <tr><td class="empty" colspan={columns.length + 1}>No songs in the library yet.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</section>

{#if popup}
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label={popup.title}>
      <header class="modal-head">
        <h3>{popup.title}</h3>
        <button class="x" onclick={() => (popup = null)} aria-label="Close">×</button>
      </header>
      <ul class="modal-list">
        {#each popup.items as it, i (i)}
          <li>
            <a
              href={it.href}
              target="_blank"
              rel="noopener"
              class:unreachable={it.unreachable}
              style:color={it.color}
              onclick={() => (popup = null)}
            >{it.label}</a>
          </li>
        {/each}
      </ul>
      <p class="modal-hint">Press Esc to close</p>
    </div>
  </div>
{/if}

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

  .legend a {
    color: var(--accent-strong);
    text-decoration: underline;
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

  /* Square intersections: every value column is one cell wide and every row one
     cell tall. */
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

  .col-head.special span {
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
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 800;
    line-height: 1;
    cursor: pointer;
    transition: transform 0.06s ease, box-shadow 0.06s ease;
  }

  /* Corner marker: this otherwise-OK square hides an unreachable copy. */
  .dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d8413a;
    border: 1px solid #fffdf7;
  }

  .sq:hover {
    transform: scale(1.18);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25);
  }

  .sq:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 1px;
  }

  .empty {
    padding: 16px;
    color: var(--muted);
    text-align: center;
  }

  /* Popup for cells with several files. */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal {
    background: var(--panel);
    color: var(--ink);
    border-radius: 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
    width: min(440px, 100%);
    max-height: 80vh;
    overflow: auto;
    padding: 18px 20px;
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .modal-head h3 {
    font-size: 1.05rem;
  }

  .x {
    border: 0;
    background: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--muted);
    padding: 0 4px;
  }

  .modal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .modal-list a {
    display: flex;
    min-height: 44px;
    align-items: center;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    text-decoration: none;
    background: #f7f5ef;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .modal-list a.unreachable {
    border-color: #d8413a;
    background: #fdf1f0;
  }

  .modal-hint {
    margin-top: 12px;
    color: var(--muted);
    font-size: 0.78rem;
    text-align: right;
  }
</style>
