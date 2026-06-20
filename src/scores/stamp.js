// Overlay small text in a PDF's corners, in place — page metadata drawn ON TOP
// of MuseScore's output (via pdf-lib, already a project dependency), reserving
// no layout space. Used for the render timestamp and, on lyre, the compact
// "Title - Instrument" header that replaces the stripped title frame.

import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INSET = 18; // points (1/4") from the left/right edges — clears the printer
// border so the left of the header / right of the date isn't clipped when the
// lyre card is pinned to the sheet's top-left corner.
const TOP_PAD = 18; // points (1/4") from the page top edge down to the header cap
// — the "1/4" above the title". The format's marginTop reserves room below this
// for the header plus a gap before the first system (see formats.js lyre).
const BOTTOM_PAD = 9; // points from the page bottom edge up to the date baseline
const HEADER_SIZE = 8; // pt, bold
const META_SIZE = 7; // pt, grey (date)

const GREY = rgb(0.45, 0.45, 0.45);
const NEAR_BLACK = rgb(0.1, 0.1, 0.1);

const CUT_COLOR = rgb(0.62, 0.62, 0.62); // faint grey trim guide
const CUT_THICKNESS = 0.5; // pt — hairline
const CUT_DASH = [4, 3]; // dashed, so it reads as "cut here" not a music rule

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
 * When `trim` is given (a card smaller than the carrier sheet — lyre printed on
 * Letter), the corner items hug the TRIM box pinned to the sheet's top-left
 * instead of the full sheet, and dashed cut guides are drawn along the two edges
 * the player cuts (the card's right and bottom).
 *
 * @param {string} pdfPath
 * @param {object} opts
 * @param {string} [opts.header]        Bold header, top-left (e.g. "Title - Inst").
 * @param {string} [opts.date]          Render timestamp.
 * @param {'topRight'|'bottomRight'} [opts.datePosition]  Where the date sits.
 * @param {{ width: number, height: number }} [opts.trim]  Finished-card size in
 *   points, pinned to the sheet's top-left. Omit when the music fills the sheet.
 */
export async function stampCorners(pdfPath, { header, date, datePosition = 'bottomRight', trim } = {}) {
  const doc = await PDFDocument.load(await readFile(pdfPath));
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();
    // Corner items hug the card, not the carrier sheet. With no trim the card IS
    // the sheet (right edge = width, bottom edge = y 0). The card is pinned to
    // the top-left, so its top edge always coincides with the sheet top.
    const cardRight = trim ? Math.min(trim.width, width) : width;
    const cardBottom = trim ? Math.max(height - trim.height, 0) : 0; // y of card's lower edge
    // Top items hug the page top so they sit in a thin band above the music
    // (the lyre top margin reserves room for it).
    const topBaseline = height - HEADER_SIZE - TOP_PAD;

    if (header) {
      page.drawText(sanitize(header), { x: INSET, y: topBaseline, size: HEADER_SIZE, font: bold, color: NEAR_BLACK });
    }
    if (date) {
      const text = sanitize(total > 1 ? `${date} - Page ${idx + 1}` : date);
      const w = reg.widthOfTextAtSize(text, META_SIZE);
      const y = datePosition === 'topRight' ? topBaseline : cardBottom + BOTTOM_PAD;
      page.drawText(text, { x: cardRight - w - INSET, y, size: META_SIZE, font: reg, color: GREY });
    }

    // Trim guides: the player cuts the card's right and bottom edges only (top
    // and left are the sheet's own edges). Lines extend to the sheet corner the
    // two cuts share, so a paper-cutter blade can follow them edge to edge.
    if (trim) {
      page.drawLine({
        start: { x: cardRight, y: cardBottom },
        end: { x: cardRight, y: height },
        thickness: CUT_THICKNESS,
        color: CUT_COLOR,
        dashArray: CUT_DASH,
      });
      page.drawLine({
        start: { x: 0, y: cardBottom },
        end: { x: cardRight, y: cardBottom },
        thickness: CUT_THICKNESS,
        color: CUT_COLOR,
        dashArray: CUT_DASH,
      });
    }
  });

  await writeFile(pdfPath, await doc.save());
}
