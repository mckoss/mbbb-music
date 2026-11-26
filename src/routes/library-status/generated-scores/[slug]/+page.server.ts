// One song's generated output: every LilyPond file (full score, parts, band
// audio, the .ly master) for preview, plus the originals each generated part
// stands beside, for the side-by-side compare viewer. Read-only.
import { error } from '@sveltejs/kit';

import { getCatalog } from '$lib/server/library';
import { readState } from '$lib/server/lilypond-store';
import type { MaskedItem } from '$lib/types';

export function load({ params }) {
  const tune = getCatalog().tunes.find((t) => t.slug === params.slug);
  if (!tune) throw error(404, 'No such song');
  const build = readState().songs[params.slug] ?? null;

  type Doc = { sha: string; name: string | null; instrumentSlug: string; instrument: string | null; partNumber: number | null; format: string; source: string | null; generated: boolean; current: boolean };
  const asDoc = (p: { sha256: string; originalName: string | null; instrumentSlug?: string; instrument?: string | null; partNumber?: number | null; format?: string; source: string | null; generated?: boolean }, current: boolean): Doc => ({
    sha: p.sha256,
    name: p.originalName,
    instrumentSlug: p.instrumentSlug ?? '',
    instrument: p.instrument ?? null,
    partNumber: p.partNumber ?? null,
    format: p.format ?? 'letter',
    source: p.source,
    generated: Boolean(p.generated),
    current,
  });
  // Every PDF part the song has: what players see now, then what a generated
  // part replaced (the band's originals, or MuseScore-built parts).
  const parts: Doc[] = [
    ...tune.parts.map((p) => asDoc(p, true)),
    ...((tune.masked ?? []) as unknown as MaskedItem[])
      .filter((m) => m.bucket === 'parts' && m.instrumentSlug)
      .map((m) => asDoc(m, false)),
  ];

  return {
    slug: tune.slug,
    title: tune.title,
    build: build
      ? {
          builtAt: build.builtAt,
          builtBy: build.builtBy,
          origin: build.origin ?? 'mscz',
          passed: build.report.passed,
          outputs: build.outputs,
          ai: build.report.ai ?? null,
        }
      : null,
    parts,
  };
}
