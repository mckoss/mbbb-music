// Drive client abstraction. The sync core depends only on this small interface
// so it can run against real Google Drive in production or a deterministic
// in-memory fixture in tests and offline demos.
//
//   interface DriveClient {
//     // List the asset-relevant files under a configured source folder.
//     listFiles(folderId): Promise<DriveFile[]>
//     // Download a file's bytes by id. `download` selects binary content
//     // (alt=media, the default) or an export rendering (files.export) for native
//     // Google editor files; see classify.js DownloadSpec.
//     downloadFile(id, download?): Promise<Buffer>
//   }
//
// A DriveFile mirrors the fields the Drive API returns and the manifest needs:
//   { id, name, mimeType, modifiedTime, sha256Checksum?, size?, version?,
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
 *        a `content` string/Buffer; if present its sha256/size are auto-filled.
 * @param {Record<string, string|Buffer>} [options.contents]  Optional id -> bytes map.
 * @returns {{ listFiles: Function, downloadFile: Function }}
 */
export function createFixtureDriveClient({ files = [], contents = {} } = {}) {
  const byId = new Map();
  const bytesById = new Map();

  for (const f of files) {
    const content = f.content ?? contents[f.id];
    let sha256Checksum = f.sha256Checksum;
    let size = f.size;
    if (content != null) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
      bytesById.set(f.id, buf);
      sha256Checksum = sha256Checksum ?? createHash('sha256').update(buf).digest('hex');
      size = size ?? buf.length;
    }
    const { content: _omit, ...rest } = f;
    byId.set(f.id, { ...rest, sha256Checksum, size });
  }

  // The fixture is flat (no real nesting), so a file's full folder path is just
  // its single folder name (mirrors the real client's `folderPath`).
  const pathOf = (file) => (file.folderName != null ? [file.folderName] : []);

  // Resolve a shortcut-to-file to its in-fixture target, standing it in at the
  // shortcut's folder placement (mirrors the real client). A shortcut whose
  // target is absent from the fixture (an "external" pointer) is left as-is, so
  // the classifier ignores it. Every emitted leaf carries its folder path; a
  // resolved shortcut also carries viaShortcut + the pointer's own id, so the
  // inventory can show it exactly where it sits in Drive.
  function resolveFixtureFile(file) {
    const sc = file.shortcutDetails;
    if (!sc?.targetId) return { ...file, folderPath: pathOf(file) };
    const here = { folderPath: pathOf(file), viaShortcut: true, shortcutId: file.id, displayName: file.name };
    const target = byId.get(sc.targetId);
    if (!target || target.mimeType === SHORTCUT_MIME || target.shortcutDetails) {
      // Target absent/unresolvable — stand the pointer in, flagged unreachable so
      // the sync records the permission/visibility gap rather than dropping it.
      return { ...file, ...here, unreachable: true, shortcutTarget: sc.targetId };
    }
    return file.folderName != null ? { ...target, folderName: file.folderName, ...here } : { ...target, ...here };
  }

  return {
    // The fixture is a flat model (no real folder recursion), so it has nothing
    // to re-scan; it accepts `options` only to match the real client's signature.
    async listFiles(folderId, _options = {}) {
      const out = [];
      for (const file of byId.values()) {
        const parents = file.parents || [];
        if (file.folderId === folderId || parents.includes(folderId)) {
          out.push(resolveFixtureFile(file));
        }
      }
      return out;
    },
    async downloadFile(id, _download) {
      if (!bytesById.has(id)) {
        throw new Error(`fixture drive client has no content for file id: ${id}`);
      }
      return bytesById.get(id);
    },
  };
}

// --- Real Google Drive v3 client ---------------------------------------------

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

// Used when no logger is injected — the client stays silent by default.
const noopLogger = { info() {}, warn() {}, error() {} };

// Read-only Drive access is all the sync needs; the source folders are public.
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Drive mime type for folders — the recursive walk descends into these.
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Drive mime type for shortcut entries (pointers to a real file/folder).
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

// Fields the manifest/classifier need. files.list returns these per child;
// `shortcutDetails` carries the target's id/mimeType so the walk can resolve a
// shortcut to the file (or folder) it points at.
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,sha256Checksum,size,version,parents,shortcutDetails';

/**
 * Create a real Google Drive v3 client backed by Node's global `fetch` (Node
 * 20+). It speaks only the two operations the sync core needs: recursively list
 * the asset files under a folder, and download a file's bytes.
 *
 * Source folders are deep — typically `root/<song-title>/<asset>` — so listFiles
 * descends into every subfolder and tags each asset with its **top-level folder
 * under the configured root** (the song folder) as `folderName`, which the sync
 * uses to group assets by song. Folders are traversed, never returned as files.
 *
 * Shortcuts are followed so a member can drop a needed file into a song folder as
 * a Drive shortcut: a shortcut-to-folder is descended into like a real folder,
 * and a shortcut-to-file is resolved (via files.get) to stand its target in at
 * the shortcut's location — same id/checksum/bytes as the real file, attributed
 * to the song folder the shortcut sits in. A shortcut whose target can't be read
 * (deleted/inaccessible) is logged as a warning (via options.logger) and skipped:
 * a file shortcut degrades to the pointer entry the classifier ignores, and a
 * folder shortcut's subtree is skipped without aborting the rest of the sync.
 * (Targets are assumed reachable with the same credentials; resource keys for
 * link-shared targets are not currently supplied.)
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
 * @param {{info:Function,warn:Function,error:Function}} [options.logger]  Surfaces
 *        warnings for shortcuts whose target can't be read (else silent/noop).
 * @returns {{ listFiles: (folderId: string, options?: { visited?: Set<string> }) => Promise<Object[]>, downloadFile: (fileId: string) => Promise<Buffer> }}
 */
export function createGoogleDriveClient(config = {}, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'No fetch implementation available. Use Node 20+ (global fetch) or inject options.fetch.',
    );
  }
  const logger = options.logger ?? noopLogger;

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

  // List the direct children of one folder, following pagination.
  async function listChildren(folderId) {
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
  }

  // Fetch one file's metadata by id — used to resolve a shortcut to its target.
  async function getFileMeta(fileId) {
    const params = new URLSearchParams({
      fields: FILE_FIELDS,
      supportsAllDrives: 'true',
    });
    const res = await driveRequest(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params.toString()}`);
    return res.json();
  }

  // Resolve a shortcut-to-file to a DriveFile standing in for its target at the
  // shortcut's location: the target's id/mime/checksum/bytes, but tagged with the
  // song folder AND the full folder path the shortcut lives in, plus viaShortcut +
  // the shortcut's own id so the inventory can show the file exactly where it
  // appears in Drive (a shortcut is a real appearance, not a hidden duplicate). If
  // the target can't be read or is itself a pointer, fall back to the shortcut
  // entry (the classifier ignores it).
  async function resolveFileShortcut(shortcut, song, songId, path) {
    const targetId = shortcut.shortcutDetails.targetId;
    // `displayName` is the shortcut's own name — what you see at this spot in
    // Drive — kept separate from the target's filename so the inventory can show
    // the file as it actually appears here (members often rename a shortcut to
    // standardize it), while metadata detection still keys off the real target name.
    const here = {
      folderPath: path,
      viaShortcut: true,
      shortcutId: shortcut.id,
      displayName: shortcut.name,
    };
    let meta = null;
    try {
      meta = await getFileMeta(targetId);
    } catch {
      meta = null;
    }
    if (!meta || !meta.id || meta.mimeType === SHORTCUT_MIME || meta.shortcutDetails) {
      logger.warn(
        `Shortcut "${shortcut.name}"${song ? ` in "${song}"` : ''} points at a file the sync ` +
          `can't read (target ${targetId}); recording it as unreachable. Share the target with ` +
          `the service account, or place the file directly in a source folder.`,
      );
      // Stand the pointer in, flagged unreachable + carrying the target id so the
      // sync records the permission gap (and the UI can link to "request access").
      const stand = song ? { ...shortcut, folderName: song, folderId: songId } : { ...shortcut };
      return { ...stand, ...here, unreachable: true, shortcutTarget: targetId };
    }
    return song ? { ...meta, folderName: song, folderId: songId, ...here } : { ...meta, ...here };
  }

  return {
    async listFiles(folderId, options = {}) {
      if (!folderId) throw new Error('listFiles(folderId) requires a Drive folder id');
      const out = [];
      // Set of folder ids already walked. A caller (the sync) can pass a shared
      // set so this set spans every source in a run — then a folder reached again
      // through a shortcut from another source (e.g. an index folder that links to
      // the real song folders) is listed only once, not re-scanned per source.
      // Without one it falls back to a per-call set (still guards cycles).
      const seen = options.visited ?? new Set();
      // Breadth-first walk. `song` is the top-level folder under the configured
      // root that this folder descends from (null while still at the root); `path`
      // is the full chain of folder names from the root to here, so each asset can
      // record its complete Drive location (not just the first-level song folder).
      const queue = [{ id: folderId, song: null, songId: null, path: [], viaShortcut: false, label: null }];
      while (queue.length) {
        const { id, song, songId, path, viaShortcut, label } = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        let children;
        try {
          children = await listChildren(id);
        } catch (err) {
          // A real source/sub-folder failing is a hard error; but a folder reached
          // only through a shortcut may be outside the service account's reach —
          // warn and skip that subtree rather than aborting the whole sync.
          if (!viaShortcut) throw err;
          logger.warn(
            `Shortcut "${label}" points at a folder the sync can't read (target ${id}); ` +
              `skipping it. Share the folder with the service account. (${err?.message || err})`,
          );
          continue;
        }
        for (const child of children) {
          const target = child.shortcutDetails;
          if (child.mimeType === FOLDER_MIME) {
            // Descend; the song (name + folder id) is fixed at the first folder
            // below the root, while the path grows with every level.
            queue.push({ id: child.id, song: song ?? child.name, songId: songId ?? child.id, path: [...path, child.name], viaShortcut: false, label: null });
          } else if (target?.targetMimeType === FOLDER_MIME && target.targetId) {
            // Shortcut to a folder: descend into the target as if it lived here,
            // recording the path under the shortcut's own display name (what you'd
            // see navigating Drive).
            queue.push({ id: target.targetId, song: song ?? child.name, songId: songId ?? target.targetId, path: [...path, child.name], viaShortcut: true, label: child.name });
          } else if (target?.targetId) {
            // Shortcut to a file: stand its target in at this location.
            out.push(await resolveFileShortcut(child, song, songId, path));
          } else {
            // Asset/leaf (Docs the classifier exports, others it ignores).
            // Tag it with its song folder (name + Drive id) and its full folder
            // path so the sync groups it correctly, folder-level corrections can
            // key on the stable id, and the inventory can mirror the Drive tree.
            const base = song ? { ...child, folderName: song, folderId: songId } : { ...child };
            out.push({ ...base, folderPath: path });
          }
        }
      }
      return out;
    },

    async downloadFile(fileId, download = { mode: 'media' }) {
      if (!fileId) throw new Error('downloadFile(fileId) requires a Drive file id');
      let url;
      if (download?.mode === 'export') {
        // Native Google editor files have no binary content; files.export renders
        // them (here, to PDF) so they store and serve like any other asset. The
        // export endpoint does not accept supportsAllDrives.
        const params = new URLSearchParams({ mimeType: download.mimeType });
        url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export?${params.toString()}`;
      } else {
        const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
        url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params.toString()}`;
      }
      const res = await driveRequest(url);
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
