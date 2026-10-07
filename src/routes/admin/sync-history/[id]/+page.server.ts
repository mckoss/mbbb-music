// Admin-only detail for one preserved Drive sync run: every file it added,
// updated (renamed, moved, content replaced, or reclassified to another song /
// instrument / part), restored, or removed — plus failures, warnings, and the log.
import { error } from '@sveltejs/kit';

import { loadConfig } from '../../../../sync/config.js';
import { historyDirFor, loadSyncRun } from '../../../../sync/history.js';
import { listUsers } from '$lib/server/users';
import { formatPacificDateTime } from '$lib/time';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

export async function load({ locals, params }) {
  requireAdmin(locals);
  const run = await loadSyncRun(historyDirFor(loadConfig().dataDir), params.id);
  if (!run) throw error(404, 'No such sync run');
  const by = run.trigger?.by as string | null;
  const name = by ? (listUsers().find((u) => u.email === by)?.name ?? by) : null;
  return {
    run,
    when: formatPacificDateTime(run.startedAt),
    seconds: Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)),
    // null → run from the command line (or by an unrecorded starter).
    by: name,
  };
}
