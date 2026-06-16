import type { PrintFormat } from './stores';

/**
 * Query string selecting a song in the collection. Preserves the current
 * instrument/format params and closes any open score view (drops view/part).
 */
export function songSearch(current: URLSearchParams, slug: string): string {
  const p = new URLSearchParams(current);
  p.set('song', slug);
  p.delete('view');
  p.delete('part');
  return `?${p}`;
}

/**
 * Query string opening the full-score overlay for a specific part (or the full
 * score when `part` is null): ?song=…&instrument=…&format=…&view=score[&part=<sha>].
 * `part` is the chosen part's content sha — a stable, unique handle, so two
 * variants that share an instrument/key/part-number (different arrangements) are
 * each individually addressable, unlike a part number that may be absent or shared.
 */
export function scoreSearch(opts: {
  song: string;
  instrument: string;
  format: PrintFormat;
  part?: string | null;
}): string {
  const p = new URLSearchParams();
  p.set('song', opts.song);
  p.set('instrument', opts.instrument);
  p.set('format', opts.format);
  p.set('view', 'score');
  if (opts.part != null) p.set('part', opts.part);
  return `?${p}`;
}
