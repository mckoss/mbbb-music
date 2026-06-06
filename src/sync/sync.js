// Core, reusable Drive asset sync. Pure orchestration: it depends on an
// injected DriveClient (real or fixture), a config, and an optional clock/logger
// so it is equally callable from the CLI (bin/sync.js) and a future Express
// admin route. No process.exit, no console coupling, no credential handling.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { classifyDriveFile } from './classify.js';
import { parseAsset } from './parse-filename.js';
import { loadManifest, saveManifest, diffManifest, findDuplicates } from './manifest.js';

const noopLogger = { info() {}, warn() {}, error() {} };

/**
 * Run an incremental Drive asset sync.
 *
 * @param {Object} params
 * @param {{ listFiles: Function, downloadFile: Function }} params.driveClient
 * @param {import('./config.js').SyncConfig} params.config
 * @param {boolean} [params.dryRun]  Plan only; do not download or write manifest.
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

  const actions = { downloaded: [], skipped: [], ignored: [], deleted: [], failed: [] };

  for (const entry of entries) {
    if (entry.status === 'ignored') {
      // Record provenance for ignored files too, so refreshes stay stable and
      // an admin can see what was skipped and why.
      manifest.files[entry.id] = buildIgnoredEntry(entry, timestamp);
      actions.ignored.push({ id: entry.id, name: entry.file.name, reason: entry.classification.ignoreReason });
      continue;
    }

    if (entry.status === 'deleted') {
      // Archive: mark deleted but never remove local content.
      manifest.files[entry.id] = { ...entry.prev, status: 'deleted', syncedAt: timestamp };
      actions.deleted.push({ id: entry.id, name: entry.prev?.originalName });
      continue;
    }

    // new | changed | unchanged asset.
    const { file, classification } = entry;
    const songTitle = file.folderName || file.sourceFolderLabel || 'unknown';
    const parsed = parseAsset({
      originalName: file.name,
      songTitle,
      assetType: classification.assetType,
      ext: classification.ext,
    });
    const absLocalPath = resolve(config.dataDir, parsed.localPath);

    const record = buildAssetEntry(entry, parsed, classification, timestamp);

    if (entry.status === 'unchanged' && existsSync(absLocalPath)) {
      manifest.files[entry.id] = { ...record, status: 'unchanged' };
      actions.skipped.push({ id: entry.id, localPath: parsed.localPath, reason: 'unchanged' });
      continue;
    }

    if (dryRun) {
      manifest.files[entry.id] = { ...record, status: entry.status };
      actions.skipped.push({ id: entry.id, localPath: parsed.localPath, reason: `dry-run:${entry.status}` });
      continue;
    }

    try {
      const bytes = await driveClient.downloadFile(entry.id);
      await mkdir(dirname(absLocalPath), { recursive: true });
      await writeFile(absLocalPath, bytes);
      manifest.files[entry.id] = { ...record, status: 'synced', byteLength: bytes.length };
      actions.downloaded.push({ id: entry.id, localPath: parsed.localPath, status: entry.status });
      logger.info(`${entry.status === 'new' ? 'Added' : 'Updated'} ${parsed.localPath}`);
    } catch (err) {
      manifest.files[entry.id] = { ...record, status: 'error', error: String(err?.message || err) };
      actions.failed.push({ id: entry.id, localPath: parsed.localPath, error: String(err?.message || err) });
      logger.error(`Failed to download ${file.name}: ${err?.message || err}`);
    }
  }

  manifest.generatedAt = timestamp;

  if (!dryRun) {
    await saveManifest(config.manifestPath, manifest);
  }

  // Report duplicate content (same SHA-256) across the whole library, regardless
  // of song folder or source. Informational only — nothing is removed.
  const duplicates = findDuplicates(manifest);

  return {
    timestamp,
    dryRun,
    dataDir: config.dataDir,
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
      failed: actions.failed.length,
      duplicateGroups: duplicates.length,
      duplicateFiles: duplicates.reduce((n, g) => n + g.count, 0),
    },
  };
}

function buildAssetEntry(entry, parsed, classification, timestamp) {
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
    sha256Checksum: file.sha256Checksum ?? null,
    size: file.size ?? null,
    assetType: classification.assetType,
    songTitle: parsed.songTitle,
    songSlug: parsed.songSlug,
    instrument: parsed.instrument,
    instrumentSlug: parsed.instrumentSlug,
    key: parsed.key,
    partNumber: parsed.partNumber,
    localPath: parsed.localPath,
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
    sha256Checksum: file.sha256Checksum ?? null,
    size: file.size ?? null,
    assetType: null,
    localPath: null,
    ignored: true,
    ignoreReason: entry.classification?.ignoreReason ?? null,
    status: 'ignored',
    syncedAt: timestamp,
  };
}
