<script lang="ts">
  // A full-screen, in-app file viewer addressed by content sha. Reached from links
  // that would otherwise open a file in a new tab — a dead-end in the installed
  // (standalone) PWA, where there's no browser chrome to go back. A back arrow
  // always returns to wherever you came from; the body adapts to the file type:
  // PDFs page through the shared PdfPager, images show inline, audio gets the
  // in-app player, and anything else offers a download.
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  import PdfPager from '$lib/components/PdfPager.svelte';
  import AudioPlayer from '$lib/components/AudioPlayer.svelte';
  import type { ViewKind } from '$lib/view';

  const sha = $derived(page.params.sha ?? '');
  const title = $derived(page.url.searchParams.get('title') ?? '');
  // Explicit return target (e.g. the gig page). Falls back to history, then home,
  // so a cold-loaded/deep-linked view still has a way out.
  const from = $derived(page.url.searchParams.get('from'));
  const kind = $derived((page.url.searchParams.get('kind') as ViewKind) || 'pdf');
  // Friendly asset URL for an image's src / a download target; falls back to the
  // raw blob when a caller didn't supply one.
  const url = $derived(page.url.searchParams.get('url') || `/blob/${sha}`);
  const dlUrl = $derived(url.includes('?') ? `${url}&dl` : `${url}?dl`);
  // Filename hint for the download attribute (last path segment of the friendly URL).
  const dlName = $derived(decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'download'));

  function back() {
    if (from) goto(from);
    else if (typeof history !== 'undefined' && history.length > 1) history.back();
    else goto('/');
  }
</script>

<svelte:head><title>{title || 'File'} — MBBB Music</title></svelte:head>

<div class="viewer">
  <div class="corner">
    <button class="exit" onclick={back} aria-label="Back" title="Back">←</button>
    {#if title}<span class="vtitle">{title}</span>{/if}
  </div>

  {#if kind === 'image'}
    <div class="media">
      <img class="image" src={url} alt={title || dlName} />
    </div>
  {:else if kind === 'audio'}
    <div class="media">
      <div class="card">
        <h2 class="card-title">{title || dlName}</h2>
        {#key sha}
          <AudioPlayer {sha} title={title || dlName} />
        {/key}
        <a class="dl-btn" href={dlUrl} download={dlName}>⤓ Download</a>
      </div>
    </div>
  {:else if kind === 'download'}
    <div class="media">
      <div class="card">
        <p class="card-icon" aria-hidden="true">📄</p>
        <h2 class="card-title">{title || dlName}</h2>
        <p class="card-sub">This file can't be previewed here.</p>
        <a class="dl-btn" href={dlUrl} download={dlName}>⤓ Download</a>
      </div>
    </div>
  {:else}
    {#key sha}
      <PdfPager {sha} tap={true} pageBadge={true} {title} openHref={`/blob/${sha}`} />
    {/key}
  {/if}
</div>

<style>
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #202124;
    color: #fffdf7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 64px 12px 12px;
  }

  /* Back arrow + title in a solid dark pill, top-left, so they stay legible over
     a white score page reaching into the corner. Matches the gig overlay. */
  .corner {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 80vw;
    padding: 6px 12px 6px 6px;
    border-radius: 10px;
    background: rgba(32, 33, 36, 0.92);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  }

  .exit {
    min-width: 44px;
    min-height: 44px;
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
    cursor: pointer;
  }

  .exit:hover {
    background: rgba(255, 253, 247, 0.22);
  }

  .vtitle {
    font-size: 0.9rem;
    font-weight: 700;
    color: #f2d36b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Non-PDF bodies (image / audio / download) center their content in the stage. */
  .media {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
  }

  .image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #fff;
    box-shadow: 0 2px 16px rgba(0, 0, 0, 0.5);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: min(420px, 100%);
    padding: 24px;
    border-radius: 12px;
    background: #2c2d31;
    border: 1px solid rgba(255, 253, 247, 0.15);
    text-align: center;
  }

  .card-icon {
    font-size: 2.6rem;
    line-height: 1;
  }

  .card-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: #fffdf7;
    word-break: break-word;
  }

  .card-sub {
    font-size: 0.85rem;
    color: #b9b6ac;
  }

  .dl-btn {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 20px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 700;
    font-size: 0.9rem;
    background: var(--accent);
    color: #fffdf7;
    border: 1px solid var(--accent-strong);
  }

  .dl-btn:hover {
    filter: brightness(1.08);
  }
</style>
