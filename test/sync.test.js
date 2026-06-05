import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runSync } from '../src/sync/sync.js';
import { createFixtureDriveClient } from '../src/sync/drive-client.js';
import { loadManifest } from '../src/sync/manifest.js';
import { FIXTURE_FILES, FIXTURE_FOLDERS } from '../src/sync/sample-fixture.js';

const FIXED_NOW = () => new Date('2026-06-05T00:00:00.000Z');

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-sync-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeConfig(dataDir) {
  return {
    dataDir,
    manifestPath: resolve(dataDir, 'manifest.json'),
    sources: FIXTURE_FOLDERS,
  };
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test('full fixture sync downloads only assets, grouped by song with canonical names', async () => {
  await withTempDir(async (dataDir) => {
    const client = createFixtureDriveClient({ files: FIXTURE_FILES });
    const report = await runSync({ driveClient: client, config: makeConfig(dataDir), now: FIXED_NOW });

    // 8 assets, 3 ignored (shortcut, google doc, jpg).
    assert.equal(report.summary.new, 8);
    assert.equal(report.summary.downloaded, 8);
    assert.equal(report.summary.ignored, 3);
    assert.equal(report.summary.failed, 0);

    // Canonical filenames from the design spec exist on disk.
    assert.ok(await exists(resolve(dataDir, 'bad-guy/bad-guy-trumpet-bflat.pdf')));
    assert.ok(await exists(resolve(dataDir, 'bad-guy/bad-guy-trumpet-bflat-2.pdf')));
    assert.ok(await exists(resolve(dataDir, 'bad-guy/bad-guy.mscz')));
    assert.ok(await exists(resolve(dataDir, 'track-suit/track-suit-euphonium.pdf')));

    // Ignored files are never written.
    assert.ok(!(await exists(resolve(dataDir, 'bad-guy/cover-art.jpg'))));

    // Manifest records provenance + status, including ignored entries.
    const manifest = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(Object.keys(manifest.files).length, FIXTURE_FILES.length);
    assert.equal(manifest.files['bg-shortcut'].ignored, true);
    assert.equal(manifest.files['bg-tpt-2'].partNumber, 2);
    assert.equal(manifest.files['bg-tpt-2'].status, 'synced');
  });
});

test('re-running is idempotent: everything unchanged, nothing re-downloaded', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    const client = createFixtureDriveClient({ files: FIXTURE_FILES });
    await runSync({ driveClient: client, config, now: FIXED_NOW });
    const second = await runSync({ driveClient: client, config, now: FIXED_NOW });

    assert.equal(second.summary.unchanged, 8);
    assert.equal(second.summary.downloaded, 0);
    assert.equal(second.summary.new, 0);
  });
});

test('a changed checksum triggers a re-download', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    await runSync({ driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }), config, now: FIXED_NOW });

    // Bump one file's content + version to simulate an edit in Drive.
    const mutated = FIXTURE_FILES.map((f) =>
      f.id === 'bg-alto' ? { ...f, content: 'SYNTHETIC-PDF: bad guy alto sax REVISED', version: '2' } : f,
    );
    const report = await runSync({ driveClient: createFixtureDriveClient({ files: mutated }), config, now: FIXED_NOW });

    assert.equal(report.summary.changed, 1);
    assert.equal(report.summary.downloaded, 1);
    const bytes = await readFile(resolve(dataDir, 'bad-guy/bad-guy-alto-sax.pdf'), 'utf8');
    assert.match(bytes, /REVISED/);
  });
});

test('a removed Drive file is archived; local content is retained', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    await runSync({ driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }), config, now: FIXED_NOW });

    const remaining = FIXTURE_FILES.filter((f) => f.id !== 'ts-mp3');
    const report = await runSync({ driveClient: createFixtureDriveClient({ files: remaining }), config, now: FIXED_NOW });

    assert.equal(report.summary.deleted, 1);
    const manifest = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(manifest.files['ts-mp3'].status, 'deleted');
    // Local file is intentionally NOT removed.
    assert.ok(await exists(resolve(dataDir, 'track-suit/track-suit.mp3')));
  });
});

test('dry-run plans without downloading or writing the manifest', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    const report = await runSync({
      driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }),
      config,
      dryRun: true,
      now: FIXED_NOW,
    });
    assert.equal(report.dryRun, true);
    assert.equal(report.summary.new, 8);
    assert.equal(report.summary.downloaded, 0);
    assert.ok(!(await exists(resolve(dataDir, 'manifest.json'))));
    assert.ok(!(await exists(resolve(dataDir, 'bad-guy'))));
  });
});
