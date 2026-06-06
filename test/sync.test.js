import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runSync } from '../src/sync/sync.js';
import { createFixtureDriveClient } from '../src/sync/drive-client.js';
import { loadManifest } from '../src/sync/manifest.js';
import { FIXTURE_FILES, FIXTURE_FOLDERS } from '../src/sync/sample-fixture.js';

const FIXED_NOW = () => new Date('2026-06-05T00:00:00.000Z');
const sha256 = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex');

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

test('full fixture sync stores assets by hash in cas/, recording metadata in the manifest', async () => {
  await withTempDir(async (dataDir) => {
    const client = createFixtureDriveClient({ files: FIXTURE_FILES });
    const report = await runSync({ driveClient: client, config: makeConfig(dataDir), now: FIXED_NOW });

    // 8 assets, 3 ignored (shortcut, google doc, jpg).
    assert.equal(report.summary.new, 8);
    assert.equal(report.summary.downloaded, 8);
    assert.equal(report.summary.ignored, 3);
    assert.equal(report.summary.failed, 0);

    // Each asset's bytes live at data/cas/<sha256-of-content>.
    const trumpet = sha256('SYNTHETIC-PDF: bad guy trumpet part 1');
    assert.ok(await exists(resolve(dataDir, 'cas', trumpet)));
    assert.equal(await readFile(resolve(dataDir, 'cas', trumpet), 'utf8'), 'SYNTHETIC-PDF: bad guy trumpet part 1');

    // The store holds exactly the 8 unique asset blobs (no nested dirs).
    const blobs = await readdir(resolve(dataDir, 'cas'));
    assert.equal(blobs.length, 8);

    // Manifest records provenance, hash, cas path, metadata, and status.
    const manifest = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(Object.keys(manifest.files).length, FIXTURE_FILES.length);
    assert.equal(manifest.files['bg-shortcut'].status, 'ignored|google-drive-shortcut');
    const e = manifest.files['bg-tpt-1'];
    assert.equal(e.status, 'synced');
    assert.equal(e.sha256, trumpet);
    assert.equal(e.instrument, 'Trumpet');
    assert.equal(e.songTitle, 'Bad Guy');

    // Undetected metadata fields are omitted entirely, not stored as null.
    const mscz = manifest.files['bg-mscz'];
    assert.ok(!('instrument' in mscz));
    assert.ok(!('key' in mscz));
    assert.ok(!('partNumber' in mscz));
  });
});

test('re-running is idempotent: every blob already cached, nothing re-downloaded', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    const client = createFixtureDriveClient({ files: FIXTURE_FILES });
    await runSync({ driveClient: client, config, now: FIXED_NOW });
    const second = await runSync({ driveClient: client, config, now: FIXED_NOW });

    assert.equal(second.summary.unchanged, 8);
    assert.equal(second.summary.downloaded, 0);
    assert.equal(second.summary.cached, 8);
  });
});

test('a changed checksum fetches the new content; the old blob remains in the store', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    await runSync({ driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }), config, now: FIXED_NOW });

    const mutated = FIXTURE_FILES.map((f) =>
      f.id === 'bg-alto' ? { ...f, content: 'SYNTHETIC-PDF: bad guy alto sax REVISED', version: '2' } : f,
    );
    const report = await runSync({ driveClient: createFixtureDriveClient({ files: mutated }), config, now: FIXED_NOW });

    assert.equal(report.summary.changed, 1);
    assert.equal(report.summary.downloaded, 1);
    const revised = sha256('SYNTHETIC-PDF: bad guy alto sax REVISED');
    const original = sha256('SYNTHETIC-PDF: bad guy alto sax part');
    assert.ok(await exists(resolve(dataDir, 'cas', revised)));
    // CAS keeps prior content; nothing is deleted.
    assert.ok(await exists(resolve(dataDir, 'cas', original)));
    const m = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(m.files['bg-alto'].sha256, revised);
  });
});

test('a removed Drive file is archived; its cached blob is retained', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    await runSync({ driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }), config, now: FIXED_NOW });

    const remaining = FIXTURE_FILES.filter((f) => f.id !== 'ts-mp3');
    const report = await runSync({ driveClient: createFixtureDriveClient({ files: remaining }), config, now: FIXED_NOW });

    assert.equal(report.summary.deleted, 1);
    const manifest = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(manifest.files['ts-mp3'].status, 'deleted');
    // The blob is intentionally NOT removed (it may be shared).
    assert.ok(await exists(resolve(dataDir, 'cas', sha256('SYNTHETIC-MP3: track suit audio'))));
  });
});

test('duplicate content is stored once; both Drive files point at the same blob', async () => {
  await withTempDir(async (dataDir) => {
    const files = [
      { id: 'orig', name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'demo-library', folderName: 'Bad Guy', content: 'SAME-BYTES' },
      { id: 'copy', name: 'Track Suit - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'demo-library', folderName: 'Track Suit', content: 'SAME-BYTES' },
      { id: 'uniq', name: 'Track Suit - Tuba.pdf', mimeType: 'application/pdf', folderId: 'demo-library', folderName: 'Track Suit', content: 'OTHER-BYTES' },
    ];
    const report = await runSync({ driveClient: createFixtureDriveClient({ files }), config: makeConfig(dataDir), now: FIXED_NOW });

    // Two unique contents -> two blobs; the identical copy is not downloaded again.
    assert.equal(report.summary.downloaded, 2);
    assert.equal(report.summary.cached, 1);
    const blobs = await readdir(resolve(dataDir, 'cas'));
    assert.equal(blobs.length, 2);

    const m = await loadManifest(resolve(dataDir, 'manifest.json'));
    const shared = sha256('SAME-BYTES');
    assert.equal(m.files['orig'].sha256, shared);
    assert.equal(m.files['copy'].sha256, shared);

    // Both are reported as one duplicate group of 2.
    assert.equal(report.summary.duplicateGroups, 1);
    assert.equal(report.summary.duplicateFiles, 2);
  });
});

test('when Drive omits sha256Checksum, the recorded hash is reused so the file is not re-downloaded', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    // A file Drive would later serve without a checksum (e.g. a "Make a copy").
    const file = {
      id: 'copy1',
      name: 'Copy of Tuba.pdf',
      mimeType: 'application/pdf',
      folderId: 'demo-library',
      folderName: 'Some Song',
      modifiedTime: '2026-01-01T00:00:00.000Z',
      version: '1',
      content: 'COPY-BYTES',
    };

    // First run: Drive provides the checksum (the fixture derives it) -> fetched.
    const first = await runSync({ driveClient: createFixtureDriveClient({ files: [file] }), config, now: FIXED_NOW });
    assert.equal(first.summary.downloaded, 1);
    assert.ok(await exists(resolve(dataDir, 'cas', sha256('COPY-BYTES'))));

    // Second run: Drive now omits sha256Checksum, but modifiedTime is unchanged.
    // The hash recorded last time is reused; the blob is recognized and the
    // download client (which throws) is never called.
    const base = createFixtureDriveClient({ files: [file] });
    const noChecksum = {
      listFiles: async (f) => (await base.listFiles(f)).map(({ sha256Checksum, ...rest }) => rest),
      downloadFile: async () => {
        throw new Error('must not re-download a file already in the store');
      },
    };
    const second = await runSync({ driveClient: noChecksum, config, now: FIXED_NOW });
    assert.equal(second.summary.downloaded, 0);
    assert.equal(second.summary.cached, 1);
    assert.equal(second.summary.unchanged, 1);
  });
});

test('a previously built cache skips download entirely (no re-download to rebuild)', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    // First run populates the store.
    await runSync({ driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }), config, now: FIXED_NOW });

    // Delete the manifest but keep cas/ — simulates rebuilding metadata from a
    // persisted content store. A client that refuses to download proves the
    // rebuild needs no network.
    await rm(resolve(dataDir, 'manifest.json'), { force: true });
    const base = createFixtureDriveClient({ files: FIXTURE_FILES });
    const noDownload = {
      listFiles: (f) => base.listFiles(f),
      downloadFile: async () => {
        throw new Error('must not download — content is already in the store');
      },
    };
    const report = await runSync({ driveClient: noDownload, config, now: FIXED_NOW });

    assert.equal(report.summary.downloaded, 0);
    assert.equal(report.summary.cached, 8);
    assert.equal(report.summary.failed, 0);
  });
});

test('manifest is written first (full metadata) before any blob is fetched', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    const manifestPath = resolve(dataDir, 'manifest.json');
    const base = createFixtureDriveClient({ files: FIXTURE_FILES });

    let pendingAtFirstDownload = -1;
    let entriesAtFirstDownload = -1;
    let downloads = 0;
    const client = {
      listFiles: (f) => base.listFiles(f),
      downloadFile: async (id) => {
        downloads += 1;
        if (downloads === 1) {
          // The manifest already exists with every entry, all still 'pending'.
          const m = JSON.parse(await readFile(manifestPath, 'utf8'));
          entriesAtFirstDownload = Object.keys(m.files).length;
          pendingAtFirstDownload = Object.values(m.files).filter((e) => e.status === 'pending').length;
        }
        return base.downloadFile(id);
      },
    };

    await runSync({ driveClient: client, config, now: FIXED_NOW });
    // Before the first byte was fetched, the manifest held all 11 entries with
    // the 8 assets queued as pending.
    assert.equal(entriesAtFirstDownload, FIXTURE_FILES.length);
    assert.equal(pendingAtFirstDownload, 8);

    // After the run, each downloaded entry carries its hash so a resume skips it.
    const finalManifest = await loadManifest(manifestPath);
    const synced = Object.values(finalManifest.files).find((e) => e.status === 'synced');
    assert.ok(synced.sha256, 'synced entries record a sha256 for resume');
  });
});

test('dry-run plans without fetching blobs or writing the manifest', async () => {
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
    assert.equal(report.summary.pending, 8);
    assert.ok(!(await exists(resolve(dataDir, 'manifest.json'))));
    assert.ok(!(await exists(resolve(dataDir, 'cas'))));
  });
});
