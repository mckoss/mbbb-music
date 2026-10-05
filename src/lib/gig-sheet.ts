// Pure parsing for the band's gig-availability Google Sheet (no server imports,
// so it is unit-testable and safe anywhere). The sheet is a grid: one column per
// gig, whose header cell is free text ("CONFIRMED -June 20th - SW Pride Parade
// 11-11:30 lineup 12p parade"), and one row per player (instrument, first name)
// with "yes"/"no" in each gig's cell. The headers rarely carry a year; the
// columns run in date order, so years are inferred from where the months wrap.
//
// Everything here is import evidence, never product data: the server-side sync
// (src/lib/server/gig-sheet.ts) turns it into app-owned gigs and RSVPs.

import type { GigTime } from './gig.js';

/** A player's answer for one gig, as far as the importer cares. */
export type SheetAnswer = 'yes' | 'no';

/** One gig column, with what could be read out of its header. */
export interface SheetGig {
  /** 0-based column index in the sheet grid. */
  column: number;
  /** The header cell, verbatim (kept in the gig's band-only notes). */
  header: string;
  /** YYYY-MM-DD, or null when no date could be read from the header. */
  date: string | null;
  /**
   * Stable identity for this column across header edits: its date plus its
   * position among same-date columns ("2026-10-31#0"). Adding "CONFIRMED" or a
   * time to the header keeps the key; null when the date is unknown.
   */
  key: string | null;
  /** A cleaned-up display name (status words, date and times stripped). */
  name: string;
  times: GigTime[];
  /** The header says CANCELLED/CANCELED or POSTPONED. */
  canceled: boolean;
  /**
   * The header cell's color, when the sheet's formatting was read. The band
   * colors gig titles red when a gig was canceled or didn't happen (no
   * quorum) and green when it's on; other colors carry no meaning we rely on.
   */
  color: HeaderColor;
}

/** The color family of a header cell (fill or text), or null for none/neutral. */
export type HeaderColor = 'red' | 'green' | 'blue' | 'other' | null;

/** A Sheets API color: 0–1 channels, absent channels meaning 0. */
export interface SheetsColor {
  red?: number;
  green?: number;
  blue?: number;
}

/**
 * Classify a Sheets color by hue. White, black and greys (low saturation) are
 * "no color"; light tints such as the stock "light red 3" fill still count.
 */
export function classifyColor(c: SheetsColor | null | undefined): HeaderColor {
  if (!c) return null;
  const r = c.red ?? 0;
  const g = c.green ?? 0;
  const b = c.blue ?? 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.06 || l > 0.97 || l < 0.08) return null;
  const sat = d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.2) return null;
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;
  if (hue < 20 || hue >= 330) return 'red';
  if (hue >= 75 && hue < 170) return 'green';
  if (hue >= 190 && hue < 260) return 'blue';
  return 'other';
}

/**
 * A header cell's color from its fill and text colors: a colored fill wins,
 * else colored text (black text on white is null).
 */
export function headerColor(background: SheetsColor | null | undefined, text: SheetsColor | null | undefined): HeaderColor {
  return classifyColor(background) ?? classifyColor(text);
}

/** One player row: who, what they play, and their answer per gig column. */
export interface SheetPlayer {
  /** The name as written in the sheet (usually a first name). */
  name: string;
  /** The instrument cell as written, or '' when the sheet has no such column. */
  instrument: string;
  /** Answers keyed by gig column index (only yes/no cells are kept). */
  answers: Map<number, SheetAnswer>;
}

export interface ParsedSheet {
  gigs: SheetGig[];
  players: SheetPlayer[];
  /** Header cells right of the player columns that held no readable date. */
  undated: string[];
}

// --- Dates -------------------------------------------------------------------

const MONTHS: [RegExp, number][] = [
  [/^jan/, 1], [/^feb/, 2], [/^mar/, 3], [/^apr/, 4], [/^may/, 5], [/^jun/, 6],
  [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12],
];

const MONTH_DAY_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/;

interface RawDate {
  month: number;
  day: number;
  year: number | null;
  /** The matched text, so the name cleaner can remove it. */
  text: string;
}

/** The first month/day mentioned in a header, whichever form comes first. */
export function readHeaderDate(header: string): RawDate | null {
  const named = MONTH_DAY_RE.exec(header);
  const numeric = NUMERIC_DATE_RE.exec(header);
  const pick = [named, numeric]
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => a.index - b.index)[0];
  if (!pick) return null;
  let month: number;
  let day: number;
  let year: number | null = null;
  if (pick === named) {
    const word = pick[1].toLowerCase();
    month = MONTHS.find(([re]) => re.test(word))![1];
    day = Number(pick[2]);
  } else {
    month = Number(pick[1]);
    day = Number(pick[2]);
    if (pick[3]) year = pick[3].length === 2 ? 2000 + Number(pick[3]) : Number(pick[3]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day, year, text: pick[0] };
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Give each dated column a year. Columns are in date order, so a month that
 * falls well behind the previous column's (Dec → Feb) starts a new year; small
 * steps back (Sept 6 then Aug 23) are just columns entered out of order. An
 * explicit year in any header ("7/27/2024") anchors the run; without one, the
 * run is placed so its last column is no earlier than ~6 months before today.
 */
function assignYears(dates: (RawDate | null)[], today: string): (string | null)[] {
  const rel: (number | null)[] = [];
  let year = 0;
  let prevMonth: number | null = null;
  for (const d of dates) {
    if (!d) {
      rel.push(null);
      continue;
    }
    if (prevMonth !== null && d.month < prevMonth - 3) year += 1;
    prevMonth = d.month;
    rel.push(year);
  }

  // Vote on the base year from explicit years; fall back to anchoring on today.
  const votes = new Map<number, number>();
  dates.forEach((d, i) => {
    if (d?.year != null && rel[i] != null) {
      const base = d.year - rel[i]!;
      votes.set(base, (votes.get(base) ?? 0) + 1);
    }
  });
  let base: number;
  if (votes.size > 0) {
    base = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  } else {
    const lastIdx = rel.findLastIndex((r) => r !== null);
    if (lastIdx < 0) return dates.map(() => null);
    const last = dates[lastIdx]!;
    const floor = new Date(`${today}T00:00:00Z`);
    floor.setUTCDate(floor.getUTCDate() - 183);
    const floorStr = floor.toISOString().slice(0, 10);
    let y = Number(today.slice(0, 4)) - 1;
    while (ymd(y, last.month, last.day) < floorStr) y += 1;
    base = y - rel[lastIdx]!;
  }

  return dates.map((d, i) => {
    if (!d || rel[i] == null) return null;
    const y = d.year ?? base + rel[i]!;
    // Reject impossible days (Feb 30) rather than rolling them over.
    const dt = new Date(Date.UTC(y, d.month - 1, d.day));
    if (dt.getUTCMonth() !== d.month - 1) return null;
    return ymd(y, d.month, d.day);
  });
}

// --- Times -------------------------------------------------------------------

function to24(h: number, m: number, meridiem: string | undefined): number | null {
  if (h > 23 || m > 59) return null;
  if (!meridiem) return h * 60 + m;
  if (h < 1 || h > 12) return null;
  const pm = meridiem.toLowerCase().startsWith('p');
  return ((h % 12) + (pm ? 12 : 0)) * 60 + m;
}

function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// "5-7pm", "12:30 - 1:15pm", "10a-12p", "2pm-4pm". The end must carry am/pm;
// the start inherits it unless that would put the start after the end.
const RANGE_RE =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a(?![a-z])|p(?![a-z]))/i;
// "4:30pm", "2 pm", "6pm". A bare a/p must hug the number ("10a"), so "3 a party"
// is never read as 3am.
const SINGLE_RE = /\b(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm)\b|(a|p)\b)/i;

/** The first performance time (or range) in a header, with the date removed. */
export function readHeaderTimes(text: string): GigTime[] {
  const range = RANGE_RE.exec(text);
  const single = SINGLE_RE.exec(text);
  if (range && (!single || range.index <= single.index)) {
    const end = to24(Number(range[4]), Number(range[5] ?? 0), range[6]);
    if (end === null) return [];
    let start = to24(Number(range[1]), Number(range[2] ?? 0), range[3] ?? range[6]);
    if (start !== null && !range[3] && start > end) start -= 12 * 60;
    if (start === null || start < 0) return [];
    return [{ start: hhmm(start), end: hhmm(end) }];
  }
  if (single) {
    const start = to24(Number(single[1]), Number(single[2] ?? 0), single[3] ?? single[4]);
    return start === null ? [] : [{ start: hhmm(start) }];
  }
  return [];
}

// --- Names -------------------------------------------------------------------

const STATUS_RE = /\b(?:confirmed|cancel+ed|postponed)\b/gi;
const CANCELED_RE = /\b(?:cancel+ed|postponed)\b/i;
const WEEKDAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\.?';
const WEEKDAY_BEFORE_RE = new RegExp(`\\b${WEEKDAY},?\\s*$`, 'i');
const WEEKDAY_AFTER_RE = new RegExp(`^[\\s,]*${WEEKDAY}(?![a-z])`, 'i');
// Where performance detail starts: "11-11:30 lineup", "4:30pm", "12p parade".
const TIME_START_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?\s*[-–]\s*\d{1,2}(?::\d{2})?(?:\s*(?:am|pm)\b|[ap]\b)?|\b\d{1,2}:\d{2}|\b\d{1,2}(?:\s*(?:am|pm)\b|[ap]\b)/i;

/** Remove the date (and a weekday right beside it) from a header. */
function withoutDate(header: string, dateText: string | null): string {
  if (!dateText) return header;
  const at = header.indexOf(dateText);
  if (at < 0) return header;
  const before = header.slice(0, at).replace(WEEKDAY_BEFORE_RE, '');
  const after = header.slice(at + dateText.length).replace(WEEKDAY_AFTER_RE, '');
  return `${before} ${after}`;
}

/**
 * A readable gig name from a header: no status words, date or weekday, and
 * nothing from the first time onward ("SW Pride Parade 11-11:30 lineup…" →
 * "SW Pride Parade"). The full header is kept in the gig's notes, so nothing
 * is lost by trimming here.
 */
export function cleanGigName(header: string, dateText: string | null): string {
  let s = withoutDate(header.replace(/\s+/g, ' '), dateText);
  s = s.replace(STATUS_RE, ' ').replace(/\(\s*\)/g, ' ');
  s = s.replace(/^[\s\-–—:.,!?]+/, '');
  const time = TIME_START_RE.exec(s);
  if (time && time.index < 3) s = s.slice(time.index + time[0].length).replace(/^[\s\-–—:.,]+/, '');
  else if (time) s = s.slice(0, time.index);
  // Keep the first sentence: "HONK! Tacoma. time tbd, expect all day." → "HONK! Tacoma".
  const stop = s.search(/\.\s/);
  if (stop > 0) s = s.slice(0, stop);
  s = s.replace(/[\s\-–—:.,&@]+$/, '').replace(/\s+(?:time|at|in)$/i, '').replace(/\s{2,}/g, ' ').trim();
  if (s.length > 60) {
    const cut = s.slice(0, 60);
    s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 30)).replace(/[\s\-–—:.,&@]+$/, '');
  }
  return s || header.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Gig';
}

// --- Grid --------------------------------------------------------------------

/** A cell's answer: "yes"/"Yes"/"YES"/"y" → yes, "no"/"n" → no, else null. */
export function readAnswer(cell: string | undefined): SheetAnswer | null {
  const s = String(cell ?? '').trim().toLowerCase();
  if (/^y(?:es)?\b/.test(s)) return 'yes';
  if (/^no?\b/.test(s)) return 'no';
  return null;
}

function cell(row: string[] | undefined, i: number): string {
  return String(row?.[i] ?? '').trim();
}

/**
 * Parse the sheet grid (rows of cell strings, as the Sheets API returns them).
 * The header row is the first row with dated cells; gig columns start at the
 * first dated header, the player-name column sits just left of it and, when
 * there's room, the instrument column left of that.
 */
export function parseGigSheet(grid: string[][], today: string, colors?: HeaderColor[][] | null): ParsedSheet {
  const headerRow = grid.findIndex((row) => row.some((c) => readHeaderDate(String(c ?? ''))));
  if (headerRow < 0) return { gigs: [], players: [], undated: [] };
  const header = grid[headerRow];
  const firstGig = header.findIndex((c) => readHeaderDate(String(c ?? '')));
  const nameCol = Math.max(0, firstGig - 1);
  const instCol = firstGig >= 2 ? firstGig - 2 : -1;

  const width = Math.max(...grid.map((r) => r.length));
  const columns: number[] = [];
  const raws: (RawDate | null)[] = [];
  const undated: string[] = [];
  for (let c = firstGig; c < width; c++) {
    const h = cell(header, c);
    if (!h) continue;
    const raw = readHeaderDate(h);
    if (!raw) undated.push(h);
    columns.push(c);
    raws.push(raw);
  }

  const dates = assignYears(raws, today);
  const seen = new Map<string, number>();
  const gigs: SheetGig[] = [];
  columns.forEach((c, i) => {
    const h = cell(header, c);
    const date = dates[i];
    if (!date) {
      if (raws[i]) undated.push(h); // read a month/day, but it isn't a real date
      return;
    }
    const n = seen.get(date) ?? 0;
    seen.set(date, n + 1);
    const dateText = raws[i]?.text ?? null;
    const sansDate = withoutDate(h, dateText);
    gigs.push({
      column: c,
      header: h,
      date,
      key: `${date}#${n}`,
      name: cleanGigName(h, dateText),
      times: readHeaderTimes(sansDate),
      canceled: CANCELED_RE.test(h),
      color: colors?.[headerRow]?.[c] ?? null,
    });
  });

  const players: SheetPlayer[] = [];
  for (const row of grid.slice(headerRow + 1)) {
    const name = cell(row, nameCol);
    if (!name || name === '#') continue;
    const answers = new Map<number, SheetAnswer>();
    for (const g of gigs) {
      const a = readAnswer(row[g.column]);
      if (a) answers.set(g.column, a);
    }
    players.push({ name, instrument: instCol >= 0 ? cell(row, instCol) : '', answers });
  }

  return { gigs, players, undated };
}

/**
 * Read a Google Sheets link into its spreadsheet id and tab gid. Accepts the
 * full /edit URL (gid in the query or the #fragment) or a bare id.
 */
export function parseSheetUrl(input: string): { spreadsheetId: string; gid: number | null } | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(raw);
  const id = m ? m[1] : /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : null;
  if (!id) return null;
  const gid = /[?#&]gid=(\d+)/.exec(raw);
  return { spreadsheetId: id, gid: gid ? Number(gid[1]) : null };
}

/**
 * Parse CSV text (RFC 4180: quoted fields, doubled quotes, newlines inside
 * quotes) into rows of strings. Used for the Drive CSV export fallback.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
