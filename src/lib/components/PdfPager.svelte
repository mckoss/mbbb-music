<script lang="ts">
  import { browser } from '$app/environment';
  import { RENDER_REV } from '$lib/render-rev';

  // Pages a score one image at a time. The server rasterizes each PDF page to
  // lossless WebP (see /render/[sha]); here we just show an <img> and page
  // through them. An <img> composites reliably on iOS Safari (the music-stand
  // target), unlike an on-device canvas — so all PDF.js now lives server-side.
  let {
    sha,
    tap = false,
    title = '',
    openHref,
  }: { sha: string; tap?: boolean; title?: string; openHref?: string } = $props();

  // Friendly URL for the "Open the PDF" fallback; defaults to the raw blob if a
  // caller didn't supply a slug-based one.
  const pdfHref = $derived(openHref ?? `/blob/${sha}`);

  let pageNum = $state(1);
  let numPages = $state(0);
  let loading = $state(true);
  let err = $state<string | null>(null);

  // Guards against a stale info response landing after the sha changed again.
  let gen = 0;

  const pageUrl = (n: number) => `/render/${sha}/${n}.webp?r=${RENDER_REV}`;
  const src = $derived(numPages > 0 ? pageUrl(pageNum) : '');

  // Load the page count whenever the score changes; reset to page 1.
  $effect(() => {
    const s = sha;
    if (!browser || !s) return;
    const myGen = ++gen;
    loading = true;
    err = null;
    numPages = 0;
    pageNum = 1;
    (async () => {
      try {
        const res = await fetch(`/render/${s}/info`);
        if (!res.ok) throw new Error(`info ${res.status}`);
        const { pages } = (await res.json()) as { pages: number };
        if (myGen !== gen) return;
        numPages = pages;
      } catch (e) {
        if (myGen === gen) {
          err = e instanceof Error ? e.message : String(e);
          loading = false;
        }
      }
    })();
  });

  // Warm the next page so a forward tap is instant.
  $effect(() => {
    if (!browser || numPages < 2 || pageNum >= numPages) return;
    const img = new Image();
    img.src = pageUrl(pageNum + 1);
  });

  function onLoad() {
    loading = false;
    err = null;
  }
  function onError() {
    loading = false;
    err = 'image failed to load';
  }

  export function prev() {
    if (pageNum > 1) pageNum -= 1;
  }
  export function next() {
    if (pageNum < numPages) pageNum += 1;
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    // Don't hijack arrows while a form control (instrument/part/format) is focused.
    if (t && /^(input|select|textarea|button)$/i.test(t.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
      next();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
      prev();
      e.preventDefault();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="pager">
  <div class="canvas-box">
    {#if src}
      <img
        {src}
        alt={title ? `${title} — page ${pageNum}` : `Page ${pageNum}`}
        onload={onLoad}
        onerror={onError}
      />
    {/if}

    {#if loading}
      <p class="status">Loading score…</p>
    {:else if err}
      <p class="status error">
        Couldn't render the score{#if err}: <span class="errdetail">{err}</span>{/if}.
        <a href={pdfHref} target="_blank" rel="noopener">Open the PDF</a>
      </p>
    {/if}

    {#if tap && numPages > 1}
      <!-- Full-height tap zones for paging (iPad). They sit below the floating
           controls in z-order so buttons still win a tap. -->
      <button
        class="tapzone left"
        onclick={prev}
        disabled={pageNum <= 1}
        aria-label="Previous page"
      ></button>
      <button
        class="tapzone right"
        onclick={next}
        disabled={pageNum >= numPages}
        aria-label="Next page"
      ></button>
    {/if}
  </div>

  {#if numPages > 1 && !tap}
    <!-- Bottom pager only when there are no edge tap zones (the roomy Score
         view). In tap mode the full-height zones page the score, so this would
         be redundant. -->
    <div class="nav">
      <button class="pg" onclick={prev} disabled={pageNum <= 1} aria-label="Previous page">‹</button>
      <span class="count">{pageNum} / {numPages}</span>
      <button class="pg" onclick={next} disabled={pageNum >= numPages} aria-label="Next page">›</button>
    </div>
  {/if}
</div>

<style>
  .pager {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .canvas-box {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #fff;
    box-shadow: var(--shadow);
  }

  .status {
    position: absolute;
    color: #dfddd4;
    font-size: 0.9rem;
    max-width: 80%;
    text-align: center;
  }

  .status.error a {
    color: #f2d36b;
  }

  .errdetail {
    color: #f6b8b4;
    font-family: ui-monospace, monospace;
    word-break: break-word;
  }

  .tapzone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 33%;
    border: 0;
    background: transparent;
    cursor: pointer;
    min-height: 0;
    padding: 0;
  }

  .tapzone.left {
    left: 0;
  }

  .tapzone.right {
    right: 0;
  }

  .tapzone:disabled {
    cursor: default;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 14px;
    color: #fffdf7;
  }

  .count {
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
    min-width: 64px;
    text-align: center;
  }

  .pg {
    min-width: 48px;
    min-height: 44px;
    border-radius: 6px;
    border: 1px solid rgba(255, 253, 247, 0.35);
    background: rgba(255, 253, 247, 0.08);
    color: #fffdf7;
    font-size: 1.4rem;
    line-height: 1;
  }

  .pg:disabled {
    opacity: 0.35;
  }

  @media print {
    .nav,
    .tapzone {
      display: none;
    }
  }
</style>
