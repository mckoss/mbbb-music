// Admin-only LilyPond pipeline control (PLAN.md decision 9: every file
// conversion is started by an admin, enforced here on the server).
//   GET  /admin/lilypond → { jobs, builds } — queue state and each song's last build
//   POST /admin/lilypond → { action: 'build', slugs, ai? } | { action: 'build-all' } | { action: 'revert', slug }
// A song with a MuseScore master is converted from it; a PDF-only song gets a
// draft master read from its part PDFs by OMR (src/omr/pipeline.js).
// The hook already restricts /admin/* to admins; we re-check defensively.
import { error, json } from '@sveltejs/kit';

import { aiAvailable, allConvertibleSlugs, enqueue, getJobs, revert } from '$lib/server/lilypond-runner';
import { readState } from '$lib/server/lilypond-store';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

/** Per-song build summary for the Generated page (no output lists). */
function builds() {
  const out: Record<string, unknown> = {};
  for (const [slug, b] of Object.entries(readState().songs)) {
    out[slug] = {
      builtAt: b.builtAt,
      builtBy: b.builtBy,
      origin: b.origin ?? 'mscz',
      omr: b.report.omr ?? null,
      ai: b.report.ai ?? null,
      masterSha256: b.masterSha256,
      outputs: b.outputs.length,
      parts: b.report.parts.length,
      passed: b.report.passed,
      warnings: b.report.warnings,
      checks: b.report.checks,
    };
  }
  return out;
}

export function GET({ locals }) {
  requireAdmin(locals);
  return json({ jobs: getJobs(), builds: builds(), aiAvailable: aiAvailable() });
}

export async function POST({ locals, request }) {
  requireAdmin(locals);
  const body = await request.json().catch(() => ({}));
  const by = locals.user?.email ?? null;
  if (body.action === 'build') {
    const slugs = Array.isArray(body.slugs) ? body.slugs.map(String).filter(Boolean) : [];
    if (!slugs.length) throw error(400, 'No songs given');
    // body.ai: run the AI correction pass (PDF-only songs; spends API credit).
    return json(enqueue(slugs, by, { ai: body.ai === true }));
  }
  if (body.action === 'build-all') {
    return json(enqueue(allConvertibleSlugs(), by));
  }
  if (body.action === 'revert') {
    const slug = String(body.slug || '');
    if (!slug) throw error(400, 'No song given');
    return json({ reverted: revert(slug) });
  }
  throw error(400, 'Unknown action');
}
