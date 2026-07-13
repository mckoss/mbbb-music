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
export type ActivityType =
  | 'download'
  | 'print'
  | 'score-view'
  | 'practice'
  | 'performance'
  | 'gig-view'
  | 'members-view';
export const ACTIVITY_TYPES: ActivityType[] = [
  'download',
  'print',
  'score-view',
  'practice',
  'performance',
  'gig-view',
  'members-view',
];

/** Kinds the client beacon may report (the rest are captured server-side). */
export const BEACON_TYPES: ActivityType[] = ['score-view', 'practice', 'performance', 'gig-view', 'print'];

/** Kinds that name a song (the per-member song list is built from these). */
export const SONG_TYPES: ActivityType[] = ['score-view', 'practice', 'performance'];

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

    -- Last time each member was seen on the site (any authenticated request).
    -- Sessions are long-lived, so a true "login" is rare; this is the signal the
    -- roster summary actually wants.
    CREATE TABLE IF NOT EXISTS seen (
      email TEXT PRIMARY KEY,
      at    TEXT NOT NULL
    );
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

/** Record that a member was on the site. Idempotent; keeps only the latest time. */
export function touchSeenDb(db: DatabaseSync, email: string, at: string): void {
  db.prepare(
    `INSERT INTO seen (email, at) VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET at = excluded.at WHERE excluded.at > seen.at`,
  ).run(email.trim().toLowerCase(), at);
}

/**
 * email → last-seen ISO time, for every member we've ever seen.
 *
 * The `seen` table only starts at the release that introduced it, so an event is
 * evidence of presence too: a member who last downloaded a chart in May was
 * plainly here in May. Taking the later of the two backfills every member who
 * predates the table, and costs nothing going forward (presence is recorded more
 * often than events, so `seen` normally wins).
 */
export function lastSeenDb(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT email, MAX(at) AS at
       FROM (SELECT email, at FROM seen UNION ALL SELECT email, at FROM events)
       GROUP BY email`,
    )
    .all() as unknown as Array<{ email: string; at: string }>;
  return new Map(rows.map((r) => [r.email, r.at]));
}

/** One member's usage of one feature: recent (since `since`) and all-time. */
export interface UsageRow {
  email: string;
  type: string;
  recent: number;
  total: number;
  last_at: string;
}

/** Per-member, per-feature event counts (recent + all-time) in one pass. */
export function usageByMemberDb(db: DatabaseSync, since: string): UsageRow[] {
  return db
    .prepare(
      `SELECT email, type,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS recent,
              COUNT(*) AS total,
              MAX(at) AS last_at
       FROM events
       GROUP BY email, type`,
    )
    .all(since) as unknown as UsageRow[];
}

/** One member's use of one song, by kind (view / practice / performance). */
export interface SongUsageRow {
  email: string;
  label: string;
  type: string;
  recent: number;
  total: number;
  last_at: string;
}

/**
 * Per-member song usage (score views, practice runs, performances). Gig set runs
 * share these types but name a gig, not a song — they carry `detail = "set:<id>"`,
 * and are left out so the song list stays a song list.
 */
export function songUsageByMemberDb(db: DatabaseSync, since: string): SongUsageRow[] {
  const kinds = SONG_TYPES.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT email, label, type,
              SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END) AS recent,
              COUNT(*) AS total,
              MAX(at) AS last_at
       FROM events
       WHERE type IN (${kinds})
         AND label IS NOT NULL AND label <> ''
         AND COALESCE(detail, '') NOT LIKE 'set:%'
       GROUP BY email, label, type`,
    )
    .all(since, ...SONG_TYPES) as unknown as SongUsageRow[];
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
export const lastSeen = (): Map<string, string> => lastSeenDb(db());
export const usageByMember = (since: string): UsageRow[] => usageByMemberDb(db(), since);
export const songUsageByMember = (since: string): SongUsageRow[] => songUsageByMemberDb(db(), since);

// Every authenticated request touches this, so throttle the write: an in-process
// memo keeps it to one UPDATE per member per window.
const SEEN_THROTTLE_MS = 5 * 60_000;
const seenMemo = new Map<string, number>();

/** Note that a member is on the site right now (best-effort; never throws). */
export function touchSeen(email: string): void {
  const now = Date.now();
  const last = seenMemo.get(email) ?? 0;
  if (now - last < SEEN_THROTTLE_MS) return;
  seenMemo.set(email, now);
  try {
    touchSeenDb(db(), email, new Date(now).toISOString());
  } catch {
    /* presence tracking must never break a request */
  }
}
