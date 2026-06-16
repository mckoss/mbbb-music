// First-page geometry of a PDF, used to classify a part's print format from the
// physical page shape rather than guessing from its filename. PDF.js (already a
// dependency for server-side rendering) parses the page and returns a viewport
// whose width/height are in PDF points (1/72") with any /Rotate applied — so a
// page rotated to landscape reports landscape dimensions, as it prints.

/**
 * Width/height of a PDF's first page in points (1/72"), rotation applied, or null
 * if the bytes can't be parsed as a PDF. Never throws.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes
 * @returns {Promise<{ widthPt: number, heightPt: number } | null>}
 */
export async function pdfPageSizePt(bytes) {
  let task;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // pdf.js rejects a Node Buffer ("provide … Uint8Array, rather than Buffer"),
    // and a Buffer satisfies `instanceof Uint8Array`, so coerce to a plain
    // Uint8Array view over the same bytes (no copy) when needed.
    let data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (data.constructor !== Uint8Array) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    // No CanvasFactory: we only read geometry, never rasterize.
    task = pdfjs.getDocument({ data, useSystemFonts: false });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const widthPt = Math.round(vp.width);
    const heightPt = Math.round(vp.height);
    return widthPt > 0 && heightPt > 0 ? { widthPt, heightPt } : null;
  } catch {
    return null;
  } finally {
    // Free the worker/loading task; release is on the task, not the document, and
    // a cleanup hiccup must never discard a size we already read.
    try {
      await task?.destroy();
    } catch {
      /* best effort */
    }
  }
}
