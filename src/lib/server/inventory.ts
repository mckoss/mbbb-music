// Physical file inventory for the Library Info "Files" tab. Unlike the catalog
// (which collapses identical content to one canonical copy and hides the rest),
// this mirrors the original Drive hierarchy: every scanned file, nested under the
// full chain of folders it lives in, at EVERY location it appears — including the
// places it is reached through a shortcut. Each row is annotated as the "Primary"
// (the one physical copy the library uses for its content) or points at where the
// primary lives. So a unique file — or a shortcut to one — is never hidden just
// because a higher-priority copy exists elsewhere.

import { readFileSync } from 'node:fs';

import { loadConfig } from '../../sync/config.js';
import { sourcePriority, canonicalByContent, liveAssets } from '../../sync/catalog.js';

/** One place a file appears in Drive (its real home, or a shortcut to it). */
interface Appearance {
  source: string | null;
  path: string[];
  name?: string | null;
  viaShortcut?: boolean;
}

export interface InvFileRow {
  driveFileId: string;
  /** The name shown at THIS location. */
  name: string;
  sha256: string | null;
  assetType: string | null;
  isPrimary: boolean;
  /** This appearance is reached through a Drive shortcut. */
  viaShortcut: boolean;
  /** Where the primary copy lives (null when this row IS the primary). */
  primary: { source: string | null; path: string[]; name: string | null } | null;
}
/** A folder node in the source tree. `name` is '' for the source root. */
export interface InvNode {
  name: string;
  folders: InvNode[];
  files: InvFileRow[];
}
export interface InvSource {
  source: string;
  root: InvNode;
  fileCount: number;
  dupCount: number;
}
export interface Inventory {
  sources: InvSource[];
  totals: { files: number; primaries: number; duplicates: number };
}

const EMPTY: Inventory = { sources: [], totals: { files: 0, primaries: 0, duplicates: 0 } };

type Entry = Record<string, unknown>;

/**
 * Every place an entry appears in Drive. Prefers the `appearances` the sync now
 * records; falls back to a single appearance synthesized from the flat
 * `originalFolder` for manifests written before appearances existed (so the view
 * still works before the next re-sync, just without deep nesting).
 */
function appearancesOf(e: Entry): Appearance[] {
  const app = e.appearances as Appearance[] | undefined;
  if (Array.isArray(app) && app.length) return app;
  const folder = e.originalFolder as string | undefined;
  return [
    {
      source: (e.sourceFolderLabel as string) ?? null,
      path: folder ? [folder] : [],
      name: (e.originalName as string) ?? null,
      viaShortcut: false,
    },
  ];
}

function emptyNode(name: string): InvNode {
  return { name, folders: [], files: [] };
}

/** Descend (creating folders as needed) to the node at `path` under `root`. */
function nodeAt(root: InvNode, path: string[]): InvNode {
  let node = root;
  for (const seg of path) {
    let child = node.folders.find((f) => f.name === seg);
    if (!child) {
      child = emptyNode(seg);
      node.folders.push(child);
    }
    node = child;
  }
  return node;
}

/** Sort a node's folders then files by name, recursively, and count its rows. */
function finalize(node: InvNode): { files: number; dups: number } {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));
  let files = node.files.length;
  let dups = node.files.filter((f) => !f.isPrimary).length;
  for (const f of node.folders) {
    const c = finalize(f);
    files += c.files;
    dups += c.dups;
  }
  return { files, dups };
}

export function fileInventory(): Inventory {
  const cfg = loadConfig();
  let manifest: { files?: Record<string, Entry> };
  try {
    manifest = JSON.parse(readFileSync(cfg.manifestPath, 'utf8'));
  } catch {
    return EMPTY; // no manifest yet
  }

  const labels = ((cfg.sources as Array<{ label: string }>) || []).map((s) => s.label).filter(Boolean);
  const pri = sourcePriority(labels, manifest);
  const { canonical } = canonicalByContent(manifest, pri);
  const keyOf = (e: Entry) => (e.sha256 as string) || `id:${e.driveFileId as string}`;

  const roots = new Map<string, InvNode>();
  let primaries = 0;
  let duplicates = 0;

  for (const e of liveAssets(manifest) as Entry[]) {
    const canonEntry = (canonical.get(keyOf(e)) as Entry | undefined) ?? e;
    const isCanonicalId = canonEntry.driveFileId === e.driveFileId;
    // The single primary appearance: the highest-priority location of the
    // content-canonical entry.
    const primAp = appearancesOf(canonEntry)[0];
    const primaryLoc = {
      source: primAp.source,
      path: primAp.path,
      name: primAp.name ?? (canonEntry.originalName as string) ?? null,
    };

    appearancesOf(e).forEach((ap, i) => {
      // Exactly one row is the Primary: the canonical id at its first appearance.
      const isPrimary = isCanonicalId && i === 0;
      if (isPrimary) primaries += 1;
      else duplicates += 1;

      const row: InvFileRow = {
        driveFileId: e.driveFileId as string,
        name: ap.name ?? (e.originalName as string) ?? (e.driveFileId as string),
        sha256: (e.sha256 as string) ?? null,
        assetType: (e.assetType as string) ?? null,
        isPrimary,
        viaShortcut: !!ap.viaShortcut,
        primary: isPrimary ? null : primaryLoc,
      };

      const src = ap.source ?? '(unknown source)';
      if (!roots.has(src)) roots.set(src, emptyNode(''));
      nodeAt(roots.get(src)!, ap.path).files.push(row);
    });
  }

  const rank = (label: string) => (pri.has(label) ? pri.get(label)! : Number.MAX_SAFE_INTEGER);
  const sources: InvSource[] = [...roots.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([source, root]) => {
      const { files, dups } = finalize(root);
      return { source, root, fileCount: files, dupCount: dups };
    });

  return { sources, totals: { files: primaries + duplicates, primaries, duplicates } };
}
