// Minimal .xlsx reader for the Gig-sheet import's color fallback. When the
// Google Sheets API isn't available to the service account, Drive can still
// export the spreadsheet as .xlsx (with the plain drive.readonly scope), and
// that file keeps each cell's fill and font colors — which the CSV export
// drops. We only need the first few rows of each tab (the gig titles), their
// text (to find the right tab) and their colors, so this reads exactly that:
// a zip central-directory walk (node:zlib for deflate) and a few regexes over
// the XML Google generates. No dependency, nothing written to disk.

import { inflateRawSync } from 'node:zlib';

import { headerColor, type HeaderColor, type SheetsColor } from '../gig-sheet.js';

/** One tab's first rows: cell text and color family, by 0-based column. */
export interface XlsxTab {
  name: string;
  rows: string[][];
  colors: HeaderColor[][];
}

/** Read the named entries of a zip archive (stored or deflated). */
export function unzip(buf: Uint8Array): Map<string, Buffer> {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: the last "PK\x05\x06" record.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(dataAt, dataAt + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTITIES[e] ?? m)
  );
}

/** "FFFF0000" (ARGB) → a Sheets-style 0–1 color; theme/indexed colors → null. */
function argb(el: string | undefined): SheetsColor | null {
  const m = el ? /rgb="([0-9A-Fa-f]{8})"/.exec(el) : null;
  if (!m) return null;
  const v = parseInt(m[1].slice(2), 16);
  return { red: ((v >> 16) & 255) / 255, green: ((v >> 8) & 255) / 255, blue: (v & 255) / 255 };
}

/** Text of a shared-string / inline-string item, plus its first colored run. */
function stringItem(xml: string): { text: string; color: SheetsColor | null } {
  const text = [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
  let color: SheetsColor | null = null;
  for (const r of xml.matchAll(/<r>([\s\S]*?)<\/r>/g)) {
    const c = argb(/<color\b[^>]*\/>/.exec(r[1])?.[0]);
    if (c && headerColor(null, c)) {
      color = c;
      break;
    }
  }
  return { text, color };
}

/** "BS" → 70 (0-based). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Read every tab's first `maxRows` rows (text and color) from an .xlsx file.
 * A cell's color is its fill if colored, else its font color, else the color
 * of a colored rich-text run.
 */
export function readXlsxTabs(file: Uint8Array, maxRows = 5): XlsxTab[] {
  const z = unzip(file);
  const text = (name: string) => z.get(name)?.toString('utf8') ?? '';

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => stringItem(m[1]));

  const styles = text('xl/styles.xml');
  const section = (tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(styles)?.[1] ?? '';
  const fonts = [...section('fonts').matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) =>
    argb(/<color\b[^>]*\/>/.exec(m[1] ?? '')?.[0])
  );
  const fills = [...section('fills').matchAll(/<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g)].map((m) =>
    /patternType="solid"/.test(m[1] ?? '') ? argb(/<fgColor\b[^>]*\/>/.exec(m[1] ?? '')?.[0]) : null
  );
  const xfs = [...section('cellXfs').matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => ({
    font: Number(/fontId="(\d+)"/.exec(m[1])?.[1] ?? 0),
    fill: Number(/fillId="(\d+)"/.exec(m[1])?.[1] ?? 0),
  }));

  // Tab names → worksheet files, via the workbook relationships.
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])?.[1] ?? '',
      (/Target="([^"]+)"/.exec(m[0])?.[1] ?? '').replace(/^\/?(xl\/)?/, 'xl/'),
    ])
  );
  const tabs: XlsxTab[] = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '');
    const sheet = target ? text(target) : '';
    const rows: string[][] = [];
    const colors: HeaderColor[][] = [];
    for (const row of sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(row[1]) - 1;
      if (r >= maxRows) break;
      rows[r] = [];
      colors[r] = [];
      for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        if (!ref) continue;
        const col = columnIndex(ref);
        const xf = xfs[Number(/\bs="(\d+)"/.exec(c[1])?.[1] ?? 0)] ?? { font: 0, fill: 0 };
        const type = /\bt="(\w+)"/.exec(c[1])?.[1];
        const body = c[2] ?? '';
        let value = '';
        let runColor: SheetsColor | null = null;
        if (type === 's') {
          const item = shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? -1)];
          value = item?.text ?? '';
          runColor = item?.color ?? null;
        } else if (type === 'inlineStr') {
          const item = stringItem(body);
          value = item.text;
          runColor = item.color;
        } else {
          value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        }
        rows[r][col] = value;
        colors[r][col] = headerColor(fills[xf.fill], fonts[xf.font]) ?? headerColor(null, runColor);
      }
    }
    // Fill sparse arrays so callers can index safely.
    for (let r = 0; r < rows.length; r++) {
      rows[r] = Array.from(rows[r] ?? [], (v) => v ?? '');
      colors[r] = Array.from(colors[r] ?? [], (v) => v ?? null);
    }
    tabs.push({ name, rows, colors });
  }
  return tabs;
}

/**
 * The tab whose top rows best match a grid read another way (the CSV export of
 * the right tab), by counting identical non-empty cells. Null when nothing
 * matches — colors are then simply unavailable.
 */
export function matchTab(tabs: XlsxTab[], grid: string[][], title?: string): XlsxTab | null {
  if (title) {
    const byName = tabs.find((t) => t.name.trim().toLowerCase() === title.toLowerCase());
    if (byName) return byName;
  }
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  let best: XlsxTab | null = null;
  let bestScore = 0;
  for (const t of tabs) {
    let score = 0;
    t.rows.forEach((row, r) =>
      row.forEach((v, c) => {
        if (norm(v) && norm(v) === norm(grid[r]?.[c] ?? '')) score += 1;
      })
    );
    if (score > bestScore) [best, bestScore] = [t, score];
  }
  return best;
}
