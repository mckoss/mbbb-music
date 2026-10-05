// Pure parsing for the "Contacts" tab of the band's availability spreadsheet
// (no server imports, so it is unit-testable). One row per band member: name,
// email, phone, instrument, shirt size(s). Header cells are loose ("phone
// number", "shirt size"), and the name and email columns may have no header at
// all, so columns are found by header text first and by content second.
//
// Import evidence only: src/lib/server/contacts-sheet.ts turns these rows into
// app-owned member-profile edits.

import { SHIRT_SIZES, type ShirtSize } from './members.js';

export interface SheetContact {
  name: string;
  email: string | null;
  phone: string | null;
  instrument: string | null;
  shirtSize: ShirtSize | null;
}

type Field = 'name' | 'email' | 'phone' | 'instrument' | 'shirt';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A header cell's field, when its text names one. */
function headerField(text: string): Field | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/second|2nd|alt/.test(t)) return null; // "second shirt size" isn't the shirt size
  if (/e-?mail/.test(t)) return 'email';
  if (/phone|cell|mobile/.test(t)) return 'phone';
  if (/instrument/.test(t)) return 'instrument';
  if (/shirt/.test(t)) return 'shirt';
  if (/name/.test(t)) return 'name';
  return null;
}

/** "L", "large", "2XL", "xx-large", "S/M" → a stored shirt size, else null. */
export function normalizeShirtSize(raw: string | null | undefined): ShirtSize | null {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const map: Record<string, ShirtSize> = {
    s: 'S', small: 'S',
    's/m': 'S/M', 'small/medium': 'S/M', sm: 'S/M',
    m: 'M', med: 'M', medium: 'M',
    l: 'L', lg: 'L', large: 'L',
    xl: 'XL', 'x-large': 'XL', xlarge: 'XL', extralarge: 'XL',
    xxl: 'XXL', '2xl': 'XXL', 'xx-large': 'XXL', xxlarge: 'XXL',
  };
  const size = map[t];
  return size && (SHIRT_SIZES as string[]).includes(size) ? size : null;
}

/**
 * Parse the Contacts grid. The header row is the first row naming a phone,
 * email, instrument or shirt column. Missing name/email columns are inferred:
 * email is the column whose cells look like addresses; name is the first
 * remaining column with text.
 */
export function parseContactsSheet(grid: string[][]): SheetContact[] {
  const headerRow = grid.findIndex((row) => row.filter((c) => headerField(String(c ?? ''))).length >= 2);
  if (headerRow < 0) return [];
  const header = grid[headerRow];
  const body = grid.slice(headerRow + 1).filter((r) => r.some((c) => String(c ?? '').trim()));
  const width = Math.max(header.length, ...body.map((r) => r.length));

  const cols: Partial<Record<Field, number>> = {};
  for (let c = 0; c < width; c++) {
    const f = headerField(String(header[c] ?? ''));
    if (f && cols[f] === undefined) cols[f] = c;
  }
  const used = () => new Set(Object.values(cols));
  if (cols.email === undefined) {
    let best = -1;
    let bestHits = 0;
    for (let c = 0; c < width; c++) {
      if (used().has(c)) continue;
      const hits = body.filter((r) => EMAIL_RE.test(String(r[c] ?? '').trim())).length;
      if (hits > bestHits) [best, bestHits] = [c, hits];
    }
    if (best >= 0) cols.email = best;
  }
  if (cols.name === undefined) {
    for (let c = 0; c < width; c++) {
      if (used().has(c)) continue;
      if (body.some((r) => String(r[c] ?? '').trim())) {
        cols.name = c;
        break;
      }
    }
  }
  if (cols.name === undefined) return [];

  const cell = (row: string[], f: Field) => (cols[f] === undefined ? '' : String(row[cols[f]!] ?? '').trim());
  const out: SheetContact[] = [];
  for (const row of body) {
    const name = cell(row, 'name').replace(/\s+/g, ' ');
    if (!name) continue;
    const email = cell(row, 'email').toLowerCase();
    out.push({
      name,
      email: EMAIL_RE.test(email) ? email : null,
      phone: cell(row, 'phone') || null,
      instrument: cell(row, 'instrument') || null,
      shirtSize: normalizeShirtSize(cell(row, 'shirt')),
    });
  }
  return out;
}
