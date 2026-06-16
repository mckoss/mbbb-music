<script lang="ts">
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import { search, instrumentSlug, printFormat } from '$lib/stores';
  import { activePdf, partsFor, type ActivePdf } from '$lib/resolve';
  import { scoreSearch } from '$lib/nav';
  import { instrumentDisplay } from '$lib/format';
  import { ALL_STATUSES, STATUS_DESC, type SongStatus } from '$lib/song-status';

  let { tunes }: { tunes: Tune[] } = $props();

  const catalog = $derived(page.data.catalog as Catalog);

  // Friendly name of the globally-selected instrument, for the "my part" line.
  const instLabel = $derived.by(() => {
    const inst = catalog.instruments.find((i) => i.slug === $instrumentSlug);
    return inst ? instrumentDisplay(inst.label, inst.key) : $instrumentSlug;
  });

  // Status filter chips. Archived songs are hidden by default; toggle a chip to
  // include/exclude that status. Ephemeral (resets per visit), like the search.
  let show = $state<Record<SongStatus, boolean>>({
    Always: true,
    Active: true,
    Learning: true,
    Archive: false,
    Unfiled: true,
  });

  const filtered = $derived(
    tunes.filter(
      (t) =>
        show[t.status] &&
        (!$search.trim() || t.title.toLowerCase().includes($search.trim().toLowerCase()))
    )
  );

  const FORMAT_ORDER = ['letter', 'lyre'] as const;
  const FORMAT_LABEL: Record<string, string> = { letter: 'Letter', lyre: 'Lyre' };

  // Instrument-aware one-liner: how many parts the current instrument has and in
  // which formats — or a clear note when there's only the full score to fall
  // back on. Answers "can I play this on my instrument?" at a glance.
  function partLine(t: Tune): string {
    const parts = partsFor(t, $instrumentSlug);
    if (parts.length === 0) {
      return t.scores.length ? `No ${instLabel} part — full score only` : `No ${instLabel} part`;
    }
    const fmts = FORMAT_ORDER.filter((f) => parts.some((p) => p.format === f)).map(
      (f) => FORMAT_LABEL[f]
    );
    const n = `${parts.length} part${parts.length === 1 ? '' : 's'}`;
    return fmts.length ? `${instLabel} · ${n} · ${fmts.join(' + ')}` : `${instLabel} · ${n}`;
  }

  // Max modified date across the song's files (catalog already rolls this up),
  // shown with the year per the folder-listing feel.
  function dateLabel(iso: string | null): string {
    return iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '';
  }

  // The whole row links into the Score view, where the chart, audio, parts,
  // format, and downloads all live now. Defaults to the instrument's part (so a
  // player lands on their chart); the score view falls back to the full score or
  // notes when there's no part, and hosts audio even for chart-less songs.
  function scoreHref(t: Tune): string {
    const active: ActivePdf | null = activePdf(t, $instrumentSlug, $printFormat);
    return scoreSearch({
      song: t.slug,
      instrument: $instrumentSlug,
      format: $printFormat,
      part: active && !active.isScore ? active.sha : null,
    });
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
    <div class="status-filter" role="group" aria-label="Filter by status">
      {#each ALL_STATUSES as s (s)}
        <button
          type="button"
          class="chip"
          class:on={show[s]}
          title={STATUS_DESC[s]}
          aria-pressed={show[s]}
          onclick={() => (show[s] = !show[s])}
        >{s}</button>
      {/each}
    </div>
  </header>

  <ul class="rows">
    {#each filtered as t (t.slug)}
      <li>
        <a class="row" href={scoreHref(t)} data-sveltekit-noscroll>
          <div class="row-head">
            <span class="title">{t.title}</span>
            <span class="status s-{t.status}" title={STATUS_DESC[t.status]}>{t.status}</span>
            {#if t.lastModified}
              <time class="date" datetime={t.lastModified}>{dateLabel(t.lastModified)}</time>
            {/if}
          </div>
          <div class="row-sub">
            <span class="part-line">{partLine(t)}</span>
            <span class="badges">
              {#if t.audio.length}<span class="badge" title="Recordings">▶ {t.audio.length}</span>{/if}
              {#if t.musescore.length}<span class="badge" title="MuseScore source">𝄞 MuseScore</span>{/if}
              {#if t.notes.length}<span class="badge" title="Notes (Google Docs)">📝 {t.notes.length}</span>{/if}
              {#if t.images.length}<span class="badge" title="Images">🖼 {t.images.length}</span>{/if}
              {#if t.files.length}<span class="badge" title="Other files">📎 {t.files.length}</span>{/if}
            </span>
            <span class="chevron" aria-hidden="true">›</span>
          </div>
        </a>
      </li>
    {/each}
    {#if filtered.length === 0}
      <li class="empty">
        {tunes.length === 0 ? 'No music in the library yet.' : `No titles match “${$search}”.`}
      </li>
    {/if}
  </ul>
</section>

<style>
  .list-pane {
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

  .status-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .chip {
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.76rem;
    font-weight: 600;
    background: var(--paper);
    color: var(--muted);
    cursor: pointer;
  }

  .chip.on {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: #fffdf7;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* A folder-style summary row that is now a single tap target into the Score
     view: title + status + date on top, the instrument's part summary and
     content badges below, with a chevron hinting it opens. */
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--panel);
    text-decoration: none;
    color: inherit;
    cursor: pointer;
  }

  .row:hover {
    border-color: var(--accent);
    background: #f7f5ef;
  }

  .row-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--ink);
  }

  .date {
    margin-left: auto; /* push to the right edge; title + status stay flush left */
    color: var(--muted);
    font-size: 0.74rem;
    white-space: nowrap;
  }

  .row-sub {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .part-line {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .badge {
    font-size: 0.72rem;
    color: var(--muted);
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 7px;
    white-space: nowrap;
  }

  /* Chevron affordance pinned to the right edge of the sub-line. */
  .chevron {
    margin-left: auto;
    color: var(--accent);
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1;
  }

  /* Status chip, keyed to the song's lifecycle state. */
  .status {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: 999px;
    padding: 2px 9px;
    border: 1px solid var(--line);
    color: var(--muted);
    background: var(--paper);
    white-space: nowrap;
  }
  .status.s-Always {
    color: #1f6f43;
    background: #e6f4ea;
    border-color: #b6dcc4;
  }
  .status.s-Active {
    color: #1b4f9c;
    background: #e7eefb;
    border-color: #bcd0f2;
  }
  .status.s-Learning {
    color: #8a5a00;
    background: #fbf0d8;
    border-color: #ecd9a8;
  }
  .status.s-Archive {
    color: var(--muted);
    background: var(--paper);
    border-color: var(--line);
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 12px;
  }
</style>
