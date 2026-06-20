// Overlay header + metadata text in a PDF, in place — drawn ON TOP of MuseScore's
// output (via pdf-lib, already a project dependency), reserving no layout space
// beyond the format's header band. Replaces the stripped title frame with an
// app-owned header: a compact "Title - Instrument" line on lyre, or a large
// centered title with the instrument on the left on letter. Also stamps the
// render timestamp in a corner.

import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const INSET = 18; // points (1/4") from the left/right edges — clears the printer
// border so the left of the header / right of the date isn't clipped when the
// lyre card is pinned to the sheet's top-left corner.
const TOP_PAD = 18; // points (1/4") from the page top edge down to the header cap
// — the "1/4" above the title". The format's marginTop reserves room below this
// for the header plus a gap before the first system (see formats.js lyre).
const BOTTOM_PAD = 9; // points from the page bottom edge up to the date baseline
const HEADER_SIZE = 8; // pt, bold (lyre one-line header; letter overrides via headerSize)
const META_SIZE = 7; // pt, grey (date)
const SUB_GAP = 6; // pt between the centered title and the instrument/page line (letter)

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
 * Stamp a PDF in place with an app-owned header + render date, drawn ON TOP of
 * the music (no layout space reserved beyond the format's header band). Two header
 * styles:
 *
 *  - Lyre (`header` only): one bold line top-left, "Title - Instrument", with the
 *    page number appended as "- p N" on multi-page parts.
 *  - Letter (`title` set): a large bold CENTERED title, the `header` (instrument /
 *    part) on the left, and the page number "p N" top-right on multi-page parts.
 *
 * Single-page parts show no page number. The `date` is right-aligned, top or
 * bottom. When `trim` is given (a card smaller than the carrier sheet — lyre on
 * Letter), corner items hug the TRIM box pinned to the sheet's top-left and dashed
 * cut guides are drawn along the two edges the player cuts (right + bottom).
 *
 * @param {string} pdfPath
 * @param {object} opts
 * @param {string} [opts.header]        Bold left header (lyre line / letter instrument).
 * @param {string} [opts.title]         Large centered title (letter). Enables the
 *   three-zone letter header; omit for the lyre one-liner.
 * @param {number} [opts.headerSize]    Left-header font size, pt (default 8 / lyre).
 * @param {number} [opts.titleSize]     Centered-title font size, pt (letter).
 * @param {string} [opts.date]          Render timestamp.
 * @param {'topRight'|'bottomRight'} [opts.datePosition]  Where the date sits.
 * @param {{ width: number, height: number }} [opts.trim]  Finished-card size in
 *   points, pinned to the sheet's top-left. Omit when the music fills the sheet.
 */
export async function stampCorners(
  pdfPath,
  { header, title, headerSize = HEADER_SIZE, titleSize = 16, date, datePosition = 'bottomRight', trim } = {},
) {
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

    const multi = total > 1;
    const page_n = `p ${idx + 1}`;

    if (title) {
      // Letter: large centered title, instrument left, page number top-right.
      const tBaseline = height - TOP_PAD - titleSize;
      const tw = bold.widthOfTextAtSize(sanitize(title), titleSize);
      page.drawText(sanitize(title), {
        x: (width - tw) / 2,
        y: tBaseline,
        size: titleSize,
        font: bold,
        color: NEAR_BLACK,
      });
      const subBaseline = tBaseline - SUB_GAP - headerSize;
      if (header) {
        page.drawText(sanitize(header), { x: INSET, y: subBaseline, size: headerSize, font: bold, color: NEAR_BLACK });
      }
      if (multi) {
        const pw = reg.widthOfTextAtSize(page_n, headerSize);
        page.drawText(page_n, { x: cardRight - pw - INSET, y: subBaseline, size: headerSize, font: reg, color: NEAR_BLACK });
      }
    } else if (header) {
      // Lyre: one line top-left; page number appended on multi-page parts.
      const text = multi ? `${header} - ${page_n}` : header;
      const topBaseline = height - headerSize - TOP_PAD;
      page.drawText(sanitize(text), { x: INSET, y: topBaseline, size: headerSize, font: bold, color: NEAR_BLACK });
    }

    if (date) {
      // Page number lives in the header (both styles), so the date stays clean.
      const text = sanitize(date);
      const w = reg.widthOfTextAtSize(text, META_SIZE);
      const topBaseline = height - META_SIZE - TOP_PAD;
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

/** Number of pages in a PDF — the page-count signal the lyre fit search ranks on. */
export async function pageCount(pdfPath) {
  const doc = await PDFDocument.load(await readFile(pdfPath));
  return doc.getPageCount();
}
