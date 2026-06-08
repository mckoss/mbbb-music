import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export type PrintFormat = 'letter' | 'lyre';

export interface ScoreView {
  sha: string;
  title: string;
  label: string;
}

function readCookie(name: string): string | null {
  if (!browser) return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (!browser) return;
  // Site-wide, persists for a year so a member's choices stick across visits.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * A writable string store backed by a cookie, so the value survives reloads and
 * return visits. Hydrates from the cookie on the client (the server starts at
 * the default and the client restores the saved value on mount).
 */
function persistedCookie<T extends string>(name: string, initial: T): Writable<T> {
  const stored = readCookie(name);
  const store = writable<T>((stored as T) || initial);
  if (browser) store.subscribe((v) => writeCookie(name, String(v)));
  return store;
}

// The globally-selected instrument. Persisted across visits (#2); initialized to
// the first catalog instrument once the catalog loads (see +layout.svelte) only
// when no saved choice exists.
export const instrumentSlug = persistedCookie<string>('mbbb_instrument', '');

// Print/performance page format applied to PDF previews and the overlay.
// Persisted across visits (#2).
export const printFormat = persistedCookie<PrintFormat>('mbbb_format', 'letter');

// Free-text filter for the collection list.
export const search = writable<string>('');

// The currently-selected tune slug, or null when none is selected.
export const selectedSlug = writable<string | null>(null);

// When non-null, the full-screen Score/Performance overlay is open showing
// this PDF.
export const score = writable<ScoreView | null>(null);
