// Server-only avatar storage and fallback resolution. Uploaded avatars are
// content-addressed blobs under data/avatars/<sha> (kept out of the Drive CAS so
// the machine-owned manifest stays untouched). The serving route layers the
// precedence: uploaded blob → Google account photo → Gravatar → initials.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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
