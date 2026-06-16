// Recent-edits page: the single management surface for human metadata
// corrections. Lists every edit (newest first, including soft-deleted ones — the
// full history) and lets an admin (or the original editor) delete one, which
// reverts that field to its previous value. Viewable by any approved user.
import { readFileSync } from 'node:fs';

import { error, fail } from '@sveltejs/kit';

import { loadConfig } from '../../sync/config.js';
import { recentEdits, deleteEdit, restoreEdit, getEdit } from '$lib/server/corrections';
import { stripCopyOf } from '$lib/format';

/** driveFileId -> a friendly "name (song)" label, read from the manifest. */
function fileLabels(): Record<string, string> {
  try {
    const cfg = loadConfig();
    const manifest = JSON.parse(readFileSync(cfg.manifestPath, 'utf8'));
    const out: Record<string, string> = {};
    for (const e of Object.values(manifest.files ?? {}) as Array<Record<string, string>>) {
      if (e.driveFileId) out[e.driveFileId] = e.originalName ? stripCopyOf(e.originalName) : e.driveFileId;
    }
    return out;
  } catch {
    return {};
  }
}

export function load({ locals }) {
  const labels = fileLabels();
  const edits = recentEdits().map((e) => ({
    ...e,
    targetLabel: e.scope === 'file' ? (labels[e.target_id] ?? e.target_id) : e.target_id,
    // An admin, or the person who made the edit, may delete or restore it.
    canManage: locals.user?.role === 'admin' || locals.user?.email === e.edited_by,
  }));
  return { edits, isAdmin: locals.user?.role === 'admin' };
}

function requireManage(locals: App.Locals, editedBy: string) {
  const user = locals.user;
  if (!user?.role) throw error(403, 'Sign in required');
  if (user.role !== 'admin' && user.email !== editedBy) throw error(403, 'Not allowed');
  return user;
}

export const actions = {
  delete: async ({ request, locals }) => {
    const form = await request.formData();
    const id = Number(form.get('id'));
    if (!Number.isInteger(id)) return fail(400, { message: 'bad id' });
    const row = getEdit(id);
    if (!row) return fail(404, { message: 'no such edit' });
    const user = requireManage(locals, row.edited_by);
    deleteEdit(id, user.email);
    return { ok: true };
  },

  restore: async ({ request, locals }) => {
    const form = await request.formData();
    const id = Number(form.get('id'));
    if (!Number.isInteger(id)) return fail(400, { message: 'bad id' });
    const row = getEdit(id);
    if (!row) return fail(404, { message: 'no such edit' });
    requireManage(locals, row.edited_by);
    restoreEdit(id);
    return { ok: true };
  },
};
