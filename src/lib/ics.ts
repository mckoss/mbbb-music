// iCalendar (RFC 5545) generation for the band's public show calendar. Pure and
// dependency-free — the same code builds the subscribable feed served at
// /shows/calendar.ics, and it's unit-tested in test/ics.test.js.
//
// Two things make this fiddlier than "join some strings":
//
//  1. TIMEZONE. A gig is a bare calendar date plus wall-clock HH:MM slots with no
//     zone — "June 14th, 2:30pm", band time. Emitting that as UTC would mean
//     doing DST math ourselves and getting it wrong twice a year. Instead we
//     ship a VTIMEZONE block for America/Los_Angeles and tag each DTSTART with
//     TZID, which hands the conversion to the calendar client (which has a real
//     tz database). A subscriber in another zone then sees the correct local time.
//
//  2. SEQUENCE. A subscribed calendar only replaces an event it already holds
//     when the sequence number *increases*. Gig.rev is that counter (bumped by
//     updateGig), so a rescheduled show actually moves on phones that already
//     subscribed instead of silently keeping its old date.
//
// Everything here takes its "now" as an argument rather than calling Date.now(),
// so the output is a pure function of its inputs and the tests can assert on it.

// Imported with .js specifiers (the SvelteKit/TS convention) rather than bare
// paths, so this module is unit-testable under plain `node --test` — the test
// loader resolves .js to the .ts source. Same reason as src/lib/server/gigs.ts.
import { isValidDate, type Gig, type GigLocation, type GigTime, type PublicShow } from './gig.js';
import { PACIFIC_TIME } from './time.js';

/** Assumed length of a slot given only a start time. */
const DEFAULT_DURATION_MIN = 120;

/** How often we ask subscribers to re-poll. Google largely ignores this and
 *  polls on its own (slow) schedule; Apple honors it. */
const REFRESH = 'PT12H';

// --- Subscribe links ---------------------------------------------------------

/**
 * The webcal:// form of the feed URL. The scheme is what makes a calendar client
 * offer to *subscribe* — a live feed it re-polls — rather than download a
 * one-time copy that never updates again.
 */
export function webcalUrl(feedUrl: string): string {
  return feedUrl.replace(/^https?:/, 'webcal:');
}

/**
 * Google's add-by-URL link.
 *
 * `cid` must carry the **webcal://** URL. Passing the https:// one — which is
 * the obvious thing to do, since that's the URL you can open in a browser —
 * fails with "Unable to add this calendar; check the URL", an error that gives
 * no hint that the scheme is the problem. Tested below so it can't regress.
 */
export function googleSubscribeUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}

// --- Line encoding -----------------------------------------------------------

/** Escape a value for a text property: backslash, semicolon, comma, newline. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to the 75-*octet* limit, continuing with a leading space.
 * The limit is bytes, not characters, so we measure UTF-8 and never split a
 * multi-byte character across the fold (which would corrupt it).
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // A continuation line spends one of its 75 octets on the leading space.
    const budget = parts.length === 0 ? 75 : 74;
    if (bytes + size > budget) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n');
}

// --- Date/time arithmetic ----------------------------------------------------

/** "2026-06-14" -> "20260614". */
export function icsDate(date: string): string {
  return date.replace(/-/g, '');
}

/** ("2026-06-14", "14:30") -> "20260614T143000". */
export function icsDateTime(date: string, time: string): string {
  return `${icsDate(date)}T${time.replace(':', '')}00`;
}

/** The calendar day after `date`. Done in UTC so DST can never shift the day. */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Advance a (date, time) by `minutes`, rolling into the next day as needed. */
function plusMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(':').map(Number);
  let total = h * 60 + m + minutes;
  let day = date;
  while (total >= 1440) {
    total -= 1440;
    day = nextDay(day);
  }
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return { date: day, time: `${hh}:${mm}` };
}

/** An event's span: an all-day box, or a start/end pair of local wall-clock times. */
export type EventWindow =
  | { allDay: true; start: string; end: string }
  | { allDay: false; start: { date: string; time: string }; end: { date: string; time: string } };

/**
 * Turn a gig's date + time slots into one calendar event's span.
 *
 * A gig can have several playing slots (a parade at 11, a set at 2). Rather than
 * emit several events, we span the whole commitment: the first slot's start to
 * the last slot's end. With no times at all it's an all-day event — the honest
 * rendering of "we know the day, not the hour" (and DTEND for an all-day event
 * is exclusive, hence the next day). A slot with a start but no end gets an
 * assumed two hours; a gig running past midnight rolls the end into the next day.
 */
export function eventWindow(show: Pick<PublicShow, 'date' | 'times'>): EventWindow {
  const times = show.times ?? [];
  if (times.length === 0) {
    return { allDay: true, start: show.date, end: nextDay(show.date) };
  }

  const first: GigTime = times[0];
  const last: GigTime = times[times.length - 1];
  const start = { date: show.date, time: first.start };
  let end = last.end
    ? { date: show.date, time: last.end }
    : plusMinutes(show.date, last.start, DEFAULT_DURATION_MIN);

  // An end at or before the start means the gig ran past midnight (a 9pm–1am
  // dance): the end belongs to the next day.
  if (`${end.date}T${end.time}` <= `${start.date}T${start.time}`) {
    end = { date: nextDay(end.date), time: end.time };
  }
  return { allDay: false, start, end };
}

// --- Calendar assembly -------------------------------------------------------

/**
 * A minimal, self-contained VTIMEZONE for US Pacific. Subscribers need the DST
 * rules to resolve our TZID-tagged times; the RRULEs are the post-2007 US rules
 * (spring forward 2nd Sunday of March, fall back 1st Sunday of November).
 */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${PACIFIC_TIME}`,
  'X-LIC-LOCATION:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** UTC stamp format: 20260713T170500Z. */
function icsStamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** The location line: venue name and address, as a person would read it. */
function locationText(ev: { location?: GigLocation }): string {
  return [ev.location?.name, ev.location?.address].filter(Boolean).join(', ');
}

export interface IcsOptions {
  /** Absolute base URL of the app, e.g. https://music.example.com — used for the
   *  event's URL property (which points at the public shows page). */
  origin: string;
  /** DTSTAMP for every event. Injected so output is deterministic under test. */
  stamp: Date;
}

/** The date/time, summary, status and location of one VEVENT — everything both
 *  the public feed and a personal one-off copy share. The three fields that
 *  differ between them (UID, DESCRIPTION, URL) come in via `parts`. */
type EventCore = Pick<PublicShow, 'name' | 'date' | 'times' | 'location' | 'canceled' | 'rev'>;

function veventLines(
  ev: EventCore,
  opts: IcsOptions,
  parts: { uid: string; description: string; url: string }
): string[] {
  const window = eventWindow(ev);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${parts.uid}`,
    `DTSTAMP:${icsStamp(opts.stamp)}`,
    `SEQUENCE:${ev.rev ?? 0}`,
  ];

  if (window.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(window.start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(window.end)}`);
  } else {
    lines.push(`DTSTART;TZID=${PACIFIC_TIME}:${icsDateTime(window.start.date, window.start.time)}`);
    lines.push(`DTEND;TZID=${PACIFIC_TIME}:${icsDateTime(window.end.date, window.end.time)}`);
  }

  // A canceled show stays in the feed as CANCELLED rather than vanishing, so it
  // strikes through on a subscriber's calendar instead of quietly disappearing —
  // "the gig is off" reads very differently from "did I imagine that gig?".
  lines.push(`SUMMARY:${escapeText(ev.canceled ? `CANCELED: ${ev.name}` : ev.name)}`);
  lines.push(`STATUS:${ev.canceled ? 'CANCELLED' : 'CONFIRMED'}`);

  const location = locationText(ev);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);

  lines.push(`DESCRIPTION:${escapeText(parts.description)}`);
  lines.push(`URL:${parts.url}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * One VEVENT for a public show (the subscribable feed). The UID is derived from
 * the gig id and a fixed domain (NOT the origin): it must stay identical for the
 * life of the gig, and pinning it to the host would mint fresh UIDs — and so
 * duplicate events on every subscriber's calendar — the day the app moves domains.
 */
export function showEvent(show: PublicShow, opts: IcsOptions): string[] {
  // A VEVENT has exactly one URL. When the host has their own page for the event
  // (the fair's schedule, the festival's tickets), that's what someone tapping
  // the event in their calendar actually wants — so it wins, and our /shows page
  // stays reachable from the description either way.
  const description = [
    show.publicNotes,
    show.eventUrl ? `Event info: ${show.eventUrl}` : null,
    `${opts.origin}/shows`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return veventLines(show, opts, {
    uid: `gig-${show.id}@mutinybaybrassband.com`,
    description,
    url: show.eventUrl ?? `${opts.origin}/shows`,
  });
}

// --- Per-gig personal calendar (one-time copy) -------------------------------
//
// The button on a gig's detail page. Unlike the public feed, this is aimed at a
// signed-in band member and their own calendar: it carries the band-only call
// notes and links back to the gig packet (call times, parking, pay) rather than
// the public /shows page. A one-time copy — it does not re-poll and update the
// way a subscription does.

/** The gig fields a personal calendar entry draws on. */
export type CalendarGig = Pick<
  Gig,
  'id' | 'name' | 'date' | 'times' | 'location' | 'notes' | 'eventUrl' | 'canceled' | 'rev'
>;

/** Band-only description: the call notes, the host's event page, and a link
 *  back to the gig packet where the call details live. */
function gigDetails(gig: CalendarGig, origin: string): string {
  return [gig.notes, gig.eventUrl ? `Event info: ${gig.eventUrl}` : null, `${origin}/gigs/${gig.id}`]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One VEVENT for a gig, for a member's own calendar. The UID is deliberately
 * distinct from the public feed's (`-me`): a member who both subscribes to
 * /shows AND adds this richer personal copy gets two independent events, so the
 * lean public one can never overwrite the one carrying their call notes.
 */
export function gigEvent(gig: CalendarGig, opts: IcsOptions): string[] {
  return veventLines(gig, opts, {
    uid: `gig-${gig.id}-me@mutinybaybrassband.com`,
    description: gigDetails(gig, opts.origin),
    url: `${opts.origin}/gigs/${gig.id}`,
  });
}

/**
 * Wrap already-built VEVENT lines in a VCALENDAR envelope with the Pacific
 * VTIMEZONE, then fold and CRLF-terminate the whole thing. Lines are
 * CRLF-terminated per RFC 5545 — iOS in particular rejects a file with bare
 * newlines — and folded to 75 octets. `header` is the calendar-level metadata
 * that differs between the subscribable feed and a one-off personal file.
 */
function assembleCalendar(header: string[], eventLines: string[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mutiny Bay Brass Band//Shows//EN',
    'CALSCALE:GREGORIAN',
    ...header,
    ...VTIMEZONE,
    ...eventLines,
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** The whole subscribable calendar — every public show, re-polled by clients. */
export function buildCalendar(shows: PublicShow[], opts: IcsOptions): string {
  return assembleCalendar(
    [
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Mutiny Bay Brass Band',
      'X-WR-CALDESC:Shows by the Mutiny Bay Brass Band, Whidbey Island WA.',
      `X-WR-TIMEZONE:${PACIFIC_TIME}`,
      `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
      `X-PUBLISHED-TTL:${REFRESH}`,
    ],
    shows.filter((s) => isValidDate(s.date)).flatMap((show) => showEvent(show, opts))
  );
}

/**
 * A one-event calendar file for a single gig, for a member to import into their
 * own calendar. No REFRESH/TTL: this is a snapshot, not a feed — nothing re-polls
 * it. Suitable for Apple Calendar, Outlook, and file-import into Google Calendar.
 */
export function gigCalendar(gig: CalendarGig, opts: IcsOptions): string {
  return assembleCalendar([`X-WR-TIMEZONE:${PACIFIC_TIME}`], gigEvent(gig, opts));
}

/**
 * Google Calendar's "create event" (TEMPLATE) link — pre-fills the new-event
 * form in the member's own Google account. `dates` are the local wall-clock
 * times paired with `ctz` (the timezone Google resolves them in); an all-day
 * gig uses bare dates with an exclusive end and no `ctz`.
 */
export function googleEventUrl(gig: CalendarGig, opts: { origin: string }): string {
  const window = eventWindow(gig);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: gig.canceled ? `CANCELED: ${gig.name}` : gig.name,
  });

  if (window.allDay) {
    params.set('dates', `${icsDate(window.start)}/${icsDate(window.end)}`);
  } else {
    params.set(
      'dates',
      `${icsDateTime(window.start.date, window.start.time)}/${icsDateTime(window.end.date, window.end.time)}`
    );
    params.set('ctz', PACIFIC_TIME);
  }

  const location = locationText(gig);
  if (location) params.set('location', location);
  params.set('details', gigDetails(gig, opts.origin));

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
