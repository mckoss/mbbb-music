// Shared gig-packet model used by both client and server (no server imports, so
// it's safe to import anywhere). A gig is a dated event with one or more sets,
// each an ordered list of songs (by slug) drawn from the library.
import type { Role } from './types';

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
  /**
   * Band-only notes: call times, parking, the contact's cell number, pay. NEVER
   * leaves the authenticated app — see publicNotes for anything the world may see.
   */
  notes?: string;
  /** Blurb shown to the public on /shows and in the public calendar feed. */
  publicNotes?: string;
  /**
   * The host organization's own page for the event we're playing (the fair, the
   * festival, the parade) — where the full schedule, tickets and parking live.
   * Public by nature. Always http(s): see normalizeUrl.
   */
  eventUrl?: string;
  /**
   * Keep this gig off the public /shows page and calendar feed — a private party,
   * a corporate booking, a rehearsal. Public by default: most gigs are shows.
   */
  hidden?: boolean;
  sets: GigSet[];
  /** A canceled gig stays in the list (struck through) but isn't happening. */
  canceled?: boolean;
  /**
   * Edit counter, bumped on every info change. It is the iCal SEQUENCE: a
   * subscriber's calendar only accepts an update to an event it already has when
   * the sequence goes *up*, so without this a rescheduled gig would silently
   * keep its old date on every phone that already subscribed.
   */
  rev?: number;
}

/** Input shape for creating a gig (id and sets are assigned/defaulted). */
export interface GigInput {
  name?: string;
  date?: string;
  times?: GigTime[];
  location?: GigLocation;
  notes?: string;
  publicNotes?: string;
  eventUrl?: string;
  hidden?: boolean;
  sets?: GigSet[];
  canceled?: boolean;
}

/** Gig Packets can be managed by admins and organizers. */
export function canEditGigs(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'organizer';
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

/**
 * Coerce a pasted event URL to a safe absolute http(s) URL, or undefined.
 *
 * This one is a guard, not a convenience. The value ends up as an `href` on
 * /shows — a page the whole world can read — and Svelte does not sanitize hrefs,
 * so a `javascript:` URL pasted into the editor would render as a live script.
 * Anything that isn't http or https is rejected outright.
 *
 * A bare "whidbeyislandfair.com/schedule" is what people actually paste, so a
 * missing scheme is assumed to be https rather than treated as an error.
 */
export function normalizeUrl(input: unknown): string | undefined {
  const raw = String(input ?? '').trim();
  if (!raw) return undefined;
  // Has a scheme? Keep it (so we can reject it below). Otherwise assume https.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (!url.hostname) return undefined;
  return url.toString();
}

/** "https://www.whidbeyislandfair.com/x" -> "whidbeyislandfair.com". */
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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
  const eventUrl = normalizeUrl(input.eventUrl);
  return {
    id: newId(),
    name: String(input.name ?? '').trim() || 'Untitled gig',
    date: isValidDate(input.date) ? input.date : '',
    ...(input.times ? { times: normalizeTimes(input.times) } : {}),
    ...(location ? { location } : {}),
    ...(input.notes ? { notes: String(input.notes) } : {}),
    ...(input.publicNotes ? { publicNotes: String(input.publicNotes) } : {}),
    ...(eventUrl ? { eventUrl } : {}),
    ...(input.hidden ? { hidden: true } : {}),
    sets: sets.length > 0 ? sets : [emptySet()],
    ...(input.canceled ? { canceled: true } : {}),
  };
}

// --- Public view -------------------------------------------------------------

/**
 * Is this gig listed publicly (on /shows and in the calendar feed)? Gigs are
 * public by default — the band mostly plays shows it wants people at — so this
 * is an opt-*out*: `hidden` takes a private booking off the page. A gig with no
 * date can't be listed either; there'd be nowhere to put it.
 *
 * Only ever pair this with publicGig(): visibility and redaction are two
 * different jobs, and a gig being listed does not make its `notes` public.
 */
export function isPublicShow(gig: Gig): boolean {
  return !gig.hidden && isValidDate(gig.date);
}

/** The public projection of a gig: what a non-member may see. */
export interface PublicShow {
  id: string;
  name: string;
  date: string;
  times?: GigTime[];
  location?: GigLocation;
  publicNotes?: string;
  eventUrl?: string;
  canceled?: boolean;
  rev?: number;
}

/**
 * Strip a gig down to its public fields. This is an allowlist, not a redaction:
 * band-only fields (notes, sets, RSVPs) can't leak by being forgotten here,
 * because nothing is copied unless it's named. Everything served to an
 * unauthenticated visitor goes through this.
 */
export function publicGig(gig: Gig): PublicShow {
  return {
    id: gig.id,
    name: gig.name,
    date: gig.date,
    ...(gig.times?.length ? { times: gig.times.map((t) => ({ ...t })) } : {}),
    ...(gig.location ? { location: { ...gig.location } } : {}),
    ...(gig.publicNotes ? { publicNotes: gig.publicNotes } : {}),
    // Re-normalized on the way out, not merely copied: a gig stored before this
    // field was validated (or hand-edited in gigs.json) must not be able to put
    // a javascript: href on the public page.
    ...(normalizeUrl(gig.eventUrl) ? { eventUrl: normalizeUrl(gig.eventUrl) } : {}),
    ...(gig.canceled ? { canceled: true } : {}),
    ...(gig.rev ? { rev: gig.rev } : {}),
  };
}

/** Every publicly-listed gig, oldest first. */
export function publicShows(gigs: Gig[]): PublicShow[] {
  return gigs.filter(isPublicShow).map(publicGig).sort(compareByDate);
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

/**
 * The gig a calendar day stands for when more than one falls on it: the first
 * one still on, else the first. Shared so the month grid and whatever it links
 * to can't disagree about which gig a day means.
 */
export function primaryGig<T extends { canceled?: boolean }>(gigs: T[]): T {
  return gigs.find((g) => !g.canceled) ?? gigs[0];
}

/** Sort comparator: by date ascending, then name. */
export function compareByDate(
  a: Pick<Gig, 'date' | 'name'>,
  b: Pick<Gig, 'date' | 'name'>
): number {
  return a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
}
