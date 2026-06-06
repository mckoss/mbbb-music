import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig } from '../src/sync/config.js';

const run = promisify(execFile);
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/sync.js');

// Guardrail: the synthetic fixture must never be allowed to write into the real
// data directory, so test/demo runs can never clobber real assets in the repo.
test('--fixture refuses to write into the real data directory', async () => {
  const realDataDir = loadConfig().dataDir;
  await assert.rejects(
    () => run(process.execPath, [cli, '--fixture', '--dry-run', '--data-dir', realDataDir]),
    (err) => {
      assert.equal(err.code, 2);
      assert.match(err.stderr, /Refusing to run --fixture against the real data directory/);
      return true;
    },
  );
});
