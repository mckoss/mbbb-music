import type { CatalogPart } from './types';

/** Seconds -> "M:SS". */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const KEY_LABELS: Record<string, string> = {
  bflat: 'B♭',
  eflat: 'E♭',
  aflat: 'A♭',
  fsharp: 'F♯',
  f: 'F',
  c: 'C',
};

/** A musical-key slug -> a display label with accidentals. */
export function keyLabel(key: string | null): string {
  if (!key) return '';
  return KEY_LABELS[key] ?? key.toUpperCase();
}

/** e.g. "Trumpet (B♭)"; no suffix when key is null/empty. */
export function instrumentDisplay(label: string, key: string | null): string {
  const k = keyLabel(key);
  return k ? `${label} (${k})` : label;
}

/**
 * The part-number designation for display: "2", or a combined "1 & 2" / "1, 2 & 3"
 * for a chart covering several parts. Empty when the part carries no number.
 */
export function partNumberText(part: CatalogPart): string {
  const nums = part.partNumbers?.length ? part.partNumbers : part.partNumber != null ? [part.partNumber] : [];
  if (nums.length === 0) return '';
  if (nums.length === 1) return String(nums[0]);
  return `${nums.slice(0, -1).join(', ')} & ${nums[nums.length - 1]}`;
}

/** e.g. "Trumpet (B♭) 2" or "Trumpet (B♭) 1 & 2" using instrument + key + part(s). */
export function partLabel(part: CatalogPart): string {
  const base = instrumentDisplay(part.instrument ?? part.instrumentSlug, part.key);
  const pt = partNumberText(part);
  return pt ? `${base} ${pt}` : base;
}

/** The print format as a clean word, used to tell two otherwise-identical parts
 * (e.g. a generated Letter + Lyre pair) apart in a picker. */
function formatTag(part: CatalogPart): string {
  return part.format === 'lyre' ? 'Lyre' : 'Letter';
}

/**
 * A short tag distinguishing one variant of an otherwise identically-labelled
 * part — its own filename (minus Drive's "Copy of" and the extension), falling
 * back to the source archive. The print-format token ("letter"/"lyre") is dropped
 * because it's shown separately as a clean format word (see {@link partOptionLabel}).
 * Used only to break ties.
 */
function variantTag(part: CatalogPart): string {
  const name = part.originalName ? stripCopyOf(part.originalName) : '';
  const cleaned = name
    .replace(/\.[a-z0-9]+$/i, '') // drop extension
    .replace(/[-_\s]*\b(?:letter|lyre)\b/gi, '') // drop the print-format token
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || part.source || '';
}

/**
 * A picker label that is unique within a set of sibling parts. Normally just
 * {@link partLabel}, but when several parts share the same base label — e.g. two
 * different "Trumpet (B♭)" arrangements that carry no part number — it appends a
 * filename-derived tag so each option is distinguishable (and selectable). Without
 * this, identical labels make the variants impossible to tell apart or address.
 */
export function partOptionLabel(part: CatalogPart, siblings: CatalogPart[]): string {
  const base = partLabel(part);
  const collides = siblings.some((p) => p.sha256 !== part.sha256 && partLabel(p) === base);
  if (!collides) return base;
  // When the colliding parts differ only in print format (a generated Letter +
  // Lyre pair), disambiguate by that clean format word rather than the filename.
  const fmt = `${base} — ${formatTag(part)}`;
  const fmtCollides = siblings.some((p) => p.sha256 !== part.sha256 && `${partLabel(p)} — ${formatTag(p)}` === fmt);
  if (!fmtCollides) return fmt;
  const tag = variantTag(part);
  return tag ? `${base} — ${tag}` : base;
}

/** Minimal base for {@link partShortLabel}: just the part (with key only when
 * there's no part number), dropping the instrument name. */
function partShortBase(part: CatalogPart): string {
  const pt = partNumberText(part);
  if (pt) return `Part ${pt}`;
  const k = keyLabel(part.key);
  return k ? `Part (${k})` : 'Part';
}

/**
 * A compact part label for contexts where the instrument is already fixed (the
 * practice bar) — "Part 1", "Part 2" — so the picker stays narrow. Disambiguates
 * with a variant tag only when two siblings would otherwise collide.
 */
export function partShortLabel(part: CatalogPart, siblings: CatalogPart[]): string {
  const base = partShortBase(part);
  const collides = siblings.some((p) => p.sha256 !== part.sha256 && partShortBase(p) === base);
  if (!collides) return base;
  // Prefer the clean print-format word for a Letter/Lyre pair (see partOptionLabel).
  const fmt = `${base} — ${formatTag(part)}`;
  const fmtCollides = siblings.some((p) => p.sha256 !== part.sha256 && `${partShortBase(p)} — ${formatTag(p)}` === fmt);
  if (!fmtCollides) return fmt;
  const tag = variantTag(part);
  return tag ? `${base} — ${tag}` : base;
}

/** Strip Drive's "Copy of " prefix (possibly repeated) from a filename. */
export function stripCopyOf(name: string): string {
  return name.replace(/^(?:copy of\s+)+/i, '');
}

/**
 * A human label for an audio recording, derived from its filename, so multiple
 * recordings (full band, drums only, an isolated instrument, …) are
 * distinguishable. Drops the extension and any "Copy of" prefix, then keeps just
 * the instrument — the segment after the last "-" (so the song/arrangement
 * prefix falls away): "Copy of Bad_Guy_Sound_Machine-Alto_Sax.mp3" → "Alto Sax".
 * A file with no instrument segment is the "Full recording".
 *
 * The app-generated full-band mix is labeled "MuseScore Audio" regardless of its
 * filename (set `museScore` on the asset — see catalog.js `isMuseScoreAudio`).
 */
export function audioLabel(originalName: string | null, museScore = false): string {
  if (museScore) return 'MuseScore Audio';
  if (!originalName) return 'Full recording';
  let s = stripCopyOf(originalName.replace(/\.[^.]+$/, '').trim()); // drop extension + "Copy of"
  const dash = s.lastIndexOf('-');
  s = dash >= 0 ? s.slice(dash + 1) : ''; // instrument is after the last dash
  s = s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || 'Full recording';
}
