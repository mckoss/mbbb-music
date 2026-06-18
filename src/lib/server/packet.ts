// Server-side assembly of a gig's charts into one downloadable PDF.
//
// The packet is built by *copying vector pages* from each source PDF into a new
// document (pdf-lib) — no rasterization — so the result stays print-sharp and
// small, and text remains selectable. The chart set is resolved exactly like the
// gig page's Download list (set order, de-duplicated by content sha, songs with
// no chart in the chosen instrument/format skipped) so the combined PDF and the
// per-chart links never disagree.

import { readFile } from 'node:fs/promises';

import { PDFDocument } from 'pdf-lib';

import type { Catalog } from '$lib/types';
import type { Gig } from '$lib/gig';
import type { PrintFormat } from '$lib/stores';
import { activeScore } from '$lib/resolve';
import { casPath } from '$lib/server/library';

export interface PacketChart {
  slug: string;
  sha: string;
  label: string;
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
        out.push({ slug, sha: sc.sha, label: sc.label });
      }
    }
  }
  return out;
}

/**
 * Merge the charts' source PDFs into one document, in order. A chart whose blob
 * is missing or isn't a loadable PDF is skipped rather than failing the whole
 * packet. Returns the saved bytes, or null when nothing could be merged.
 */
export async function buildPacketPdf(
  charts: PacketChart[],
  title?: string
): Promise<Uint8Array | null> {
  const merged = await PDFDocument.create();
  let added = 0;
  for (const chart of charts) {
    try {
      const bytes = await readFile(casPath(chart.sha));
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
      added++;
    } catch {
      // Not a loadable PDF (or blob missing) — skip this chart, keep the packet.
      continue;
    }
  }
  if (added === 0) return null;
  if (title) merged.setTitle(title);
  return merged.save();
}
