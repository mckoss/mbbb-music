// Sync configuration. Source folders and Google credentials are read from a
// git-ignored config.json in the repo root (never committed). For deployments
// where a file is awkward (Railway, CI), the same JSON can be supplied verbatim
// in the MBBB_CONFIG_JSON environment variable. Real folder ids and credentials
// never live in this public repo. See config.example.json for the shape.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// config.js lives at <repo>/src/sync/config.js, so the repo root is two up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, 'config.json');

/**
 * @typedef {Object} SourceFolder
 * @property {string} id     Drive folder id.
 * @property {string} label  Human-readable label (also used as provenance).
 * @property {boolean} [foldered]  False if this source is NOT organized into
 *        per-song subfolders (its files are grouped by the song embedded in each
 *        filename instead). Defaults to true (folder name = song).
 * @property {boolean} [generated]  True if this source holds app-generated scores
 *        (the MuseScore `build-scores` output, one `<Song>.parts` folder per song).
 *        When a song has generated scores here, they MASK the manually-created
 *        score PDFs synced for that song from other sources.
 */

/**
 * @typedef {Object} GoogleCredentials
 * @property {Object} [serviceAccount]  Inline service-account key JSON (from Google Cloud).
 */

/**
 * @typedef {Object} SyncConfig
 * @property {string} dataDir              Absolute path to the gitignored data/ dir.
 * @property {string} manifestPath         Absolute path to data/manifest.json.
 * @property {SourceFolder[]} sources      Configured Drive source folders.
 * @property {GoogleCredentials} google    Google service-account credentials (Drive sync).
 * @property {Object} auth                 Web sign-in config: { clientId, clientSecret, cookieSecret, admins[], redirectUri? }.
 */

/**
 * Read and parse the raw JSON config object.
 *
 * Precedence:
 *   1. an explicit `raw` object (overrides.raw) — for tests/embedding
 *   2. config.json in the repo root (git-ignored), or overrides.configPath
 *   3. the MBBB_CONFIG_JSON environment variable (a JSON string)
 *   4. {} — empty (e.g. --fixture runs that supply everything via overrides)
 *
 * @returns {Object}
 */
function readRawConfig({ raw, configPath } = {}, env = process.env) {
  if (raw) return raw;

  const path = configPath || DEFAULT_CONFIG_PATH;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // No config file — fall back to the single-env-var form for deployments.
      if (env.MBBB_CONFIG_JSON) {
        try {
          return JSON.parse(env.MBBB_CONFIG_JSON);
        } catch {
          throw new Error('MBBB_CONFIG_JSON is set but is not valid JSON');
        }
      }
      return {};
    }
    throw new Error(`Failed to read config file (${path}): ${err.message || err}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Config file (${path}) is not valid JSON`);
  }
}

/** Normalize the `sources` array, dropping entries without an id and defaulting labels. */
function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((s) => s && s.id)
    .map((s, i) => ({
      id: s.id,
      label: s.label || `drive-folder-${i + 1}`,
      // Preserve an explicit `foldered: false` (source not organized by song).
      ...(s.foldered === false ? { foldered: false } : {}),
      // Preserve an explicit `generated: true` (authoritative MuseScore output).
      ...(s.generated === true ? { generated: true } : {}),
    }));
}

/**
 * Build a SyncConfig from the JSON config (file or MBBB_CONFIG_JSON) and overrides.
 *
 * config.json shape (all optional; see config.example.json):
 *   {
 *     "dataDir": "data",
 *     "sources": [ { "id": "<folder-id>", "label": "scores" }, ... ],
 *     "google":  { "serviceAccount": { ...service-account key... } }
 *   }
 *
 * @param {Object} [overrides]
 * @param {string} [overrides.dataDir]        Override the data dir (e.g. CLI --data-dir).
 * @param {SourceFolder[]} [overrides.sources] Override sources (e.g. --fixture).
 * @param {string} [overrides.configPath]     Read config from this path instead of the default.
 * @param {Object} [overrides.raw]            Use this raw config object directly (tests/embedding).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SyncConfig}
 */
export function loadConfig(overrides = {}, env = process.env) {
  const raw = readRawConfig(overrides, env);

  // MBBB_DATA_DIR points the app at an alternate data dir without editing a
  // production-ready config.json — a test/ops escape hatch alongside MBBB_NO_AUTH
  // (see auth.ts). The e2e suite uses it to run against isolated fixture data.
  const dataDir = resolve(overrides.dataDir || env.MBBB_DATA_DIR || raw.dataDir || 'data');
  const sources = overrides.sources || normalizeSources(raw.sources);

  return {
    dataDir,
    manifestPath: resolve(dataDir, 'manifest.json'),
    sources,
    google: raw.google || {},
    // Web sign-in (Google OAuth) + session cookie + role bootstrap. Optional:
    // when clientId/clientSecret/cookieSecret are absent the web app runs open.
    auth: raw.auth || {},
  };
}
