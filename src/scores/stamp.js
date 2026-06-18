// Overlay small text in a PDF's corners, in place — page metadata drawn ON TOP
// of MuseScore's output (via pdf-lib, already a project dependency), reserving
// no layout space. Used for the render timestamp and, on lyre, the compact
// "Title - Instrument" header that replaces the stripped title frame.

import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INSET = 14; // points from the left/right edges (≈0.2")
const TOP_PAD = 3; // points from the page top edge down to the header cap
const BOTTOM_PAD = 9; // points from the page bottom edge up to the date baseline
const HEADER_SIZE = 8; // pt, bold
const META_SIZE = 7; // pt, grey (date)

const GREY = rgb(0.45, 0.45, 0.45);
const NEAR_BLACK = rgb(0.1, 0.1, 0.1);

// The standard fonts are WinAnsi-encoded and can't render musical accidentals
// (♭ U+266D, ♯ U+266F) or stray non-Latin glyphs — transliterate/strip so
// drawText never throws on a part name like "B♭ Trumpet".
function sanitize(text) {
  return String(text ?? '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/—/g, '-') // em dash → hyphen
    .replace(/[^\x20-\xFF]/g, '?'); // anything else outside Latin-1
}

/**
 * Stamp a PDF in place: an optional bold `header` top-left, and the `date`
 * right-aligned (top or bottom). On multi-page parts the date gets a per-page
 * "- Page N" suffix (handy once a part spans two flip-folder pages).
 *
 * @param {string} pdfPath
 * @param {object} opts
 * @param {string} [opts.header]        Bold header, top-left (e.g. "Title - Inst").
 * @param {string} [opts.date]          Render timestamp.
 * @param {'topRight'|'bottomRight'} [opts.datePosition]  Where the date sits.
 */
export async function stampCorners(pdfPath, { header, date, datePosition = 'bottomRight' } = {}) {
  const doc = await PDFDocument.load(await readFile(pdfPath));
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();
    // Top items hug the page top so they sit in a thin band above the music
    // (the lyre top margin reserves room for it).
    const topBaseline = height - HEADER_SIZE - TOP_PAD;

    if (header) {
      page.drawText(sanitize(header), { x: INSET, y: topBaseline, size: HEADER_SIZE, font: bold, color: NEAR_BLACK });
    }
    if (date) {
      const text = sanitize(total > 1 ? `${date} - Page ${idx + 1}` : date);
      const w = reg.widthOfTextAtSize(text, META_SIZE);
      const y = datePosition === 'topRight' ? topBaseline : BOTTOM_PAD;
      page.drawText(text, { x: width - w - INSET, y, size: META_SIZE, font: reg, color: GREY });
    }
  });

  await writeFile(pdfPath, await doc.save());
}
