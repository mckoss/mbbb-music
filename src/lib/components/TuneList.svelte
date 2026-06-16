<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Catalog, Tune } from '$lib/types';
  import { search, instrumentSlug, printFormat } from '$lib/stores';
  import { activePdf, partsFor, type ActivePdf } from '$lib/resolve';
  import { scoreSearch } from '$lib/nav';
  import { playSha, audio } from '$lib/audio';
  import { instrumentDisplay, audioLabel, stripCopyOf } from '$lib/format';
  import { ALL_STATUSES, STATUS_DESC, type SongStatus } from '$lib/song-status';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import AudioPlayer from './AudioPlayer.svelte';

  let { tunes }: { tunes: Tune[] } = $props();

  const catalog = $derived(page.data.catalog as Catalog);

  // Friendly, slug-based download/open URLs keyed off the catalog (no raw sha in
  // the link or the saved filename). `?dl` forces a download; the filename is
  // the last path segment. Falls back to /blob only if a hash isn't indexed.
  const assetIndex = $derived(assetIndexFor(catalog));
  const openUrl = (sha: string) => urlForSha(assetIndex, sha) ?? `/blob/${sha}`;
  const dlUrl = (sha: string) => `${openUrl(sha)}?dl`;

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

  // Which row has its Downloads panel open (at most one at a time, on demand —
  // the row itself stays a compact summary by default).
  let openDl = $state<string | null>(null);

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

  function getActive(t: Tune): ActivePdf | null {
    return activePdf(t, $instrumentSlug, $printFormat);
  }

  function openScore(t: Tune) {
    const active = getActive(t);
    if (!active) return;
    goto(
      scoreSearch({
        song: t.slug,
        instrument: $instrumentSlug,
        format: $printFormat,
        part: active.isScore ? null : active.sha,
      }),
      { keepFocus: true, noScroll: true }
    );
  }

  // Which recording each multi-take song plays (keyed by slug; defaults to the
  // first, which the catalog orders as the full-band mix). Picking one plays it.
  let chosenAudio = $state<Record<string, string>>({});
  function audioSha(t: Tune): string | null {
    return chosenAudio[t.slug] ?? t.audio[0]?.sha256 ?? null;
  }
  function playAudio(t: Tune) {
    const sha = audioSha(t);
    if (sha) playSha(sha, t.title);
  }
  function pickAudio(t: Tune, sha: string) {
    chosenAudio[t.slug] = sha;
    playSha(sha, t.title);
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
      {@const active = getActive(t)}
      <li class="row">
        <div class="row-body">
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
          </div>
        </div>

        <div class="row-actions">
          <button class="act" onclick={() => openScore(t)} disabled={!active}>Score</button>
          <button class="act" onclick={() => playAudio(t)} disabled={t.audio.length === 0}>Audio</button>
          {#if t.audio.length > 1}
            <select
              class="rec"
              aria-label="Recording for {t.title}"
              value={audioSha(t)}
              onchange={(e) => pickAudio(t, e.currentTarget.value)}
            >
              {#each t.audio as a (a.sha256)}
                <option value={a.sha256}>{audioLabel(a.originalName)}</option>
              {/each}
            </select>
          {/if}
          <button
            class="act ghost"
            aria-expanded={openDl === t.slug}
            onclick={() => (openDl = openDl === t.slug ? null : t.slug)}
          >⤓ Files {openDl === t.slug ? '▴' : '▾'}</button>
        </div>

        {#if openDl === t.slug}
          <div class="downloads">
            {#if active && !active.isScore}
              <a class="dl" href={dlUrl(active.sha)} download>
                ⤓ Part (PDF)
              </a>
            {/if}
            {#each t.scores as s, i (s.sha256)}
              <a class="dl" href={dlUrl(s.sha256)} download>
                ⤓ Full score{t.scores.length > 1 ? ` ${i + 1}` : ''} (PDF)
              </a>
            {/each}
            {#each t.notes as n (n.sha256)}
              <a class="dl" href={dlUrl(n.sha256)} download>
                ⤓ {n.originalName ? stripCopyOf(n.originalName) : 'Notes'} (PDF)
              </a>
            {/each}
            {#if t.musescore[0]}
              <a class="dl" href={dlUrl(t.musescore[0].sha256)} download>⤓ MuseScore</a>
            {/if}
            {#each t.audio as a (a.sha256)}
              <a class="dl" href={dlUrl(a.sha256)} download>
                ⤓ {audioLabel(a.originalName)} (MP3)
              </a>
            {/each}
            {#each t.files as f (f.sha256)}
              <a class="dl" href={dlUrl(f.sha256)} download>
                ⤓ {f.originalName ? stripCopyOf(f.originalName) : (f.assetType ?? 'Download')}
              </a>
            {/each}
            {#if !active && t.scores.length === 0 && t.notes.length === 0 && !t.musescore[0] && t.audio.length === 0 && t.files.length === 0}
              <span class="dl-empty">Nothing to download.</span>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
    {#if filtered.length === 0}
      <li class="empty">
        {tunes.length === 0 ? 'No music in the library yet.' : `No titles match “${$search}”.`}
      </li>
    {/if}
  </ul>

  <!-- Rows no longer expand to host a player, so the transport lives here as a
       sticky bar that appears once something is playing and stays put as you
       scroll the list. Bound to the shared store, so it continues a track
       started from any row. -->
  {#if $audio.sha}
    <div class="now-playing">
      <AudioPlayer sha={$audio.sha} title={$audio.title} />
    </div>
  {/if}
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

  /* A folder-style summary row: title + status + date on top, the instrument's
     part summary and content badges below, quick actions on the right. Always
     visible — no expansion needed to read what a song contains. */
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 12px;
    row-gap: 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 12px;
    background: var(--panel);
  }

  .row-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
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

  .row-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .act {
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #f7f5ef;
    color: var(--accent-strong);
    font-size: 0.74rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .act.ghost {
    background: var(--panel);
    color: var(--muted);
  }

  .act:disabled {
    color: var(--muted);
    background: var(--paper);
    cursor: not-allowed;
  }

  /* Recording picker — only shown for songs with more than one take. */
  .rec {
    max-width: 11rem;
    min-height: 40px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 8px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.74rem;
  }

  .downloads {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px dashed var(--line);
  }

  .dl {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    text-decoration: none;
    color: var(--accent-strong);
    background: #f7f5ef;
    font-weight: 600;
    font-size: 0.8rem;
  }

  .dl-empty {
    color: var(--muted);
    font-size: 0.8rem;
    padding: 8px 0;
  }

  .empty {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 12px;
  }

  /* Sticky transport: stays at the bottom of the viewport while the list
     scrolls, so playback controls are always reachable without an expanded row. */
  .now-playing {
    position: sticky;
    bottom: 8px;
    margin-top: 6px;
    box-shadow: var(--shadow);
    border-radius: 8px;
  }

  @media (max-width: 560px) {
    .row {
      grid-template-columns: 1fr;
    }
    .row-actions {
      justify-content: flex-start;
    }
  }
</style>
