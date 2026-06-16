// Physical file inventory for the Library Info "Files" tab. Unlike the catalog
// (which collapses identical content to one canonical copy and hides the rest),
// this lists EVERY scanned file by its original Drive location, annotating each as
// the "Primary" (the canonical copy the library uses for its content) or pointing
// at where the primary lives. So a duplicate is never silently invisible.

import { readFileSync } from 'node:fs';

import { loadConfig } from '../../sync/config.js';
import { sourcePriority, canonicalByContent, liveAssets } from '../../sync/catalog.js';

export interface InvFile {
  driveFileId: string;
  name: string;
  sha256: string | null;
  assetType: string | null;
  isPrimary: boolean;
  /** Where the primary copy lives (null when this row IS the primary). */
  primary: { source: string | null; folder: string | null; name: string | null } | null;
}
export interface InvFolder {
  folder: string;
  files: InvFile[];
  dupCount: number;
}
export interface InvSource {
  source: string;
  folders: InvFolder[];
}
export interface Inventory {
  sources: InvSource[];
  totals: { files: number; primaries: number; duplicates: number };
}

const EMPTY: Inventory = { sources: [], totals: { files: 0, primaries: 0, duplicates: 0 } };

export function fileInventory(): Inventory {
  const cfg = loadConfig();
  let manifest: { files?: Record<string, Record<string, string>> };
  try {
    manifest = JSON.parse(readFileSync(cfg.manifestPath, 'utf8'));
  } catch {
    return EMPTY; // no manifest yet
  }

  const labels = ((cfg.sources as Array<{ label: string }>) || []).map((s) => s.label).filter(Boolean);
  const pri = sourcePriority(labels, manifest);
  const { canonical } = canonicalByContent(manifest, pri);
  const keyOf = (e: Record<string, string>) => e.sha256 || `id:${e.driveFileId}`;

  const sources = new Map<string, Map<string, InvFile[]>>();
  let primaries = 0;
  let duplicates = 0;

  for (const e of liveAssets(manifest) as Array<Record<string, string>>) {
    const primaryEntry = canonical.get(keyOf(e)) as Record<string, string> | undefined;
    const isPrimary = !primaryEntry || primaryEntry.driveFileId === e.driveFileId;
    if (isPrimary) primaries += 1;
    else duplicates += 1;

    const rec: InvFile = {
      driveFileId: e.driveFileId,
      name: e.originalName ?? e.driveFileId, // the true Drive name (incl. "Copy of") — this is a faithful inventory
      sha256: e.sha256 ?? null,
      assetType: e.assetType ?? null,
      isPrimary,
      primary: isPrimary
        ? null
        : {
            source: primaryEntry!.sourceFolderLabel ?? null,
            folder: primaryEntry!.originalFolder ?? null,
            name: primaryEntry!.originalName ?? null,
          },
    };

    const src = e.sourceFolderLabel ?? '(unknown source)';
    const fol = e.originalFolder ?? '(source root)';
    if (!sources.has(src)) sources.set(src, new Map());
    const folders = sources.get(src)!;
    if (!folders.has(fol)) folders.set(fol, []);
    folders.get(fol)!.push(rec);
  }

  const rank = (label: string) => (pri.has(label) ? pri.get(label)! : Number.MAX_SAFE_INTEGER);
  const out: InvSource[] = [...sources.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([source, folders]) => ({
      source,
      folders: [...folders.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([folder, files]) => ({
          folder,
          files: files.sort((x, y) => x.name.localeCompare(y.name)),
          dupCount: files.filter((f) => !f.isPrimary).length,
        })),
    }));

  return { sources: out, totals: { files: primaries + duplicates, primaries, duplicates } };
}
