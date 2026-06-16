// Admin-only provenance backfill:
//   POST /admin/origins → walk the CAS and write a data/cas/origins/<sha>.json
//                         sidecar for every blob lacking one, recovering origin
//                         from the manifest. Idempotent (write-once). Returns the
//                         counts. Runs on the server's data volume, so it works on
//                         the deployed (Railway) instance, not just localhost.
// The hook already restricts /admin/* to admins; we re-check defensively.
import { resolve } from 'node:path';

import { error, json } from '@sveltejs/kit';

import { loadConfig } from '../../../sync/config.js';
import { recoverOrigins } from '../../../sync/origins.js';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

export async function POST({ locals }) {
  requireAdmin(locals);
  const config = loadConfig();
  const casDir = resolve(config.dataDir, 'cas');
  const result = await recoverOrigins({ casDir, manifestPath: config.manifestPath });
  return json(result);
}
