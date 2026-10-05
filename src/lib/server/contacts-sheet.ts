// Server-only Contacts-sheet import, run by an admin from the Members page
// ("Sync Contacts"). Reads the "Contacts" tab of the band's availability
// spreadsheet (the same one the Gig-sheet import uses, unless an admin saves a
// different link) and fills in member profiles:
//
//   - Each contact is matched to a member by email (login or alternate), then by
//     full name, then by a unique first name (narrowed by instrument).
//   - Only profile fields nobody has ever edited are filled — name, phone,
//     primary instrument, shirt size, and the sheet email as the alternate email
//     when it differs from the login. Anything entered on the website wins; when
//     it disagrees with the sheet, the report lists the difference.
//   - Contacts with no account are listed so an admin can add them as members
//     (a deliberate grant of access — never automatic).
//
// Contact details are private band data: they go only into the private data
// volume (data/members.db, data/contacts-sheet.json), never into this repo.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { detectInstrument } from '../../sync/instruments.js';
import { parseContactsSheet, type SheetContact } from '../contacts-sheet.js';
import { parseSheetUrl } from '../gig-sheet.js';
import type { MemberProfile, ProfileField, ProfilePatch } from '../members.js';

/** The `edited_by` identity on profile edits the import makes. */
export const CONTACTS_IMPORTER = 'contacts-sheet-import';

/** The tab read when the saved link doesn't name one with #gid=. */
export const CONTACTS_TAB = 'Contacts';

type Filled = 'fullName' | 'phone' | 'primaryInstrument' | 'shirtSize' | 'alternateEmail';

const FIELD_LABEL: Record<Filled, string> = {
  fullName: 'Name',
  phone: 'Phone',
  primaryInstrument: 'Instrument',
  shirtSize: 'Shirt size',
  alternateEmail: 'Alternate email',
};

export interface ContactsReport {
  at: string;
  ok: boolean;
  error?: string;
  /** Contact rows read from the sheet. */
  rows: number;
  /** Members whose blank profile fields were filled. */
  updated: { email: string; member: string; fields: string[] }[];
  /** Website values that differ from the sheet (kept as they are). */
  differences: { email: string; member: string; field: string; site: string; sheet: string }[];
  /** Contacts with no member account. `email` enables "Add as member". */
  notOnSite: { name: string; email: string | null; instrument: string | null }[];
  /** Contacts that match several members — left alone. */
  ambiguous: { name: string }[];
}

export interface ContactsState {
  /** A Sheets link for the Contacts tab; blank → the Gig sheet's spreadsheet. */
  url?: string;
  lastRun?: ContactsReport;
}

function statePath(dataDir?: string): string {
  return resolve(dataDir ?? loadConfig().dataDir, 'contacts-sheet.json');
}

export function readContactsState(dataDir?: string): ContactsState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dataDir), 'utf8'));
    return {
      ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}),
      ...(parsed.lastRun ? { lastRun: parsed.lastRun } : {}),
    };
  } catch {
    return {};
  }
}

function writeContactsState(state: ContactsState, dataDir?: string): void {
  const path = statePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** Save (or, blank, clear) the Contacts link. False when it isn't a Sheets link. */
export function setContactsUrl(url: string, dataDir?: string): boolean {
  const state = readContactsState(dataDir);
  const u = url.trim();
  if (u && !parseSheetUrl(u)) return false;
  if (u) state.url = u;
  else delete state.url;
  writeContactsState(state, dataDir);
  return true;
}

// --- Matching and filling (pure over injected stores) ---------------------------

export interface ContactMember {
  email: string;
  name: string;
  alternateEmail: string | null;
  instruments: string[];
  former?: boolean;
}

export interface ProfileStore {
  get(email: string): MemberProfile;
  /** Fields that have ever been edited for this member (by anyone). */
  editedFields(email: string): Set<string>;
  edit(email: string, patch: ProfilePatch, by: string): void;
}

function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.+]+/g, ' ')
    .trim();
}

type ContactMatch = { email: string } | { unmatched: 'none' | 'several' };

/** Who a contact row is: by email, then full name, then unique first name. */
export function matchContact(c: SheetContact, members: ContactMember[]): ContactMatch {
  if (c.email) {
    const byEmail = members.find((m) => m.email === c.email || m.alternateEmail === c.email);
    if (byEmail) return { email: byEmail.email };
  }
  const want = fold(c.name);
  if (!want) return { unmatched: 'none' };
  const full = members.filter((m) => fold(m.name) === want);
  if (full.length === 1) return { email: full[0].email };
  if (full.length > 1) return { unmatched: 'several' };

  const first = want.split(' ')[0];
  let hits = members.filter((m) => !m.former && fold(m.name).split(' ')[0] === first);
  if (hits.length > 1) {
    const slug = c.instrument ? detectInstrument(c.instrument)?.slug : null;
    const byInst = slug ? hits.filter((m) => m.instruments.includes(slug)) : [];
    if (byInst.length === 1) hits = byInst;
  }
  if (hits.length === 1) return { email: hits[0].email };
  return { unmatched: hits.length ? 'several' : 'none' };
}

/** The values a contact row offers for each fillable field. */
function sheetValues(c: SheetContact, login: string): Partial<Record<Filled, string>> {
  const out: Partial<Record<Filled, string>> = {};
  if (c.name.includes(' ')) out.fullName = c.name; // a lone first name isn't a full name
  if (c.phone) out.phone = c.phone;
  const slug = c.instrument ? detectInstrument(c.instrument)?.slug : null;
  if (slug) out.primaryInstrument = slug;
  if (c.shirtSize) out.shirtSize = c.shirtSize;
  if (c.email && c.email !== login) out.alternateEmail = c.email;
  return out;
}

/** Equal for the purpose of a "differs" report (case, spacing, phone punctuation). */
function same(field: Filled, a: string, b: string): boolean {
  if (field === 'phone') return a.replace(/\D/g, '').slice(-10) === b.replace(/\D/g, '').slice(-10);
  return fold(a) === fold(b);
}

export function applyContacts(input: {
  grid: string[][];
  members: ContactMember[];
  profiles: ProfileStore;
  now?: string;
}): ContactsReport {
  const contacts = parseContactsSheet(input.grid);
  const report: ContactsReport = {
    at: input.now ?? new Date().toISOString(),
    ok: true,
    rows: contacts.length,
    updated: [],
    differences: [],
    notOnSite: [],
    ambiguous: [],
  };
  const nameOf = new Map(input.members.map((m) => [m.email, m.name || m.email]));

  for (const c of contacts) {
    const m = matchContact(c, input.members);
    if (!('email' in m)) {
      if (m.unmatched === 'several') report.ambiguous.push({ name: c.name });
      else report.notOnSite.push({ name: c.name, email: c.email, instrument: c.instrument });
      continue;
    }
    const email = m.email;
    const profile = input.profiles.get(email);
    const edited = input.profiles.editedFields(email);
    const patch: ProfilePatch = {};
    const filled: string[] = [];
    for (const [field, value] of Object.entries(sheetValues(c, email)) as [Filled, string][]) {
      const current = profile[field as ProfileField] as string | null;
      if (current) {
        if (!same(field, current, value)) {
          report.differences.push({ email, member: nameOf.get(email) ?? email, field: FIELD_LABEL[field], site: current, sheet: value });
        }
        continue;
      }
      if (edited.has(field)) continue; // someone cleared it on purpose
      (patch as Record<string, string>)[field] = value;
      filled.push(FIELD_LABEL[field]);
    }
    if (filled.length) {
      input.profiles.edit(email, patch, CONTACTS_IMPORTER);
      report.updated.push({ email, member: nameOf.get(email) ?? email, fields: filled });
    }
  }
  return report;
}

// --- App wiring ------------------------------------------------------------------

/** The link to read: the saved Contacts link, else the Gig sheet's spreadsheet. */
function contactsSource(state: ContactsState, gigSheetUrl: string | undefined): { url: string; tab?: string } | null {
  if (state.url) return { url: state.url, tab: CONTACTS_TAB };
  const ref = gigSheetUrl ? parseSheetUrl(gigSheetUrl) : null;
  if (!ref) return null;
  // Drop the Gig tab's #gid= so the Contacts tab is found by its title.
  return { url: `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/edit`, tab: CONTACTS_TAB };
}

let running: Promise<ContactsReport> | null = null;

/** Run one Contacts sync against the real stores. Never throws. */
export function runContactsSync(): Promise<ContactsReport> {
  running ??= (async () => {
    const [{ fetchSheetGrid, readState: readGigSheetState }, { listUsers }, { getProfile, editProfile, profileHistory }] =
      await Promise.all([import('./gig-sheet.js'), import('./users.js'), import('./members.js')]);
    const state = readContactsState();
    let report: ContactsReport;
    try {
      const source = contactsSource(state, readGigSheetState().url);
      if (!source) throw new Error('No sheet link yet. Save the Gig sheet link on the Gigs page, or a Contacts link here.');
      const grid = await fetchSheetGrid(source.url, loadConfig().google?.serviceAccount, source.tab);
      const members: ContactMember[] = listUsers().map((u) => {
        const p = getProfile(u.email);
        return {
          email: u.email,
          name: p.fullName || u.name || '',
          alternateEmail: p.alternateEmail,
          instruments: [p.primaryInstrument, ...p.instruments].filter((s): s is string => Boolean(s)),
          former: Boolean(p.endDate),
        };
      });
      report = applyContacts({
        grid,
        members,
        profiles: {
          get: (e) => getProfile(e),
          editedFields: (e) => new Set(profileHistory(e).map((r) => r.field)),
          edit: (e, patch, by) => void editProfile(e, patch, by),
        },
      });
    } catch (err) {
      report = {
        at: new Date().toISOString(),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        rows: 0,
        updated: [],
        differences: [],
        notOnSite: state.lastRun?.notOnSite ?? [],
        ambiguous: [],
      };
    }
    const fresh = readContactsState();
    fresh.lastRun = report;
    writeContactsState(fresh);
    return report;
  })().finally(() => {
    running = null;
  });
  return running;
}
