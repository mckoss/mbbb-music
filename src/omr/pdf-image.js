// Render PDF pages to PNG for the AI correction pass (Claude reads the page
// image beside the OMR transcription). Same PDF.js + @napi-rs/canvas pairing the
// server uses for score page images.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { createCanvas } from '@napi-rs/canvas';

const nodeRequire = createRequire(import.meta.url);
const STANDARD_FONTS = resolve(dirname(nodeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(cc, width, height) {
    cc.canvas.width = Math.ceil(width);
    cc.canvas.height = Math.ceil(height);
  }
  destroy(cc) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

/**
 * Render every page of a PDF as a PNG whose long edge is `longEdge` pixels
 * (1568 px is the largest size Claude reads without downscaling).
 *
 * @param {string} path
 * @param {{ longEdge?: number }} [opts]
 * @returns {Promise<Buffer[]>}
 */
export async function renderPdfPages(path, opts = {}) {
  const longEdge = opts.longEdge ?? 1568;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(path)),
    CanvasFactory: NodeCanvasFactory,
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
  });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = longEdge / Math.max(base.width, base.height);
      const vp = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push(canvas.toBuffer('image/png'));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
