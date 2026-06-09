// Shared gig-packet model used by both client and server (no server imports, so
// it's safe to import anywhere). A gig is a dated event with one or more sets,
// each an ordered list of songs (by slug) drawn from the library.

/** A start (and optional end) time for one playing slot, as "HH:MM" strings. */
export interface GigTime {
  start: string;
  end?: string;
}

/** Where the gig is. An address (when present) drives a Google Maps link. */
export interface GigLocation {
  name?: string;
  address?: string;
}

/** One set within a gig: an ordered list of song slugs. */
export interface GigSet {
  id: string;
  name?: string;
  songSlugs: string[];
}

export interface Gig {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  times?: GigTime[];
  location?: GigLocation;
  notes?: string;
  sets: GigSet[];
}

/** Input shape for creating a gig (id and sets are assigned/defaulted). */
export interface GigInput {
  name?: string;
  date?: string;
  times?: GigTime[];
  location?: GigLocation;
  notes?: string;
  sets?: GigSet[];
}

/**
 * A new opaque id. On the server we use crypto.randomUUID (available in Node 24
 * and the browser); a short slice keeps gig/set ids readable in URLs.
 */
export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// --- Validation / normalization --------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** True for a well-formed YYYY-MM-DD date string. */
export function isValidDate(date: unknown): date is string {
  return typeof date === 'string' && DATE_RE.test(date);
}

/** True for a well-formed HH:MM time string. */
export function isValidTime(time: unknown): time is string {
  return typeof time === 'string' && TIME_RE.test(time);
}

/** Coerce arbitrary input to a clean GigTime[] (drops empties/invalids). */
export function normalizeTimes(input: unknown): GigTime[] {
  if (!Array.isArray(input)) return [];
  const out: GigTime[] = [];
  for (const t of input) {
    if (!t || typeof t !== 'object') continue;
    const start = (t as GigTime).start;
    const end = (t as GigTime).end;
    if (!isValidTime(start)) continue;
    out.push(isValidTime(end) ? { start, end } : { start });
  }
  return out;
}

/** Coerce arbitrary input to a GigLocation, or undefined when empty. */
export function normalizeLocation(input: unknown): GigLocation | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const name = String((input as GigLocation).name ?? '').trim();
  const address = String((input as GigLocation).address ?? '').trim();
  if (!name && !address) return undefined;
  return { ...(name ? { name } : {}), ...(address ? { address } : {}) };
}

/** Coerce arbitrary input to a clean GigSet[], assigning ids where missing. */
export function normalizeSets(input: unknown): GigSet[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is GigSet => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      id: typeof s.id === 'string' && s.id ? s.id : newId(),
      ...(s.name ? { name: String(s.name) } : {}),
      songSlugs: Array.isArray(s.songSlugs) ? s.songSlugs.filter((x) => typeof x === 'string') : [],
    }));
}

/** A fresh, empty set (used when an admin adds one). */
export function emptySet(name?: string): GigSet {
  return { id: newId(), ...(name ? { name } : {}), songSlugs: [] };
}

/**
 * Build a normalized Gig from input, assigning an id and defaulting to one
 * empty set. The date and name are best-effort: callers (the store) enforce a
 * valid date before persisting where needed.
 */
export function makeGig(input: GigInput): Gig {
  const sets = normalizeSets(input.sets);
  const location = normalizeLocation(input.location);
  return {
    id: newId(),
    name: String(input.name ?? '').trim() || 'Untitled gig',
    date: isValidDate(input.date) ? input.date : '',
    ...(input.times ? { times: normalizeTimes(input.times) } : {}),
    ...(location ? { location } : {}),
    ...(input.notes ? { notes: String(input.notes) } : {}),
    sets: sets.length > 0 ? sets : [emptySet()],
  };
}

// --- Formatting (display helpers) ------------------------------------------

/** "2026-06-14" -> "Sun, Jun 14, 2026" (parsed as a local calendar date). */
export function formatGigDate(date: string): string {
  if (!isValidDate(date)) return date || 'No date';
  const [y, m, d] = date.split('-').map(Number);
  // Construct in local time (not UTC) so the displayed day never slips a date.
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "14:30" -> "2:30 PM". Returns the input unchanged when not HH:MM. */
export function formatGigTime(time: string): string {
  if (!isValidTime(time)) return time;
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** A single set/slot like "2:30 PM – 4:00 PM" or "2:30 PM". */
export function formatGigTimeRange(t: GigTime): string {
  const start = formatGigTime(t.start);
  return t.end ? `${start} – ${formatGigTime(t.end)}` : start;
}

/** All of a gig's time slots joined for a summary line, or '' when none. */
export function formatGigTimes(times: GigTime[] | undefined): string {
  if (!times || times.length === 0) return '';
  return times.map(formatGigTimeRange).join(', ');
}

/** A one-line location summary (name and/or address), or '' when none. */
export function formatGigLocation(loc: GigLocation | undefined): string {
  if (!loc) return '';
  return [loc.name, loc.address].filter(Boolean).join(' · ');
}

/** A Google Maps search URL for an address (open in a new tab). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Sort comparator: by date ascending, then name. */
export function compareByDate(a: Gig, b: Gig): number {
  return a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
}
