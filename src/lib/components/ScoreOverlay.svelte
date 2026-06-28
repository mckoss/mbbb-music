<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import type { Catalog } from '$lib/types';
  import { viewableDocs, partsForFormat } from '$lib/resolve';
  import { instrumentDisplay, audioLabel, stripCopyOf, partShortLabel } from '$lib/format';
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

  // Three ways to read a score. Score view (default): full chrome — the
  // instrument/part/format pickers, a Files menu, and the roomy player — with the
  // page scaled below. From there you launch one of two immersive, tap-paged,
  // full-screen states: Practice (a one-line player on top) or Perform (no
  // player). The back arrow always steps out to the Collection.
  type Mode = 'score' | 'practice' | 'performance';
  const mode = $derived<Mode>(
    params.get('mode') === 'performance'
      ? 'performance'
      : params.get('mode') === 'practice'
        ? 'practice'
        : 'score'
  );
  // Plain booleans for template branching, so Svelte's TS narrowing doesn't
  // collapse `mode` to a literal across blocks. `immersive` covers both
  // full-screen, tap-paged states (Practice and Perform).
  const isScore = $derived(mode === 'score');
  const isPractice = $derived(mode === 'practice');
  const immersive = $derived(mode !== 'score');

  // Every PDF this song can show — the instrument's parts, the full-band
  // score(s), and notes. The chosen one is addressed by sha (?part); absent or
  // stale, fall back to the first (a part, else a real score).
  const docs = $derived(open && tune ? viewableDocs(tune, instrument, format) : []);
  const current = $derived(docs.find((d) => d.sha === partSha) ?? docs[0] ?? null);
  const title = $derived(tune?.title ?? '');

  // The Part picker offers the instrument's parts only — "which part of my
  // instrument". The full-band score and notes are still viewable, but reached
  // through the Files menu, so this dropdown stays focused and uncluttered.
  const parts = $derived(open && tune ? partsForFormat(tune, instrument, format) : []);
  const currentIsPart = $derived(current ? parts.some((p) => p.sha256 === current.sha) : false);
  // If a non-part doc (full score / notes) is being viewed via the Files menu,
  // surface it as a leading option so the picker still reflects what's on screen
  // and you can switch back to a real part.
  const partOptions = $derived.by(() => {
    const opts = parts.map((p) => ({ sha: p.sha256, label: partShortLabel(p, parts) }));
    if (current && !currentIsPart) opts.unshift({ sha: current.sha, label: current.label });
    return opts;
  });

  // The instrument's display name (with key), for the caption under the title.
  const instruments = $derived(catalog?.instruments ?? []);
  const instObj = $derived(instruments.find((i) => i.slug === instrument) ?? null);
  const instLabel = $derived(instObj ? instrumentDisplay(instObj.label, instObj.key) : instrument);
  // "Trumpet · 1st · Letter" — quiet context line under the song title.
  const caption = $derived(
    [instLabel, current?.label, format === 'lyre' ? 'Lyre' : 'Letter'].filter(Boolean).join(' · ')
  );

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

  // Downloads for this song, surfaced via the Files menu. The currently-shown
  // part comes first, then full scores, MuseScore, recordings, notes, and other
  // files. PDFs that the on-screen pager can render are also viewable in place.
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
    tune.audio.forEach((a) => out.push({ sha: a.sha256, label: `${audioLabel(a.originalName, a.museScore)} (MP3)` }));
    tune.notes.forEach((n) =>
      out.push({ sha: n.sha256, label: `${n.originalName ? stripCopyOf(n.originalName) : 'Notes'} (PDF)` })
    );
    tune.files.forEach((f) =>
      out.push({ sha: f.sha256, label: f.originalName ? stripCopyOf(f.originalName) : (f.assetType ?? 'Download') })
    );
    return out;
  });
  // The shas the pager can show on screen (parts + full scores + notes), so the
  // Files menu can offer "view" alongside "download" for those rows.
  const viewableShas = $derived(new Set(docs.map((d) => d.sha)));

  function close() {
    if (!browser) return;
    // Pop our pushed entry so Back stays consistent; if we got here directly
    // (deep link / fresh tab), just drop the score params in place. Works from
    // any mode — the arrow always returns to the Collection.
    if (window.history.length > 1) history.back();
    else {
      const p = new URLSearchParams(page.url.search);
      p.delete('view');
      p.delete('part');
      p.delete('mode');
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

  function viewDoc(sha: string) {
    setPart(sha);
    filesOpen = false;
  }

  function setMode(m: Mode) {
    const p = new URLSearchParams(page.url.search);
    if (m === 'score') p.delete('mode'); // Score view is the default (no param)
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
    filesOpen = false;
  }
</script>

<svelte:window onkeydown={onKey} onclick={onWindowClick} />

<!-- The recording picker, shared by the Score view's player line and the
     immersive Practice bar. Shown only when a song has more than one take. -->
{#snippet recordingSelect()}
  {#if audios.length > 1}
    <select
      class="rec-sel"
      value={chosenAudioSha}
      onchange={(e) => (chosenAudioSha = e.currentTarget.value)}
      aria-label="Recording"
    >
      {#each audios as a (a.sha256)}
        <option value={a.sha256}>{audioLabel(a.originalName, a.museScore)}</option>
      {/each}
    </select>
  {/if}
{/snippet}

{#if open && tune}
  <div class="overlay" class:immersive>
    {#if isPractice}
      <!-- Practice: one top bar in normal flow — back arrow, recording picker,
           and the one-line player. Reserves its own height so the score sits
           below it with no overlap. The arrow steps back to the Score view. -->
      <div class="immersive-bar">
        <button class="back" onclick={() => setMode('score')} aria-label="Back to Score view" title="Back to Score view">←</button>
        {@render recordingSelect()}
        <AudioPlayer compact sha={practiceAudio?.sha256 ?? null} title={title} />
      </div>
    {:else if !isScore}
      <!-- Perform: minimal chrome — just a floating back arrow (top-left) that
           steps back to the Score view. It floats above the page-tap zones so it
           always wins a tap, on a solid pill so it stays visible over a white
           score page. -->
      <button class="back floating-back" onclick={() => setMode('score')} aria-label="Back to Score view" title="Back to Score view">←</button>
    {:else}
      <header class="bar">
        <button class="back" onclick={close} aria-label="Back to Collection" title="Back to Collection">←</button>
        <div class="info">
          <h2>{title}</h2>
          <p class="sub">{caption}</p>
        </div>
        <!-- Launch the two immersive states. Not a toggle — you step into one and
             the back arrow returns to the Collection. -->
        <div class="mode-launch" role="group" aria-label="Open full-screen mode">
          <button onclick={() => setMode('practice')} title="Full-screen score with a one-line player">✎ Practice</button>
          <button onclick={() => setMode('performance')} title="Full-screen score, no player">▶ Perform</button>
        </div>
      </header>

      <!-- View pickers, always adjacent: Instrument · Part · Format. The Files
           menu (overflow) sits flush right. -->
      <div class="pickers">
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
        {#if partOptions.length > 1}
          <label class="fmt">
            <span class="eyebrow">Part</span>
            <select value={current?.sha ?? ''} onchange={(e) => setPart(e.currentTarget.value)}>
              {#each partOptions as o (o.sha)}
                <option value={o.sha}>{o.label}</option>
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

        <div class="files">
          <button class="ghost" onclick={() => (filesOpen = !filesOpen)} aria-expanded={filesOpen}>
            Files ⤓
          </button>
          {#if filesOpen}
            <div class="files-pop">
              {#if current}
                <button class="file-action" onclick={print}>🖨 Print / open current PDF</button>
              {/if}
              {#each downloads as d (d.sha + d.label)}
                <div class="file-row">
                  {#if viewableShas.has(d.sha)}
                    <button class="file-view" onclick={() => viewDoc(d.sha)} title="View on screen">{d.label}</button>
                  {:else}
                    <span class="file-name">{d.label}</span>
                  {/if}
                  <a class="file-dl" href={dlUrl(d.sha)} download aria-label={`Download ${d.label}`} title="Download">⤓</a>
                </div>
              {/each}
              {#if downloads.length === 0}
                <span class="dl-empty">Nothing to download.</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Audio gets its own full-width row. -->
      <div class="player-row">
        {@render recordingSelect()}
        <AudioPlayer compact sha={practiceAudio?.sha256 ?? null} title={title} />
      </div>
    {/if}

    <div class="stage">
      {#if current}
        <PdfPager sha={current.sha} title={`${title} — ${current.label}`} tap={immersive} openHref={openUrl(current.sha)} />
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

  /* --- Score view header: [←] [title block] ............ [Practice|Perform] --- */
  .bar {
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 16px 24px 12px;
    border-bottom: 1px solid rgba(255, 253, 247, 0.12);
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  h2 {
    font-size: 1.4rem;
    line-height: 1.2;
  }

  .sub {
    color: #b9b6ac;
    font-size: 0.82rem;
    margin-top: 2px;
  }

  /* Shared control sizing: every button and select on a score surface is 44px. */
  select,
  button {
    min-height: 44px;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 700;
  }

  select {
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 10px;
    font-weight: 600;
  }

  button {
    padding: 0 18px;
  }

  .ghost {
    background: transparent;
    color: #fffdf7;
    border: 1px solid rgba(255, 253, 247, 0.35);
  }

  .ghost:hover {
    background: rgba(255, 253, 247, 0.12);
  }

  /* Back arrow — the single, consistent "step out" affordance, top-left on every
     score surface. Always returns to the Collection. */
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
    flex: none;
  }

  .back:hover {
    background: rgba(255, 253, 247, 0.22);
  }

  .bar .back {
    align-self: flex-start;
  }

  /* Two launch buttons into the immersive states, as a segmented control. */
  .mode-launch {
    display: inline-flex;
    border: 1px solid rgba(255, 253, 247, 0.25);
    border-radius: 6px;
    overflow: hidden;
    flex: none;
  }

  .mode-launch button {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #dfddd4;
    padding: 0 16px;
    white-space: nowrap;
  }

  .mode-launch button:hover {
    background: var(--accent);
    color: #fffdf7;
  }

  .mode-launch button + button {
    border-left: 1px solid rgba(255, 253, 247, 0.25);
  }

  /* --- Pickers row: Instrument · Part · Format ............ Files --- */
  .pickers {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
    padding: 12px 24px;
  }

  .fmt {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
  }

  .eyebrow {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #b9b6ac;
  }

  /* Files menu pushes to the right edge of the pickers row. */
  .files {
    position: relative;
    margin-left: auto;
  }

  .files-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    min-width: 260px;
    max-height: 60vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: 8px;
    background: #2c2d31;
    border: 1px solid rgba(255, 253, 247, 0.25);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  /* A Files row: a view target (when the pager can show it) plus a download icon. */
  .file-row {
    display: flex;
    align-items: stretch;
    gap: 4px;
  }

  .file-view,
  .file-name,
  .file-action {
    flex: 1;
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    text-align: left;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    color: #fffdf7;
    background: rgba(255, 253, 247, 0.08);
    border: 1px solid rgba(255, 253, 247, 0.2);
  }

  .file-action {
    margin-bottom: 4px;
    color: #f2d36b;
  }

  .file-view:hover,
  .file-action:hover {
    background: rgba(255, 253, 247, 0.18);
  }

  .file-name {
    background: transparent;
    border-color: transparent;
    color: #dfddd4;
  }

  .file-dl {
    min-width: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    text-decoration: none;
    color: #fffdf7;
    background: rgba(255, 253, 247, 0.08);
    border: 1px solid rgba(255, 253, 247, 0.2);
    font-size: 1rem;
  }

  .file-dl:hover {
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

  /* The Score view's player line — compact single row, own full-width band. */
  .player-row {
    padding: 4px 24px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    justify-content: center;
    padding: 8px 24px 24px;
  }

  /* --- Immersive modes (Practice / Perform): the page fills the screen. --- */
  .overlay.immersive {
    overflow: hidden;
  }

  .overlay.immersive .stage {
    padding: 12px;
  }

  /* Practice bar: in normal flow along the top, reserving its height so the score
     sits below with no overlap. Back · recording · one-line player. */
  .immersive-bar {
    margin: 12px 12px 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  /* Perform: a single floating back arrow (top-left), above the pager's tap
     zones (no z-index) so it wins a tap. A solid dark pill keeps it visible even
     where the white score page reaches the corner. */
  .floating-back {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  .rec-sel {
    min-height: 44px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.25);
    background: #2c2d31;
    color: #fffdf7;
    padding: 0 8px;
    max-width: 40vw;
    flex: none;
  }

  @media print {
    .bar,
    .pickers,
    .player-row,
    .immersive-bar,
    .floating-back {
      display: none;
    }

    .overlay {
      position: static;
      background: #fff;
    }
  }
</style>
