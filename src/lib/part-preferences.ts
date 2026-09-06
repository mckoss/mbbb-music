// Device-local, per-account selections. No library data or server writes; usable
// offline. Store one selection per notation format so Letter/Lyre don't compete.
export function preferenceKey(user: string, song: string, instrument: string, format: string): string {
  return JSON.stringify([user, song, instrument, format]);
}

export function readPartPreferences(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem('mbbb_part_choices') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { return {}; }
}
