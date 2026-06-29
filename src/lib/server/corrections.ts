// Human-entered metadata corrections, applied as an overlay over the synced
// manifest. The manifest is machine-owned (a Drive re-sync re-derives every field
// from filenames), so corrections can NEVER live there. They live in their own
// SQLite database (data/corrections.db) and are applied at catalog-build time in
// library.ts — exactly like the song-status overlay, just richer.
//
// Model (deliberately simple — no approval workflow):
//   - An edit is live the moment it's made; everyone sees it.
//   - The EFFECTIVE value of a field is the latest non-deleted edit; none → the
//     machine-derived value.
//   - A same-user re-edit of the same field soft-deletes their prior edit (a
//     self-supersede collapse) so the active set shows only their latest.
//   - Delete is a SOFT delete (deleted_by/deleted_at) — the full history is kept;
//     deleting an edit reverts the field to whatever value preceded it.
//
// Append-only in spirit: rows are inserted and soft-deleted, never hard-removed.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';

export type Scope = 'file' | 'song' | 'folder';

/**
 * Fields a human may correct, by scope.
 *   file   — keyed by Drive file id: instrument/key/part, plus `songSlug` to
 *            (re)assign this one file to a song.
 *   song   — keyed by the stable identity slug: display name + display slug.
 *   folder — keyed by the song-folder's Drive id: `songSlug` to (re)assign every
 *            file in that folder to a song.
 */
export const CORRECTABLE_FIELDS: Record<Scope, readonly string[]> = {
  file: ['instrumentSlug', 'key', 'partNumber', 'songSlug'],
  song: ['displaySlug', 'displayName', 'videoUrl'],
  folder: ['songSlug'],
};

export interface EditInput {
  scope: Scope;
  targetId: string;
  field: string;
  value: string | null;
  by: string;
  at?: string;
}

export interface EditRow {
  id: number;
  scope: Scope;
  target_id: string;
  field: string;
  value: string | null;
  edited_by: string;
  edited_at: string;
  deleted_by: string | null;
  deleted_at: string | null;
}

/** Overlay applied to the manifest, grouped by scope (target_id -> field -> value). */
export interface Overlay {
  file: Record<string, Record<string, string | null>>;
  song: Record<string, Record<string, string | null>>;
  folder: Record<string, Record<string, string | null>>;
}

/** Create the table + index if absent. Idempotent. */
export function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS corrections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,
      target_id  TEXT NOT NULL,
      field      TEXT NOT NULL,
      value      TEXT,
      edited_by  TEXT NOT NULL,
      edited_at  TEXT NOT NULL,
      deleted_by TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_lookup
      ON corrections (scope, target_id, field);
  `);
}

function assertField(scope: Scope, field: string): void {
  if (!CORRECTABLE_FIELDS[scope]?.includes(field)) {
    throw new Error(`Field "${field}" is not correctable for scope "${scope}".`);
  }
}

/**
 * Record an edit. Collapses the same user's prior still-active edit of the same
 * field (soft-deletes it as a self-supersede) before inserting the new value.
 */
export function editFieldDb(db: DatabaseSync, input: EditInput): EditRow {
  const { scope, targetId, field, value, by } = input;
  assertField(scope, field);
  const at = input.at ?? new Date().toISOString();

  // Collapse: this user's own active edit of this field becomes history.
  db.prepare(
    `UPDATE corrections SET deleted_by = ?, deleted_at = ?
     WHERE scope = ? AND target_id = ? AND field = ? AND edited_by = ? AND deleted_at IS NULL`,
  ).run(by, at, scope, targetId, field, by);

  const info = db
    .prepare(
      `INSERT INTO corrections (scope, target_id, field, value, edited_by, edited_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(scope, targetId, field, value, by, at);

  return db.prepare(`SELECT * FROM corrections WHERE id = ?`).get(Number(info.lastInsertRowid)) as unknown as EditRow;
}

/** Soft-delete one edit (revert it). Returns true if a live row was deleted. */
export function deleteEditDb(db: DatabaseSync, id: number, by: string, at?: string): boolean {
  const when = at ?? new Date().toISOString();
  const info = db
    .prepare(`UPDATE corrections SET deleted_by = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(by, when, id);
  return Number(info.changes) > 0;
}

/**
 * Restore (un-delete) a soft-deleted edit. The edit becomes active again; if a
 * newer active edit exists for the same field that one still wins (latest-wins),
 * so restoring is always safe. Returns true if a deleted row was restored.
 */
export function restoreEditDb(db: DatabaseSync, id: number): boolean {
  const info = db
    .prepare(`UPDATE corrections SET deleted_by = NULL, deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`)
    .run(id);
  return Number(info.changes) > 0;
}

/** The latest non-deleted edit for one field, or undefined. */
export function editorOf(db: DatabaseSync, id: number): EditRow | undefined {
  return db.prepare(`SELECT * FROM corrections WHERE id = ?`).get(id) as unknown as EditRow | undefined;
}

/**
 * The effective overlay: for each (scope, target, field) the latest non-deleted
 * value. Grouped for direct application to manifest entries (file) and tunes (song).
 */
export function effectiveOverlayDb(db: DatabaseSync): Overlay {
  const rows = db
    .prepare(
      `SELECT scope, target_id, field, value FROM corrections c
       WHERE deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM corrections c2
           WHERE c2.deleted_at IS NULL
             AND c2.scope = c.scope AND c2.target_id = c.target_id AND c2.field = c.field
             AND (c2.edited_at > c.edited_at OR (c2.edited_at = c.edited_at AND c2.id > c.id))
         )`,
    )
    .all() as unknown as Pick<EditRow, 'scope' | 'target_id' | 'field' | 'value'>[];

  const overlay: Overlay = { file: {}, song: {}, folder: {} };
  for (const r of rows) {
    const bucket = r.scope === 'song' ? overlay.song : r.scope === 'folder' ? overlay.folder : overlay.file;
    (bucket[r.target_id] ??= {})[r.field] = r.value;
  }
  return overlay;
}

/** Recent edits, newest first, including soft-deleted ones (the full history). */
export function recentEditsDb(db: DatabaseSync, limit = 500): EditRow[] {
  return db
    .prepare(`SELECT * FROM corrections ORDER BY edited_at DESC, id DESC LIMIT ?`)
    .all(limit) as unknown as EditRow[];
}

/**
 * A cheap monotonic-ish signal that changes on any write (insert OR soft-delete),
 * for catalog-cache invalidation. Inserts bump max(id); deletes bump the deleted
 * counters.
 */
export function revisionDb(db: DatabaseSync): string {
  const r = db
    .prepare(
      `SELECT COALESCE(MAX(id),0) AS mid,
              COUNT(deleted_at) AS dels,
              COALESCE(MAX(deleted_at),'') AS mdel
       FROM corrections`,
    )
    .get() as unknown as { mid: number; dels: number; mdel: string };
  return `${r.mid}:${r.dels}:${r.mdel}`;
}

// ---------------------------------------------------------------------------
// App singleton (configured DB path). Server-only; tests use the *Db functions
// above with an in-memory database.
// ---------------------------------------------------------------------------

let cachedDb: DatabaseSync | null = null;
let cachedPath: string | null = null;

function db(): DatabaseSync {
  const path = resolve(loadConfig().dataDir, 'corrections.db');
  if (cachedDb && cachedPath === path) return cachedDb;
  if (cachedDb) cachedDb.close();
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  ensureSchema(d);
  cachedDb = d;
  cachedPath = path;
  return d;
}

export const editField = (input: EditInput): EditRow => editFieldDb(db(), input);
export const deleteEdit = (id: number, by: string): boolean => deleteEditDb(db(), id, by);
export const restoreEdit = (id: number): boolean => restoreEditDb(db(), id);
export const getEdit = (id: number): EditRow | undefined => editorOf(db(), id);
export const effectiveOverlay = (): Overlay => effectiveOverlayDb(db());
export const recentEdits = (limit?: number): EditRow[] => recentEditsDb(db(), limit);
export const revision = (): string => revisionDb(db());
