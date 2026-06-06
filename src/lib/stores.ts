import { writable } from 'svelte/store';

export type PrintFormat = 'letter' | 'lyre';

export interface ScoreView {
  sha: string;
  title: string;
  label: string;
}

// The globally-selected instrument. Initialized to the first catalog
// instrument once the catalog loads (see +layout.svelte).
export const instrumentSlug = writable<string>('');

// Print/performance page format applied to PDF previews and the overlay.
export const printFormat = writable<PrintFormat>('letter');

// Free-text filter for the collection list.
export const search = writable<string>('');

// The currently-selected tune slug, or null when none is selected.
export const selectedSlug = writable<string | null>(null);

// When non-null, the full-screen Score/Performance overlay is open showing
// this PDF.
export const score = writable<ScoreView | null>(null);
