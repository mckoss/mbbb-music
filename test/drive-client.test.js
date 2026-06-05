import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, env: { MBBB_GOOGLE_ACCESS_TOKEN: 'tok-123' } });

  const files = await client.listFiles('folder-xyz');
  assert.deepEqual(files, [{ id: 'a', name: 'A.pdf' }]);

  const { url, init } = fetchImpl.calls[0];
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://www.googleapis.com/drive/v3/files');
  assert.equal(parsed.searchParams.get('q'), "'folder-xyz' in parents and trashed=false");
  const fields = parsed.searchParams.get('fields');
  for (const f of ['id', 'name', 'mimeType', 'modifiedTime', 'md5Checksum', 'size', 'version', 'parents', 'shortcutDetails']) {
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
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, env: { MBBB_GOOGLE_ACCESS_TOKEN: 't' } });

  const files = await client.listFiles('f');
  assert.deepEqual(files.map((f) => f.id), ['p1', 'p2']);
  assert.equal(fetchImpl.calls.length, 2);
});

test('downloadFile requests alt=media and returns a Buffer', async () => {
  const payload = Buffer.from('SYNTHETIC-PDF-BYTES');
  const fetchImpl = makeFetch([() => bytesResponse(payload)]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, env: { MBBB_GOOGLE_ACCESS_TOKEN: 't' } });

  const out = await client.downloadFile('file 1/with?weird');
  assert.ok(Buffer.isBuffer(out));
  assert.equal(out.toString(), 'SYNTHETIC-PDF-BYTES');

  const parsed = new URL(fetchImpl.calls[0].url);
  assert.equal(parsed.pathname, '/drive/v3/files/' + encodeURIComponent('file 1/with?weird'));
  assert.equal(parsed.searchParams.get('alt'), 'media');
});

test('refresh-token credentials mint an access token, then reuse it', async () => {
  const fetchImpl = makeFetch([
    ({ url, init }) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(init.method, 'POST');
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('client_id'), 'cid');
      assert.equal(body.get('client_secret'), 'csecret');
      assert.equal(body.get('refresh_token'), 'rtok');
      return jsonResponse({ access_token: 'fresh-token', expires_in: 3600 });
    },
    ({ init }) => {
      assert.equal(init.headers.Authorization, 'Bearer fresh-token');
      return jsonResponse({ files: [] });
    },
    ({ init }) => {
      // Second list reuses the cached token: no extra token call.
      assert.equal(init.headers.Authorization, 'Bearer fresh-token');
      return jsonResponse({ files: [] });
    },
  ]);
  const client = createGoogleDriveClient(
    {},
    {
      fetch: fetchImpl,
      env: {
        MBBB_GOOGLE_CLIENT_ID: 'cid',
        MBBB_GOOGLE_CLIENT_SECRET: 'csecret',
        MBBB_GOOGLE_REFRESH_TOKEN: 'rtok',
      },
    },
  );

  await client.listFiles('f');
  await client.listFiles('f');
  assert.equal(fetchImpl.calls.length, 3); // one token + two lists
});

test('a 401 triggers a one-time refresh and retry', async () => {
  const fetchImpl = makeFetch([
    () => jsonResponse({ access_token: 'first', expires_in: 3600 }),
    () => jsonResponse({ error: 'unauthorized' }, 401),
    ({ url }) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      return jsonResponse({ access_token: 'second', expires_in: 3600 });
    },
    ({ init }) => {
      assert.equal(init.headers.Authorization, 'Bearer second');
      return jsonResponse({ files: [{ id: 'ok' }] });
    },
  ]);
  const client = createGoogleDriveClient(
    {},
    {
      fetch: fetchImpl,
      env: {
        MBBB_GOOGLE_CLIENT_ID: 'cid',
        MBBB_GOOGLE_CLIENT_SECRET: 'csecret',
        MBBB_GOOGLE_REFRESH_TOKEN: 'rtok',
      },
    },
  );

  const files = await client.listFiles('f');
  assert.deepEqual(files.map((f) => f.id), ['ok']);
});

test('missing credentials throw a clear, actionable error', async () => {
  const fetchImpl = makeFetch([]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, env: {} });
  await assert.rejects(() => client.listFiles('f'), /credentials are not configured/i);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a non-2xx Drive response throws including status and body', async () => {
  const fetchImpl = makeFetch([() => jsonResponse({ error: { message: 'File not found' } }, 404)]);
  const client = createGoogleDriveClient({}, { fetch: fetchImpl, env: { MBBB_GOOGLE_ACCESS_TOKEN: 't' } });
  await assert.rejects(() => client.downloadFile('missing'), /404.*File not found/s);
});

test('MBBB_GOOGLE_TOKEN_FILE supplies credentials when present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-token-'));
  try {
    const tokenFile = join(dir, 'token.json');
    await writeFile(tokenFile, JSON.stringify({ access_token: 'from-file' }));
    const fetchImpl = makeFetch([
      ({ init }) => {
        assert.equal(init.headers.Authorization, 'Bearer from-file');
        return jsonResponse({ files: [] });
      },
    ]);
    const client = createGoogleDriveClient({}, { fetch: fetchImpl, env: { MBBB_GOOGLE_TOKEN_FILE: tokenFile } });
    await client.listFiles('f');
    assert.equal(fetchImpl.calls.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a configured-but-absent token file is ignored, falling through to missing-creds', async () => {
  const fetchImpl = makeFetch([]);
  const client = createGoogleDriveClient(
    {},
    { fetch: fetchImpl, env: { MBBB_GOOGLE_TOKEN_FILE: join(tmpdir(), 'definitely-absent-token-xyz.json') } },
  );
  await assert.rejects(() => client.listFiles('f'), /credentials are not configured/i);
});
