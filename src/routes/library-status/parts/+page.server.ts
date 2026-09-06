import { error, fail } from '@sveltejs/kit';
import { getCatalog } from '$lib/server/library';
import { editField, effectiveOverlay } from '$lib/server/corrections';
import { INSTRUMENT_CHOICES } from '../../../sync/instruments.js';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
  return locals.user;
}

export function load({ locals }) {
  requireAdmin(locals);
  return {};
}

export const actions = {
  assign: async ({ request, locals }) => {
    const user = requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('file') ?? '');
    const instrument = String(form.get('instrument') ?? '');
    if (!INSTRUMENT_CHOICES.some((i) => i.slug === instrument)) return fail(400, { message: 'Choose an instrument' });
    if (!getCatalog().tunes.some((t) => t.unclassified.some((p) => p.driveFileId === id))) return fail(404, { message: 'Chart no longer needs classification' });
    editField({ scope: 'file', targetId: id, field: 'instrumentSlug', value: instrument, by: user.email });
    return { ok: true };
  },
  visibility: async ({ request, locals }) => {
    const user = requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('file') ?? '');
    const instrument = String(form.get('instrument') ?? '');
    const mode = String(form.get('mode') ?? '');
    if (!['hide', 'show', 'hideAll', 'showAll'].includes(mode)) return fail(400, { message: 'Invalid action' });
    const parts = getCatalog().tunes.flatMap((t) => [...t.parts, ...t.hiddenParts]);
    if (!parts.some((p) => p.driveFileId === id && p.instrumentSlug === instrument)) {
      return fail(404, { message: 'Part no longer exists; refresh this page' });
    }
    if (mode.endsWith('All')) {
      editField({ scope: 'file', targetId: id, field: 'hidden', value: String(mode === 'hideAll'), by: user.email });
    } else {
      const current = effectiveOverlay().file[id]?.hiddenInstruments;
      const hidden = new Set<string>(current ? JSON.parse(current) : []);
      if (mode === 'hide') hidden.add(instrument);
      else hidden.delete(instrument);
      editField({ scope: 'file', targetId: id, field: 'hiddenInstruments', value: JSON.stringify([...hidden]), by: user.email });
    }
    return { ok: true };
  },
};
