// Server-only gig RSVP store. A member's attendance reply to a gig is app-owned,
// mutable data with no place in the Drive manifest, so — like member profiles
// (members.ts) — it lives in its own SQLite database (data/rsvps.db).
//
// Model (simpler than the profile edit-log: current value only):
//   - One row per (gig_id, member email). The email is the member's immutable
//     LOGIN identity (lowercased), matching SessionUser.email / MemberProfile.email.
//   - `status` is one of 'yes' | 'no' | 'maybe'. The absence of a row is the
//     fourth, "unconfirmed" state — clearing a reply deletes the row.
//   - `updated_by` / `updated_at` record who set it and when (an organizer may
//     set a reply on a member's behalf), giving a light audit trail for free.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { isRsvpStatus, type RsvpStatus } from '../rsvp.js';

export interface RsvpRow {
  email: string;
  status: RsvpStatus;
  updatedAt: string;
  updatedBy: string;
}

/** Create the table if absent. Idempotent. */
export function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gig_rsvps (
      gig_id     TEXT NOT NULL,
      email      TEXT NOT NULL,
      status     TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (gig_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_gig_rsvps_email ON gig_rsvps (email);
  `);
}

/**
 * Set (or clear) one member's reply to a gig. A null/unknown status clears the
 * reply (deletes the row → back to unconfirmed). Emails are lowercased. Returns
 * the effective status after the write (null when cleared).
 */
export function setRsvpDb(
  db: DatabaseSync,
  gigId: string,
  email: string,
  status: RsvpStatus | null,
  by: string,
  at?: string,
): RsvpStatus | null {
  const e = email.trim().toLowerCase();
  const who = by.trim().toLowerCase();
  if (!gigId) throw new Error('missing gig id');
  if (!e) throw new Error('missing member email');
  if (!who) throw new Error('missing editor email');

  if (!isRsvpStatus(status)) {
    db.prepare(`DELETE FROM gig_rsvps WHERE gig_id = ? AND email = ?`).run(gigId, e);
    return null;
  }

  const when = at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO gig_rsvps (gig_id, email, status, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(gig_id, email) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(gigId, e, status, when, who);
  return status;
}

/** Every reply for one gig (any status), keyed by member email. */
export function getRsvpsDb(db: DatabaseSync, gigId: string): RsvpRow[] {
  const rows = db
    .prepare(
      `SELECT email, status, updated_at, updated_by FROM gig_rsvps WHERE gig_id = ?`,
    )
    .all(gigId) as unknown as {
    email: string;
    status: string;
    updated_at: string;
    updated_by: string;
  }[];
  return rows
    .filter((r) => isRsvpStatus(r.status))
    .map((r) => ({
      email: r.email,
      status: r.status as RsvpStatus,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
}

/** One member's replies across every gig, as { gigId: status }. */
export function getMemberRsvpsDb(db: DatabaseSync, email: string): Record<string, RsvpStatus> {
  const rows = db
    .prepare(`SELECT gig_id, status FROM gig_rsvps WHERE email = ?`)
    .all(email.trim().toLowerCase()) as unknown as { gig_id: string; status: string }[];
  const out: Record<string, RsvpStatus> = {};
  for (const r of rows) if (isRsvpStatus(r.status)) out[r.gig_id] = r.status;
  return out;
}

// ---------------------------------------------------------------------------
// App singleton (configured DB path). Server-only; tests use the *Db functions
// above with an in-memory database.
// ---------------------------------------------------------------------------

let cachedDb: DatabaseSync | null = null;
let cachedPath: string | null = null;

function db(): DatabaseSync {
  const path = resolve(loadConfig().dataDir, 'rsvps.db');
  if (cachedDb && cachedPath === path) return cachedDb;
  if (cachedDb) cachedDb.close();
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  ensureSchema(d);
  cachedDb = d;
  cachedPath = path;
  return d;
}

export const setRsvp = (
  gigId: string,
  email: string,
  status: RsvpStatus | null,
  by: string,
): RsvpStatus | null => setRsvpDb(db(), gigId, email, status, by);
export const getRsvps = (gigId: string): RsvpRow[] => getRsvpsDb(db(), gigId);
export const getMemberRsvps = (email: string): Record<string, RsvpStatus> =>
  getMemberRsvpsDb(db(), email);
