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

import { JWT } from 'google-auth-library';

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

// Read-only Drive access is all the sync needs; the source folders are public.
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Fields the manifest/classifier need. files.list returns these per child; a
// shortcut's shortcutDetails lets the classifier ignore pointer entries.
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,md5Checksum,size,version,parents,shortcutDetails';

/**
 * Create a real Google Drive v3 client backed by Node's global `fetch` (Node
 * 20+). It speaks only the two operations the sync core needs:
 * list the direct children of a folder, and download a file's bytes.
 *
 * Authentication is by Google **service account** only. The `google` block of
 * config.json (or MBBB_CONFIG_JSON) embeds the service-account key inline as
 * `serviceAccount` (the JSON object Google hands you). The configured source
 * folders are public, so the service account just provides API credentials — no
 * folder sharing or user impersonation is required.
 *
 * `google-auth-library`'s JWT client signs the assertion and mints/refreshes the
 * short-lived access token; this module keeps its own fetch-based Drive REST calls.
 *
 * @param {import('./config.js').SyncConfig} [config]  Provides config.google creds.
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetch]  Inject a fetch implementation (tests).
 * @param {Object} [options.authClient]   Inject an auth client (tests); must expose
 *        getAccessToken(). Bypasses service-account loading entirely.
 * @param {typeof JWT} [options.JWT]      Inject the JWT constructor (tests).
 * @returns {{ listFiles: (folderId: string) => Promise<Object[]>, downloadFile: (fileId: string) => Promise<Buffer> }}
 */
export function createGoogleDriveClient(config = {}, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'No fetch implementation available. Use Node 20+ (global fetch) or inject options.fetch.',
    );
  }

  const auth = createAuthProvider({ config, options });

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
 * Resolve and cache a service-account access token via google-auth-library's JWT
 * client. The client is built lazily on first use (so an absent/invalid key only
 * fails when a token is actually needed) and caches/refreshes tokens internally.
 */
function createAuthProvider({ config, options }) {
  const JWTCtor = options.JWT ?? JWT;
  const google = config.google || {};

  // A pre-built client (tests) bypasses service-account loading entirely.
  let client = options.authClient ?? null;
  let initialized = Boolean(options.authClient);

  function ensureClient() {
    if (initialized) return;
    initialized = true;
    client = buildJwtClient(google, JWTCtor);
  }

  async function getToken({ forceRefresh = false } = {}) {
    ensureClient();
    if (!client) throw missingCredsError();
    // Force a re-mint by invalidating any cached token (used on a 401 retry).
    if (forceRefresh && client.credentials) client.credentials.access_token = null;
    const res = await client.getAccessToken();
    const token = typeof res === 'string' ? res : res && res.token;
    if (!token) throw new Error('Service account auth returned no access token');
    return token;
  }

  return {
    getToken,
    canRefresh() {
      ensureClient();
      return Boolean(client);
    },
  };
}

/** Build a JWT client from the inline service account, or null if none is configured. */
function buildJwtClient(google, JWTCtor) {
  const sa = google.serviceAccount;
  if (!sa || typeof sa !== 'object') return null;
  if (!sa.client_email || !sa.private_key) {
    throw new Error('config.json google.serviceAccount is missing "client_email" or "private_key".');
  }
  return new JWTCtor({
    email: sa.client_email,
    key: sa.private_key,
    scopes: DRIVE_SCOPES,
  });
}

function missingCredsError() {
  return new Error(
    'Google service account is not configured. In config.json (or MBBB_CONFIG_JSON), embed the ' +
      'service-account key inline as "google": { "serviceAccount": { ... } }. Or run with ' +
      '--fixture for a credential-free demo. See config.example.json and ' +
      'docs/design.md → Incremental Drive Sync.',
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
