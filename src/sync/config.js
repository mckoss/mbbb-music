// Sync configuration. The two Google Drive source folders are configured via
// environment variables (never hard-coded, never committed). Real folder ids
// and credentials live in a local .env / Railway env, not in this public repo.

import { resolve } from 'node:path';

/**
 * @typedef {Object} SourceFolder
 * @property {string} id     Drive folder id.
 * @property {string} label  Human-readable label (also used as provenance).
 */

/**
 * @typedef {Object} SyncConfig
 * @property {string} dataDir          Absolute path to the gitignored data/ dir.
 * @property {string} manifestPath     Absolute path to data/manifest.json.
 * @property {SourceFolder[]} sources  Configured Drive source folders.
 */

/**
 * Build a SyncConfig from environment variables and overrides.
 *
 * Recognized env vars:
 *   MBBB_DATA_DIR              data dir (default: <cwd>/data)
 *   MBBB_DRIVE_FOLDER_1_ID     first source folder id
 *   MBBB_DRIVE_FOLDER_1_LABEL  optional label for folder 1
 *   MBBB_DRIVE_FOLDER_2_ID     second source folder id
 *   MBBB_DRIVE_FOLDER_2_LABEL  optional label for folder 2
 *
 * @param {Object} [overrides]
 * @param {string} [overrides.dataDir]
 * @param {SourceFolder[]} [overrides.sources]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SyncConfig}
 */
export function loadConfig(overrides = {}, env = process.env) {
  const dataDir = resolve(overrides.dataDir || env.MBBB_DATA_DIR || 'data');

  let sources = overrides.sources;
  if (!sources) {
    sources = [];
    for (const n of [1, 2]) {
      const id = env[`MBBB_DRIVE_FOLDER_${n}_ID`];
      if (id) {
        sources.push({
          id,
          label: env[`MBBB_DRIVE_FOLDER_${n}_LABEL`] || `drive-folder-${n}`,
        });
      }
    }
  }

  return {
    dataDir,
    manifestPath: resolve(dataDir, 'manifest.json'),
    sources,
  };
}
