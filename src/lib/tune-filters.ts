import type { SongStatus } from './song-status';

export function defaultStatuses(): Record<SongStatus, boolean> {
  return { Always: true, Active: true, Learning: true, Archive: false, Unfiled: true };
}

export function filterTunes<T extends { title: string; status: SongStatus }>(
  tunes: T[], query: string, show: Record<SongStatus, boolean>
): T[] {
  const term = query.trim().toLowerCase();
  return tunes.filter((t) => show[t.status] && t.title.toLowerCase().includes(term));
}
