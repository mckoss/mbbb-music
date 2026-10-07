// One Drive file, end to end: where it sits in Drive, what the sync recorded,
// what the filename was read as, any human corrections, and how the library
// ends up handling it (song / instrument / part / default vs alternate, a
// duplicate, masked, hidden, an Extra File, or never imported and why). Admins
// also see every sync that changed it. Viewable by any approved user, like the
// rest of Library Info (the hook already gates that).
import { error } from '@sveltejs/kit';

import { loadConfig } from '../../../../sync/config.js';
import { formatOf } from '../../../../sync/catalog.js';
import { describeHandling } from '../../../../sync/file-handling.js';
import { fileHistory, historyDirFor } from '../../../../sync/history.js';
import { getCatalog, getManifests, type ManifestEntry } from '$lib/server/library';
import { editsForTarget } from '$lib/server/corrections';
import { formatPacificDateTime } from '$lib/time';
import { keyLabel } from '$lib/format';

const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** What the app reads a manifest entry as, for the "Read as" table. */
function readAs(e: ManifestEntry) {
  const nums: number[] = e.partNumbers?.length ? e.partNumbers : e.partNumber != null ? [e.partNumber] : [];
  return {
    song: e.songTitle ?? null,
    instrument: e.instrument ?? null,
    key: e.key ? keyLabel(e.key) : null,
    part: nums.length ? nums.join(' & ') : null,
    role: e.role ?? null,
    clef: e.clef ?? null,
    type: e.assetType ?? null,
    format: e.assetType === 'pdf' && e.sha256 ? formatOf(e) : null,
    hidden: e.hidden ? 'whole file' : e.hiddenInstruments?.length ? e.hiddenInstruments.join(', ') : null,
  };
}

/** Every place the file appears in Drive (older manifests: just its folder). */
function locations(e: ManifestEntry) {
  const app = Array.isArray(e.appearances) && e.appearances.length ? e.appearances : null;
  if (app) {
    return app.map((a: { source: string | null; path: string[]; name?: string | null; viaShortcut?: boolean }) => ({
      source: a.source ?? null,
      path: a.path ?? [],
      name: a.name ?? e.originalName ?? null,
      viaShortcut: !!a.viaShortcut,
    }));
  }
  return [
    {
      source: e.sourceFolderLabel ?? null,
      path: e.originalFolder ? [e.originalFolder] : [],
      name: e.originalName ?? null,
      viaShortcut: false,
    },
  ];
}

export async function load({ params, locals }) {
  const id = params.id;
  if (!DRIVE_ID.test(id)) throw error(400, 'Not a Drive file id');
  const { raw, corrected } = getManifests();
  const rawEntry = raw.files[id];
  if (!rawEntry) throw error(404, 'This file is not in the synced manifest. It may be newer than the last sync.');
  const entry = corrected.files[id] ?? rawEntry;
  const isAdmin = locals.user?.role === 'admin';

  const edits = [
    ...editsForTarget('file', id).map((r) => ({ ...r, scopeLabel: 'This file' })),
    ...(rawEntry.songFolderId
      ? editsForTarget('folder', rawEntry.songFolderId).map((r) => ({ ...r, scopeLabel: 'Its folder' }))
      : []),
  ]
    .sort((a, b) => (a.edited_at < b.edited_at ? 1 : -1))
    .map((r) => ({
      id: r.id,
      scope: r.scopeLabel,
      field: r.field,
      value: r.value,
      by: r.edited_by,
      at: formatPacificDateTime(r.edited_at),
      reverted: Boolean(r.deleted_at),
    }));

  const history = isAdmin
    ? (await fileHistory(historyDirFor(loadConfig().dataDir), id)).map((h) => ({
        runId: h.runId,
        when: formatPacificDateTime(h.startedAt),
        change: h.change,
      }))
    : null;

  return {
    id,
    name: rawEntry.originalName ?? id,
    status: rawEntry.status ?? null,
    sha256: rawEntry.status === 'deleted' || String(rawEntry.status ?? '').startsWith('ignored') ? null : (rawEntry.sha256 ?? null),
    assetType: entry.assetType ?? null,
    mimeType: rawEntry.mimeType ?? null,
    size: rawEntry.size != null ? Number(rawEntry.size) : null,
    modified: rawEntry.modifiedTime ? formatPacificDateTime(rawEntry.modifiedTime) : null,
    lastSynced: rawEntry.syncedAt ? formatPacificDateTime(rawEntry.syncedAt) : null,
    driveUrl: `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`,
    folderUrl: rawEntry.songFolderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(rawEntry.songFolderId)}` : null,
    locations: locations(rawEntry),
    detected: readAs(rawEntry),
    effective: readAs(entry),
    edits,
    handling: describeHandling(id, corrected, getCatalog()),
    history,
  };
}
