// Server-only Gig-sheet import. The band keeps a Google Sheet of upcoming gigs
// (one column each) and who can make them (one row per player, "yes"/"no").
// Once a day — and whenever an admin presses "Sync Gig Sheet" on /gigs — this
// reads that sheet and brings the app's own gig records and RSVPs up to date:
//
//   - Sheet gigs (past and upcoming) with no matching app gig are CREATED with
//     the band-only note "Imported from Gig sheet" and the sheet's full header
//     text. They are public like any other gig, unless the header calls the
//     event "private".
//   - App gigs are NEVER deleted or edited because of the sheet; the one change
//     the sheet can make to an existing gig is marking it canceled (never
//     un-canceling).
//   - A sheet "yes"/"no" becomes the website reply for a member who hasn't
//     replied on the website. A reply a member (or organizer) entered on the
//     website always wins; when it disagrees with the sheet the roster flags a
//     "Gig Sheet Conflict" (see sheetConflict). Replies the import itself set
//     follow later sheet edits (yes ⇄ no), and a reply a member cleared on the
//     website is not re-added.
//
// The sheet is an import source, not the product model (AGENTS.md): sheet
// columns are linked to app gig ids once, by date, and those links — plus the
// sheet URL, player→member links and the last run's report — live in the private
// data volume (data/gig-sheet.json), never in this public repo.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { JWT } from 'google-auth-library';

import { loadConfig } from '../../sync/config.js';
import { detectInstrument } from '../../sync/instruments.js';
import { parseCsv, parseGigSheet, parseSheetUrl, type SheetAnswer, type SheetGig, type SheetPlayer } from '../gig-sheet.js';
import type { Gig, GigInput } from '../gig.js';
import type { RsvpStatus } from '../rsvp.js';
import { pacificToday } from '../time.js';

/** The `updated_by` identity on replies the import sets. */
export const GIG_SHEET_IMPORTER = 'gig-sheet-import';

/** The band-only note an imported gig starts with. */
export const IMPORTED_NOTE = 'Imported from Gig sheet';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DAY_MS = 24 * 60 * 60 * 1000;

// --- Persistent state ----------------------------------------------------------

export interface GigSheetReport {
  at: string;
  trigger: 'manual' | 'daily';
  ok: boolean;
  error?: string;
  /** Dated sheet columns considered. */
  columns: number;
  created: { gigId: string; name: string; date: string }[];
  linked: { gigId: string; name: string; date: string }[];
  canceled: { gigId: string; name: string; date: string }[];
  /** How many replies were set or changed (the list below is capped). */
  rsvpCount: number;
  rsvps: { gigId: string; gigName: string; email: string; member: string; status: RsvpStatus }[];
  /** Website-entered replies that disagree with the sheet (kept, and flagged). */
  conflicts: number;
  /** Sheet columns that match several app gigs on the same day — left alone. */
  ambiguous: { date: string; header: string }[];
  /** Linked app gigs an admin has since deleted — not re-created. */
  deleted: number;
  /** Sheet players not linked to a member (their answers are skipped). */
  unmatched: { key: string; name: string; instrument: string; reason: 'none' | 'several' }[];
  /** Header cells with no readable date. */
  undated: string[];
}

export interface GigSheetState {
  /** The Google Sheets link (with #gid= for the tab) an admin pasted. */
  url?: string;
  /** Sheet column key ("2026-10-31#0") → app gig id. */
  links: Record<string, string>;
  /** Sheet player key ("david|drums") → member login email, set by an admin. */
  players: Record<string, string>;
  /** Replies this import has set: gig id → email → the sheet answer applied. */
  applied: Record<string, Record<string, SheetAnswer>>;
  /** The sheet's current answers for linked players: gig id → email → answer. */
  sheet: Record<string, Record<string, SheetAnswer>>;
  lastRun?: GigSheetReport;
}

function emptyState(): GigSheetState {
  return { links: {}, players: {}, applied: {}, sheet: {} };
}

function statePath(dataDir?: string): string {
  return resolve(dataDir ?? loadConfig().dataDir, 'gig-sheet.json');
}

export function readState(dataDir?: string): GigSheetState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dataDir), 'utf8'));
    return {
      ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}),
      links: parsed.links ?? {},
      players: parsed.players ?? {},
      applied: parsed.applied ?? {},
      sheet: parsed.sheet ?? {},
      ...(parsed.lastRun ? { lastRun: parsed.lastRun } : {}),
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: GigSheetState, dataDir?: string): void {
  const path = statePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** Save the sheet link (validated). Returns false when it isn't a Sheets link. */
export function setSheetUrl(url: string, dataDir?: string): boolean {
  if (!parseSheetUrl(url)) return false;
  const state = readState(dataDir);
  state.url = url.trim();
  writeState(state, dataDir);
  return true;
}

/** Link (or, with a blank email, unlink) a sheet player to a member login. */
export function linkPlayer(key: string, email: string, dataDir?: string): void {
  const state = readState(dataDir);
  const e = email.trim().toLowerCase();
  if (e) state.players[key] = e;
  else delete state.players[key];
  writeState(state, dataDir);
}

// --- Matching ------------------------------------------------------------------

/** A member the import can attach a sheet row to. */
export interface SheetMember {
  email: string;
  name: string;
  /** Instrument slugs the member plays (primary first). */
  instruments: string[];
  /** A past member — never auto-matched. */
  former?: boolean;
}

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The sheet's instrument cell as a canonical slug, when it reads as one. */
function instrumentSlugOf(text: string): string | null {
  return text ? (detectInstrument(text)?.slug ?? null) : null;
}

/** A stable key for a sheet row: folded name plus instrument. */
export function playerKey(p: Pick<SheetPlayer, 'name' | 'instrument'>): string {
  return `${fold(p.name)}|${instrumentSlugOf(p.instrument) ?? fold(p.instrument)}`;
}

type PlayerMatch = { email: string } | { unmatched: 'none' | 'several' };

/**
 * Who a sheet row is. An admin's explicit link wins; otherwise a current member
 * whose name starts with the sheet's name ("David" → "David Smith"), narrowed by
 * instrument when several share a first name.
 */
export function matchPlayer(p: SheetPlayer, members: SheetMember[], links: Record<string, string>): PlayerMatch {
  const linked = links[playerKey(p)];
  if (linked && members.some((m) => m.email === linked)) return { email: linked };
  const want = fold(p.name);
  if (!want) return { unmatched: 'none' };
  let hits = members.filter((m) => {
    if (m.former) return false;
    const n = fold(m.name);
    return n === want || n.startsWith(`${want} `);
  });
  if (hits.length > 1) {
    const slug = instrumentSlugOf(p.instrument);
    const byInst = slug ? hits.filter((m) => m.instruments.includes(slug)) : [];
    if (byInst.length === 1) hits = byInst;
  }
  if (hits.length === 1) return { email: hits[0].email };
  return { unmatched: hits.length === 0 ? 'none' : 'several' };
}

/** Shown in the roster tooltip for a conflict. */
const ANSWER_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', maybe: 'Maybe' };

/**
 * When a website-entered reply disagrees with the sheet, the explanation shown
 * beside it ("Gig Sheet Conflict"); null when there's nothing to flag. Replies
 * the import set itself can't conflict — they follow the sheet.
 */
export function sheetConflict(
  reply: { status: RsvpStatus; updatedBy: string } | null | undefined,
  sheet: SheetAnswer | null | undefined
): string | null {
  if (!reply || !sheet || reply.updatedBy === GIG_SHEET_IMPORTER || reply.status === sheet) return null;
  return (
    `The Gig sheet says ${ANSWER_LABEL[sheet]}, but the website reply is ${ANSWER_LABEL[reply.status]} ` +
    `(entered by ${reply.updatedBy}). The website reply is kept; update the sheet or the reply so they agree.`
  );
}

/** Header wording that keeps an imported gig off the public /shows page. */
const PRIVATE_RE = /\bprivate\b/i;

const STOP = new Set(['the', 'and', 'for', 'with', 'at', 'in', 'on', 'of', 'set', 'sets', 'two', 'one', 'time', 'tbd', 'tba']);

function tokens(s: string): Set<string> {
  return new Set(fold(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t)));
}

/** Word overlap between a sheet header and an app gig's name. */
function overlap(header: string, name: string): number {
  const a = tokens(header);
  let n = 0;
  for (const t of tokens(name)) if (a.has(t)) n += 1;
  return n;
}

// --- The sync itself (pure over injected stores, so it is unit-testable) -------

export interface GigStore {
  list(): Gig[];
  create(input: GigInput): Gig;
  update(id: string, patch: Partial<GigInput>): Gig | null;
}

export interface RsvpStore {
  get(gigId: string): { email: string; status: RsvpStatus; updatedBy: string }[];
  set(gigId: string, email: string, status: RsvpStatus, by: string): void;
}

export interface ApplyInput {
  grid: string[][];
  today: string;
  state: GigSheetState;
  gigs: GigStore;
  rsvps: RsvpStore;
  members: SheetMember[];
  trigger: GigSheetReport['trigger'];
  now?: string;
}

/**
 * Apply a sheet grid to the app. Mutates `state` (links and applied replies)
 * and returns the run's report; the caller persists both.
 */
export function applyGigSheet(input: ApplyInput): GigSheetReport {
  const { grid, today, state, gigs, rsvps, members, trigger } = input;
  const parsed = parseGigSheet(grid, today);
  const report: GigSheetReport = {
    at: input.now ?? new Date().toISOString(),
    trigger,
    ok: true,
    columns: 0,
    created: [],
    linked: [],
    canceled: [],
    rsvpCount: 0,
    rsvps: [],
    conflicts: 0,
    ambiguous: [],
    deleted: 0,
    unmatched: [],
    undated: parsed.undated,
  };

  // Every dated column counts — past gigs too, so attendance history comes along.
  const columns = parsed.gigs.filter((g) => g.date);
  report.columns = columns.length;
  const sameDay = new Map<string, number>();
  for (const g of columns) sameDay.set(g.date!, (sameDay.get(g.date!) ?? 0) + 1);

  // 1. Resolve each column to an app gig (link, create, or skip).
  const resolved: { col: SheetGig; gig: Gig }[] = [];
  for (const col of columns) {
    const key = col.key!;
    const all = gigs.list();
    const linkedId = state.links[key];
    if (linkedId) {
      const gig = all.find((g) => g.id === linkedId);
      if (gig) resolved.push({ col, gig });
      else report.deleted += 1; // an admin deleted it — respect that
      continue;
    }

    const taken = new Set(Object.values(state.links));
    const candidates = all.filter((g) => g.date === col.date && !taken.has(g.id));
    let gig: Gig | null = null;
    if (candidates.length === 1 && sameDay.get(col.date!) === 1) {
      gig = candidates[0];
    } else if (candidates.length > 0) {
      const scored = candidates
        .map((g) => ({ g, s: overlap(col.header, g.name) }))
        .sort((a, b) => b.s - a.s);
      if (scored[0].s > 0 && (scored.length === 1 || scored[1].s < scored[0].s)) gig = scored[0].g;
      else {
        report.ambiguous.push({ date: col.date!, header: col.header });
        continue;
      }
    }

    if (gig) {
      report.linked.push({ gigId: gig.id, name: gig.name, date: gig.date });
    } else {
      gig = gigs.create({
        name: col.name,
        date: col.date!,
        ...(col.times.length ? { times: col.times } : {}),
        notes: `${IMPORTED_NOTE}.\n\nSheet column: ${col.header.replace(/\s+/g, ' ').trim()}`,
        // Public like a hand-made gig, unless the sheet calls it private.
        ...(PRIVATE_RE.test(col.header) ? { hidden: true } : {}),
        importedFrom: 'gig-sheet',
        ...(col.canceled ? { canceled: true } : {}),
      });
      report.created.push({ gigId: gig.id, name: gig.name, date: gig.date });
    }
    state.links[key] = gig.id;
    resolved.push({ col, gig });
  }

  // 2. Canceled on the sheet → canceled here (one-way; never un-cancels).
  for (const r of resolved) {
    if (r.col.canceled && !r.gig.canceled) {
      r.gig = gigs.update(r.gig.id, { canceled: true }) ?? r.gig;
      report.canceled.push({ gigId: r.gig.id, name: r.gig.name, date: r.gig.date });
    }
  }

  // 3. Players → members.
  const matched: { player: SheetPlayer; email: string }[] = [];
  const seenUnmatched = new Set<string>();
  for (const player of parsed.players) {
    const m = matchPlayer(player, members, state.players);
    if ('email' in m) matched.push({ player, email: m.email });
    else if (player.answers.size > 0) {
      const key = playerKey(player);
      if (!seenUnmatched.has(key)) {
        seenUnmatched.add(key);
        report.unmatched.push({ key, name: player.name, instrument: player.instrument, reason: m.unmatched });
      }
    }
  }
  const nameOf = new Map(members.map((m) => [m.email, m.name]));

  // 4. Answers → RSVPs, never overriding a reply entered on the website.
  for (const { col, gig } of resolved) {
    // Remember what the sheet says (for the roster's conflict flags), even for
    // a canceled gig whose replies we leave alone.
    const answers: Record<string, SheetAnswer> = {};
    for (const { player, email } of matched) {
      const a = player.answers.get(col.column);
      if (a) answers[email] = a;
    }
    if (Object.keys(answers).length) state.sheet[gig.id] = answers;
    else delete state.sheet[gig.id];
    if (gig.canceled) continue;

    const current = new Map(rsvps.get(gig.id).map((r) => [r.email, r]));
    const applied = (state.applied[gig.id] ??= {});
    for (const [email, answer] of Object.entries(answers)) {
      const cur = current.get(email);
      const ours = cur?.updatedBy === GIG_SHEET_IMPORTER;
      if (sheetConflict(cur, answer)) report.conflicts += 1;
      // Set it when the member never replied (and never cleared an imported
      // reply), or when the import owns the reply and the sheet has changed.
      const next = (!cur && !applied[email]) || (ours && cur!.status !== answer) ? answer : null;
      if (!next) continue;
      rsvps.set(gig.id, email, next, GIG_SHEET_IMPORTER);
      current.set(email, { email, status: next, updatedBy: GIG_SHEET_IMPORTER });
      applied[email] = answer;
      report.rsvpCount += 1;
      if (report.rsvps.length < 50) {
        report.rsvps.push({ gigId: gig.id, gigName: gig.name, email, member: nameOf.get(email) ?? email, status: next });
      }
    }
    if (Object.keys(applied).length === 0) delete state.applied[gig.id];
  }

  return report;
}

// --- Google Sheets fetch -------------------------------------------------------

interface ServiceAccount {
  client_email?: string;
  private_key?: string;
}

async function sheetsGet(url: string, token: string, who: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.ok) return res.json();
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    /* no JSON body */
  }
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      `Google Sheets refused access (${res.status}). Share the sheet (Viewer) with ${who}, ` +
        `and make sure the Google Sheets API is enabled for that service account's Cloud project.` +
        (detail ? ` Google said: ${detail}` : '')
    );
  }
  throw new Error(`Google Sheets request failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

async function tokenFor(sa: Required<ServiceAccount>, scope: string): Promise<string> {
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [scope] });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error('Service account auth returned no access token');
  return token;
}

/** Sheets API read: the tab named by gid (or the first tab) as display strings. */
async function readViaSheetsApi(ref: { spreadsheetId: string; gid: number | null }, sa: Required<ServiceAccount>): Promise<string[][]> {
  const token = await tokenFor(sa, SHEETS_SCOPE);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ref.spreadsheetId)}`;
  const meta = (await sheetsGet(`${base}?fields=sheets.properties(sheetId,title)`, token, sa.client_email)) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  };
  const tabs = (meta.sheets ?? []).map((s) => s.properties ?? {});
  const tab = ref.gid === null ? tabs[0] : tabs.find((t) => t.sheetId === ref.gid);
  if (!tab?.title) throw new Error(`The sheet has no tab with gid=${ref.gid}.`);

  const range = encodeURIComponent(`'${tab.title.replace(/'/g, "''")}'`);
  const values = (await sheetsGet(
    `${base}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    token,
    sa.client_email
  )) as { values?: unknown[][] };
  return (values.values ?? []).map((row) => row.map((c) => String(c ?? '')));
}

/**
 * Fallback: the spreadsheet's own CSV export of one tab, authorized with the
 * same Drive read-only scope the music sync already uses. Covers a Cloud
 * project where the Sheets API was never enabled.
 */
async function readViaCsvExport(ref: { spreadsheetId: string; gid: number | null }, sa: Required<ServiceAccount>): Promise<string[][]> {
  const token = await tokenFor(sa, DRIVE_SCOPE);
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(ref.spreadsheetId)}/export?format=csv` +
    (ref.gid === null ? '' : `&gid=${ref.gid}`);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) {
    throw new Error(`CSV export failed (${res.status}${type.includes('text/html') ? ', got a sign-in page' : ''})`);
  }
  return parseCsv(await res.text());
}

/** Read one tab of a spreadsheet as a grid of display strings. */
export async function fetchSheetGrid(sheetUrl: string, serviceAccount: ServiceAccount | undefined): Promise<string[][]> {
  const ref = parseSheetUrl(sheetUrl);
  if (!ref) throw new Error('The saved Gig sheet link is not a Google Sheets link.');
  if (!serviceAccount?.client_email || !serviceAccount.private_key) {
    throw new Error('No Google service account is configured (config.json google.serviceAccount).');
  }
  const sa = serviceAccount as Required<ServiceAccount>;
  try {
    return await readViaSheetsApi(ref, sa);
  } catch (err) {
    try {
      return await readViaCsvExport(ref, sa);
    } catch (fallback) {
      const why = fallback instanceof Error ? fallback.message : String(fallback);
      throw new Error(`${err instanceof Error ? err.message : String(err)} (Drive CSV fallback also failed: ${why})`);
    }
  }
}

// --- App wiring ----------------------------------------------------------------

let running: Promise<GigSheetReport> | null = null;

/**
 * Run one sync against the app's real stores. Single-flight: a second call while
 * one is running gets the same result. Never throws — failures come back as a
 * report with ok: false (and are saved as the last run, so admins see them).
 */
export function runGigSheetSync(trigger: GigSheetReport['trigger']): Promise<GigSheetReport> {
  running ??= (async () => {
    // Loaded lazily so this module (and its pure helpers) stays importable by
    // the unit tests without the SvelteKit-only stores.
    const [{ listGigs, createGig, updateGig }, { getRsvps, setRsvp }, { listUsers }, { getProfile }] = await Promise.all([
      import('./gigs.js'),
      import('./rsvps.js'),
      import('./users.js'),
      import('./members.js'),
    ]);
    const state = readState();
    try {
      if (!state.url) throw new Error('No Gig sheet link saved yet. Paste the sheet link on the Gigs page.');
      const grid = await fetchSheetGrid(state.url, loadConfig().google?.serviceAccount);
      const members: SheetMember[] = listUsers().map((u) => {
        const p = getProfile(u.email);
        const instruments = [p.primaryInstrument, ...p.instruments].filter((s): s is string => Boolean(s));
        return { email: u.email, name: p.fullName || u.name || '', instruments, former: Boolean(p.endDate) };
      });
      const report = applyGigSheet({
        grid,
        today: pacificToday(),
        state,
        trigger,
        members,
        gigs: { list: () => listGigs(), create: (i) => createGig(i), update: (id, p) => updateGig(id, p) },
        rsvps: {
          get: (id) => getRsvps(id),
          set: (id, email, status, by) => void setRsvp(id, email, status, by),
        },
      });
      state.lastRun = report;
      writeState(state);
      return report;
    } catch (err) {
      const report: GigSheetReport = {
        at: new Date().toISOString(),
        trigger,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        columns: 0,
        created: [],
        linked: [],
        canceled: [],
        rsvpCount: 0,
        rsvps: [],
        conflicts: 0,
        ambiguous: [],
        deleted: 0,
        unmatched: state.lastRun?.unmatched ?? [],
        undated: [],
      };
      // Re-read so a failed run never clobbers links written meanwhile.
      const fresh = readState();
      fresh.lastRun = report;
      writeState(fresh);
      return report;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Start the once-a-day background sync (from the server's init hook). The first
 * run waits a few minutes so a deploy's boot isn't slowed; it then repeats every
 * 24 hours. Quietly does nothing until an admin has saved a sheet link.
 */
export function startDailyGigSheetSync(): void {
  const g = globalThis as { __mbbbGigSheetTimer?: boolean };
  if (g.__mbbbGigSheetTimer) return; // dev-server reloads re-run init
  g.__mbbbGigSheetTimer = true;
  const tick = async () => {
    if (!readState().url) return;
    const r = await runGigSheetSync('daily');
    if (r.ok) {
      console.log(`[gig-sheet] daily sync: ${r.created.length} created, ${r.rsvpCount} RSVPs, ${r.canceled.length} canceled, ${r.conflicts} conflicts`);
    } else {
      console.warn(`[gig-sheet] daily sync failed: ${r.error}`);
    }
  };
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), DAY_MS).unref();
  }, 5 * 60 * 1000).unref();
}
