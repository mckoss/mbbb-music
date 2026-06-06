import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadConfig } from '../src/sync/config.js';

// An env with neither a config file nor MBBB_CONFIG_JSON: use a configPath that
// surely does not exist so loadConfig falls through to env/empty.
const ABSENT = join(tmpdir(), 'mbbb-no-such-config-xyz.json');

test('reads sources and google creds from config.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-cfg-'));
  try {
    const configPath = join(dir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        dataDir: 'mydata',
        sources: [
          { id: 'f1', label: 'scores' },
          { id: 'f2' },
        ],
        google: { serviceAccount: { client_email: 'svc@x', private_key: 'KEY' } },
      }),
    );
    const config = loadConfig({ configPath }, {});
    assert.equal(config.dataDir, resolve('mydata'));
    assert.equal(config.manifestPath, resolve('mydata', 'manifest.json'));
    assert.deepEqual(config.sources, [
      { id: 'f1', label: 'scores' },
      { id: 'f2', label: 'drive-folder-2' }, // label defaulted from position
    ]);
    assert.deepEqual(config.google, { serviceAccount: { client_email: 'svc@x', private_key: 'KEY' } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('supports an arbitrary number of source folders', async () => {
  const raw = { sources: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] };
  const config = loadConfig({ raw }, {});
  assert.equal(config.sources.length, 4);
  assert.deepEqual(config.sources.map((s) => s.id), ['a', 'b', 'c', 'd']);
});

test('drops source entries that have no id', async () => {
  const config = loadConfig({ raw: { sources: [{ id: 'a' }, { label: 'oops' }, null] } }, {});
  assert.deepEqual(config.sources.map((s) => s.id), ['a']);
});

test('falls back to MBBB_CONFIG_JSON when no config file is present', async () => {
  const env = { MBBB_CONFIG_JSON: JSON.stringify({ sources: [{ id: 'envfolder' }] }) };
  const config = loadConfig({ configPath: ABSENT }, env);
  assert.deepEqual(config.sources, [{ id: 'envfolder', label: 'drive-folder-1' }]);
});

test('with no file and no env var, sources are empty and data defaults to ./data', async () => {
  const config = loadConfig({ configPath: ABSENT }, {});
  assert.deepEqual(config.sources, []);
  assert.deepEqual(config.google, {});
  assert.equal(config.dataDir, resolve('data'));
});

test('overrides win over file values', async () => {
  const raw = { dataDir: 'fromfile', sources: [{ id: 'fromfile' }] };
  const config = loadConfig({ raw, dataDir: 'override', sources: [{ id: 'x', label: 'x' }] }, {});
  assert.equal(config.dataDir, resolve('override'));
  assert.deepEqual(config.sources, [{ id: 'x', label: 'x' }]);
});

test('deprioritize patterns are normalized (trimmed, lowercased, non-strings dropped)', () => {
  const config = loadConfig({ raw: { deprioritize: ['  Indexed By Instrument ', '', 42, 'DRAFT'] } }, {});
  assert.deepEqual(config.deprioritize, ['indexed by instrument', 'draft']);

  // Absent -> empty list.
  assert.deepEqual(loadConfig({ raw: {} }, {}).deprioritize, []);
});

test('invalid MBBB_CONFIG_JSON throws a clear error', async () => {
  const env = { MBBB_CONFIG_JSON: '{not json' };
  assert.throws(() => loadConfig({ configPath: ABSENT }, env), /MBBB_CONFIG_JSON.*valid JSON/);
});

test('a malformed config file throws a clear error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-cfg-'));
  try {
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, '{ broken');
    assert.throws(() => loadConfig({ configPath }, {}), /not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
