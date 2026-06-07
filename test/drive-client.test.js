import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGoogleDriveClient, createFixtureDriveClient } from '../src/sync/drive-client.js';

// A tiny fetch double that records requests and replays scripted responses.
function makeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const handler = handlers.shift();
    if (!handler) throw new Error(`unexpected fetch call: ${url}`);
    return handler({ url: String(url), init });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// An injected auth client (bypasses service-account loading) that returns a fixed token.
function fakeAuth(token) {
  return {
    async getAccessToken() {
      return { token };
    },
  };
}

// A fetch double that answers files.list by parent folder id from a folder tree,
// so recursive-walk tests don't depend on fetch call ordering. Single page each.
// It also answers files.get (no `q` param) by id from an optional `filesById`
// map, so shortcut-target resolution can be exercised.
function driveTreeFetch(childrenByFolder, filesById = {}, forbidden = new Set()) {
  return async (url) => {
    const parsed = new URL(String(url));
    const q = parsed.searchParams.get('q');
    if (!q) {
      // files.get/{id}?fields=... — the last path segment is the (encoded) id.
      const id = decodeURIComponent(parsed.pathname.split('/').pop());
      if (forbidden.has(id)) return jsonResponse({ error: { message: 'forbidden' } }, 403);
      const meta = filesById[id];
      return meta ? jsonResponse(meta) : jsonResponse({ error: { message: 'not found' } }, 404);
    }
    const m = q.match(/'([^']+)' in parents/);
    const folderId = m ? m[1] : null;
    if (forbidden.has(folderId)) return jsonResponse({ error: { message: 'forbidden' } }, 403);
    return jsonResponse({ files: childrenByFolder[folderId] || [] });
  };
}

// A logger that records what it was told, for asserting warnings.
function captureLogger() {
  const warns = [];
  return { warns, info() {}, warn: (m) => warns.push(String(m)), error() {} };
}

const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const aFolderShortcut = (id, name, targetId) => ({
  id,
  name,
  mimeType: SHORTCUT_MIME,
  shortcutDetails: { targetId, targetMimeType: FOLDER_MIME },
});
const aFileShortcut = (id, name, targetId, targetMimeType = 'application/pdf') => ({
  id,
  name,
  mimeType: SHORTCUT_MIME,
  shortcutDetails: { targetId, targetMimeType },
});

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const aFolder = (id, name) => ({ id, name, mimeType: FOLDER_MIME });
const aPdf = (id, name) => ({ id, name, mimeType: 'application/pdf' });
const anMp3 = (id, name) => ({ id, name, mimeType: 'audio/mpeg' });

function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    async json() {
      return obj;
    },
    async text() {
      return JSON.stringify(obj);
    },
  };
}

function bytesResponse(buf, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    async text() {
      return buf.toString();
    },
  };
}

test('listFiles builds a folder-scoped, non-trashed query with manifest fields', async () => {
  const fetchImpl = makeFetch([() => jsonResponse({ files: [{ id: 'a', name: 'A.pdf' }] })]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, authClient: fakeAuth('tok-123') });

  const files = await client.listFiles('folder-xyz');
  assert.deepEqual(files, [{ id: 'a', name: 'A.pdf' }]);

  const { url, init } = fetchImpl.calls[0];
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://www.googleapis.com/drive/v3/files');
  assert.equal(parsed.searchParams.get('q'), "'folder-xyz' in parents and trashed=false");
  const fields = parsed.searchParams.get('fields');
  for (const f of ['id', 'name', 'mimeType', 'modifiedTime', 'sha256Checksum', 'size', 'version', 'parents', 'shortcutDetails']) {
    assert.ok(fields.includes(f), `fields should include ${f}`);
  }
  assert.equal(init.headers.Authorization, 'Bearer tok-123');
});

test('listFiles follows nextPageToken across pages', async () => {
  const fetchImpl = makeFetch([
    () => jsonResponse({ files: [{ id: 'p1' }], nextPageToken: 'tok-next' }),
    ({ url }) => {
      assert.ok(new URL(url).searchParams.get('pageToken') === 'tok-next');
      return jsonResponse({ files: [{ id: 'p2' }] });
    },
  ]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, authClient: fakeAuth('t') });

  const files = await client.listFiles('f');
  assert.deepEqual(files.map((f) => f.id), ['p1', 'p2']);
  assert.equal(fetchImpl.calls.length, 2);
});

test('listFiles recurses into subfolders and tags assets with their top-level song folder', async () => {
  // root/<song>/... possibly nested deeper. Songs are the top-level folders.
  const tree = {
    root: [aFolder('bg', 'Bad Guy'), aFolder('ts', 'Track Suit')],
    bg: [aPdf('p1', 'Bad Guy - Trumpet.pdf'), aFolder('bgp', 'parts')],
    bgp: [aPdf('p2', 'Bad Guy - Trumpet 2.pdf'), anMp3('m1', 'practice.mp3')], // a level deeper
    ts: [anMp3('m2', 'Track Suit.mp3')],
  };
  const client = createGoogleDriveClient({}, { fetch: driveTreeFetch(tree), authClient: fakeAuth('t') });

  const files = await client.listFiles('root');

  // Folders are never emitted as files.
  assert.ok(!files.some((f) => f.mimeType === FOLDER_MIME));
  // Every asset (incl. the one nested under bg/parts) is tagged with its song.
  const byId = Object.fromEntries(files.map((f) => [f.id, f.folderName]));
  assert.deepEqual(byId, { p1: 'Bad Guy', p2: 'Bad Guy', m1: 'Bad Guy', m2: 'Track Suit' });
});

test('listFiles descends into a shortcut-to-folder, attributing its subtree to a song', async () => {
  // A song folder reached only via a shortcut placed at the root.
  const tree = {
    root: [aFolder('bg', 'Bad Guy'), aFolderShortcut('sc1', 'Encore', 'encore-real')],
    bg: [aPdf('p1', 'Bad Guy - Trumpet.pdf')],
    'encore-real': [aPdf('p9', 'Encore - Tuba.pdf')],
  };
  const client = createGoogleDriveClient({}, { fetch: driveTreeFetch(tree), authClient: fakeAuth('t') });

  const files = await client.listFiles('root');
  const byId = Object.fromEntries(files.map((f) => [f.id, f.folderName]));
  // The shortcut's own name becomes the song for everything behind it.
  assert.deepEqual(byId, { p1: 'Bad Guy', p9: 'Encore' });
  assert.ok(!files.some((f) => f.mimeType === SHORTCUT_MIME)); // shortcut never emitted as a file
});

test('listFiles resolves a shortcut-to-file, standing the target in at the shortcut location', async () => {
  // A trumpet PDF that physically lives elsewhere, dropped into the song folder
  // as a shortcut. Its real metadata (id, checksum, mime) must stand in.
  const target = {
    id: 'real-tpt',
    name: 'Bad Guy - Trumpet.pdf',
    mimeType: 'application/pdf',
    sha256Checksum: 'deadbeef',
    size: '123',
    modifiedTime: '2026-01-02T10:00:00.000Z',
    version: '4',
  };
  const tree = {
    root: [aFolder('bg', 'Bad Guy')],
    bg: [aFileShortcut('sc2', 'Trumpet (shortcut).pdf', 'real-tpt')],
  };
  const client = createGoogleDriveClient(
    {},
    { fetch: driveTreeFetch(tree, { 'real-tpt': target }), authClient: fakeAuth('t') },
  );

  const files = await client.listFiles('root');
  assert.equal(files.length, 1);
  const f = files[0];
  assert.equal(f.id, 'real-tpt'); // downloads/keys by the target, not the pointer
  assert.equal(f.sha256Checksum, 'deadbeef'); // cheap change-detection preserved
  assert.equal(f.mimeType, 'application/pdf');
  assert.equal(f.folderName, 'Bad Guy'); // attributed to the song the shortcut sits in
  assert.equal(f.shortcutDetails, undefined); // resolved away
});

test('listFiles degrades a shortcut whose target is unreadable to the (ignored) pointer', async () => {
  const tree = {
    root: [aFolder('bg', 'Bad Guy')],
    bg: [aFileShortcut('sc3', 'Dangling.pdf', 'missing-target')],
  };
  // No entry for 'missing-target' → files.get answers 404.
  const client = createGoogleDriveClient({}, { fetch: driveTreeFetch(tree), authClient: fakeAuth('t') });

  const files = await client.listFiles('root');
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 'sc3'); // still the pointer
  assert.equal(files[0].mimeType, SHORTCUT_MIME); // classifier will ignore it
  assert.equal(files[0].folderName, 'Bad Guy');
});

test('an unreadable file-shortcut target warns (naming the shortcut) and is skipped', async () => {
  const tree = {
    root: [aFolder('bg', 'Bad Guy')],
    bg: [aFileShortcut('sc4', 'Protected Part.pdf', 'locked-file')],
  };
  const logger = captureLogger();
  const client = createGoogleDriveClient(
    {},
    { fetch: driveTreeFetch(tree, {}, new Set(['locked-file'])), authClient: fakeAuth('t'), logger },
  );

  const files = await client.listFiles('root');
  assert.equal(files[0].mimeType, SHORTCUT_MIME); // degraded to the pointer (ignored downstream)
  assert.equal(logger.warns.length, 1);
  assert.match(logger.warns[0], /Protected Part\.pdf/);
  assert.match(logger.warns[0], /can't read/);
});

test('an unreadable folder-shortcut target warns and skips, without aborting the walk', async () => {
  const tree = {
    root: [aFolder('bg', 'Bad Guy'), aFolderShortcut('sc5', 'Locked Folder', 'locked-folder')],
    bg: [aPdf('p1', 'Bad Guy - Trumpet.pdf')],
    // 'locked-folder' returns 403 when listed.
  };
  const logger = captureLogger();
  const client = createGoogleDriveClient(
    {},
    { fetch: driveTreeFetch(tree, {}, new Set(['locked-folder'])), authClient: fakeAuth('t'), logger },
  );

  const files = await client.listFiles('root');
  assert.deepEqual(files.map((f) => f.id), ['p1']); // the rest of the walk still completed
  assert.equal(logger.warns.length, 1);
  assert.match(logger.warns[0], /Locked Folder/);
});

test('a real (non-shortcut) folder failing still aborts the walk', async () => {
  // A genuine error in a configured source/sub-folder must not be swallowed.
  const tree = { root: [aFolder('bg', 'Bad Guy')] }; // 'bg' itself is forbidden
  const client = createGoogleDriveClient(
    {},
    { fetch: driveTreeFetch(tree, {}, new Set(['bg'])), authClient: fakeAuth('t') },
  );
  await assert.rejects(() => client.listFiles('root'), /403/);
});

test('a shared visited set stops a folder being re-scanned across sources', async () => {
  // Source A is a real song folder; source C is an index that shortcuts to A and
  // also has its own file. Walking A then C with one shared set must not re-walk A.
  const tree = {
    A: [aFolder('bg', 'Bad Guy')],
    bg: [aPdf('a1', 'Bad Guy - Trumpet.pdf')],
    C: [aFolderShortcut('sc', 'Bad Guy (link)', 'bg'), aPdf('c1', 'Honk - Tuba.pdf')],
  };
  let listCalls = 0;
  const fetch = (url) => {
    const q = new URL(String(url)).searchParams.get('q');
    if (q && /'bg' in parents/.test(q)) listCalls += 1; // count times 'bg' is listed
    return driveTreeFetch(tree)(url);
  };
  const client = createGoogleDriveClient({}, { fetch, authClient: fakeAuth('t') });

  const visited = new Set();
  const a = await client.listFiles('A', { visited });
  const c = await client.listFiles('C', { visited });

  assert.deepEqual(a.map((f) => f.id), ['a1']);
  assert.deepEqual(c.map((f) => f.id), ['c1']); // A's file is NOT re-emitted via the shortcut
  assert.equal(listCalls, 1); // 'bg' was listed exactly once across both walks
});

test('without a shared set, each call re-scans (per-call guard only)', async () => {
  // Contrast: separate calls each carry their own guard, so the shortcut re-walks.
  const tree = {
    A: [aFolder('bg', 'Bad Guy')],
    bg: [aPdf('a1', 'Bad Guy - Trumpet.pdf')],
    C: [aFolderShortcut('sc', 'Bad Guy (link)', 'bg'), aPdf('c1', 'Honk - Tuba.pdf')],
  };
  const client = createGoogleDriveClient({}, { fetch: driveTreeFetch(tree), authClient: fakeAuth('t') });
  const c = await client.listFiles('C'); // no shared set
  assert.deepEqual(c.map((f) => f.id).sort(), ['a1', 'c1']); // re-walked A via the shortcut
});

test('listFiles leaves files placed directly in the root untagged', async () => {
  const tree = { root: [aPdf('r1', 'loose.pdf')] };
  const client = createGoogleDriveClient({}, { fetch: driveTreeFetch(tree), authClient: fakeAuth('t') });

  const files = await client.listFiles('root');
  assert.equal(files.length, 1);
  assert.equal(files[0].folderName, undefined); // sync falls back to the source label
});

test('fixture client resolves an in-fixture shortcut and ignores an external one', async () => {
  const client = createFixtureDriveClient({
    files: [
      { id: 'real', name: 'Song - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: 'Real Home', content: 'PDF' },
      {
        id: 'sc-in',
        name: 'Trumpet (shortcut).pdf',
        mimeType: SHORTCUT_MIME,
        folderId: 'lib',
        folderName: 'Song',
        shortcutDetails: { targetId: 'real', targetMimeType: 'application/pdf' },
      },
      {
        id: 'sc-ext',
        name: 'External.pdf',
        mimeType: SHORTCUT_MIME,
        folderId: 'lib',
        folderName: 'Song',
        shortcutDetails: { targetId: 'not-in-fixture', targetMimeType: 'application/pdf' },
      },
    ],
  });

  const files = await client.listFiles('lib');
  const byId = Object.fromEntries(files.map((f) => [f.id, f]));
  // The in-fixture shortcut resolved to its target, re-attributed to 'Song'.
  assert.ok(byId.real, 'target stands in for the shortcut');
  assert.equal(files.filter((f) => f.id === 'real').length, 2); // real entry + resolved shortcut
  const resolved = files.find((f) => f.id === 'real' && f.folderName === 'Song');
  assert.ok(resolved, 'resolved shortcut carries the shortcut’s folder placement');
  assert.equal(resolved.mimeType, 'application/pdf');
  // The external shortcut (no in-fixture target) is left as a pointer to ignore.
  assert.ok(byId['sc-ext']);
  assert.equal(byId['sc-ext'].mimeType, SHORTCUT_MIME);
  // Downloading the resolved target works (bytes come from the real file).
  assert.equal((await client.downloadFile('real')).toString(), 'PDF');
});

test('downloadFile requests alt=media and returns a Buffer', async () => {
  const payload = Buffer.from('SYNTHETIC-PDF-BYTES');
  const fetchImpl = makeFetch([() => bytesResponse(payload)]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, authClient: fakeAuth('t') });

  const out = await client.downloadFile('file 1/with?weird');
  assert.ok(Buffer.isBuffer(out));
  assert.equal(out.toString(), 'SYNTHETIC-PDF-BYTES');

  const parsed = new URL(fetchImpl.calls[0].url);
  assert.equal(parsed.pathname, '/drive/v3/files/' + encodeURIComponent('file 1/with?weird'));
  assert.equal(parsed.searchParams.get('alt'), 'media');
});

test('downloadFile in export mode hits files.export with the target mimeType', async () => {
  const payload = Buffer.from('EXPORTED-PDF-BYTES');
  const fetchImpl = makeFetch([() => bytesResponse(payload)]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, authClient: fakeAuth('t') });

  const out = await client.downloadFile('doc1', { mode: 'export', mimeType: 'application/pdf' });
  assert.equal(out.toString(), 'EXPORTED-PDF-BYTES');

  const parsed = new URL(fetchImpl.calls[0].url);
  assert.equal(parsed.pathname, '/drive/v3/files/doc1/export');
  assert.equal(parsed.searchParams.get('mimeType'), 'application/pdf');
  // The export endpoint takes no alt=media / supportsAllDrives params.
  assert.equal(parsed.searchParams.get('alt'), null);
  assert.equal(parsed.searchParams.get('supportsAllDrives'), null);
});

test('service account: builds a JWT client from the inline key with drive.readonly scope', async () => {
  let opts;
  class FakeJWT {
    constructor(o) {
      opts = o;
    }
    async getAccessToken() {
      return { token: 'svc-token' };
    }
  }
  const fetchImpl = makeFetch([
    ({ init }) => {
      assert.equal(init.headers.Authorization, 'Bearer svc-token');
      return jsonResponse({ files: [] });
    },
  ]);
  const client = createGoogleDriveClient(
    {
      google: {
        serviceAccount: { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: 'PRIVATE_KEY' },
      },
    },
    { fetch: fetchImpl, JWT: FakeJWT },
  );

  await client.listFiles('f');
  assert.equal(opts.email, 'svc@proj.iam.gserviceaccount.com');
  assert.equal(opts.key, 'PRIVATE_KEY');
  assert.deepEqual(opts.scopes, ['https://www.googleapis.com/auth/drive.readonly']);
});

test('a 401 triggers a one-time token re-mint and retry', async () => {
  // Stub auth client whose token is re-minted once its cached value is cleared.
  const authClient = {
    credentials: { access_token: 'first' },
    async getAccessToken() {
      if (!this.credentials.access_token) this.credentials.access_token = 'second';
      return { token: this.credentials.access_token };
    },
  };
  const fetchImpl = makeFetch([
    ({ init }) => {
      assert.equal(init.headers.Authorization, 'Bearer first');
      return jsonResponse({ error: 'unauthorized' }, 401);
    },
    ({ init }) => {
      assert.equal(init.headers.Authorization, 'Bearer second');
      return jsonResponse({ files: [{ id: 'ok' }] });
    },
  ]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, authClient });

  const files = await client.listFiles('f');
  assert.deepEqual(files.map((f) => f.id), ['ok']);
  assert.equal(fetchImpl.calls.length, 2);
});

test('missing service account throws a clear, actionable error', async () => {
  const fetchImpl = makeFetch([]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl });
  await assert.rejects(() => client.listFiles('f'), /service account is not configured/i);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a service account JSON missing private_key throws', async () => {
  const fetchImpl = makeFetch([]);
  const client = createGoogleDriveClient(
    { google: { serviceAccount: { client_email: 'svc@x' } } },
    { fetch: fetchImpl },
  );
  await assert.rejects(() => client.listFiles('f'), /missing "client_email" or "private_key"/);
});

test('a non-2xx Drive response throws including status and body', async () => {
  const fetchImpl = makeFetch([() => jsonResponse({ error: { message: 'File not found' } }, 404)]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, authClient: fakeAuth('t') });
  await assert.rejects(() => client.downloadFile('missing'), /404.*File not found/s);
});
