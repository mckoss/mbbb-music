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

/** e.g. "Trumpet (B♭) 2" using instrument + key + partNumber. */
export function partLabel(part: CatalogPart): string {
  const base = instrumentDisplay(part.instrument ?? part.instrumentSlug, part.key);
  return part.partNumber != null ? `${base} ${part.partNumber}` : base;
}
