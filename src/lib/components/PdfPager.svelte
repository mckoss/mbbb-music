<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy } from 'svelte';

  // Renders a PDF one page at a time, scaled so a whole page fits the available
  // box, with prev/next paging. Native PDF iframes can't be paged programmatically
  // on iOS Safari (the music-stand target), so we rasterize each page with PDF.js.
  //
  // We render onto an OFFSCREEN canvas and display the result as an <img>. iOS
  // WebKit silently fails to composite a live <canvas> inside a position:fixed
  // overlay (it shows up blank white), but composites images reliably — so the
  // visible element is an <img>, never the canvas. The pixel ratio is also capped
  // so the rasterized image stays within iOS's canvas/export size limits.
  let {
    sha,
    tap = false,
    title = '',
  }: { sha: string; tap?: boolean; title?: string } = $props();

  // iOS won't reliably display or export very large canvases; 1.5x keeps scores
  // crisp while staying well within the safe range on a retina iPad.
  const MAX_DPR = 1.5;

  let container = $state<HTMLDivElement | null>(null);
  let imgEl = $state<HTMLImageElement | null>(null);

  let pageNum = $state(1);
  let numPages = $state(0);
  let loading = $state(true);
  let err = $state<string | null>(null);

  // Bumped by the ResizeObserver so the render effect re-fits on layout changes.
  let resizeTick = $state(0);

  // Non-reactive handles. `gen` guards against races when sha changes mid-load.
  type PdfLib = typeof import('pdfjs-dist');
  let lib: PdfLib | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc = $state<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let renderTask: any = null;
  let gen = 0;

  async function ensureLib(): Promise<PdfLib> {
    if (lib) return lib;
    const mod = await import('pdfjs-dist');
    // Bundled module worker (Vite rewrites the ?url import to an emitted asset).
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    mod.GlobalWorkerOptions.workerSrc = workerUrl;
    lib = mod;
    return mod;
  }

  // Load the document whenever the sha changes; reset to page 1.
  $effect(() => {
    const s = sha;
    if (!browser || !s) return;
    const myGen = ++gen;
    loading = true;
    err = null;
    (async () => {
      try {
        const l = await ensureLib();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = await l.getDocument({ url: `/blob/${s}` }).promise;
        if (myGen !== gen) {
          d.destroy?.();
          return;
        }
        doc?.destroy?.();
        numPages = d.numPages;
        pageNum = 1;
        doc = d;
      } catch (e) {
        if (myGen === gen) err = e instanceof Error ? e.message : String(e);
      } finally {
        if (myGen === gen) loading = false;
      }
    })();
  });

  // Re-render on page change, document change, or resize.
  $effect(() => {
    const d = doc;
    const n = pageNum;
    void resizeTick;
    if (!d || !imgEl || !container) return;
    void renderPage(d, n);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function renderPage(d: any, n: number) {
    const target = imgEl;
    const box = container;
    if (!target || !box) return;
    const myGen = gen;
    try {
      const pageObj = await d.getPage(n);
      if (myGen !== gen) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const base = pageObj.getViewport({ scale: 1 });
      const cw = box.clientWidth;
      const ch = box.clientHeight;
      if (cw < 2 || ch < 2) return;
      const scale = Math.max(0.05, Math.min(cw / base.width, ch / base.height));
      const viewport = pageObj.getViewport({ scale: scale * dpr });

      // Render to a detached canvas, then hand the pixels to the <img>.
      const c = document.createElement('canvas');
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      renderTask?.cancel?.();
      renderTask = pageObj.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
      if (myGen !== gen) return;

      const url = c.toDataURL('image/png');
      // iOS returns a near-empty data URL when a canvas is too big to export.
      if (url.length < 100) throw new Error('canvas export failed (too large)');
      target.src = url;
      err = null;
    } catch (e) {
      // Ignore superseded/cancelled renders; surface anything else.
      const msg = e instanceof Error ? e.message : String(e);
      if (myGen === gen && !/cancel/i.test(msg)) err = msg;
    }
  }

  $effect(() => {
    const box = container;
    if (!browser || !box) return;
    const ro = new ResizeObserver(() => {
      resizeTick++;
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    gen++; // invalidate any in-flight async work
    renderTask?.cancel?.();
    doc?.destroy?.();
  });

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
  <div class="canvas-box" bind:this={container}>
    <img bind:this={imgEl} alt={title ? `${title} — page ${pageNum}` : `Page ${pageNum}`} />

    {#if loading}
      <p class="status">Loading score…</p>
    {:else if err}
      <p class="status error">
        Couldn't render the score. <a href={`/blob/${sha}`} target="_blank" rel="noopener">Open the PDF</a>
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

  {#if numPages > 1}
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

  /* Hide the broken-image glyph before the first page has been rasterized. */
  img:not([src]) {
    visibility: hidden;
  }

  .status {
    position: absolute;
    color: #dfddd4;
    font-size: 0.9rem;
  }

  .status.error a {
    color: #f2d36b;
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
