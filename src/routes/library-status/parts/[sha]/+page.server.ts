// Start pages inside one whole-band chart.
//
// The viewer sends a player straight to their part by reading the part names the
// engraver printed in each page's left margin. That covers the band's charts, but
// not a scan with no text layer, a misspelled label, or an arrangement that names
// a part something the vocabulary doesn't know. This page shows what was read and
// lets an admin correct any instrument's page by hand.

import { error, fail } from '@sveltejs/kit';

import { getCatalog } from '$lib/server/library';
import { getPageCount } from '$lib/server/render';
import { getPartPages } from '$lib/server/part-pages';
import { startPages } from '../../../../sync/part-labels.js';
import { editField, effectiveOverlay } from '$lib/server/corrections';
import { INSTRUMENT_CHOICES } from '../../../../sync/instruments.js';

const SHA_RE = /^[a-f0-9]{64}$/;

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
  return locals.user;
}

/** Find a chart by content hash among every song's scores and band charts. */
function findChart(sha: string) {
  for (const tune of getCatalog().tunes) {
    const asset = [...tune.scores, ...(tune.unclassified ?? [])].find((a) => a.sha256 === sha);
    if (asset) return { tune, asset };
  }
  return null;
}

export async function load({ params, locals }) {
  requireAdmin(locals);
  const sha = params.sha ?? '';
  if (!SHA_RE.test(sha)) throw error(400, 'invalid content hash');
  const found = findChart(sha);
  if (!found) throw error(404, 'No such chart');
  const detected = await getPartPages(sha);

  return {
    sha,
    songTitle: found.tune.title,
    chartName: found.asset.originalName,
    driveFileId: found.asset.driveFileId ?? null,
    pageCount: (await getPageCount(sha)) ?? 0,
    // What the PDF's own part labels say, page by page...
    detected,
    // ...and where that lands each instrument, by the same rule the viewer uses.
    detectedPages: startPages(detected),
    // What an admin has overridden, instrument slug -> page.
    overrides: found.asset.partPages ?? {},
    instruments: INSTRUMENT_CHOICES,
  };
}

export const actions = {
  /** Set or clear one instrument's start page. A blank page clears the override. */
  setPage: async ({ params, request, locals }) => {
    const user = requireAdmin(locals);
    const sha = params.sha ?? '';
    const found = SHA_RE.test(sha) ? findChart(sha) : null;
    const id = found?.asset.driveFileId;
    if (!id) return fail(404, { message: 'Chart no longer exists; refresh this page' });

    const form = await request.formData();
    const instrument = String(form.get('instrument') ?? '');
    const raw = String(form.get('page') ?? '').trim();
    if (!INSTRUMENT_CHOICES.some((i) => i.slug === instrument)) {
      return fail(400, { message: 'Choose an instrument' });
    }

    const pageCount = (await getPageCount(sha)) ?? 0;
    const page = Number.parseInt(raw, 10);
    if (raw !== '' && (!Number.isInteger(page) || page < 1 || page > pageCount)) {
      return fail(400, { message: `Page must be between 1 and ${pageCount}` });
    }

    // Corrections are whole-value edits, so read the current map, change the one
    // instrument, and write it back.
    const current = effectiveOverlay().file[id]?.partPages;
    let pages: Record<string, number> = {};
    try {
      const parsed = JSON.parse(current || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) pages = parsed;
    } catch {
      pages = {};
    }
    if (raw === '') delete pages[instrument];
    else pages[instrument] = page;

    editField({ scope: 'file', targetId: id, field: 'partPages', value: JSON.stringify(pages), by: user.email });
    return { ok: true };
  },
};
