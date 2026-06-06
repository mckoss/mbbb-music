import type { Tune, CatalogPart } from './types';
import { partLabel } from './format';

export interface ActivePdf {
  sha: string;
  label: string;
  // For building a download filename.
  instrumentSlug: string | null;
  key: string | null;
  partNumber: number | null;
  isScore: boolean;
}

/** Parts of a tune matching the given instrument slug. */
export function partsFor(tune: Tune, instrumentSlug: string): CatalogPart[] {
  return tune.parts.filter((p) => p.instrumentSlug === instrumentSlug);
}

/**
 * Resolve the PDF to show for a tune given the selected instrument and an
 * optional chosen part sha. Falls back to the first full score, then null.
 */
export function activePdf(
  tune: Tune,
  instrumentSlug: string,
  chosenSha?: string | null
): ActivePdf | null {
  const matches = partsFor(tune, instrumentSlug);
  if (matches.length > 0) {
    const part = matches.find((p) => p.sha256 === chosenSha) ?? matches[0];
    return {
      sha: part.sha256,
      label: partLabel(part),
      instrumentSlug: part.instrumentSlug,
      key: part.key,
      partNumber: part.partNumber,
      isScore: false,
    };
  }
  const score = tune.scores[0];
  if (score) {
    return {
      sha: score.sha256,
      label: 'Full score',
      instrumentSlug: null,
      key: null,
      partNumber: null,
      isScore: true,
    };
  }
  return null;
}
