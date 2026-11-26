// Positioned text from a PDF's text layer (no rasterizing), for reading the
// measure numbers printed at the start of each system. Uses the same PDF.js
// build the server renders with.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const STANDARD_FONTS = resolve(dirname(nodeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

/**
 * @param {string} path
 * @returns {Promise<import('./score.js').PageText[]>}
 */
export async function pdfPageText(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), standardFontDataUrl: STANDARD_FONTS, useSystemFonts: false });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        width: vp.width,
        height: vp.height,
        items: content.items
          .filter((it) => (it.str ?? '').trim())
          .map((it) => ({ text: it.str.trim(), x: it.transform[4], y: vp.height - it.transform[5] })),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
