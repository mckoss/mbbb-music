<script lang="ts">
  import type { Tune } from '$lib/types';
  import type { PrintFormat } from '$lib/stores';
  import { score } from '$lib/stores';
  import { partLabel, instrumentDisplay } from '$lib/format';
  import { partsFor, activePdf, type ActivePdf } from '$lib/resolve';
  import AudioPlayer from './AudioPlayer.svelte';

  let {
    tune,
    instrumentSlug,
    printFormat,
  }: { tune: Tune; instrumentSlug: string; printFormat: PrintFormat } = $props();

  const matches = $derived(partsFor(tune, instrumentSlug));

  // Chosen part sha when multiple parts exist; reset when the tune/instrument
  // changes by deriving the default from the current matches.
  let chosenSha = $state<string | null>(null);
  $effect(() => {
    // Reset selection whenever the candidate set changes.
    void tune.slug;
    void instrumentSlug;
    chosenSha = matches.length > 0 ? matches[0].sha256 : null;
  });

  const active = $derived(activePdf(tune, instrumentSlug, chosenSha));
  const instrumentLabel = $derived(matches[0]?.instrument ?? instrumentSlug);

  const audioAsset = $derived(tune.audio[0] ?? null);
  const musescoreAsset = $derived(tune.musescore[0] ?? null);

  const modified = $derived(
    tune.lastModified ? new Date(tune.lastModified).toLocaleDateString() : ''
  );

  function dlName(active: ActivePdf): string {
    if (active.isScore) return `mbbb-${tune.slug}-full-score.pdf`;
    const parts = [`mbbb-${tune.slug}`, active.instrumentSlug];
    if (active.key) parts.push(active.key);
    let name = parts.filter(Boolean).join('-');
    if (active.partNumber != null) name += `-part${active.partNumber}`;
    return `${name}.pdf`;
  }

  function openScore() {
    if (!active) return;
    score.set({ sha: active.sha, title: tune.title, label: active.label });
  }

  const aspect = $derived(printFormat === 'lyre' ? 7 / 5 : 8.5 / 11);
</script>

<section class="detail">
  <header>
    <p class="kicker">Selected music</p>
    <h2>{tune.title}</h2>

    {#if matches.length > 1}
      <label class="part-select">
        <span class="eyebrow">Part</span>
        <select bind:value={chosenSha}>
          {#each matches as p (p.sha256)}
            <option value={p.sha256}>{partLabel(p)}</option>
          {/each}
        </select>
      </label>
    {/if}

    <p class="meta">
      {#if active}
        {#if matches.length === 0}
          <span class="muted">No part for {instrumentDisplay(instrumentLabel, null)} — showing full score</span>
        {:else}
          {active.label}
        {/if}
        · {printFormat === 'lyre' ? 'Lyre' : 'Letter'}
        {#if modified}· Updated {modified}{/if}
      {:else}
        <span class="muted">No score available</span>
      {/if}
    </p>
  </header>

  {#if audioAsset}
    <AudioPlayer sha={audioAsset.sha256} title={tune.title} />
  {/if}

  <div class="downloads">
    {#if active}
      <a class="dl" href={`/blob/${active.sha}?dl=${encodeURIComponent(dlName(active))}`} download>
        PDF
      </a>
    {/if}
    {#if musescoreAsset}
      <a
        class="dl"
        href={`/blob/${musescoreAsset.sha256}?dl=${encodeURIComponent(`mbbb-${tune.slug}-full-score.mscz`)}`}
        download
      >
        MuseScore
      </a>
    {/if}
    {#if audioAsset}
      <a
        class="dl"
        href={`/blob/${audioAsset.sha256}?dl=${encodeURIComponent(`mbbb-${tune.slug}.mp3`)}`}
        download
      >
        Audio
      </a>
    {/if}
  </div>

  {#if active}
    <button class="open-score" onclick={openScore}>Open Score</button>

    <div class="preview" class:lyre={printFormat === 'lyre'}>
      <iframe
        title={`${tune.title} — ${active.label}`}
        src={`/blob/${active.sha}#toolbar=0&view=FitH`}
        style={`aspect-ratio:${aspect};`}
      ></iframe>
    </div>
  {/if}
</section>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 22px;
  }

  h2 {
    font-size: clamp(1.4rem, 3vw, 2rem);
    margin-top: 4px;
  }

  .part-select {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 10px;
  }

  .part-select span {
    color: var(--muted);
  }

  select {
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 10px;
    background: var(--panel);
    color: var(--ink);
  }

  .meta {
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .muted {
    color: var(--muted);
  }

  .downloads {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .dl {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: 6px;
    text-decoration: none;
    color: var(--accent-strong);
    background: #f7f5ef;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .open-score {
    min-height: 44px;
    border: 1px solid var(--accent-strong);
    background: var(--accent);
    color: #fffdf7;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.85rem;
    letter-spacing: 0.02em;
  }

  .preview {
    display: flex;
    justify-content: center;
    background: #efece3;
    border-radius: 8px;
    padding: 16px;
  }

  .preview iframe {
    width: 100%;
    max-width: 460px;
    border: 0;
    background: #fff;
    box-shadow: var(--shadow);
  }

  .preview.lyre iframe {
    max-width: 520px;
  }
</style>
