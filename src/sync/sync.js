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

const noopLogger = { info() {}, warn() {}, error() {} };

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

  // 1. List + classify across all configured source folders.
  const current = [];
  for (const source of config.sources) {
    logger.info(`Listing Drive folder: ${source.label} (${source.id})`);
    const files = await driveClient.listFiles(source.id);
    for (const file of files) {
      const classification = classifyDriveFile(file);
      current.push({ file: { ...file, sourceFolderId: source.id, sourceFolderLabel: source.label }, classification });
    }
  }

  // 2. Diff against the manifest.
  const { entries, counts } = diffManifest(manifest, current.map(({ file, classification }) => ({ file, classification })));

  const actions = { downloaded: [], cached: [], ignored: [], deleted: [], failed: [] };

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
    if (entry.status === 'deleted') {
      // Archive: mark deleted but never remove the cached blob (it may be shared).
      manifest.files[entry.id] = { ...entry.prev, status: 'deleted', syncedAt: timestamp };
      actions.deleted.push({ id: entry.id, name: entry.prev?.originalName });
      continue;
    }

    // new | changed | unchanged asset.
    const { file, classification } = entry;
    const songTitle = file.folderName || file.sourceFolderLabel || 'unknown';
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

        const bytes = await driveClient.downloadFile(entry.id);
        // Trust Drive's checksum as the key when present; otherwise hash the bytes.
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
    summary: {
      seen: current.length,
      new: counts.new || 0,
      changed: counts.changed || 0,
      unchanged: counts.unchanged || 0,
      deleted: counts.deleted || 0,
      ignored: counts.ignored || 0,
      downloaded: actions.downloaded.length,
      cached: actions.cached.length,
      pending: dryRun ? pending.length : 0,
      failed: actions.failed.length,
      duplicateGroups: duplicates.length,
      duplicateFiles: duplicates.reduce((n, g) => n + g.count, 0),
    },
  };
}

function buildAssetEntry(entry, meta, classification, sha, timestamp) {
  const { file } = entry;
  return {
    driveFileId: entry.id,
    sourceFolderId: file.sourceFolderId,
    sourceFolderLabel: file.sourceFolderLabel,
    originalName: file.name,
    originalFolder: file.folderName ?? null,
    mimeType: file.mimeType ?? null,
    modifiedTime: file.modifiedTime ?? null,
    version: file.version ?? null,
    sha256: sha,
    size: file.size ?? null,
    assetType: classification.assetType,
    songTitle: meta.songTitle,
    instrument: meta.instrument,
    instrumentSlug: meta.instrumentSlug,
    key: meta.key,
    partNumber: meta.partNumber,
    ignored: false,
    ignoreReason: null,
    syncedAt: timestamp,
  };
}

function buildIgnoredEntry(entry, timestamp) {
  const { file } = entry;
  return {
    driveFileId: entry.id,
    sourceFolderId: file.sourceFolderId ?? null,
    sourceFolderLabel: file.sourceFolderLabel ?? null,
    originalName: file.name ?? null,
    originalFolder: file.folderName ?? null,
    mimeType: file.mimeType ?? null,
    modifiedTime: file.modifiedTime ?? null,
    version: file.version ?? null,
    sha256: file.sha256Checksum ?? null,
    size: file.size ?? null,
    assetType: null,
    ignored: true,
    ignoreReason: entry.classification?.ignoreReason ?? null,
    status: 'ignored',
    syncedAt: timestamp,
  };
}
