import type { Tune, CatalogPart } from './types';
import type { PrintFormat } from './stores';
import { partLabel } from './format';

export interface ActivePdf {
  sha: string;
  label: string;
  // For building a download filename.
  instrumentSlug: string | null;
  key: string | null;
  partNumber: number | null;
  format: PrintFormat;
  isScore: boolean;
}

/** Parts of a tune matching the given instrument slug. */
export function partsFor(tune: Tune, instrumentSlug: string): CatalogPart[] {
  return tune.parts.filter((p) => p.instrumentSlug === instrumentSlug);
}

/**
 * Parts for an instrument in the selected print format, so the list conforms to
 * the Format dropdown. Falls back to all of the instrument's parts when none
 * exist in the chosen format (so the user still sees the available rendition).
 */
export function partsForFormat(
  tune: Tune,
  instrumentSlug: string,
  printFormat: PrintFormat
): CatalogPart[] {
  const all = partsFor(tune, instrumentSlug);
  const inFormat = all.filter((p) => p.format === printFormat);
  return inFormat.length > 0 ? inFormat : all;
}

/**
 * Resolve the PDF to show for a tune given the selected instrument, print
 * format, and an optional chosen part sha. Falls back to the first full score,
 * then null.
 */
export function activePdf(
  tune: Tune,
  instrumentSlug: string,
  printFormat: PrintFormat,
  chosenSha?: string | null
): ActivePdf | null {
  const matches = partsForFormat(tune, instrumentSlug, printFormat);
  if (matches.length > 0) {
    const part = matches.find((p) => p.sha256 === chosenSha) ?? matches[0];
    return {
      sha: part.sha256,
      label: partLabel(part),
      instrumentSlug: part.instrumentSlug,
      key: part.key,
      partNumber: part.partNumber,
      format: part.format as PrintFormat,
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
      format: printFormat,
      isScore: true,
    };
  }
  return null;
}

/**
 * Resolve the score-overlay PDF from URL params: the chosen instrument, format,
 * and optional part number for a tune. Picks the matching part (or the full
 * score when the instrument has none), via {@link activePdf}.
 */
export function activeScore(
  tune: Tune,
  instrumentSlug: string,
  printFormat: PrintFormat,
  part: number | null
): ActivePdf | null {
  const parts = partsForFormat(tune, instrumentSlug, printFormat);
  const chosen = part != null ? parts.find((p) => p.partNumber === part) : null;
  return activePdf(tune, instrumentSlug, printFormat, chosen?.sha256 ?? null);
}
