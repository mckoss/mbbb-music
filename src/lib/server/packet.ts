// Server-side assembly of a gig's charts into one downloadable PDF.
//
// The packet is built by *copying vector pages* from each source PDF into a new
// document (pdf-lib) — no rasterization — so the result stays print-sharp and
// small, and text remains selectable. The chart set is resolved exactly like the
// gig page's Download list (set order, de-duplicated by content sha, songs with
// no chart in the chosen instrument/format skipped) so the combined PDF and the
// per-chart links never disagree.

import { PDFDocument } from 'pdf-lib';

import type { Catalog } from '$lib/types';
import type { Gig } from '$lib/gig';
import type { PrintFormat } from '$lib/stores';
// Relative (not `$lib/…`) so this assembly module stays importable under the test
// runner, which doesn't resolve the Vite alias. Blob I/O is the caller's job (see
// `loadBlob`), keeping this module free of server-only filesystem/catalog imports.
import { activeScore } from '../resolve.js';

export interface PacketChart {
  slug: string;
  sha: string;
  label: string;
  /**
   * True when this chart has no real Lyre rendition (it resolved to a Letter/other
   * format in a Lyre packet) and so must be shrunk to the lyre card width. See
   * {@link lyreFitPlacement} and the assembly in {@link buildPacketPdf}.
   */
  lyreFit?: boolean;
}

// Lyre-fit target: a 7" content width pinned to the TOP-LEFT of an 8.5×11 sheet,
// leaving the rest as blank carrier the player cuts away to lyre-card size. (The
// real Lyre renditions are already 7" cards on an 8.5×11 sheet, so they pass
// through untouched — only too-wide fallbacks are scaled here.) Units: points.
const LYRE_W = 7 * 72;
const PAGE_W = 8.5 * 72;
const PAGE_H = 11 * 72;

/**
 * Where to draw a source page of `w`×`h` points so it fits the lyre card: scaled
 * DOWN (never up) until it's at most 7" wide, then pinned to the sheet's top-left.
 * A page tall enough that a 7" width would run past the 11" sheet is scaled by
 * height instead, so nothing is ever clipped (it just ends up narrower than 7").
 *
 * @returns the draw rectangle on an 8.5×11 page (origin bottom-left, pdf-lib's).
 */
export function lyreFitPlacement(w: number, h: number): { dw: number; dh: number; x: number; y: number } {
  let scale = Math.min(LYRE_W / w, 1);
  if (h * scale > PAGE_H) scale = PAGE_H / h; // never clip a tall page
  const dw = w * scale;
  const dh = h * scale;
  return { dw, dh, x: 0, y: PAGE_H - dh }; // top-left of the sheet
}

/**
 * The charts that belong in a packet for the chosen instrument/format: every
 * set's songs in order, each resolved to its printable PDF and de-duplicated by
 * content sha (a chart used in two sets appears once). Mirrors the page's
 * `downloads` derivation so the two views stay in lockstep.
 */
export function packetCharts(
  gig: Gig,
  catalog: Catalog,
  instrument: string,
  format: PrintFormat
): PacketChart[] {
  const bySlug = new Map(catalog.tunes.map((t) => [t.slug, t]));
  const seen = new Set<string>();
  const out: PacketChart[] = [];
  for (const set of gig.sets) {
    for (const slug of set.songSlugs) {
      const tune = bySlug.get(slug);
      if (!tune) continue;
      const sc = activeScore(tune, instrument, format, null);
      if (sc && !seen.has(sc.sha)) {
        seen.add(sc.sha);
        // In a Lyre packet, flag for shrink-to-fit anything that isn't a true Lyre
        // card: a chart that resolved to a non-Lyre part (no lyre rendition exists),
        // or a full-band score fallback (always letter-wide, never a 7" card).
        const lyreFit = format === 'lyre' && (sc.format !== 'lyre' || sc.isScore);
        out.push({ slug, sha: sc.sha, label: sc.label, lyreFit });
      }
    }
  }
  return out;
}

/**
 * Merge the charts' source PDFs into one document, in order. A chart whose blob
 * is missing or isn't a loadable PDF is skipped rather than failing the whole
 * packet. Charts flagged {@link PacketChart.lyreFit} are scaled to ≤7" wide and
 * pinned top-left on an 8.5×11 sheet (see {@link lyreFitPlacement}); all others
 * keep their vector pages verbatim. Returns the saved bytes, or null when nothing
 * could be merged.
 *
 * @param loadBlob  Resolves a chart sha to its PDF bytes (the caller supplies the
 *                  CAS reader; tests pass synthetic PDFs).
 * @param opts.title     Document title to stamp on the merged PDF.
 * @param opts.lyreMode  True for a Lyre packet — enables the width safety below.
 */
export async function buildPacketPdf(
  charts: PacketChart[],
  loadBlob: (sha: string) => Promise<Uint8Array | Buffer>,
  opts: { title?: string; lyreMode?: boolean } = {}
): Promise<Uint8Array | null> {
  const { title, lyreMode = false } = opts;
  const merged = await PDFDocument.create();
  let added = 0;
  for (const chart of charts) {
    try {
      const bytes = await loadBlob(chart.sha);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const srcPages = src.getPages();
      for (let i = 0; i < srcPages.length; i++) {
        const { width, height } = srcPages[i].getSize();
        // Lyre-fit a page when its chart has no true-Lyre rendition (chart.lyreFit),
        // OR — as a hard safety in a Lyre packet — whenever a page is physically
        // wider than a letter sheet (landscape/oversized art that would overrun the
        // card). A normal ≤8.5"-wide lyre card is copied verbatim.
        const tooWide = lyreMode && width > PAGE_W + 0.5;
        if (chart.lyreFit || tooWide) {
          // Shrink to ≤7" wide, pinned top-left, leaving carrier to cut for the lyre.
          const embedded = await merged.embedPage(srcPages[i]);
          const { dw, dh, x, y } = lyreFitPlacement(width, height);
          const page = merged.addPage([PAGE_W, PAGE_H]);
          page.drawPage(embedded, { x, y, width: dw, height: dh });
        } else {
          const [copied] = await merged.copyPages(src, [i]);
          merged.addPage(copied);
        }
        added++;
      }
    } catch {
      // Not a loadable PDF (or blob missing) — skip this chart, keep the packet.
      continue;
    }
  }
  if (added === 0) return null;
  if (title) merged.setTitle(title);
  return merged.save();
}
