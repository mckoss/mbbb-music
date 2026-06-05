// Drive client abstraction. The sync core depends only on this small interface
// so it can run against real Google Drive in production or a deterministic
// in-memory fixture in tests and offline demos.
//
//   interface DriveClient {
//     // List the asset-relevant files under a configured source folder.
//     listFiles(folderId): Promise<DriveFile[]>
//     // Download a file's bytes by id.
//     downloadFile(id): Promise<Buffer>
//   }
//
// A DriveFile mirrors the fields the Drive API returns and the manifest needs:
//   { id, name, mimeType, modifiedTime, md5Checksum?, size?, version?,
//     parents?, folderName?, shortcutDetails? }

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Create an in-memory fixture Drive client from a list of files and their
 * byte contents. Checksums/sizes are derived from the content so the manifest's
 * change detection behaves exactly as it would against real Drive.
 *
 * @param {Object} options
 * @param {Array<Object>} options.files  DriveFile-shaped records. Each may carry
 *        a `content` string/Buffer; if present its md5/size are auto-filled.
 * @param {Record<string, string|Buffer>} [options.contents]  Optional id -> bytes map.
 * @returns {{ listFiles: Function, downloadFile: Function }}
 */
export function createFixtureDriveClient({ files = [], contents = {} } = {}) {
  const byId = new Map();
  const bytesById = new Map();

  for (const f of files) {
    const content = f.content ?? contents[f.id];
    let md5Checksum = f.md5Checksum;
    let size = f.size;
    if (content != null) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
      bytesById.set(f.id, buf);
      md5Checksum = md5Checksum ?? createHash('md5').update(buf).digest('hex');
      size = size ?? buf.length;
    }
    const { content: _omit, ...rest } = f;
    byId.set(f.id, { ...rest, md5Checksum, size });
  }

  return {
    async listFiles(folderId) {
      const out = [];
      for (const file of byId.values()) {
        const parents = file.parents || [];
        if (file.folderId === folderId || parents.includes(folderId)) {
          out.push({ ...file });
        }
      }
      return out;
    },
    async downloadFile(id) {
      if (!bytesById.has(id)) {
        throw new Error(`fixture drive client has no content for file id: ${id}`);
      }
      return bytesById.get(id);
    },
  };
}

// --- Real Google Drive v3 client ---------------------------------------------

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Fields the manifest/classifier need. files.list returns these per child; a
// shortcut's shortcutDetails lets the classifier ignore pointer entries.
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,md5Checksum,size,version,parents,shortcutDetails';

/**
 * Create a real, dependency-free Google Drive v3 client backed by Node's global
 * `fetch` (Node 20+). It speaks only the two operations the sync core needs:
 * list the direct children of a folder, and download a file's bytes.
 *
 * Authentication (resolved from `options` first, then `env`):
 *   - MBBB_GOOGLE_ACCESS_TOKEN — a ready-to-use OAuth bearer token. Simplest for
 *     short-lived/manual runs; cannot be auto-refreshed.
 *   - MBBB_GOOGLE_CLIENT_ID + MBBB_GOOGLE_CLIENT_SECRET + MBBB_GOOGLE_REFRESH_TOKEN
 *     — a refresh-token grant; the client mints (and re-mints on 401/expiry) an
 *     access token via Google's OAuth token endpoint.
 *   - MBBB_GOOGLE_TOKEN_FILE — optional path to a JSON token object. Loaded only
 *     when the env var is set AND the file exists; never defaulted to a private
 *     path. Its fields (access_token / client_id / client_secret / refresh_token)
 *     fill any gaps left by the above, so an authorized-app credentials file can
 *     supply everything at once.
 *
 * @param {import('./config.js').SyncConfig} [config]  Unused today; accepted so
 *        callers can pass the same config object they build for the sync.
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch]  Inject a fetch implementation (tests).
 * @param {NodeJS.ProcessEnv} [options.env]  Override the environment source.
 * @param {string} [options.accessToken]
 * @param {string} [options.clientId]
 * @param {string} [options.clientSecret]
 * @param {string} [options.refreshToken]
 * @param {string} [options.tokenFile]
 * @returns {{ listFiles: (folderId: string) => Promise<Object[]>, downloadFile: (fileId: string) => Promise<Buffer> }}
 */
export function createGoogleDriveClient(config = {}, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'No fetch implementation available. Use Node 20+ (global fetch) or inject options.fetch.',
    );
  }

  const auth = createAuthProvider({ options, env, fetchImpl });

  // Issue an authenticated Drive request, transparently refreshing the access
  // token once on a 401 when refresh credentials are available.
  async function driveRequest(url) {
    let token = await auth.getToken();
    let res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && (await auth.canRefresh())) {
      token = await auth.getToken({ forceRefresh: true });
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) {
      const detail = await safeText(res);
      throw new Error(
        `Google Drive request failed: ${res.status} ${res.statusText || ''}`.trim() +
          (detail ? ` — ${detail}` : ''),
      );
    }
    return res;
  }

  return {
    async listFiles(folderId) {
      if (!folderId) throw new Error('listFiles(folderId) requires a Drive folder id');
      const files = [];
      let pageToken;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed=false`,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '1000',
          // Tolerate source folders that live on a shared drive.
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await driveRequest(`${DRIVE_FILES_URL}?${params.toString()}`);
        const data = await res.json();
        if (Array.isArray(data.files)) files.push(...data.files);
        pageToken = data.nextPageToken || undefined;
      } while (pageToken);
      return files;
    },

    async downloadFile(fileId) {
      if (!fileId) throw new Error('downloadFile(fileId) requires a Drive file id');
      const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
      const res = await driveRequest(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params.toString()}`);
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    },
  };
}

/**
 * Resolve and cache an OAuth access token from the configured credentials.
 * Precedence: explicit options > env vars > optional token file (gap-filling).
 */
function createAuthProvider({ options, env, fetchImpl }) {
  const tokenFile = options.tokenFile ?? env.MBBB_GOOGLE_TOKEN_FILE ?? null;
  const creds = {
    accessToken: options.accessToken ?? env.MBBB_GOOGLE_ACCESS_TOKEN ?? null,
    clientId: options.clientId ?? env.MBBB_GOOGLE_CLIENT_ID ?? null,
    clientSecret: options.clientSecret ?? env.MBBB_GOOGLE_CLIENT_SECRET ?? null,
    refreshToken: options.refreshToken ?? env.MBBB_GOOGLE_REFRESH_TOKEN ?? null,
  };

  let initialized = false;
  let cachedToken = null;
  let expiresAtMs = 0;

  async function init() {
    if (initialized) return;
    initialized = true;
    if (tokenFile) await mergeTokenFile(creds, tokenFile);
    if (creds.accessToken) {
      cachedToken = creds.accessToken;
      // A pre-supplied token has an unknown lifetime; treat it as valid until a
      // 401 forces a refresh (only possible if refresh creds were also given).
      expiresAtMs = Infinity;
    }
  }

  function hasRefreshCreds() {
    return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken);
  }

  async function refresh() {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      throw new Error(
        `Google OAuth token refresh failed: ${res.status} ${res.statusText || ''}`.trim() +
          (detail ? ` — ${detail}` : ''),
      );
    }
    const data = await res.json();
    if (!data.access_token) {
      throw new Error('Google OAuth token refresh returned no access_token');
    }
    cachedToken = data.access_token;
    const ttlSec = Number(data.expires_in) || 3600;
    // Refresh a minute early to avoid racing expiry mid-sync.
    expiresAtMs = Date.now() + Math.max(0, ttlSec - 60) * 1000;
    return cachedToken;
  }

  return {
    async getToken({ forceRefresh = false } = {}) {
      await init();
      if (!forceRefresh && cachedToken && Date.now() < expiresAtMs) return cachedToken;
      if (hasRefreshCreds()) return refresh();
      if (cachedToken) return cachedToken; // direct token, not refreshable
      throw missingCredsError();
    },
    async canRefresh() {
      await init();
      return hasRefreshCreds();
    },
  };
}

/** Merge a JSON token file's fields into `creds`, without overriding what's set. */
async function mergeTokenFile(creds, tokenFile) {
  let raw;
  try {
    raw = await readFile(tokenFile, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return; // "if present" — absence is fine
    throw new Error(`Failed to read MBBB_GOOGLE_TOKEN_FILE (${tokenFile}): ${err.message || err}`);
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error(`MBBB_GOOGLE_TOKEN_FILE (${tokenFile}) is not valid JSON`);
  }
  creds.accessToken = creds.accessToken ?? obj.access_token ?? obj.accessToken ?? null;
  creds.clientId = creds.clientId ?? obj.client_id ?? obj.clientId ?? null;
  creds.clientSecret = creds.clientSecret ?? obj.client_secret ?? obj.clientSecret ?? null;
  creds.refreshToken = creds.refreshToken ?? obj.refresh_token ?? obj.refreshToken ?? null;
}

function missingCredsError() {
  return new Error(
    'Google Drive credentials are not configured. Set MBBB_GOOGLE_ACCESS_TOKEN, or ' +
      'MBBB_GOOGLE_CLIENT_ID + MBBB_GOOGLE_CLIENT_SECRET + MBBB_GOOGLE_REFRESH_TOKEN ' +
      '(optionally via MBBB_GOOGLE_TOKEN_FILE). Or run with --fixture for a ' +
      'credential-free demo. See docs/design.md → Incremental Drive Sync.',
  );
}

/** Best-effort read of an error response body for clearer messages. */
async function safeText(res) {
  try {
    const text = await res.text();
    return text ? text.slice(0, 500) : '';
  } catch {
    return '';
  }
}
