<script lang="ts">
  // A full-screen, in-app chart viewer addressed by content sha. Reached from
  // links that would otherwise open a raw PDF in a new tab — a dead-end in the
  // installed (standalone) PWA, where there's no browser chrome to go back. Here
  // the score renders with the shared PdfPager under a visible back arrow that
  // returns to wherever you came from.
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  import PdfPager from '$lib/components/PdfPager.svelte';

  const sha = $derived(page.params.sha ?? '');
  const title = $derived(page.url.searchParams.get('title') ?? '');
  // Explicit return target (e.g. the gig page). Falls back to history, then home,
  // so a cold-loaded/deep-linked view still has a way out.
  const from = $derived(page.url.searchParams.get('from'));

  function back() {
    if (from) goto(from);
    else if (typeof history !== 'undefined' && history.length > 1) history.back();
    else goto('/');
  }
</script>

<svelte:head><title>{title || 'Chart'} — MBBB Music</title></svelte:head>

<div class="viewer">
  <div class="corner">
    <button class="exit" onclick={back} aria-label="Back" title="Back">←</button>
    {#if title}<span class="vtitle">{title}</span>{/if}
  </div>

  {#key sha}
    <PdfPager {sha} tap={true} {title} openHref={`/blob/${sha}`} />
  {/key}
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
</style>
