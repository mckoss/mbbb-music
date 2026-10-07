// Admin-only sync history: every preserved Drive sync run (newest first) with
// its outcome and how many files it added, updated, restored, or removed. Each
// run opens to /admin/sync-history/<id> for the per-file detail.
import { error } from '@sveltejs/kit';

import { loadConfig } from '../../../sync/config.js';
import { historyDirFor, listSyncRuns } from '../../../sync/history.js';
import { listUsers } from '$lib/server/users';
import { formatPacificDateTime } from '$lib/time';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

export async function load({ locals }) {
  requireAdmin(locals);
  const names = new Map(listUsers().map((u) => [u.email, u.name || u.email]));
  const runs = (await listSyncRuns(historyDirFor(loadConfig().dataDir))).map((r) => ({
    id: r.id as string,
    when: formatPacificDateTime(r.startedAt),
    seconds: Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000)),
    ok: Boolean(r.ok),
    error: (r.error as string | null) ?? null,
    by: r.trigger?.by ? (names.get(r.trigger.by) ?? r.trigger.by) : r.trigger?.via === 'cli' ? 'Command line' : 'Unknown',
    seen: (r.summary?.seen as number | undefined) ?? null,
    failed: (r.failed?.length as number | undefined) ?? 0,
    warnings: (r.warnings?.length as number | undefined) ?? 0,
    counts: r.changeCounts as Record<string, number>,
  }));
  return { runs };
}
