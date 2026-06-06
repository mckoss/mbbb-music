import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGoogleDriveClient } from '../src/sync/drive-client.js';

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
function driveTreeFetch(childrenByFolder) {
  return async (url) => {
    const q = new URL(String(url)).searchParams.get('q') || '';
    const m = q.match(/'([^']+)' in parents/);
    const folderId = m ? m[1] : null;
    return jsonResponse({ files: childrenByFolder[folderId] || [] });
  };
}

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

test('listFiles leaves files placed directly in the root untagged', async () => {
  const tree = { root: [aPdf('r1', 'loose.pdf')] };
  const client = createGoogleDriveClient({}, { fetch: driveTreeFetch(tree), authClient: fakeAuth('t') });

  const files = await client.listFiles('root');
  assert.equal(files.length, 1);
  assert.equal(files[0].folderName, undefined); // sync falls back to the source label
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
