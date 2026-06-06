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

  const actions = { downloaded: [], skipped: [], ignored: [], deleted: [], failed: [], duplicates: [] };

  // Pre-pass over the present asset files: build source-prefixed paths, pick one
  // original per unique content (SHA-256), and guarantee every path is unique.
  const assetEntries = entries.filter(
    (e) => e.status === 'new' || e.status === 'changed' || e.status === 'unchanged',
  );
  prepareAssets(assetEntries, logger, config.deprioritize || []);

  // Persist the manifest incrementally so a stopped sync never loses progress:
  // after every download the manifest on disk records exactly what was fetched
  // (with its SHA-256), so a resume skips already-downloaded files. The write is
  // atomic, so an interrupt can't leave a missing or truncated manifest.
  manifest.generatedAt = timestamp;
  const persist = async () => {
    if (!dryRun) await saveManifest(config.manifestPath, manifest);
  };
  await persist(); // ensure a valid manifest exists before the first download

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
    const { file, classification, parsed } = entry;
    const record = buildAssetEntry(entry, parsed, classification, timestamp);

    if (entry.isDuplicate) {
      // Identical content already lives under the original's path. Keep the
      // manifest entry — flagged and redirected — but never download a 2nd copy.
      manifest.files[entry.id] = { ...record, status: 'duplicate' };
      actions.duplicates.push({ id: entry.id, localPath: parsed.localPath, duplicateOf: entry.duplicateOf });
      continue;
    }

    const absLocalPath = resolve(config.dataDir, parsed.localPath);

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
      await persist(); // durably record this download before fetching the next
    } catch (err) {
      manifest.files[entry.id] = { ...record, status: 'error', error: String(err?.message || err) };
      actions.failed.push({ id: entry.id, localPath: parsed.localPath, error: String(err?.message || err) });
      logger.error(`Failed to download ${file.name}: ${err?.message || err}`);
      await persist();
    }
  }

  await persist(); // final write captures any trailing non-download entries

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
      duplicatesSkipped: actions.duplicates.length,
      failed: actions.failed.length,
      duplicateGroups: duplicates.length,
      duplicateFiles: duplicates.reduce((n, g) => n + g.count, 0),
    },
  };
}

/**
 * Prepare the present asset entries for download: build source-prefixed paths,
 * de-duplicate by content, and guarantee unique destination paths.
 *
 * Mutates each entry, adding `parsed`, `isDuplicate`, and `duplicateOf`.
 *
 * @param {object[]} assetEntries
 * @param {object} logger
 * @param {string[]} deprioritize  Folder-name patterns that lose the tie when
 *        choosing the canonical copy of duplicate content (e.g. re-index folders).
 */
function prepareAssets(assetEntries, logger, deprioritize = []) {
  for (const e of assetEntries) {
    const f = e.file;
    const songTitle = f.folderName || f.sourceFolderLabel || 'unknown';
    e.parsed = parseAsset({
      sourceLabel: f.sourceFolderLabel,
      originalName: f.name,
      songTitle,
      assetType: e.classification.assetType,
      ext: e.classification.ext,
    });
    e.sha = f.sha256Checksum || null;
    e.deprioritized = isDeprioritized(e, deprioritize);
  }

  // Content de-duplication: download one copy per unique SHA-256. Within a group
  // the original is the preferred copy — copies in deprioritized folders (e.g.
  // by-instrument re-index folders) lose to a normal copy; ties break by smallest
  // path, then id. The rest are flagged duplicates and redirected to the original.
  // Files lacking a hash are treated as unique (their own id is the key).
  const groups = new Map();
  for (const e of assetEntries) {
    const key = e.sha ? `sha:${e.sha}` : `id:${e.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const group of groups.values()) {
    group.sort(byPreferenceThenPath);
    group.forEach((e, i) => {
      e.isDuplicate = i > 0;
      e.duplicateOf = i > 0 ? group[0].id : null;
      e.originalRef = group[0];
    });
  }

  // Uniqueness guarantee: if two DISTINCT-content originals still resolve to the
  // same path (even after source-prefixing), disambiguate deterministically.
  const owner = new Map();
  for (const e of assetEntries) {
    if (e.isDuplicate) continue;
    let lp = e.parsed.localPath;
    const key = e.sha || e.id;
    if (owner.has(lp) && owner.get(lp) !== key) {
      lp = appendBeforeExt(lp, `-${key.slice(0, 8)}`);
      e.parsed = { ...e.parsed, localPath: lp };
      logger.warn(`Path collision disambiguated -> ${lp}`);
    }
    owner.set(lp, key);
  }

  // Redirect duplicates to their original's (possibly disambiguated) path.
  for (const e of assetEntries) {
    if (e.isDuplicate) e.parsed = { ...e.parsed, localPath: e.originalRef.parsed.localPath };
  }
}

/** Rank a duplicate group's copies: preferred (non-deprioritized) first, then path, then id. */
function byPreferenceThenPath(a, b) {
  if (a.deprioritized !== b.deprioritized) return a.deprioritized ? 1 : -1;
  if (a.parsed.localPath !== b.parsed.localPath) return a.parsed.localPath < b.parsed.localPath ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when an asset's source/song folder matches any deprioritize pattern. */
function isDeprioritized(entry, patterns) {
  if (!patterns.length) return false;
  const hay = `${entry.file.folderName || ''} ${entry.parsed.localPath}`.toLowerCase();
  return patterns.some((p) => hay.includes(p));
}

/** Insert `tag` before a path's file extension (e.g. "a/b.pdf" + "-x" -> "a/b-x.pdf"). */
function appendBeforeExt(p, tag) {
  const slash = p.lastIndexOf('/');
  const dot = p.lastIndexOf('.');
  return dot > slash ? p.slice(0, dot) + tag + p.slice(dot) : p + tag;
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
    isDuplicate: Boolean(entry.isDuplicate),
    duplicateOf: entry.duplicateOf ?? null,
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
