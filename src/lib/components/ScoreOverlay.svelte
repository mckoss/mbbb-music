<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { instrumentSlug, printFormat, type PrintFormat } from '$lib/stores';
  import type { Catalog } from '$lib/types';
  import { activeScore, partsForFormat } from '$lib/resolve';
  import { instrumentDisplay, partLabel } from '$lib/format';
  import AudioPlayer from './AudioPlayer.svelte';

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

  const current = $derived(open && tune ? activeScore(tune, instrument, format, part) : null);
  const title = $derived(tune?.title ?? '');
  const aspect = $derived(format === 'lyre' ? 7 / 5 : 8.5 / 11);
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

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && current) close();
  }

  function print() {
    if (browser) window.print();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if current}
  <div class="overlay">
    <header class="bar">
      <div class="info">
        <p class="kicker perf">Performance view</p>
        <h2>{title}</h2>
        <p class="sub">{current.label} · {format === 'lyre' ? 'Lyre' : 'Letter'}</p>
      </div>

      <div class="controls">
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

    <div class="stage" class:lyre={format === 'lyre'}>
      <iframe
        title={`${title} — ${current.label}`}
        src={`/blob/${current.sha}#toolbar=0&view=FitH`}
        style={`aspect-ratio:${aspect};`}
      ></iframe>
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

  .practice {
    padding: 14px 24px;
  }

  .stage {
    flex: 1;
    display: flex;
    justify-content: center;
    padding: 8px 24px 28px;
  }

  .stage iframe {
    width: 100%;
    max-width: 780px;
    border: 0;
    background: #fff;
    box-shadow: var(--shadow);
  }

  .stage.lyre iframe {
    max-width: 620px;
  }

  @media print {
    .bar,
    .practice {
      display: none;
    }

    .overlay {
      position: static;
      background: #fff;
    }
  }
</style>
