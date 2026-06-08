// Server-only user/role store. Roles live in a writable data/users.json so an
// admin can grant/revoke access at runtime; the email(s) in auth.admins are
// always treated as admin (bootstrap), and can't be demoted/removed via the UI.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { loadConfig } from '../../sync/config.js';
import { authConfig } from './auth.js';
import type { Role } from '$lib/types';

export const ROLES: Role[] = ['admin', 'member', 'organizer'];

export interface UserRecord {
  email: string;
  role: Role;
  name?: string | null;
  addedAt?: string;
  addedBy?: string;
  bootstrap?: boolean; // a config.auth.admins entry — not editable via the UI
}

interface UsersFile {
  users: Record<string, { role: Role; name?: string | null; addedAt?: string; addedBy?: string }>;
}

function usersPath(): string {
  return resolve(loadConfig().dataDir, 'users.json');
}

function readFile(): UsersFile {
  try {
    const parsed = JSON.parse(readFileSync(usersPath(), 'utf8'));
    return { users: parsed.users ?? {} };
  } catch {
    return { users: {} };
  }
}

function writeFileAtomic(data: UsersFile): void {
  const path = usersPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/** Bootstrap admin emails from config (lowercased). */
function bootstrapAdmins(): Set<string> {
  return new Set(authConfig().cfg.admins);
}

/**
 * The effective role for an email: config-admin wins (always admin), else the
 * role recorded in users.json, else null (authenticated but not approved).
 */
export function roleOf(email: string | null | undefined): Role | null {
  if (!email) return null;
  const e = email.toLowerCase();
  if (bootstrapAdmins().has(e)) return 'admin';
  const rec = readFile().users[e];
  return rec?.role ?? null;
}

/** All known users (config admins merged with the file), sorted by email. */
export function listUsers(): UserRecord[] {
  const out = new Map<string, UserRecord>();
  for (const e of bootstrapAdmins()) out.set(e, { email: e, role: 'admin', bootstrap: true });
  const file = readFile().users;
  for (const [email, rec] of Object.entries(file)) {
    const e = email.toLowerCase();
    if (out.has(e)) continue; // a bootstrap admin overrides any file entry
    out.set(e, { email: e, role: rec.role, name: rec.name ?? null, addedAt: rec.addedAt, addedBy: rec.addedBy });
  }
  return [...out.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Add or update a user's role. Bootstrap admins are immutable (no-op). */
export function setRole(email: string, role: Role, byEmail: string): void {
  const e = email.trim().toLowerCase();
  if (!e || !ROLES.includes(role)) throw new Error('invalid email or role');
  if (bootstrapAdmins().has(e)) return; // config admin — managed in config, not here
  const data = readFile();
  const prev = data.users[e];
  data.users[e] = {
    role,
    name: prev?.name ?? null,
    addedAt: prev?.addedAt ?? new Date().toISOString(),
    addedBy: prev?.addedBy ?? byEmail.toLowerCase(),
  };
  writeFileAtomic(data);
}

/** Remove a user (revoke access). Bootstrap admins can't be removed here. */
export function removeUser(email: string): void {
  const e = email.trim().toLowerCase();
  if (bootstrapAdmins().has(e)) return;
  const data = readFile();
  if (data.users[e]) {
    delete data.users[e];
    writeFileAtomic(data);
  }
}

/** Record a display name for a user on sign-in (best-effort, file users only). */
export function rememberName(email: string, name: string | null): void {
  const e = email.toLowerCase();
  if (!name || bootstrapAdmins().has(e)) return;
  const data = readFile();
  const rec = data.users[e];
  if (rec && rec.name !== name) {
    rec.name = name;
    writeFileAtomic(data);
  }
}
