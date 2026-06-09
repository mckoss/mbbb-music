<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import type { Catalog } from '$lib/types';
  import { activeScore, partsForFormat } from '$lib/resolve';
  import { instrumentDisplay, partLabel } from '$lib/format';
  import AudioPlayer from './AudioPlayer.svelte';
  import PdfPager from './PdfPager.svelte';

  // The overlay is driven entirely by the URL: it's open when ?view=score, and
  // shows the PDF for ?song / ?instrument / ?format / ?part (each falling back to
  // the cookie-persisted store when absent). This makes it shareable and survive
  // a refresh, and the browser Back button closes it.
  const catalog = $derived(page.data.catalog as Catalog);
  const params = $derived(page.url.searchParams);
  const open = $derived(params.get('view') === 'score');
  const tune = $derived(catalog?.tunes?.find((t) => t.slug === params.get('song')) ?? null);
  const instrument = $derived(params.get('instrument') ?? $instrumentSlug);
  const format = $derived(((params.get('format') as PrintFormat) || $printFormat) as PrintFormat);
  const partParam = $derived(params.get('part'));
  const part = $derived(partParam && /^\d+$/.test(partParam) ? Number(partParam) : null);

  // Two ways to read a score (#1). Practice: chrome + the MP3 player on top, with
  // the page scaled to fit below it. Performance: full-screen, no player, large
  // page, paged by tapping the left/right edges (iPad on a music stand).
  type Mode = 'practice' | 'performance';
  const mode = $derived<Mode>(params.get('mode') === 'performance' ? 'performance' : 'practice');
  // A plain boolean for template branching, so Svelte's TS narrowing doesn't
  // collapse `mode` to a literal inside the {:else} block.
  const isPerformance = $derived(mode === 'performance');

  const current = $derived(open && tune ? activeScore(tune, instrument, format, part) : null);
  const title = $derived(tune?.title ?? '');
  const practiceAudio = $derived(tune?.audio[0] ?? null);

  // Instrument/part are switchable in-place: changing them updates the URL params
  // (replaceState — no remount), which re-resolves the PDF below. Audio plays
  // through a global singleton element, so swapping the score never interrupts it.
  const instruments = $derived(catalog?.instruments ?? []);
  const parts = $derived(open && tune ? partsForFormat(tune, instrument, format) : []);

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
    if (e.key === 'Escape' && current) close();
  }

  // Open the raw PDF in a new tab so the browser's own viewer handles a reliable
  // full-document print (the on-screen view shows one rasterized page at a time).
  function print() {
    if (browser && current) window.open(`/blob/${current.sha}`, '_blank', 'noopener');
  }
</script>

<svelte:window onkeydown={onKey} />

{#if current}
  <div class="overlay" class:performance={isPerformance}>
    {#if isPerformance}
      <!-- No chrome: a floating cluster (above the tap zones) holds the controls.
           Returning to Practice is the common action, so it's the primary,
           clearly-labelled button; the whole cluster is solid and fully opaque
           so it stays obvious on a music stand. -->
      <div class="floating">
        <button class="primary" onclick={() => setMode('practice')}>← Practice</button>
        <button class="ghost" onclick={close}>Done</button>
      </div>
    {:else}
    <header class="bar">
      <div class="info">
        <p class="kicker perf">Score view</p>
        <h2>{title}</h2>
        <p class="sub">{current.label} · {format === 'lyre' ? 'Lyre' : 'Letter'}</p>
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
        {#if parts.length > 1}
          <label class="fmt">
            <span class="eyebrow">Part</span>
            <select
              value={String(current?.partNumber ?? '')}
              onchange={(e) => setPart(e.currentTarget.value)}
            >
              {#each parts as p (p.sha256)}
                <option value={String(p.partNumber ?? '')}>{partLabel(p)}</option>
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
        <button class="ghost" onclick={print}>Print</button>
        <button class="primary" onclick={close}>Collection</button>
      </div>
    </header>

    <div class="practice">
      <AudioPlayer sha={practiceAudio?.sha256 ?? null} title={title} />
    </div>
    {/if}

    <div class="stage">
      <PdfPager sha={current.sha} title={`${title} — ${current.label}`} tap={mode === 'performance'} />
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

  .primary {
    background: var(--accent);
    color: #fffdf7;
    border: 1px solid var(--accent-strong);
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
    right: 12px;
    z-index: 10; /* above PdfPager's tap zones (no z-index) so buttons win a tap */
    display: flex;
    gap: 10px;
    /* A solid pill so the cluster reads clearly over both the dark stage and a
       white score page, and fully opaque so it's never easy to miss. */
    padding: 6px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  .floating button {
    padding: 0 16px;
  }

  /* The performance Practice button is opaque (no see-through ghost) for contrast. */
  .floating .ghost {
    background: rgba(255, 253, 247, 0.12);
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
