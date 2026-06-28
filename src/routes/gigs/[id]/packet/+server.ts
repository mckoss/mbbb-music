// Combined-PDF download for a gig packet. Resolves the gig's charts for the
// requested instrument/format and streams them merged into one PDF as an
// attachment. The instrument/format come from the query string (the download
// box's local pickers), independent of the viewer's global cookie choice.
import { readFile } from 'node:fs/promises';

import { error } from '@sveltejs/kit';

import { getGig } from '$lib/server/gigs';
import { getCatalog, casPath } from '$lib/server/library';
import { instrumentDisplay } from '$lib/format';
import type { Catalog } from '$lib/types';
import type { PrintFormat } from '$lib/stores';
import { packetCharts, buildPacketPdf, type PacketSelection } from '$lib/server/packet';

/**
 * Parse the download box's per-song customization from the query string:
 *   omit=slug1,slug2          songs to leave out
 *   part=slug:sha (repeated)  songs pinned to a single part
 * Returns undefined when neither is present (the default full packet).
 */
function parseSelection(url: URL): PacketSelection | undefined {
  const omit = new Set(
    (url.searchParams.get('omit') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const partBySlug = new Map<string, string>();
  for (const raw of url.searchParams.getAll('part')) {
    const i = raw.indexOf(':');
    if (i <= 0) continue;
    const slug = raw.slice(0, i);
    const sha = raw.slice(i + 1);
    if (slug && sha) partBySlug.set(slug, sha);
  }
  if (omit.size === 0 && partBySlug.size === 0) return undefined;
  return { omit, partBySlug };
}

/** Strip characters unsafe in a Content-Disposition filename. */
function safeName(s: string): string {
  return s.replace(/[\\/"\r\n]/g, '-').replace(/\s+/g, ' ').trim();
}

export async function GET({ params, url }) {
  const gig = getGig(params.id ?? '');
  if (!gig) throw error(404, 'Gig not found');
  // The server catalog's JSDoc under-describes instruments (no `key`) and tunes
  // (no `status`); both are present at runtime, so widen to the full type — the
  // same cast the gig page makes on the serialized catalog.
  const catalog = getCatalog() as unknown as Catalog;

  const instrument = url.searchParams.get('instrument') ?? '';
  const format: PrintFormat = url.searchParams.get('format') === 'lyre' ? 'lyre' : 'letter';

  const charts = packetCharts(gig, catalog, instrument, format, parseSelection(url));
  if (charts.length === 0) throw error(404, 'No charts for this instrument and format');

  const inst = catalog.instruments.find((i) => i.slug === instrument);
  const instLabel = inst ? instrumentDisplay(inst.label, inst.key) : instrument || 'All parts';
  const fmtLabel = format === 'lyre' ? 'Lyre' : 'Letter';

  const pdf = await buildPacketPdf(charts, (sha) => readFile(casPath(sha)), {
    title: `${gig.name} — ${instLabel} (${fmtLabel})`,
    lyreMode: format === 'lyre',
  });
  if (!pdf) throw error(404, 'No charts could be assembled into a PDF');

  // RFC 5987: an ASCII-only fallback plus a UTF-8 name so keys like "B♭" survive.
  const niceName = `MBBB - ${gig.name} - ${instLabel} (${fmtLabel}).pdf`;
  // ASCII fallback: transliterate the accidental glyphs so "B♭" reads "Bb", not "B".
  const asciiName = safeName(niceName.replace(/♭/g, 'b').replace(/♯/g, '#')).replace(
    /[^\x20-\x7e]/g,
    ''
  );
  const disposition =
    `attachment; filename="${asciiName}"; ` +
    `filename*=UTF-8''${encodeURIComponent(safeName(niceName))}`;

  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': disposition,
      'content-length': String(pdf.byteLength),
      'cache-control': 'no-store',
    },
  });
}
