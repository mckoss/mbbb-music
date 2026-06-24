import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

import { buildPacketPdf, lyreFitPlacement, packetCharts, shouldLyreFitPage } from '../src/lib/server/packet.ts';

const IN = 72;
const LYRE_W = 7 * IN;
const PAGE_W = 8.5 * IN;
const PAGE_H = 11 * IN;
const nodeRequire = createRequire(import.meta.url);
const STANDARD_FONTS = resolve(dirname(nodeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

class TestCanvasFactory {
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

// --- lyreFitPlacement: the pure shrink-to-fit geometry -----------------------

test('lyreFitPlacement: a letter-portrait page is scaled to exactly 7" wide, pinned top-left', () => {
  const { dw, dh, x, y } = lyreFitPlacement(PAGE_W, PAGE_H); // 612 x 792
  assert.ok(Math.abs(dw - LYRE_W) < 1e-9, 'width becomes 7"');
  assert.ok(Math.abs(dh - PAGE_H * (LYRE_W / PAGE_W)) < 1e-9, 'height scales proportionally');
  assert.equal(x, 0, 'left-aligned');
  assert.ok(Math.abs(y - (PAGE_H - dh)) < 1e-9, 'top-aligned (origin bottom-left)');
  assert.ok(dh < PAGE_H, 'fits the sheet height');
});

test('shouldLyreFitPage: generated MuseScore lyre output is not auto-shrunk by page width', () => {
  assert.equal(shouldLyreFitPage({ generated: true, lyreFit: false }, 14 * IN, 8.5 * IN, true), false);
  assert.equal(shouldLyreFitPage({ generated: true, lyreFit: true }, 14 * IN, 8.5 * IN, true), true);
});

test('shouldLyreFitPage: only explicit lyre-fit pages shrink to the 7" lyre width', () => {
  assert.equal(shouldLyreFitPage({ generated: false, lyreFit: false }, 14 * IN, 8.5 * IN, true), false);
  assert.equal(shouldLyreFitPage({ generated: false, lyreFit: false }, PAGE_W, PAGE_H, true), false);
  assert.equal(shouldLyreFitPage({ generated: false, lyreFit: true }, PAGE_W, PAGE_H, true), true);
  assert.equal(shouldLyreFitPage({ generated: false, lyreFit: true }, 14 * IN, 8.5 * IN, false), false);
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

async function renderFirstPage(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    CanvasFactory: TestCanvasFactory,
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvasFactory = new TestCanvasFactory();
  const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  await task.destroy();
  return { canvas, context };
}

function hasDarkPixelInXBand(context, x0, x1) {
  const width = Math.max(1, Math.ceil(x1) - Math.floor(x0));
  const data = context.getImageData(Math.floor(x0), 0, width, PAGE_H).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) return true;
  }
  return false;
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

test('buildPacketPdf: a Letter fallback has ink between 5.5" and 7", but not beyond 7"', async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([PAGE_W, PAGE_H]);
  // Put the only black mark near the right edge of a Letter page. When the page
  // is lyre-fit from 8.5" to 7", this mark lands in the 5.5"–7" band. Without
  // scaling, it would remain in the 7"–8.5" band.
  page.drawRectangle({ x: 8.0 * IN, y: 9 * IN, width: 0.25 * IN, height: 0.25 * IN });
  const letter = await src.save();

  const out = await buildPacketPdf([{ slug: 'a', sha: 'letter', label: 'A', lyreFit: true }], async () => letter, {
    lyreMode: true,
  });
  const { context } = await renderFirstPage(out);

  assert.equal(hasDarkPixelInXBand(context, 5.5 * IN, 7 * IN), true, 'scaled mark appears inside the lyre width');
  assert.equal(hasDarkPixelInXBand(context, 7 * IN + 1, PAGE_W), false, 'no ink extends past the 7" lyre width');
});

test('buildPacketPdf: an actual Lyre page is copied even if its PDF is unusually wide', async () => {
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
  // The page is not flagged as a Letter/score fallback, so it is copied verbatim.
  assert.ok(Math.abs(p0.getWidth() - 14 * IN) < 1e-6, 'unflagged page copied at native width');
  assert.ok(Math.abs(p0.getHeight() - 8.5 * IN) < 1e-6);
  // A normal lyre card is also left untouched.
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

test('packetCharts: Lyre packets pre-shrink Letter fallbacks', () => {
  const gig = { sets: [{ songSlugs: ['fallback'] }] };
  const catalog = {
    tunes: [
      {
        slug: 'fallback',
        title: 'Fallback',
        parts: [
          {
            sha256: 'letter',
            instrumentSlug: 'trumpet',
            instrument: 'Trumpet',
            key: 'bflat',
            partNumber: null,
            format: 'letter',
            originalName: 'fallback-letter.pdf',
            source: null,
          },
        ],
        scores: [],
        audio: [],
      },
    ],
  };

  const [chart] = packetCharts(gig, catalog, 'trumpet', 'lyre');
  assert.equal(chart.sha, 'letter');
  assert.equal(chart.lyreFit, true);
});

test('packetCharts: actual Lyre-format Drive-library parts pass through without downscaling', () => {
  const gig = { sets: [{ songSlugs: ['drive-lyre'] }] };
  const catalog = {
    tunes: [
      {
        slug: 'drive-lyre',
        title: 'Drive Lyre',
        parts: [
          {
            sha256: 'drive-lyre',
            instrumentSlug: 'trumpet',
            instrument: 'Trumpet',
            key: 'bflat',
            partNumber: null,
            format: 'lyre',
            originalName: 'library-lyre.pdf',
            source: 'drive-library',
          },
        ],
        scores: [],
        audio: [],
      },
    ],
  };

  const [chart] = packetCharts(gig, catalog, 'trumpet', 'lyre');
  assert.equal(chart.sha, 'drive-lyre');
  assert.equal(chart.generated, undefined);
  assert.equal(chart.lyreFit, false);
  assert.equal(shouldLyreFitPage(chart, PAGE_W, PAGE_H, true), false);
});

test('packetCharts: generated Lyre-format parts pass through without downscaling', () => {
  const gig = { sets: [{ songSlugs: ['lyre'] }] };
  const catalog = {
    tunes: [
      {
        slug: 'lyre',
        title: 'Lyre',
        parts: [
          {
            sha256: 'lyre',
            instrumentSlug: 'trumpet',
            instrument: 'Trumpet',
            key: 'bflat',
            partNumber: null,
            format: 'lyre',
            generated: true,
            originalName: 'generated-lyre.pdf',
            source: null,
          },
        ],
        scores: [],
        audio: [],
      },
    ],
  };

  const [chart] = packetCharts(gig, catalog, 'trumpet', 'lyre');
  assert.equal(chart.sha, 'lyre');
  assert.equal(chart.generated, true);
  assert.equal(chart.lyreFit, false);
});

test('packetCharts: generated-source Lyre carrier pages are not downscaled by page geometry', () => {
  const gig = { sets: [{ songSlugs: ['generated-carrier'] }] };
  const catalog = {
    tunes: [
      {
        slug: 'generated-carrier',
        title: 'Generated Carrier',
        parts: [
          {
            sha256: 'carrier',
            instrumentSlug: 'trumpet',
            instrument: 'Trumpet',
            key: 'bflat',
            partNumber: null,
            // build-scores Lyre PDFs are 8.5x11 carrier pages, but their catalog
            // format comes from the generated source/filename and is authoritative.
            format: 'lyre',
            generated: true,
            originalName: 'generated-carrier-lyre.pdf',
            source: 'generated-scores',
          },
        ],
        scores: [],
        audio: [],
      },
    ],
  };

  const [chart] = packetCharts(gig, catalog, 'trumpet', 'lyre');
  assert.equal(chart.sha, 'carrier');
  assert.equal(chart.generated, true);
  assert.equal(chart.lyreFit, false);
  assert.equal(shouldLyreFitPage(chart, PAGE_W, PAGE_H, true), false);
});
