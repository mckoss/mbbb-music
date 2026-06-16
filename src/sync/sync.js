// Core, reusable Drive asset sync. Pure orchestration: it depends on an
// injected DriveClient (real or fixture), a config, and an optional clock/logger
// so it is equally callable from the CLI (bin/sync.js) and a future Express
// admin route. No process.exit, no console coupling, no credential handling.
//
// Storage is content-addressable: every blob lives at data/cas/<sha256> and the
// manifest maps each Drive file to its hash plus provenance and catalog
// metadata. De-duplication is therefore intrinsic — identical bytes share one
// blob — and the cache persists, so rebuilding the manifest never re-downloads a
// file whose content is already in the store (true also for future sources like
// "generated from MuseScore master").

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { classifyDriveFile } from './classify.js';
import { detectAssetMetadata } from './metadata.js';
import { loadManifest, saveManifest, diffManifest, findDuplicates } from './manifest.js';
import { originsDirFor, recordOrigin, buildOriginRecord } from './origins.js';

const noopLogger = { info() {}, warn() {}, error() {} };

// Song bucket for assets not inside a song folder (e.g. files at a source root).
const MISC_SONG = 'Misc';

/**
 * Run an incremental, content-addressable Drive asset sync.
 *
 * @param {Object} params
 * @param {{ listFiles: Function, downloadFile: Function }} params.driveClient
 * @param {import('./config.js').SyncConfig} params.config
 * @param {boolean} [params.dryRun]  Plan only; do not fetch blobs or write manifest.
 * @param {() => Date} [params.now]  Clock injection for deterministic tests.
 * @param {{info:Function,warn:Function,error:Function}} [params.logger]
 * @returns {Promise<object>} A structured report (also suitable as a JSON response).
 */
export async function runSync({ driveClient, config, dryRun = false, now = () => new Date(), logger = noopLogger }) {
  if (!config?.sources?.length) {
    throw new Error('No Drive source folders configured. Add "sources" to config.json or pass sources.');
  }

  const timestamp = now().toISOString();
  const manifest = await loadManifest(config.manifestPath);
  const casDir = resolve(config.dataDir, 'cas');
  const originsDir = originsDirFor(casDir);

  // 1. List + classify across all configured source folders. One shared
  // visited-folder set spans every source, so a folder reached again through a
  // shortcut from a later source (e.g. an index folder linking to the real song
  // folders) is walked only once for the whole run, not re-scanned per source.
  const current = [];
  const warnings = [];
  const visited = new Set();
  for (const source of config.sources) {
    logger.info(`Listing Drive folder: ${source.label} (${source.id})`);
    // If this source's own root was already walked via a higher-priority source
    // (an index/shortcut that linked here), its 0-file result is expected dedup,
    // not an access problem — don't mistake it for an unshared folder below.
    const rootAlreadyCovered = visited.has(source.id);
    const files = await driveClient.listFiles(source.id, { visited });
    // Drive returns an *empty* listing — not an error — for a parent the caller
    // can't see, so an unshared/mistyped source folder otherwise syncs nothing
    // silently. Surface it loudly with an actionable fix.
    if (files.length === 0 && rootAlreadyCovered) {
      logger.info(
        `Source folder "${source.label}" (${source.id}) was already covered by a ` +
          `higher-priority source (reached via a shortcut); nothing new to add.`,
      );
    } else if (files.length === 0) {
      const sa = config.google?.serviceAccount?.client_email;
      const message =
        `Source folder "${source.label}" (${source.id}) returned no files. Drive returns an ` +
        `empty listing — not an error — for a folder the sync can't access, so this almost ` +
        `always means the folder isn't shared (rather than truly empty). In Drive, open the ` +
        `folder → Share → General access → "Anyone with the link" (Viewer)` +
        `${sa ? `, or share it directly with the service account ${sa}` : ''}, then re-sync.`;
      warnings.push({ source: source.label, sourceId: source.id, reason: 'empty-or-unshared', message });
      logger.warn(message);
    }
    for (const file of files) {
      const classification = classifyDriveFile(file);
      current.push({ file: { ...file, sourceFolderId: source.id, sourceFolderLabel: source.label }, classification });
    }
  }

  // A single Drive file can be reached from more than one source — most commonly
  // its real home folder plus a shortcut to it from another source. The manifest
  // is keyed by file id, so without deduping here the file would be processed
  // once per source and the LAST source walked would silently overwrite its
  // provenance (sourceFolderLabel/originalFolder). Keep one entry per id,
  // attributed to the highest-priority source — the earliest in config.sources,
  // which is the listing order above — so a real folder always wins over a
  // shortcut from a lower-priority source.
  const deduped = [];
  const seenIds = new Set();
  let crossSourceDuplicates = 0;
  for (const item of current) {
    const id = item.file.id;
    if (seenIds.has(id)) {
      crossSourceDuplicates += 1;
      continue;
    }
    seenIds.add(id);
    deduped.push(item);
  }
  if (crossSourceDuplicates > 0) {
    logger.info(
      `${crossSourceDuplicates} file(s) were reachable from more than one source (e.g. via ` +
        `shortcuts); each is attributed to its highest-priority source.`,
    );
  }

  // 2. Diff against the manifest.
  const { entries, counts } = diffManifest(manifest, deduped.map(({ file, classification }) => ({ file, classification })));

  const actions = { downloaded: [], cached: [], ignored: [], unreachable: [], deleted: [], failed: [] };

  // 3. Build the complete manifest up front. Because the SHA-256 IS the storage
  // location, every entry is fully known before any bytes are fetched, so the
  // manifest can be written first. An asset whose blob is already in data/cas/
  // (from this run, a previous run, or a duplicate elsewhere) is recorded synced
  // with no download; the rest are queued.
  const pending = [];
  for (const entry of entries) {
    if (entry.status === 'ignored') {
      manifest.files[entry.id] = buildIgnoredEntry(entry, timestamp);
      actions.ignored.push({ id: entry.id, name: entry.file.name, reason: entry.classification.ignoreReason });
      continue;
    }
    if (entry.status === 'unreachable') {
      // An unreadable shortcut: record its classified metadata (no content) so the
      // health view can flag the permission gap. Never queued for download.
      const { file } = entry;
      const meta = detectAssetMetadata({ originalName: file.name, songTitle: file.folderName || MISC_SONG });
      manifest.files[entry.id] = buildUnreachableEntry(entry, meta, timestamp);
      actions.unreachable.push({ id: entry.id, name: file.name });
      continue;
    }
    if (entry.status === 'deleted') {
      // Archive: mark deleted but never remove the cached blob (it may be shared).
      manifest.files[entry.id] = compact({ ...entry.prev, status: 'deleted', syncedAt: timestamp });
      actions.deleted.push({ id: entry.id, name: entry.prev?.originalName });
      continue;
    }

    // new | changed | unchanged asset.
    const { file, classification } = entry;
    // A file inside a song folder is attributed to that song; one sitting at a
    // source root (no song folder) isn't tied to a song, so it lands in a shared
    // "Misc" bucket rather than being mislabeled with the source name.
    const songTitle = file.folderName || MISC_SONG;
    const meta = detectAssetMetadata({ originalName: file.name, songTitle });

    // Prefer the hash Drive reports. Drive omits sha256Checksum for some files
    // (e.g. "Make a copy" duplicates); when it does and the diff judged the file
    // unchanged (by modifiedTime/version — see manifest.isChanged), reuse the
    // hash recorded last time so its blob is recognized in the store instead of
    // being needlessly re-downloaded.
    let sha = file.sha256Checksum || null;
    if (!sha && entry.status === 'unchanged' && entry.prev?.sha256) {
      sha = entry.prev.sha256;
    }
    const record = buildAssetEntry(entry, meta, classification, sha, timestamp);

    if (sha && existsSync(resolve(casDir, sha))) {
      manifest.files[entry.id] = { ...record, status: 'synced' };
      actions.cached.push({ id: entry.id, sha256: sha });
    } else {
      manifest.files[entry.id] = { ...record, status: 'pending' };
      pending.push(entry);
    }
  }

  manifest.generatedAt = timestamp;
  const persist = async () => {
    if (!dryRun) await saveManifest(config.manifestPath, manifest);
  };
  await persist(); // write the full manifest BEFORE fetching any blob

  // 4. Fetch the missing blobs. Each unique SHA is downloaded once; a blob
  // already on disk (this run or earlier) is never re-fetched. The store and the
  // manifest are persisted after every write, so a stop loses no progress.
  if (!dryRun) {
    const fetched = new Set(); // SHAs written during this run (intra-run dedup)
    for (const entry of pending) {
      const knownSha = entry.file.sha256Checksum || null;
      try {
        if (knownSha && (fetched.has(knownSha) || existsSync(resolve(casDir, knownSha)))) {
          // Another entry already supplied this content during this run.
          manifest.files[entry.id] = { ...manifest.files[entry.id], status: 'synced' };
          actions.cached.push({ id: entry.id, sha256: knownSha });
          continue;
        }

        const bytes = await driveClient.downloadFile(entry.id, entry.classification.download);
        // Trust Drive's checksum as the key when present; otherwise hash the
        // bytes. Native files exported to PDF have no Drive checksum, so the CAS
        // key is always the SHA-256 of the exported bytes computed here.
        const sha = knownSha || createHash('sha256').update(bytes).digest('hex');
        const blobPath = resolve(casDir, sha);
        const newBlob = !existsSync(blobPath);
        if (newBlob) {
          await mkdir(casDir, { recursive: true });
          await writeFile(blobPath, bytes);
        }
        fetched.add(sha);
        manifest.files[entry.id] = {
          ...manifest.files[entry.id],
          sha256: sha,
          byteLength: bytes.length,
          status: 'synced',
        };
        actions.downloaded.push({ id: entry.id, sha256: sha, newBlob });
        // The blob may already exist (e.g. Drive gave no checksum up front, so we
        // had to fetch to learn the hash) — say so rather than claiming a write.
        logger.info(
          `${newBlob ? 'Stored' : 'Fetched (already in store)'} cas/${sha.slice(0, 12)}… (${entry.file.name})`,
        );
        await persist();
      } catch (err) {
        manifest.files[entry.id] = { ...manifest.files[entry.id], status: 'error', error: String(err?.message || err) };
        actions.failed.push({ id: entry.id, name: entry.file.name, error: String(err?.message || err) });
        logger.error(`Failed to download ${entry.file.name}: ${err?.message || err}`);
        await persist();
      }
    }
  }

  await persist(); // final write captures any trailing entries

  // Reconcile per-blob provenance for every asset whose bytes are now in the store
  // (freshly downloaded or already cached). recordOrigin is write-once for a known
  // origin, so this is cheap on a steady-state re-sync; its real job is to (a) seed
  // a sidecar the first time a blob is stored, and (b) UPGRADE a blob previously
  // recorded as "unknown" (an orphan) the moment a real Drive file matches it.
  if (!dryRun) {
    const storedIds = new Set([...actions.downloaded, ...actions.cached].map((a) => a.id));
    for (const id of storedIds) {
      const e = manifest.files[id];
      if (!e?.sha256) continue;
      await recordOrigin(originsDir, e.sha256, buildOriginRecord(e, { createdAt: timestamp, provenance: 'sync' }));
    }
  }

  // Report files whose content is duplicated (same SHA-256 across Drive
  // locations). Informational only — they already share one blob in the store.
  const duplicates = findDuplicates(manifest);

  return {
    timestamp,
    dryRun,
    dataDir: config.dataDir,
    casDir,
    manifestPath: config.manifestPath,
    sources: config.sources,
    counts,
    actions,
    duplicates,
    warnings,
    summary: {
      seen: deduped.length,
      crossSourceDuplicates,
      new: counts.new || 0,
      changed: counts.changed || 0,
      unchanged: counts.unchanged || 0,
      deleted: counts.deleted || 0,
      ignored: counts.ignored || 0,
      unreachable: actions.unreachable.length,
      downloaded: actions.downloaded.length,
      cached: actions.cached.length,
      pending: dryRun ? pending.length : 0,
      failed: actions.failed.length,
      duplicateGroups: duplicates.length,
      duplicateFiles: duplicates.reduce((n, g) => n + g.count, 0),
      warnings: warnings.length,
    },
  };
}

/** Drop keys whose value is null or undefined, so manifest entries carry no null props. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null) out[k] = v;
  }
  return out;
}

function buildAssetEntry(entry, meta, classification, sha, timestamp) {
  const { file } = entry;
  return compact({
    driveFileId: entry.id,
    sourceFolderId: file.sourceFolderId,
    sourceFolderLabel: file.sourceFolderLabel,
    originalName: file.name,
    originalFolder: file.folderName,
    songFolderId: file.folderId,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    version: file.version,
    sha256: sha,
    size: file.size,
    assetType: classification.assetType,
    songTitle: meta.songTitle,
    songTitleSlug: meta.songTitleSlug,
    instrument: meta.instrument,
    instrumentSlug: meta.instrumentSlug,
    key: meta.key,
    partNumber: meta.partNumber,
    syncedAt: timestamp,
  });
}

function buildUnreachableEntry(entry, meta, timestamp) {
  const { file, classification } = entry;
  // A shortcut whose target can't be read: no sha256/size (no content), but the
  // classified metadata + the target id (for a "request access" link) are kept.
  return compact({
    driveFileId: entry.id,
    sourceFolderId: file.sourceFolderId,
    sourceFolderLabel: file.sourceFolderLabel,
    originalName: file.name,
    originalFolder: file.folderName,
    songFolderId: file.folderId,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    version: file.version,
    assetType: classification?.assetType,
    songTitle: meta.songTitle,
    songTitleSlug: meta.songTitleSlug,
    instrument: meta.instrument,
    instrumentSlug: meta.instrumentSlug,
    key: meta.key,
    partNumber: meta.partNumber,
    shortcutTarget: file.shortcutTarget,
    status: 'unreachable',
    syncedAt: timestamp,
  });
}

function buildIgnoredEntry(entry, timestamp) {
  const { file } = entry;
  // Ignored entries encode the reason in the status itself, e.g.
  // "ignored|google-drive-shortcut". Recorded for provenance; never fetched.
  return compact({
    driveFileId: entry.id,
    sourceFolderId: file.sourceFolderId,
    sourceFolderLabel: file.sourceFolderLabel,
    originalName: file.name,
    originalFolder: file.folderName,
    songFolderId: file.folderId,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    version: file.version,
    sha256: file.sha256Checksum,
    size: file.size,
    status: `ignored|${entry.classification?.ignoreReason ?? 'unknown'}`,
    syncedAt: timestamp,
  });
}
