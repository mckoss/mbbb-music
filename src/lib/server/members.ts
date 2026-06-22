// Server-only band-member profile store. Profiles are app-owned, mutable data
// that has no place in the machine-owned Drive manifest, so — exactly like the
// metadata corrections (see corrections.ts) — they live in their own SQLite
// database (data/members.db) as an append-only field-edit log.
//
// Model (mirrors corrections, deliberately simple):
//   - Each profile is keyed by the member's immutable LOGIN email (lowercased).
//   - A profile is the PROJECTION of the edit log: each field's effective value
//     is the latest non-deleted edit; absent → null (empty list for instruments).
//   - `edited_by` records WHO made each edit (self or an admin) and `edited_at`
//     WHEN, giving the full "who changed what, when" audit trail for free.
//   - A same-user re-edit of a field soft-deletes their prior edit (self-supersede
//     collapse); delete is soft, so history is never lost and edits can be reverted.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import {
  PROFILE_FIELDS,
  isProfileField,
  parseInstruments,
  serializeProfileValue,
  validateProfileValue,
  type MemberProfile,
  type ProfileField,
  type ProfilePatch,
  type ShirtSize,
} from '../members.js';

export interface ProfileEditInput {
  email: string;
  field: ProfileField;
  value: string | null;
  by: string;
  at?: string;
}

export interface ProfileEditRow {
  id: number;
  email: string;
  field: string;
  value: string | null;
  edited_by: string;
  edited_at: string;
  deleted_by: string | null;
  deleted_at: string | null;
}

/** Create the table + index if absent. Idempotent. */
export function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_edits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      field      TEXT NOT NULL,
      value      TEXT,
      edited_by  TEXT NOT NULL,
      edited_at  TEXT NOT NULL,
      deleted_by TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_member_edits_lookup
      ON member_edits (email, field);
  `);
}

function assertField(field: string): asserts field is ProfileField {
  if (!isProfileField(field)) throw new Error(`Field "${field}" is not a profile field.`);
}

/**
 * Record an edit to one profile field. The value is validated/normalized first
 * (an invalid value throws and nothing is written). Collapses the same actor's
 * prior still-active edit of the same field before inserting the new value.
 */
export function editProfileFieldDb(db: DatabaseSync, input: ProfileEditInput): ProfileEditRow {
  assertField(input.field);
  const email = input.email.trim().toLowerCase();
  const by = input.by.trim().toLowerCase();
  if (!email) throw new Error('missing profile email');
  if (!by) throw new Error('missing editor email');
  const value = validateProfileValue(input.field, input.value);
  const at = input.at ?? new Date().toISOString();

  // Collapse: this actor's own active edit of this field becomes history.
  db.prepare(
    `UPDATE member_edits SET deleted_by = ?, deleted_at = ?
     WHERE email = ? AND field = ? AND edited_by = ? AND deleted_at IS NULL`,
  ).run(by, at, email, input.field, by);

  const info = db
    .prepare(
      `INSERT INTO member_edits (email, field, value, edited_by, edited_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(email, input.field, value, by, at);

  return db
    .prepare(`SELECT * FROM member_edits WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as unknown as ProfileEditRow;
}

/** Soft-delete one edit (revert it). Returns true if a live row was deleted. */
export function deleteProfileEditDb(db: DatabaseSync, id: number, by: string, at?: string): boolean {
  const when = at ?? new Date().toISOString();
  const info = db
    .prepare(`UPDATE member_edits SET deleted_by = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(by.trim().toLowerCase(), when, id);
  return Number(info.changes) > 0;
}

/** Restore (un-delete) a soft-deleted edit. Latest active edit still wins. */
export function restoreProfileEditDb(db: DatabaseSync, id: number): boolean {
  const info = db
    .prepare(`UPDATE member_edits SET deleted_by = NULL, deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`)
    .run(id);
  return Number(info.changes) > 0;
}

/** An empty profile (all fields cleared) for the given email. */
function emptyProfile(email: string): MemberProfile {
  return {
    email,
    fullName: null,
    phone: null,
    primaryInstrument: null,
    instruments: [],
    shirtSize: null,
    alternateEmail: null,
    joinedDate: null,
    endDate: null,
    avatarSha: null,
    updatedAt: null,
    updatedBy: null,
  };
}

/** The latest non-deleted edit per (email, field), the live head of the log. */
function activeRows(db: DatabaseSync, email?: string): Pick<ProfileEditRow, 'email' | 'field' | 'value' | 'edited_by' | 'edited_at'>[] {
  const where = email ? `AND c.email = ?` : '';
  const args = email ? [email.trim().toLowerCase()] : [];
  return db
    .prepare(
      `SELECT email, field, value, edited_by, edited_at FROM member_edits c
       WHERE deleted_at IS NULL ${where}
         AND NOT EXISTS (
           SELECT 1 FROM member_edits c2
           WHERE c2.deleted_at IS NULL
             AND c2.email = c.email AND c2.field = c.field
             AND (c2.edited_at > c.edited_at OR (c2.edited_at = c.edited_at AND c2.id > c.id))
         )`,
    )
    .all(...args) as unknown as Pick<ProfileEditRow, 'email' | 'field' | 'value' | 'edited_by' | 'edited_at'>[];
}

/** Apply one active row's value onto a profile, tracking the most recent edit. */
function applyRow(p: MemberProfile, r: { field: string; value: string | null; edited_by: string; edited_at: string }): void {
  switch (r.field) {
    case 'fullName':
      p.fullName = r.value;
      break;
    case 'phone':
      p.phone = r.value;
      break;
    case 'primaryInstrument':
      p.primaryInstrument = r.value;
      break;
    case 'instruments':
      p.instruments = parseInstruments(r.value);
      break;
    case 'shirtSize':
      p.shirtSize = (r.value as ShirtSize | null) ?? null;
      break;
    case 'alternateEmail':
      p.alternateEmail = r.value;
      break;
    case 'joinedDate':
      p.joinedDate = r.value;
      break;
    case 'endDate':
      p.endDate = r.value;
      break;
    case 'avatarSha':
      p.avatarSha = r.value;
      break;
  }
  if (!p.updatedAt || r.edited_at > p.updatedAt) {
    p.updatedAt = r.edited_at;
    p.updatedBy = r.edited_by;
  }
}

/** The effective profile for one member (empty profile if no edits exist). */
export function effectiveProfileDb(db: DatabaseSync, email: string): MemberProfile {
  const p = emptyProfile(email.trim().toLowerCase());
  for (const r of activeRows(db, email)) applyRow(p, r);
  return p;
}

/** Every profile that has at least one edit, keyed by email. */
export function allProfilesDb(db: DatabaseSync): MemberProfile[] {
  const byEmail = new Map<string, MemberProfile>();
  for (const r of activeRows(db)) {
    let p = byEmail.get(r.email);
    if (!p) byEmail.set(r.email, (p = emptyProfile(r.email)));
    applyRow(p, r);
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Full edit history for one member, newest first (including soft-deleted rows). */
export function profileHistoryDb(db: DatabaseSync, email: string, limit = 500): ProfileEditRow[] {
  return db
    .prepare(
      `SELECT * FROM member_edits WHERE email = ? ORDER BY edited_at DESC, id DESC LIMIT ?`,
    )
    .all(email.trim().toLowerCase(), limit) as unknown as ProfileEditRow[];
}

/** The current stored (normalized) string for one field of an effective profile. */
function storedValue(p: MemberProfile, field: ProfileField): string | null {
  if (field === 'instruments') return p.instruments.length ? JSON.stringify(p.instruments) : null;
  return (p[field] as string | null) ?? null;
}

/**
 * Apply a typed patch as a set of field edits; returns the resulting profile.
 * Only fields whose value actually changes are written, so the audit log records
 * real edits (not a fresh row per field on every save).
 */
export function editProfileDb(db: DatabaseSync, email: string, patch: ProfilePatch, by: string, at?: string): MemberProfile {
  const current = effectiveProfileDb(db, email);
  for (const field of PROFILE_FIELDS) {
    if (!(field in patch)) continue;
    const value = validateProfileValue(field, serializeProfileValue(field, (patch as Record<string, unknown>)[field]));
    if (value === storedValue(current, field)) continue; // unchanged — no-op
    editProfileFieldDb(db, { email, field, value, by, at });
  }
  return effectiveProfileDb(db, email);
}

// ---------------------------------------------------------------------------
// App singleton (configured DB path). Server-only; tests use the *Db functions
// above with an in-memory database.
// ---------------------------------------------------------------------------

let cachedDb: DatabaseSync | null = null;
let cachedPath: string | null = null;

function db(): DatabaseSync {
  const path = resolve(loadConfig().dataDir, 'members.db');
  if (cachedDb && cachedPath === path) return cachedDb;
  if (cachedDb) cachedDb.close();
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  ensureSchema(d);
  cachedDb = d;
  cachedPath = path;
  return d;
}

export const getProfile = (email: string): MemberProfile => effectiveProfileDb(db(), email);
export const allProfiles = (): MemberProfile[] => allProfilesDb(db());
export const editProfile = (email: string, patch: ProfilePatch, by: string): MemberProfile =>
  editProfileDb(db(), email, patch, by);
export const profileHistory = (email: string, limit?: number): ProfileEditRow[] =>
  profileHistoryDb(db(), email, limit);
export const deleteProfileEdit = (id: number, by: string): boolean => deleteProfileEditDb(db(), id, by);
export const restoreProfileEdit = (id: number): boolean => restoreProfileEditDb(db(), id);
