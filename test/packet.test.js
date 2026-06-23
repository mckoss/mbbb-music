import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PDFDocument } from 'pdf-lib';

import { buildPacketPdf, lyreFitPlacement } from '../src/lib/server/packet.ts';

const IN = 72;
const LYRE_W = 7 * IN;
const PAGE_W = 8.5 * IN;
const PAGE_H = 11 * IN;

// --- lyreFitPlacement: the pure shrink-to-fit geometry -----------------------

test('lyreFitPlacement: a letter-portrait page is scaled to exactly 7" wide, pinned top-left', () => {
  const { dw, dh, x, y } = lyreFitPlacement(PAGE_W, PAGE_H); // 612 x 792
  assert.ok(Math.abs(dw - LYRE_W) < 1e-9, 'width becomes 7"');
  assert.ok(Math.abs(dh - PAGE_H * (LYRE_W / PAGE_W)) < 1e-9, 'height scales proportionally');
  assert.equal(x, 0, 'left-aligned');
  assert.ok(Math.abs(y - (PAGE_H - dh)) < 1e-9, 'top-aligned (origin bottom-left)');
  assert.ok(dh < PAGE_H, 'fits the sheet height');
});

test('lyreFitPlacement: a landscape page is scaled down to 7" wide', () => {
  const { dw, dh } = lyreFitPlacement(11 * IN, 8.5 * IN); // landscape
  assert.ok(Math.abs(dw - LYRE_W) < 1e-9, 'width becomes 7"');
  assert.ok(dh < LYRE_W, 'and the (shorter) height follows');
});

test('lyreFitPlacement: a page already ≤7" wide is never enlarged', () => {
  const { dw, dh, x, y } = lyreFitPlacement(5 * IN, 4 * IN);
  assert.equal(dw, 5 * IN, 'width unchanged (no upscaling past its size)');
  assert.equal(dh, 4 * IN, 'height unchanged');
  assert.equal(x, 0);
  assert.equal(y, PAGE_H - 4 * IN, 'still pinned to the top');
});

test('lyreFitPlacement: a very tall page is limited by height, ending narrower than 7"', () => {
  const { dw, dh, y } = lyreFitPlacement(8.5 * IN, 17 * IN); // would overflow at 7" wide
  assert.ok(Math.abs(dh - PAGE_H) < 1e-9, 'height clamped to the 11" sheet');
  assert.ok(dw < LYRE_W, 'so it ends up narrower than 7" (never clipped)');
  assert.ok(Math.abs(y - 0) < 1e-9, 'top-aligned: a full-height page sits at y=0');
});

// --- buildPacketPdf: assembly + lyre-fit re-homing ---------------------------

async function pdfBytes(w, h, pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([w, h]);
    // A bit of content so the page has a Contents stream (embeddable, like a real chart).
    page.drawRectangle({ x: 4, y: 4, width: w - 8, height: h - 8, borderWidth: 1 });
  }
  return doc.save();
}

test('buildPacketPdf: a lyre-fit chart is re-homed onto an 8.5×11 sheet; a real lyre chart is copied as-is', async () => {
  const wide = await pdfBytes(11 * IN, 8.5 * IN); // too-wide landscape fallback
  const lyre = await pdfBytes(PAGE_W, PAGE_H); // real lyre card on a letter sheet
  const blobs = { wide, lyre };

  const charts = [
    { slug: 'a', sha: 'wide', label: 'A', lyreFit: true },
    { slug: 'b', sha: 'lyre', label: 'B', lyreFit: false },
  ];
  const out = await buildPacketPdf(charts, async (sha) => blobs[sha], { title: 'Test Packet', lyreMode: true });
  assert.ok(out, 'a packet was produced');

  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 2);
  const [p0, p1] = doc.getPages();
  // The 11×8.5 source would copy verbatim as a landscape page; lyre-fit forces it
  // onto a portrait 8.5×11 sheet — proof the page was re-homed, not copied.
  assert.ok(Math.abs(p0.getWidth() - PAGE_W) < 1e-6, 'lyre-fit page is 8.5" wide');
  assert.ok(Math.abs(p0.getHeight() - PAGE_H) < 1e-6, 'lyre-fit page is 11" tall');
  // The real lyre card passes through unchanged.
  assert.ok(Math.abs(p1.getWidth() - PAGE_W) < 1e-6, 'lyre card copied at 8.5" wide');
  assert.ok(Math.abs(p1.getHeight() - PAGE_H) < 1e-6, 'lyre card copied at 11" tall');
});

test('buildPacketPdf: multi-page lyre-fit chart yields one 8.5×11 sheet per source page', async () => {
  const wide = await pdfBytes(13 * IN, 9 * IN, 3);
  const out = await buildPacketPdf([{ slug: 'a', sha: 'w', label: 'A', lyreFit: true }], async () => wide, {
    lyreMode: true,
  });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 3, 'all three pages re-homed');
  for (const p of doc.getPages()) {
    assert.ok(Math.abs(p.getWidth() - PAGE_W) < 1e-6 && Math.abs(p.getHeight() - PAGE_H) < 1e-6);
  }
});

test('buildPacketPdf: Lyre safety — an oversized page is shrunk even when not flagged lyreFit', async () => {
  const landscape = await pdfBytes(14 * IN, 8.5 * IN); // wider than a letter sheet
  const lyre = await pdfBytes(PAGE_W, PAGE_H); // a real 8.5×11 lyre card
  const blobs = { landscape, lyre };
  const charts = [
    { slug: 'a', sha: 'landscape', label: 'A', lyreFit: false }, // tagged lyre but actually wide
    { slug: 'b', sha: 'lyre', label: 'B', lyreFit: false },
  ];
  const out = await buildPacketPdf(charts, async (sha) => blobs[sha], { lyreMode: true });
  const doc = await PDFDocument.load(out);
  const [p0, p1] = doc.getPages();
  // The 14×8.5 page would copy verbatim (14" wide!) without the safety; lyreMode
  // forces it onto a portrait 8.5×11 sheet.
  assert.ok(Math.abs(p0.getWidth() - PAGE_W) < 1e-6, 'oversized page shrunk to an 8.5×11 sheet');
  assert.ok(Math.abs(p0.getHeight() - PAGE_H) < 1e-6);
  // A normal ≤8.5"-wide lyre card is left untouched by the safety.
  assert.ok(Math.abs(p1.getWidth() - PAGE_W) < 1e-6 && Math.abs(p1.getHeight() - PAGE_H) < 1e-6);
});

test('buildPacketPdf: a Letter packet (no lyreMode) never re-homes an oversized page', async () => {
  const landscape = await pdfBytes(14 * IN, 8.5 * IN);
  const out = await buildPacketPdf([{ slug: 'a', sha: 'l', label: 'A', lyreFit: false }], async () => landscape, {
    lyreMode: false,
  });
  const [p0] = (await PDFDocument.load(out)).getPages();
  assert.ok(Math.abs(p0.getWidth() - 14 * IN) < 1e-6, 'copied verbatim at its native 14" width');
});

test('buildPacketPdf: returns null when no chart blob can be loaded', async () => {
  const out = await buildPacketPdf(
    [{ slug: 'a', sha: 'missing', label: 'A', lyreFit: true }],
    async () => {
      throw new Error('blob missing');
    }
  );
  assert.equal(out, null);
});
