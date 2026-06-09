// Server-side, on-demand PDF page rasterization with an on-disk cache.
//
// Scores are rendered to lossless WebP one page at a time and cached at
//   data/render/<profile>/<sha>-<page>.webp     (profile = r<rev>-<dpi>)
//   data/render/meta/<sha>.json                 (page count, profile-independent)
// The paths are a pure function of (content hash, page, render profile), so there
// is nothing to index — given a request the path is computed and stat'd. The
// cache is disposable: `rm -rf data/render` and it rebuilds on demand.
//
// PDF.js lives only here now (server-side); the client just shows an <img>. iOS
// WebKit composites <img> reliably, which sidesteps the canvas/compositing
// fragility that on-device rasterization hit on iPad.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';

import { loadConfig } from '../../sync/config.js';
import { RENDER_REV, RENDER_DPI } from '../render-rev.js';
import { getAsset, casPath } from './library.js';

const PROFILE = `r${RENDER_REV}-${RENDER_DPI}`;

function renderDir(): string {
  return resolve(loadConfig().dataDir, 'render', PROFILE);
}

// Page-count sidecars live ABOVE the profile dir: a score's page count never
// changes (it's a property of the content hash), so a RENDER_REV/DPI bump that
// re-rasterizes the images keeps the counts and avoids reopening every PDF.
function metaPath(sha: string): string {
  return resolve(loadConfig().dataDir, 'render', 'meta', `${sha}.json`);
}

// A canvas factory backed by @napi-rs/canvas so PDF.js can rasterize in Node
// (its default factory assumes a DOM). PDF.js asks the factory for the main
// canvas and any scratch canvases it needs for masks/patterns.
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext('2d') };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reset(cc: any, width: number, height: number) {
    cc.canvas.width = Math.ceil(width);
    cc.canvas.height = Math.ceil(height);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  destroy(cc: any) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

/** Open a CAS-stored PDF as a PDF.js document. Caller must destroy the task. */
async function openDoc(sha: string) {
  // The legacy build is transpiled for broad engine support and is the variant
  // PDF.js recommends for Node. No worker is configured, so it parses on the
  // main thread (fine for one-page-at-a-time rendering).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(casPath(sha)));
  const task = pdfjs.getDocument({
    data,
    CanvasFactory: NodeCanvasFactory,
    useSystemFonts: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = await task.promise;
  return { doc, task };
}

// Page counts are immutable per content hash. They're cached at three levels so
// the PDF is opened at most once ever per score: process memory, then the
// on-disk sidecar (survives restarts and is shared across instances on a common
// volume), then — only on a true cold miss — opening the PDF and writing the
// sidecar. Concurrent cold misses are de-duped so the PDF opens once.
const pageCounts = new Map<string, number>();
const countInflight = new Map<string, Promise<number | null>>();

/** Read the page-count sidecar, or null if absent/unreadable. */
async function readMeta(sha: string): Promise<number | null> {
  try {
    const { pages } = JSON.parse(await readFile(metaPath(sha), 'utf8'));
    return Number.isInteger(pages) && pages > 0 ? pages : null;
  } catch {
    return null;
  }
}

let tmpSeq = 0;
/** Write the sidecar atomically (temp + rename) so a torn read can't happen. */
async function writeMeta(sha: string, pages: number): Promise<void> {
  const path = metaPath(sha);
  await mkdir(resolve(path, '..'), { recursive: true });
  const tmp = `${path}.${process.pid}.${tmpSeq++}.tmp`;
  await writeFile(tmp, JSON.stringify({ pages }));
  await rename(tmp, path);
}

/** Page count for a score, or null when the hash isn't a PDF in the library. */
export async function getPageCount(sha: string): Promise<number | null> {
  const mem = pageCounts.get(sha);
  if (mem != null) return mem;

  const meta = getAsset(sha);
  if (!meta || meta.assetType !== 'pdf') return null;

  const disk = await readMeta(sha);
  if (disk != null) {
    pageCounts.set(sha, disk);
    return disk;
  }

  const existing = countInflight.get(sha);
  if (existing) return existing;
  const job = computeCount(sha).finally(() => countInflight.delete(sha));
  countInflight.set(sha, job);
  return job;
}

/** Cold path: open the PDF once, record the count in memory and on disk. */
async function computeCount(sha: string): Promise<number> {
  const { doc, task } = await openDoc(sha);
  try {
    const n = doc.numPages as number;
    pageCounts.set(sha, n);
    await writeMeta(sha, n);
    return n;
  } finally {
    await task.destroy();
  }
}

// De-dupe concurrent renders of the same page (e.g. an <img> load racing a
// prefetch) so a page is rasterized at most once even under a burst.
const inflight = new Map<string, Promise<string | null>>();

/**
 * Ensure page `n` of score `sha` is rendered, returning the cached file path
 * (or null when the hash isn't a renderable score or the page is out of range).
 */
export async function ensureRenderedPage(sha: string, n: number): Promise<string | null> {
  const meta = getAsset(sha);
  if (!meta || meta.assetType !== 'pdf') return null;

  const path = resolve(renderDir(), `${sha}-${n}.webp`);
  if (existsSync(path)) return path;

  const key = `${PROFILE}:${sha}:${n}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const job = renderToFile(sha, n, path).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function renderToFile(sha: string, n: number, path: string): Promise<string | null> {
  const { doc, task } = await openDoc(sha);
  try {
    // Record the count from this same open (avoids a second open on a cold page)
    // and range-check against it.
    const total = doc.numPages as number;
    if (pageCounts.get(sha) !== total) {
      pageCounts.set(sha, total);
      await writeMeta(sha, total);
    }
    if (n < 1 || n > total) return null;

    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: RENDER_DPI / 72 });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    // PDFs are transparent-backed; paint white so the score reads on a page, not
    // on the dark overlay behind it.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const rgba = Buffer.from(ctx.getImageData(0, 0, w, h).data);
    const webp = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .webp({ lossless: true })
      .toBuffer();

    await mkdir(renderDir(), { recursive: true });
    await writeFile(path, webp);
    return path;
  } finally {
    await task.destroy();
  }
}
