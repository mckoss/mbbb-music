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
import { activePdfs } from '../resolve.js';

export interface PacketChart {
  slug: string;
  sha: string;
  label: string;
  /**
   * True when this chart is not actual Lyre-format music in a Lyre packet, so it
   * should be re-homed onto the lyre carrier sheet at a 7" page width.
   */
  lyreFit?: boolean;
  /** True for app-generated MuseScore output; these lyre cards are preformatted. */
  generated?: boolean;
  /**
   * 1-based page to keep from this chart's PDF (the rest are dropped). Used to
   * pull a single page out of an undifferentiated full score. Out-of-range or
   * absent means "all pages".
   */
  onlyPage?: number;
}

// Lyre-fit target: a 7" content width pinned to the TOP-LEFT of an 8.5×11 sheet,
// leaving the rest as blank carrier the player cuts away to lyre-card size.
// Real Lyre renditions, including build-scores output from generated sources,
// may also be 8.5×11 carrier pages; the catalog format/provenance decides
// whether a chart is already Lyre music, not the PDF page dimensions.
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
 * Per-song customization of a packet, expressed as deviations from the default
 * (every song, every matching part). The download box sends these so a player
 * can leave songs out or pin a single part; omitting it builds the full packet.
 */
export interface PacketSelection {
  /** Song slugs to leave out of the packet entirely. */
  omit?: Set<string>;
  /** Pin a song to a single part by sha; its other parts are dropped. */
  partBySlug?: Map<string, string>;
  /**
   * Keep only one (1-based) page of a song's full score — for picking a single
   * page out of an undifferentiated combined score. Applies only when the song
   * resolves to a full score, not to instrument parts.
   */
  pageBySlug?: Map<string, number>;
}

/**
 * The charts that belong in a packet for the chosen instrument/format: every
 * set's songs in order, each resolved to all matching printable PDFs and
 * de-duplicated by content sha (a chart used in two sets appears once). Mirrors
 * the page's packet download derivation so the two views stay in lockstep.
 *
 * An optional {@link PacketSelection} narrows the result: omitted songs are
 * skipped, and a song pinned to one part keeps only that sha. Absent selection
 * (or empty sets/maps) yields the full default packet.
 */
export function packetCharts(
  gig: Gig,
  catalog: Catalog,
  instrument: string,
  format: PrintFormat,
  selection?: PacketSelection
): PacketChart[] {
  const bySlug = new Map(catalog.tunes.map((t) => [t.slug, t]));
  const seen = new Set<string>();
  const out: PacketChart[] = [];
  for (const set of gig.sets) {
    for (const slug of set.songSlugs) {
      if (selection?.omit?.has(slug)) continue;
      const tune = bySlug.get(slug);
      if (!tune) continue;
      const pinnedSha = selection?.partBySlug?.get(slug);
      for (const sc of activePdfs(tune, instrument, format)) {
        if (pinnedSha && sc.sha !== pinnedSha) continue;
        if (seen.has(sc.sha)) continue;
        seen.add(sc.sha);
        // In a Lyre packet, shrink Letter/score fallbacks to a 7" page width.
        // Actual Lyre-format music is already authored for the lyre card and must
        // pass through unchanged, including generated MuseScore Lyre PDFs.
        const lyreFit = format === 'lyre' && (sc.format !== 'lyre' || sc.isScore);
        // A page pin only makes sense on a full score (a single combined PDF);
        // instrument parts are already one chart per part.
        const onlyPage = sc.isScore ? selection?.pageBySlug?.get(slug) : undefined;
        out.push({
          slug,
          sha: sc.sha,
          label: sc.label,
          lyreFit,
          ...(sc.generated ? { generated: true } : {}),
          ...(onlyPage ? { onlyPage } : {}),
        });
      }
    }
  }
  return out;
}

export function shouldLyreFitPage(
  chart: Pick<PacketChart, 'lyreFit' | 'generated'>,
  _pageWidth: number,
  _pageHeight: number,
  lyreMode: boolean
): boolean {
  if (!lyreMode) return false;
  return chart.lyreFit === true;
}

/**
 * Merge the charts' source PDFs into one document, in order. A chart whose blob
 * is missing or isn't a loadable PDF is skipped rather than failing the whole
 * packet. Letter/score fallbacks in a Lyre packet are scaled to ≤7" wide and
 * pinned top-left on an 8.5×11 sheet (see {@link lyreFitPlacement}); actual
 * Lyre-format pages keep their vector pages verbatim. Returns the saved bytes,
 * or null when nothing could be merged.
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
      // A valid page pin narrows this chart to that single page; otherwise every
      // page is copied (an out-of-range pin falls back to all, never empty).
      const pinned = chart.onlyPage;
      const indices =
        pinned != null && pinned >= 1 && pinned <= srcPages.length
          ? [pinned - 1]
          : srcPages.map((_, i) => i);
      for (const i of indices) {
        const { width, height } = srcPages[i].getSize();
        // Lyre-fit only charts that resolved to Letter/score fallbacks. Actual
        // Lyre-format pages, including generated MuseScore Lyre output, pass
        // through unchanged.
        if (shouldLyreFitPage(chart, width, height, lyreMode)) {
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
