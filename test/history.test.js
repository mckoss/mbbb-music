import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runSync } from '../src/sync/sync.js';
import { createFixtureDriveClient } from '../src/sync/drive-client.js';
import { FIXTURE_FILES, FIXTURE_FOLDERS } from '../src/sync/sample-fixture.js';
import {
  diffSyncManifests,
  countChanges,
  historyDirFor,
  isRunId,
  listSyncRuns,
  loadSyncRun,
  runIdFor,
  saveSyncRun,
} from '../src/sync/history.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'mbbb-history-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const config = (dataDir) => ({ dataDir, manifestPath: resolve(dataDir, 'manifest.json'), sources: FIXTURE_FOLDERS });
// Each run gets its own clock so each writes its own history record.
const at = (iso) => () => new Date(iso);

const part = (over = {}) => ({
  driveFileId: 'f1',
  originalName: 'Baile - Alto Horn.pdf',
  folderPath: ['Baile'],
  sha256: 'aaa',
  songTitle: 'Baile',
  instrument: 'Alto horn',
  instrumentSlug: 'alto-horn',
  key: 'eflat',
  assetType: 'pdf',
  status: 'synced',
  syncedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

test('diffSyncManifests: added, ignored, removed, restored, and unchanged files', () => {
  const before = {
    keep: part({ driveFileId: 'keep' }),
    gone: part({ driveFileId: 'gone', originalName: 'Old.pdf' }),
    back: part({ driveFileId: 'back', status: 'deleted' }),
  };
  const after = {
    // Only bookkeeping moved (sync time, Drive metadata) — not a change.
    keep: part({ driveFileId: 'keep', syncedAt: '2026-02-01T00:00:00.000Z', modifiedTime: 'x', appearances: [] }),
    gone: part({ driveFileId: 'gone', originalName: 'Old.pdf', status: 'deleted' }),
    back: part({ driveFileId: 'back' }),
    fresh: part({ driveFileId: 'fresh', originalName: 'New.pdf' }),
    shortcut: { driveFileId: 'shortcut', originalName: 'Link', status: 'ignored|google-drive-shortcut' },
  };
  const changes = diffSyncManifests(before, after);
  const kinds = Object.fromEntries(changes.map((c) => [c.id, c.kind]));
  assert.deepEqual(kinds, { fresh: 'added', back: 'restored', gone: 'removed', shortcut: 'ignored' });
  assert.equal(changes.find((c) => c.id === 'gone').name, 'Old.pdf');
  assert.deepEqual(countChanges(changes), { added: 1, updated: 0, restored: 1, removed: 1, ignored: 1 });
});

test('diffSyncManifests: a rename that reallocates a file to another part reports each field', () => {
  const before = { f1: part() };
  const after = {
    f1: part({ originalName: 'Baile - Alto Horn 2.pdf', partNumber: 2, sha256: 'bbb', folderPath: ['Baile', 'Horns'] }),
  };
  const [c] = diffSyncManifests(before, after);
  assert.equal(c.kind, 'updated');
  assert.deepEqual(
    c.fields.map((f) => [f.field, f.from, f.to]),
    [
      ['name', 'Baile - Alto Horn.pdf', 'Baile - Alto Horn 2.pdf'],
      ['folder', 'Baile', 'Baile / Horns'],
      ['content', 'aaa', 'bbb'],
      ['part', null, '2'],
    ],
  );
});

test('diffSyncManifests: a download completing (pending → synced) is not a change', () => {
  const changes = diffSyncManifests({ f1: part({ status: 'pending' }) }, { f1: part() });
  assert.deepEqual(changes, []);
});

test('saveSyncRun keeps the newest runs and refuses unsafe ids', async () => {
  await withTempDir(async (dir) => {
    for (let i = 0; i < 4; i++) {
      const id = runIdFor(`2026-10-0${i + 1}T00:00:00.000Z`);
      await saveSyncRun(dir, { id, startedAt: id, ok: true, changes: [], log: [] }, { keep: 3 });
    }
    const runs = await listSyncRuns(dir);
    assert.deepEqual(
      runs.map((r) => r.id),
      ['2026-10-04T00-00-00-000Z', '2026-10-03T00-00-00-000Z', '2026-10-02T00-00-00-000Z'],
    );
    assert.equal('changes' in runs[0], false);
    assert.equal(isRunId('../manifest'), false);
    assert.equal(await loadSyncRun(dir, '../manifest'), null);
    await assert.rejects(saveSyncRun(dir, { id: '../x' }));
  });
});

test('runSync records each real sync in data/sync-history with its file changes', async () => {
  await withTempDir(async (dataDir) => {
    const first = await runSync({
      driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }),
      config: config(dataDir),
      now: at('2026-10-01T10:00:00.000Z'),
      trigger: { by: 'admin@example.com', via: 'web' },
    });
    assert.equal(first.historyId, '2026-10-01T10-00-00-000Z');

    // Rename the alto sax part so it is reclassified as alto horn part 2, and drop a file.
    const files = FIXTURE_FILES.filter((f) => f.id !== 'ts-mp3').map((f) =>
      f.id === 'bg-alto' ? { ...f, name: 'Bad Guy - Alto Horn 2.pdf' } : f,
    );
    const second = await runSync({
      driveClient: createFixtureDriveClient({ files }),
      config: config(dataDir),
      now: at('2026-10-02T10:00:00.000Z'),
    });

    const dir = historyDirFor(dataDir);
    assert.deepEqual((await readdir(dir)).sort(), [`${first.historyId}.json`, `${second.historyId}.json`]);

    const run1 = await loadSyncRun(dir, first.historyId);
    assert.equal(run1.ok, true);
    assert.deepEqual(run1.trigger, { by: 'admin@example.com', via: 'web' });
    assert.equal(run1.changeCounts.added, first.summary.new + first.summary.unreachable);
    assert.ok(run1.log.length > 0);

    const run2 = await loadSyncRun(dir, second.historyId);
    assert.equal(run2.trigger.via, 'cli');
    assert.deepEqual(
      run2.changes.map((c) => [c.id, c.kind]),
      [
        ['bg-alto', 'updated'],
        ['ts-mp3', 'removed'],
      ],
    );
    const fields = Object.fromEntries(run2.changes[0].fields.map((f) => [f.field, [f.from, f.to]]));
    assert.deepEqual(fields.name, ['Bad Guy - Alto Saxophone.pdf', 'Bad Guy - Alto Horn 2.pdf']);
    assert.deepEqual(fields.instrument, ['Alto saxophone', 'Alto horn']);
    assert.deepEqual(fields.part, [null, '2']);
    assert.equal(fields.content, undefined, 'same bytes — content unchanged');
  });
});

test('a failed sync is still recorded, and a dry run is not', async () => {
  await withTempDir(async (dataDir) => {
    const broken = {
      listFiles: async () => {
        throw new Error('Drive is down');
      },
      downloadFile: async () => Buffer.alloc(0),
    };
    await assert.rejects(
      runSync({ driveClient: broken, config: config(dataDir), now: at('2026-10-03T10:00:00.000Z') }),
      /Drive is down/,
    );
    await runSync({
      driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }),
      config: config(dataDir),
      dryRun: true,
      now: at('2026-10-04T10:00:00.000Z'),
    });
    const runs = await listSyncRuns(historyDirFor(dataDir));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].ok, false);
    assert.equal(runs[0].error, 'Drive is down');
  });
});
