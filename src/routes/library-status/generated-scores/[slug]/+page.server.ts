// One song's versions page: every file the song has, grouped by where it came
// from — the band's original PDFs, the MuseScore master and MuseScore-built
// parts, and the app's LilyPond builds — for preview and the side-by-side
// compare viewer. Includes files a generated version masks for players. Read-only.
import { error } from '@sveltejs/kit';

import { getCatalog } from '$lib/server/library';
import { readState } from '$lib/server/lilypond-store';
import type { MaskedItem } from '$lib/types';

/** Where a file came from. */
export type Origin = 'original' | 'musescore' | 'lilypond' | 'draft';

interface AnyAsset {
  sha256: string;
  originalName: string | null;
  instrumentSlug?: string;
  instrument?: string | null;
  partNumber?: number | null;
  partNumbers?: number[];
  format?: string;
  source: string | null;
  generated?: boolean;
  modifiedTime?: string | null;
}

function originOf(a: AnyAsset): Origin {
  if (a.source === 'lilypond') return 'lilypond';
  if (a.source === 'lilypond-omr') return 'draft';
  return a.generated ? 'musescore' : 'original';
}

export function load({ params }) {
  const tune = getCatalog().tunes.find((t) => t.slug === params.slug);
  if (!tune) throw error(404, 'No such song');
  const build = readState().songs[params.slug] ?? null;
  const masked = (tune.masked ?? []) as unknown as (Omit<MaskedItem, 'bucket'> & { bucket: string })[];

  const doc = (a: AnyAsset, current: boolean) => ({
    sha: a.sha256,
    name: a.originalName,
    instrumentSlug: a.instrumentSlug ?? '',
    instrument: a.instrument ?? null,
    partNumber: a.partNumber ?? null,
    partNumbers: a.partNumbers ?? (a.partNumber != null ? [a.partNumber] : []),
    format: a.format ?? (/\blyre\b/i.test(a.originalName ?? '') ? 'lyre' : 'letter'),
    source: a.source,
    origin: originOf(a),
    modified: a.modifiedTime ?? null,
    current,
  });

  // Every PDF part: what players see now, then what a generated version masks.
  const parts = [
    ...tune.parts.map((p) => doc(p as AnyAsset, true)),
    ...masked.filter((m) => m.bucket === 'parts' && m.instrumentSlug).map((m) => doc(m as AnyAsset, false)),
  ];
  const scores = [
    ...tune.scores.map((s) => doc(s as AnyAsset, true)),
    ...masked.filter((m) => m.bucket === 'scores').map((m) => doc(m as AnyAsset, false)),
  ];
  const audio = [
    ...tune.audio.map((a) => doc(a as AnyAsset, true)),
    ...masked.filter((m) => m.bucket === 'audio').map((m) => doc(m as AnyAsset, false)),
  ];
  const musescore = tune.musescore.map((m) => doc(m as AnyAsset, true));

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
    scores,
    audio,
    musescore,
  };
}
