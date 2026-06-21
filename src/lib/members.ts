// Shared (client + server) member-profile types, constants, and pure validation.
// The DB layer lives in src/lib/server/members.ts; this module carries only what
// the UI also needs (the profile shape, the pickable option sets, and the
// value-validation rules), so it must stay free of any server-only imports.

import { INSTRUMENT_CHOICES } from '../sync/instruments.js';

// Re-exported so UI code can pull the canonical instrument list + label helper
// from one profile-domain module.
export { INSTRUMENT_CHOICES, instrumentLabel } from '../sync/instruments.js';

/** Band-shirt sizes offered in the profile picker. */
export type ShirtSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';
export const SHIRT_SIZES: ShirtSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

/**
 * The editable profile fields. The login email is deliberately NOT here: it's the
 * account's immutable identity (the row key), never an editable field — only
 * `alternateEmail` (a contact address) can change.
 */
export const PROFILE_FIELDS = [
  'fullName',
  'phone',
  'primaryInstrument',
  'instruments',
  'shirtSize',
  'alternateEmail',
  'avatarSha',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/**
 * A member's effective profile (the projection of the edit log). `email` is the
 * immutable login identity; `instruments` are the additional instruments beyond
 * `primaryInstrument`. `updatedAt`/`updatedBy` reflect the most recent field edit.
 */
export interface MemberProfile {
  email: string;
  fullName: string | null;
  phone: string | null;
  primaryInstrument: string | null; // instrument slug
  instruments: string[]; // additional instrument slugs
  shirtSize: ShirtSize | null;
  alternateEmail: string | null;
  avatarSha: string | null; // uploaded avatar blob hash, if any
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A typed partial update; only the provided fields are written. */
export type ProfilePatch = Partial<{
  fullName: string | null;
  phone: string | null;
  primaryInstrument: string | null;
  instruments: string[] | null;
  shirtSize: ShirtSize | null;
  alternateEmail: string | null;
  avatarSha: string | null;
}>;

const INSTRUMENT_SLUGS = new Set(INSTRUMENT_CHOICES.map((i) => i.slug));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SHA_RE = /^[a-f0-9]{64}$/;

export function isProfileField(field: string): field is ProfileField {
  return (PROFILE_FIELDS as readonly string[]).includes(field);
}

/** True if `slug` is one of the canonical instruments. */
export function isInstrumentSlug(slug: string): boolean {
  return INSTRUMENT_SLUGS.has(slug);
}

/** Parse a stored `instruments` value (JSON array, or null) into a slug list. */
export function parseInstruments(value: string | null): string[] {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Validate and normalize one field's raw string value for storage. Clearing (null
 * or empty/whitespace) is always allowed and stores null. Structured fields:
 * `instruments` is a JSON-encoded slug array; an empty list stores null. Throws on
 * an invalid value so a bad write is rejected before it reaches the DB.
 */
export function validateProfileValue(field: ProfileField, value: string | null): string | null {
  const v = typeof value === 'string' ? value.trim() : value;
  if (v == null || v === '') return null;

  switch (field) {
    case 'fullName':
    case 'phone':
      return v;
    case 'alternateEmail': {
      const e = v.toLowerCase();
      if (!EMAIL_RE.test(e)) throw new Error('invalid alternate email');
      return e;
    }
    case 'primaryInstrument':
      if (!INSTRUMENT_SLUGS.has(v)) throw new Error(`unknown instrument "${v}"`);
      return v;
    case 'instruments': {
      let arr: unknown;
      try {
        arr = JSON.parse(v);
      } catch {
        throw new Error('instruments must be a JSON array');
      }
      if (!Array.isArray(arr)) throw new Error('instruments must be a JSON array');
      const slugs = [...new Set(arr.map(String))];
      for (const s of slugs) if (!INSTRUMENT_SLUGS.has(s)) throw new Error(`unknown instrument "${s}"`);
      return slugs.length ? JSON.stringify(slugs) : null;
    }
    case 'shirtSize':
      if (!(SHIRT_SIZES as string[]).includes(v)) throw new Error(`invalid shirt size "${v}"`);
      return v;
    case 'avatarSha':
      if (!SHA_RE.test(v)) throw new Error('invalid avatar hash');
      return v;
    default:
      throw new Error(`unknown profile field "${field}"`);
  }
}

/** Serialize a typed patch value to its stored string form (JSON for instruments). */
export function serializeProfileValue(field: ProfileField, raw: unknown): string | null {
  if (raw == null) return null;
  if (field === 'instruments') return Array.isArray(raw) ? JSON.stringify(raw.map(String)) : null;
  return String(raw);
}
