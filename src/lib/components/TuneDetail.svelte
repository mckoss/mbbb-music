<script lang="ts">
  import type { Tune } from '$lib/types';
  import type { PrintFormat } from '$lib/stores';
  import { score } from '$lib/stores';
  import { partLabel, instrumentDisplay, audioLabel, stripCopyOf } from '$lib/format';
  import { partsForFormat, activePdf, type ActivePdf } from '$lib/resolve';
  import AudioPlayer from './AudioPlayer.svelte';

  let {
    tune,
    instrumentSlug,
    printFormat,
  }: { tune: Tune; instrumentSlug: string; printFormat: PrintFormat } = $props();

  // Parts conform to the selected print format (Letter/Lyre).
  const matches = $derived(partsForFormat(tune, instrumentSlug, printFormat));

  // Chosen part sha when multiple parts exist; reset when the tune/instrument/
  // format changes by deriving the default from the current matches.
  let chosenSha = $state<string | null>(null);
  $effect(() => {
    // Reset selection whenever the candidate set changes.
    void tune.slug;
    void instrumentSlug;
    void printFormat;
    chosenSha = matches.length > 0 ? matches[0].sha256 : null;
  });

  const active = $derived(activePdf(tune, instrumentSlug, printFormat, chosenSha));
  const instrumentLabel = $derived(matches[0]?.instrument ?? instrumentSlug);

  const audios = $derived(tune.audio ?? []);
  const musescoreAsset = $derived(tune.musescore[0] ?? null);
  const images = $derived(tune.images ?? []);
  const files = $derived(tune.files ?? []);

  // Which recording the inline player uses (reset when the tune changes).
  let chosenAudioSha = $state<string | null>(null);
  $effect(() => {
    void tune.slug;
    chosenAudioSha = audios.length > 0 ? audios[0].sha256 : null;
  });
  const playingAudio = $derived(audios.find((a) => a.sha256 === chosenAudioSha) ?? audios[0] ?? null);

  // Download filename for an audio file: the original minus Drive's "Copy of"
  // prefix, falling back to a generated name.
  function audioDlName(a: { originalName: string | null }): string {
    return (a.originalName && stripCopyOf(a.originalName)) || `mbbb-${tune.slug}.mp3`;
  }

  // Download name for a misc asset: keep the original filename (it carries the
  // right extension); fall back to a generated name if absent.
  function fileDlName(a: { originalName: string | null; assetType?: string }): string {
    return a.originalName ?? `mbbb-${tune.slug}-${a.assetType ?? 'file'}`;
  }

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

  {#if audios.length > 0}
    <div class="audio">
      {#if audios.length > 1}
        <label class="audio-select">
          <span class="eyebrow">Recording</span>
          <select bind:value={chosenAudioSha}>
            {#each audios as a (a.sha256)}
              <option value={a.sha256}>{audioLabel(a.originalName)}</option>
            {/each}
          </select>
        </label>
      {/if}
      <AudioPlayer sha={playingAudio?.sha256 ?? null} title={tune.title} />
    </div>
  {/if}

  <section class="downloads-section">
    <p class="kicker">Downloads</p>
    <div class="downloads">
      {#if active}
        <a class="dl" href={`/blob/${active.sha}?dl=${encodeURIComponent(dlName(active))}`} download>
          ⤓ Score (PDF)
        </a>
      {/if}
      {#if musescoreAsset}
        <a
          class="dl"
          href={`/blob/${musescoreAsset.sha256}?dl=${encodeURIComponent(`mbbb-${tune.slug}-full-score.mscz`)}`}
          download
        >
          ⤓ MuseScore
        </a>
      {/if}
      {#each audios as a (a.sha256)}
        <a class="dl" href={`/blob/${a.sha256}?dl=${encodeURIComponent(audioDlName(a))}`} download>
          ⤓ {audioLabel(a.originalName)} (MP3)
        </a>
      {/each}
    </div>
  </section>

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

  {#if images.length}
    <div class="images">
      {#each images as img (img.sha256)}
        <figure>
          <a href={`/blob/${img.sha256}`} target="_blank" rel="noopener">
            <img src={`/blob/${img.sha256}`} alt={img.originalName ?? 'Image'} loading="lazy" />
          </a>
          {#if img.originalName}<figcaption>{img.originalName}</figcaption>{/if}
        </figure>
      {/each}
    </div>
  {/if}

  {#if files.length}
    <div class="files">
      <p class="kicker">Files</p>
      <div class="downloads">
        {#each files as f (f.sha256)}
          <a class="dl" href={`/blob/${f.sha256}?dl=${encodeURIComponent(fileDlName(f))}`} download>
            {f.originalName ?? f.assetType ?? 'Download'}
          </a>
        {/each}
      </div>
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

  .audio {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .audio-select {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
  }

  .audio-select span {
    color: var(--muted);
  }

  .audio-select select {
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0 10px;
    background: var(--panel);
    color: var(--ink);
  }

  .downloads-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
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

  .images {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .images figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 240px;
  }

  .images img {
    width: 100%;
    height: auto;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: #fff;
    box-shadow: var(--shadow);
  }

  .images figcaption {
    color: var(--muted);
    font-size: 0.8rem;
    word-break: break-word;
  }

  .files {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
