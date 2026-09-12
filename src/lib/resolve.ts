import type { Tune, CatalogPart, CatalogAsset } from './types';
import type { PrintFormat } from './stores';
import { partOptionLabel, partShortLabel, stripCopyOf } from './format.js';

export interface ActivePdf {
  sha: string;
  label: string;
  // For building a download filename.
  instrumentSlug: string | null;
  key: string | null;
  partNumber: number | null;
  format: PrintFormat;
  isScore: boolean;
  generated?: boolean;
  /** Admin-corrected start pages, when this resolved to a whole-band chart. */
  partPages?: Record<string, number>;
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
      label: partOptionLabel(part, matches),
      instrumentSlug: part.instrumentSlug,
      key: part.key,
      partNumber: part.partNumber,
      format: part.format as PrintFormat,
      isScore: false,
      ...(part.generated ? { generated: true } : {}),
    };
  }
  const score = fullBandChart(tune);
  if (score) {
    return {
      sha: score.sha256,
      label: 'Full score',
      instrumentSlug: null,
      key: null,
      partNumber: null,
      format: printFormat,
      isScore: true,
      ...(score.partPages ? { partPages: score.partPages } : {}),
    };
  }
  return null;
}

/**
 * The chart to fall back on when an instrument has no part of its own: a whole-band
 * "all parts" compilation if the song has one, else a true full score. The
 * compilation wins because it holds a playable part for the reader — and the viewer
 * opens it at that part's own page — where a score is a conductor's document.
 * Dropping these left some songs with nothing at all to show.
 */
function fullBandChart(tune: Tune): CatalogAsset | undefined {
  return tune.unclassified?.[0] ?? tune.scores[0];
}

/**
 * Resolve every printable PDF for an instrument/format packet. This follows the
 * same fallback rule as {@link activePdf}, but keeps every matching part instead
 * of selecting just the first one: parts in the requested format, otherwise all
 * of that instrument's parts, otherwise the first full score.
 */
export function activePdfs(
  tune: Tune,
  instrumentSlug: string,
  printFormat: PrintFormat
): ActivePdf[] {
  const matches = partsForFormat(tune, instrumentSlug, printFormat);
  if (matches.length > 0) {
    return matches.map((part) => ({
      sha: part.sha256,
      label: partOptionLabel(part, matches),
      instrumentSlug: part.instrumentSlug,
      key: part.key,
      partNumber: part.partNumber,
      format: part.format as PrintFormat,
      isScore: false,
      ...(part.generated ? { generated: true } : {}),
    }));
  }
  const score = fullBandChart(tune);
  if (!score) return [];
  return [
    {
      sha: score.sha256,
      label: 'Full score',
      instrumentSlug: null,
      key: null,
      partNumber: null,
      format: printFormat,
      isScore: true,
      ...(score.partPages ? { partPages: score.partPages } : {}),
    },
  ];
}

export type DocKind = 'part' | 'score' | 'notes';

export interface ViewableDoc {
  sha: string;
  label: string;
  kind: DocKind;
  /** The asset behind the doc, when the viewer needs more than a sha (e.g. a
   *  whole-band chart's admin-corrected start pages). */
  asset?: CatalogAsset;
}

/** A filename trimmed to a short human label: drop "Copy of", the extension, underscores. */
function cleanDocName(name: string | null): string {
  if (!name) return '';
  return stripCopyOf(name)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every PDF a song can show in the score viewer, in display/priority order: the
 * current instrument's parts first, then the full-band score(s), then notes
 * (Google Docs exported to PDF). De-duplicated by content sha. The first entry is
 * the sensible default — a part if the instrument has one, otherwise a real
 * score, and only a note when that's all there is. Each carries a label that
 * disambiguates it within its kind, and the `part` sha addressing matches the
 * URL's ?part handle so a selection is shareable.
 */
export function viewableDocs(
  tune: Tune,
  instrumentSlug: string,
  printFormat: PrintFormat
): ViewableDoc[] {
  const out: ViewableDoc[] = [];
  const seen = new Set<string>();
  const push = (sha: string, label: string, kind: DocKind, asset?: CatalogAsset) => {
    if (seen.has(sha)) return;
    seen.add(sha);
    out.push({ sha, label, kind, ...(asset ? { asset } : {}) });
  };

  // The instrument and format are chosen by their own dropdowns, so the Document
  // picker only needs the part identity — "Part 1", "Part 2", … (and "Full score"
  // / "Notes" below) — never the instrument name or a raw filename.
  const parts = partsForFormat(tune, instrumentSlug, printFormat);
  for (const p of parts) push(p.sha256, partShortLabel(p, parts), 'part');

  // Charts the importer couldn't pin to an instrument — typically a whole-band
  // "all parts" PDF holding every player's part back to back. For someone with no
  // part of their own these outrank a full score: a score is a conductor's
  // document, every instrument stacked on one system, while a parts compilation
  // contains an actual playable part — and the viewer can open it straight at the
  // reader's own page. (`unclassified` is a review flag for admins; it was never a
  // reason to hide music from the band.)
  const unclassified = tune.unclassified ?? [];
  for (const u of unclassified) {
    push(u.sha256, cleanDocName(u.originalName) || 'Band chart', 'score', u);
  }

  const scores = tune.scores ?? [];
  for (const s of scores) {
    push(s.sha256, scores.length === 1 ? 'Full score' : `Full score — ${cleanDocName(s.originalName) || 'untitled'}`, 'score', s);
  }

  const notes = tune.notes ?? [];
  for (const n of notes) {
    push(n.sha256, notes.length === 1 ? 'Notes' : `Notes — ${cleanDocName(n.originalName) || 'untitled'}`, 'notes');
  }

  return out;
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

/**
 * Resolve the gig-run PDF from an exact current-song part selection plus the
 * cross-song part-number preference. The exact sha wins when it still belongs to
 * the current tune; otherwise the part number carries forward to the next tune.
 */
export function activeScoreForRun(
  tune: Tune,
  instrumentSlug: string,
  printFormat: PrintFormat,
  selectedSha: string | null,
  preferredPart: number | null
): ActivePdf | null {
  const parts = partsForFormat(tune, instrumentSlug, printFormat);
  const exact = selectedSha ? parts.find((p) => p.sha256 === selectedSha) : null;
  if (exact) return activePdf(tune, instrumentSlug, printFormat, exact.sha256);
  const chosen = preferredPart != null ? parts.find((p) => p.partNumber === preferredPart) : null;
  return activePdf(tune, instrumentSlug, printFormat, chosen?.sha256 ?? null);
}
