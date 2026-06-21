// Server-only avatar storage and fallback resolution. Uploaded avatars are
// content-addressed blobs under data/avatars/<sha> (kept out of the Drive CAS so
// the machine-owned manifest stays untouched). The serving route layers the
// precedence: uploaded blob → Google account photo → Gravatar → initials.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../../sync/config.js';

/** Largest upload we accept (bytes). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function avatarsDir(): string {
  return resolve(loadConfig().dataDir, 'avatars');
}

export function avatarPath(sha: string): string {
  return resolve(avatarsDir(), sha);
}

/** Sniff a supported raster image type from its magic bytes, or null. */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // "WEBP"
  )
    return 'image/webp';
  return null;
}

/**
 * Store an uploaded avatar by its content hash and return the sha. Rejects
 * anything that isn't a supported image. Idempotent: identical bytes reuse the
 * existing blob.
 */
export function saveAvatar(buf: Buffer): string {
  if (!sniffImageType(buf)) throw new Error('Unsupported image — use PNG, JPEG, GIF, or WebP.');
  const sha = createHash('sha256').update(buf).digest('hex');
  mkdirSync(avatarsDir(), { recursive: true });
  const path = avatarPath(sha);
  if (!existsSync(path)) writeFileSync(path, buf);
  return sha;
}

/** Read a stored avatar blob with its sniffed content type, or null if absent. */
export function readAvatar(sha: string): { buf: Buffer; type: string } | null {
  try {
    const buf = readFileSync(avatarPath(sha));
    return { buf, type: sniffImageType(buf) ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

/**
 * Gravatar image URL for an email. Gravatar keys avatars on the MD5 hex of the
 * trimmed, lowercased address; `d=404` makes it 404 (rather than serve a default)
 * when the address has no avatar, so the caller can fall through to initials.
 */
export function gravatarUrl(email: string, size = 240): string {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
}

/** Where a member's effective avatar comes from, in precedence order. */
export type AvatarSource = 'upload' | 'google' | 'gravatar' | 'initials';

export type AvatarResolution =
  | { source: 'upload' | 'google' | 'gravatar'; sha: string }
  | { source: 'initials' };

// Cached external photos (Google/Gravatar) live in the same content-addressed
// store as uploads; index.json memoizes which sha a given source resolved to,
// so we serve same-origin bytes (offline-cacheable) without re-fetching each
// time. A Google photo is keyed by its URL, so a new URL at sign-in refreshes
// it; we also re-check on a TTL. Gravatar is re-probed daily, with misses
// negatively cached so a member without one doesn't trigger a fetch per view.
const GOOGLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GRAVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

interface CacheIndex {
  entries: Record<string, { sha: string | null; at: number }>;
}

function indexPath(baseDir: string): string {
  return resolve(baseDir, 'index.json');
}

function readIndex(baseDir: string): CacheIndex {
  try {
    const j = JSON.parse(readFileSync(indexPath(baseDir), 'utf8'));
    return { entries: j.entries ?? {} };
  } catch {
    return { entries: {} };
  }
}

function writeIndex(baseDir: string, idx: CacheIndex): void {
  mkdirSync(baseDir, { recursive: true });
  const tmp = `${indexPath(baseDir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(idx));
  renameSync(tmp, indexPath(baseDir));
}

/**
 * Resolve an external photo URL to a locally-cached content hash, fetching and
 * storing it on a miss. Returns the sha, or null when there's no usable image.
 * `allowNegative` caches a miss (used for Gravatar, whose absence is the common
 * case) so it isn't re-probed on every view within the TTL.
 */
async function cacheExternal(
  baseDir: string,
  fetchFn: typeof fetch,
  descriptor: string,
  url: string,
  ttlMs: number,
  allowNegative: boolean,
): Promise<string | null> {
  const key = createHash('sha256').update(descriptor).digest('hex');
  const idx = readIndex(baseDir);
  const e = idx.entries[key];
  const now = Date.now();
  if (e && now - e.at < ttlMs) {
    if (e.sha && existsSync(resolve(baseDir, e.sha))) return e.sha;
    if (e.sha === null && allowNegative) return null;
  }
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (sniffImageType(buf)) {
        const sha = createHash('sha256').update(buf).digest('hex');
        const path = resolve(baseDir, sha);
        mkdirSync(baseDir, { recursive: true });
        if (!existsSync(path)) writeFileSync(path, buf);
        idx.entries[key] = { sha, at: now };
        writeIndex(baseDir, idx);
        return sha;
      }
    }
    if (allowNegative) {
      idx.entries[key] = { sha: null, at: now };
      writeIndex(baseDir, idx);
    }
    return null;
  } catch {
    return e?.sha ?? null; // transient error — serve the last known copy if any
  }
}

/**
 * Resolve the effective avatar to a locally-stored content hash by precedence:
 * uploaded blob → Google account photo → Gravatar → none (initials). Google and
 * Gravatar bytes are cached in `baseDir` so the result is always same-origin and
 * offline-cacheable. Injectable `baseDir`/`fetchFn` for testing.
 */
export async function loadAvatarIn(
  baseDir: string,
  fetchFn: typeof fetch,
  opts: { email: string; avatarSha: string | null; googlePhoto: string | null },
): Promise<AvatarResolution> {
  if (opts.avatarSha && existsSync(resolve(baseDir, opts.avatarSha))) {
    return { source: 'upload', sha: opts.avatarSha };
  }
  if (opts.googlePhoto) {
    const sha = await cacheExternal(baseDir, fetchFn, `google:${opts.googlePhoto}`, opts.googlePhoto, GOOGLE_TTL_MS, false);
    if (sha) return { source: 'google', sha };
  }
  const email = opts.email.trim().toLowerCase();
  const gsha = await cacheExternal(baseDir, fetchFn, `gravatar:${email}`, gravatarUrl(opts.email), GRAVATAR_TTL_MS, true);
  if (gsha) return { source: 'gravatar', sha: gsha };
  return { source: 'initials' };
}

/** App wrapper: resolve against the configured avatar store using global fetch. */
export function loadAvatar(opts: { email: string; avatarSha: string | null; googlePhoto: string | null }): Promise<AvatarResolution> {
  return loadAvatarIn(avatarsDir(), fetch, opts);
}

/** Initials for the placeholder: from the name, else the email local part. */
function initialsFor(name: string | null, email: string): string {
  const n = (name ?? '').trim();
  if (n) {
    const parts = n.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    const out = (first + last).toUpperCase();
    if (out) return out;
  }
  const local = (email.split('@')[0] ?? '').replace(/[^a-z0-9]/gi, '');
  return (local.slice(0, 2) || '?').toUpperCase();
}

/** A stable hue (0–359) derived from the email, so a member's color is constant. */
function hueFor(email: string): number {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** A deterministic initials placeholder as an inline SVG string. */
export function initialsSvg(name: string | null, email: string, size = 240): string {
  const initials = initialsFor(name, email);
  const hue = hueFor(email);
  const bg = `hsl(${hue} 45% 38%)`;
  // Single uppercase letter or two; size the text to the box.
  const fontSize = Math.round(size * (initials.length > 1 ? 0.4 : 0.52));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${initials}">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/>` +
    `<text x="50%" y="50%" dy="0.02em" fill="#fff" font-family="-apple-system, Segoe UI, Roboto, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${initials}</text>` +
    `</svg>`
  );
}
