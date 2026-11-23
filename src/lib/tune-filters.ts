import { ALL_STATUSES, type SongStatus } from './song-status.js';

export function defaultStatuses(): Record<SongStatus, boolean> {
  return { Always: true, Active: true, Learning: true, Archive: false, Unfiled: true };
}

const matchesTitle = (title: string, term: string) => title.toLowerCase().includes(term);

/**
 * The songs to list. With no search text, the status chips decide. A search
 * covers every song whatever the chips say — someone typing a title wants to find
 * it, and a song hidden by its status (say, Archive) must not look missing. Pair
 * with {@link hiddenStatusMatches} to tell the reader which matches the chips
 * would otherwise hide.
 */
export function filterTunes<T extends { title: string; status: SongStatus }>(
  tunes: T[], query: string, show: Record<SongStatus, boolean>
): T[] {
  const term = query.trim().toLowerCase();
  if (!term) return tunes.filter((t) => show[t.status]);
  return tunes.filter((t) => matchesTitle(t.title, term));
}

/**
 * For a search, the statuses the chips hide that still have matching songs, with
 * how many, in chip order. Empty with no search text or when nothing is hidden.
 */
export function hiddenStatusMatches<T extends { title: string; status: SongStatus }>(
  tunes: T[], query: string, show: Record<SongStatus, boolean>
): { status: SongStatus; count: number }[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const counts = new Map<SongStatus, number>();
  for (const t of tunes) {
    if (show[t.status] || !matchesTitle(t.title, term)) continue;
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  }
  return ALL_STATUSES.filter((s) => counts.has(s)).map((status) => ({ status, count: counts.get(status)! }));
}
