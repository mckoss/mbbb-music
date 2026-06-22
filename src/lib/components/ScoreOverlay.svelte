<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import type { Catalog } from '$lib/types';
  import { viewableDocs } from '$lib/resolve';
  import { instrumentDisplay, audioLabel, stripCopyOf } from '$lib/format';
  import { assetIndexFor, urlForSha } from '$lib/asset-urls';
  import { track } from '$lib/track';
  import AudioPlayer from './AudioPlayer.svelte';
  import PdfPager from './PdfPager.svelte';

  // The overlay is driven entirely by the URL: it's open when ?view=score, and
  // shows the PDF for ?song / ?instrument / ?format / ?part (each falling back to
  // the cookie-persisted store when absent). This makes it shareable and survive
  // a refresh, and the browser Back button closes it.
  const catalog = $derived(page.data.catalog as Catalog);
  const assetIndex = $derived(assetIndexFor(catalog));
  const openUrl = (sha: string) => urlForSha(assetIndex, sha) ?? `/blob/${sha}`;
  const dlUrl = (sha: string) => `${openUrl(sha)}?dl`;
  const params = $derived(page.url.searchParams);
  const open = $derived(params.get('view') === 'score');
  const tune = $derived(catalog?.tunes?.find((t) => t.slug === params.get('song')) ?? null);
  const instrument = $derived(params.get('instrument') ?? $instrumentSlug);
  const format = $derived(((params.get('format') as PrintFormat) || $printFormat) as PrintFormat);
  // `part` is the chosen part's content sha (a unique handle), or null for the
  // default/full score. Addressing by sha — not a part number — lets two variants
  // that share an instrument/key (different arrangements) each be selected.
  const partSha = $derived(params.get('part'));

  // Two ways to read a score (#1). Practice: chrome + the MP3 player on top, with
  // the page scaled to fit below it. Performance: full-screen, no player, large
  // page, paged by tapping the left/right edges (iPad on a music stand).
  type Mode = 'practice' | 'performance';
  const mode = $derived<Mode>(params.get('mode') === 'performance' ? 'performance' : 'practice');
  // A plain boolean for template branching, so Svelte's TS narrowing doesn't
  // collapse `mode` to a literal inside the {:else} block.
  const isPerformance = $derived(mode === 'performance');

  // Every PDF this song can show — the instrument's parts, the full-band
  // score(s), and notes — in priority order. The chosen one is addressed by sha
  // (?part); absent/stale, fall back to the first (a part, else a real score).
  const docs = $derived(open && tune ? viewableDocs(tune, instrument, format) : []);
  const current = $derived(docs.find((d) => d.sha === partSha) ?? docs[0] ?? null);
  const title = $derived(tune?.title ?? '');

  // Record a score view (or a performance) when the overlay opens or switches
  // mode. Server-side dedup collapses repeats; the local key avoids re-firing on
  // unrelated reactive ticks.
  let lastTracked = '';
  $effect(() => {
    if (!browser || !open || !tune) return;
    const key = `${tune.slug}|${instrument}|${mode}`;
    if (key === lastTracked) return;
    lastTracked = key;
    track(mode === 'performance' ? 'performance' : 'score-view', tune.title, instrument);
  });

  // Recording picker for the practice player: default to the first take (the
  // catalog orders the full-band mix first), reset when the song changes.
  const audios = $derived(tune?.audio ?? []);
  let chosenAudioSha = $state<string | null>(null);
  $effect(() => {
    void tune?.slug;
    chosenAudioSha = audios[0]?.sha256 ?? null;
  });
  const practiceAudio = $derived(audios.find((a) => a.sha256 === chosenAudioSha) ?? audios[0] ?? null);

  // Downloads for this song, surfaced via a compact "Files" dropdown (the
  // collection list no longer carries them). The currently-shown part comes
  // first, then full scores, MuseScore, recordings, notes, and other files.
  interface DlItem {
    sha: string;
    label: string;
  }
  let filesOpen = $state(false);
  const downloads = $derived.by<DlItem[]>(() => {
    if (!tune) return [];
    const out: DlItem[] = [];
    if (current && current.kind === 'part') out.push({ sha: current.sha, label: 'This part (PDF)' });
    tune.scores.forEach((s, i) =>
      out.push({ sha: s.sha256, label: `Full score${tune!.scores.length > 1 ? ` ${i + 1}` : ''} (PDF)` })
    );
    if (tune.musescore[0]) out.push({ sha: tune.musescore[0].sha256, label: 'MuseScore' });
    tune.audio.forEach((a) => out.push({ sha: a.sha256, label: `${audioLabel(a.originalName)} (MP3)` }));
    tune.notes.forEach((n) =>
      out.push({ sha: n.sha256, label: `${n.originalName ? stripCopyOf(n.originalName) : 'Notes'} (PDF)` })
    );
    tune.files.forEach((f) =>
      out.push({ sha: f.sha256, label: f.originalName ? stripCopyOf(f.originalName) : (f.assetType ?? 'Download') })
    );
    return out;
  });

  // Instrument/part are switchable in-place: changing them updates the URL params
  // (replaceState — no remount), which re-resolves the PDF below. Audio plays
  // through a global singleton element, so swapping the score never interrupts it.
  const instruments = $derived(catalog?.instruments ?? []);

  function close() {
    if (!browser) return;
    // Pop our pushed entry so Back stays consistent; if we got here directly
    // (deep link / fresh tab), just drop the score params in place.
    if (window.history.length > 1) history.back();
    else {
      const p = new URLSearchParams(page.url.search);
      p.delete('view');
      p.delete('part');
      goto(`?${p}`, { replaceState: true });
    }
  }

  function setFormat(fmt: PrintFormat) {
    printFormat.set(fmt); // keep the cookie/global in sync
    const p = new URLSearchParams(page.url.search);
    p.set('format', fmt);
    goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function setInstrument(slug: string) {
    instrumentSlug.set(slug); // keep the cookie/global in sync
    const p = new URLSearchParams(page.url.search);
    p.set('instrument', slug);
    p.delete('part'); // a part number is meaningless for a different instrument
    goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function setPart(value: string) {
    const p = new URLSearchParams(page.url.search);
    if (value === '') p.delete('part');
    else p.set('part', value);
    goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function setMode(m: Mode) {
    const p = new URLSearchParams(page.url.search);
    if (m === 'practice') p.delete('mode');
    else p.set('mode', m);
    goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    if (filesOpen) filesOpen = false;
    else close();
  }

  // Close the Files popover when clicking anywhere outside it.
  function onWindowClick(e: MouseEvent) {
    if (filesOpen && !(e.target as HTMLElement).closest('.files')) filesOpen = false;
  }

  // Open the raw PDF in a new tab so the browser's own viewer handles a reliable
  // full-document print (the on-screen view shows one rasterized page at a time).
  function print() {
    if (browser && current) window.open(openUrl(current.sha), '_blank', 'noopener');
  }
</script>

<svelte:window onkeydown={onKey} onclick={onWindowClick} />

{#if open && tune}
  <div class="overlay" class:performance={isPerformance}>
    {#if isPerformance}
      <!-- No chrome on a music stand: a single floating Back arrow (top-left,
           the same corner as Practice mode's) steps back to the full Score view.
           It sits above the page-tap zones, so it always wins a tap. -->
      <div class="floating">
        <button
          class="back"
          onclick={() => setMode('practice')}
          aria-label="Back to Score view"
          title="Back to Score view">←</button
        >
      </div>
    {:else}
    <header class="bar">
      <button class="back" onclick={close} aria-label="Back to Collection" title="Back to Collection">←</button>
      <div class="info">
        <p class="kicker perf">Score view</p>
        <h2>{title}</h2>
        <p class="sub">{current?.label ?? 'No chart'} · {format === 'lyre' ? 'Lyre' : 'Letter'}</p>
      </div>

      <div class="controls">
        <div class="mode-toggle" role="group" aria-label="View mode">
          <button class:on={mode === 'practice'} onclick={() => setMode('practice')}>Practice</button>
          <button class:on={mode === 'performance'} onclick={() => setMode('performance')}>Performance</button>
        </div>
        {#if instruments.length}
          <label class="fmt">
            <span class="eyebrow">Instrument</span>
            <select value={instrument} onchange={(e) => setInstrument(e.currentTarget.value)}>
              {#each instruments as inst (inst.slug)}
                <option value={inst.slug}>{instrumentDisplay(inst.label, inst.key)}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if docs.length > 1}
          <label class="fmt">
            <span class="eyebrow">Document</span>
            <select
              value={current?.sha ?? ''}
              onchange={(e) => setPart(e.currentTarget.value)}
            >
              {#each docs as d (d.sha)}
                <option value={d.sha}>{d.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="fmt">
          <span class="eyebrow">Format</span>
          <select value={format} onchange={(e) => setFormat(e.currentTarget.value as PrintFormat)}>
            <option value="letter">Letter</option>
            <option value="lyre">Lyre</option>
          </select>
        </label>
        <button class="ghost" onclick={print} disabled={!current}>Print</button>
        <div class="files">
          <button class="ghost" onclick={() => (filesOpen = !filesOpen)} aria-expanded={filesOpen}>
            Files ⤓
          </button>
          {#if filesOpen}
            <div class="files-pop">
              {#each downloads as d (d.sha + d.label)}
                <a class="dl" href={dlUrl(d.sha)} download onclick={() => (filesOpen = false)}>⤓ {d.label}</a>
              {/each}
              {#if downloads.length === 0}
                <span class="dl-empty">Nothing to download.</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </header>

    <div class="practice">
      {#if audios.length > 1}
        <label class="fmt">
          <span class="eyebrow">Recording</span>
          <select value={chosenAudioSha} onchange={(e) => (chosenAudioSha = e.currentTarget.value)}>
            {#each audios as a (a.sha256)}
              <option value={a.sha256}>{audioLabel(a.originalName)}</option>
            {/each}
          </select>
        </label>
      {/if}
      <AudioPlayer sha={practiceAudio?.sha256 ?? null} title={title} />
    </div>
    {/if}

    <div class="stage">
      {#if current}
        <PdfPager sha={current.sha} title={`${title} — ${current.label}`} tap={mode === 'performance'} openHref={openUrl(current.sha)} />
      {:else}
        <div class="no-chart">
          <p>No chart for “{title}” in this instrument / format.</p>
          <p class="hint">
            Switch the instrument or format above{audios.length ? ', or play a recording below' : ''}.
          </p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #202124;
    color: #fffdf7;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-end;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid rgba(255, 253, 247, 0.12);
  }

  .perf {
    color: #f2d36b;
  }

  h2 {
    font-size: 1.4rem;
    margin-top: 4px;
  }

  .sub {
    color: #dfddd4;
    font-size: 0.85rem;
    margin-top: 2px;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
  }

  .fmt {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
  }

  .fmt span {
    color: #dfddd4;
  }

  select {
    min-height: 44px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 10px;
  }

  button {
    min-height: 44px;
    padding: 0 18px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.82rem;
  }

  .ghost {
    background: transparent;
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
  }

  /* Back arrow — the single, consistent "step out" affordance. Practice mode →
     Collection; performance mode → the full Score view. Same top-left corner in
     both, so it's muscle memory. */
  .back {
    min-width: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    line-height: 1;
    background: rgba(255, 253, 247, 0.12);
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
    border-radius: 8px;
  }

  .back:hover {
    background: rgba(255, 253, 247, 0.22);
  }

  .bar .back {
    align-self: flex-start;
  }

  /* Files dropdown: a compact button revealing the song's downloads. */
  .files {
    position: relative;
  }

  .files-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    min-width: 230px;
    max-height: 60vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-radius: 8px;
    background: #2c2d31;
    border: 1px solid rgba(255, 253, 247, 0.25);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .dl {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border-radius: 6px;
    text-decoration: none;
    color: #fffdf7;
    background: rgba(255, 253, 247, 0.1);
    border: 1px solid rgba(255, 253, 247, 0.2);
    font-size: 0.82rem;
    font-weight: 600;
  }

  .dl:hover {
    background: rgba(255, 253, 247, 0.18);
  }

  .dl-empty {
    color: #b9b6ac;
    font-size: 0.82rem;
    padding: 6px;
  }

  /* Shown in the stage when the song has no chart for the chosen instrument/format. */
  .no-chart {
    margin: auto;
    text-align: center;
    color: #dfddd4;
    padding: 24px;
  }

  .no-chart .hint {
    color: #b9b6ac;
    font-size: 0.85rem;
    margin-top: 8px;
  }

  .mode-toggle {
    display: inline-flex;
    border: 1px solid rgba(255, 253, 247, 0.25);
    border-radius: 6px;
    overflow: hidden;
    align-self: flex-end;
  }

  .mode-toggle button {
    min-height: 44px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #dfddd4;
    padding: 0 14px;
  }

  .mode-toggle button.on {
    background: var(--accent);
    color: #fffdf7;
  }

  .practice {
    padding: 14px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    padding: 8px 24px 24px;
  }

  /* Performance mode: no chrome, the page fills the whole screen. */
  .overlay.performance {
    overflow: hidden;
  }

  .overlay.performance .stage {
    padding: 12px;
  }

  .floating {
    position: absolute;
    top: 12px;
    left: 12px; /* same corner as the practice-mode Back arrow */
    z-index: 10; /* above PdfPager's tap zones (no z-index) so the button wins a tap */
    display: flex;
    gap: 10px;
    /* A solid pill so it reads clearly over both the dark stage and a white score
       page, and fully opaque so it's never easy to miss on a music stand. */
    padding: 6px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  @media print {
    .bar,
    .practice,
    .floating {
      display: none;
    }

    .overlay {
      position: static;
      background: #fff;
    }
  }
</style>
