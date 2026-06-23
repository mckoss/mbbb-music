// Server-only site-activity log. Records authenticated user actions (PDF
// downloads, score views, gig views, performances) for an admin report. Like
// the other app-owned stores it lives in its own SQLite database
// (data/activity.db) and is append-only.
//
// Profile edits are NOT duplicated here — they already live in member_edits
// (members.ts); the admin report merges the two streams.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';

/** Event kinds recorded in the activity log. */
export type ActivityType = 'download' | 'score-view' | 'gig-view' | 'performance';
export const ACTIVITY_TYPES: ActivityType[] = ['download', 'score-view', 'gig-view', 'performance'];

/** Kinds the client beacon may report (the rest are captured server-side). */
export const BEACON_TYPES: ActivityType[] = ['score-view', 'performance'];

// Collapse repeats: an identical (email, type, label) within this window is not
// re-logged, so a reactive beacon or a reload doesn't spam the feed.
const DEDUP_MS = 60_000;

export interface EventInput {
  email: string;
  type: ActivityType;
  label: string | null;
  detail?: string | null;
  at?: string;
  offline?: boolean;
  uploadedAt?: string | null;
}

export interface EventRow {
  id: number;
  at: string;
  email: string;
  type: string;
  label: string | null;
  detail: string | null;
  offline: number;
  uploaded_at: string | null;
}

export function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      at     TEXT NOT NULL,
      email  TEXT NOT NULL,
      type   TEXT NOT NULL,
      label  TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_at ON events (at);
    CREATE INDEX IF NOT EXISTS idx_events_dedup ON events (email, type, label, at);
  `);
  ensureColumn(db, 'offline', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'uploaded_at', 'TEXT');
}

function ensureColumn(db: DatabaseSync, name: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(events)`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === name)) return;
  db.exec(`ALTER TABLE events ADD COLUMN ${name} ${definition}`);
}

/**
 * Record an event, unless an identical one was logged within the dedup window.
 * Returns the new row, or null when collapsed.
 */
export function logEventDb(db: DatabaseSync, input: EventInput): EventRow | null {
  const at = input.at ?? new Date().toISOString();
  const email = input.email.trim().toLowerCase();
  const label = input.label ?? null;
  const cutoff = new Date(Date.parse(at) - DEDUP_MS).toISOString();
  const offline = input.offline ? 1 : 0;
  const uploadedAt = input.uploadedAt ?? null;

  const dup = db
    .prepare(
      `SELECT 1 FROM events
       WHERE email = ? AND type = ? AND COALESCE(label,'') = COALESCE(?,'') AND at >= ?
       LIMIT 1`,
    )
    .get(email, input.type, label, cutoff);
  if (dup) return null;

  const info = db
    .prepare(`INSERT INTO events (at, email, type, label, detail, offline, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(at, email, input.type, label, input.detail ?? null, offline, uploadedAt);

  return db.prepare(`SELECT * FROM events WHERE id = ?`).get(Number(info.lastInsertRowid)) as unknown as EventRow;
}

/** Recent events, newest first. */
export function recentEventsDb(db: DatabaseSync, limit = 500): EventRow[] {
  return db.prepare(`SELECT * FROM events ORDER BY at DESC, id DESC LIMIT ?`).all(limit) as unknown as EventRow[];
}

// ---------------------------------------------------------------------------
// App singleton (configured DB path). Server-only; tests use the *Db functions.
// ---------------------------------------------------------------------------

let cachedDb: DatabaseSync | null = null;
let cachedPath: string | null = null;

function db(): DatabaseSync {
  const path = resolve(loadConfig().dataDir, 'activity.db');
  if (cachedDb && cachedPath === path) return cachedDb;
  if (cachedDb) cachedDb.close();
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  ensureSchema(d);
  cachedDb = d;
  cachedPath = path;
  return d;
}

export const logEvent = (input: EventInput): EventRow | null => logEventDb(db(), input);
export const recentEvents = (limit?: number): EventRow[] => recentEventsDb(db(), limit);
