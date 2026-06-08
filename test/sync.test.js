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

    // 12 assets (incl. the Google Doc exported to PDF, a jpg, a docx, and a
    // root-level zip), 1 unreachable (the shortcut whose target can't be read).
    assert.equal(report.summary.new, 12);
    assert.equal(report.summary.downloaded, 12);
    assert.equal(report.summary.ignored, 0);
    assert.equal(report.summary.unreachable, 1);
    assert.equal(report.summary.failed, 0);

    // Each asset's bytes live at data/cas/<sha256-of-content>.
    const trumpet = sha256('SYNTHETIC-PDF: bad guy trumpet part 1');
    assert.ok(await exists(resolve(dataDir, 'cas', trumpet)));
    assert.equal(await readFile(resolve(dataDir, 'cas', trumpet), 'utf8'), 'SYNTHETIC-PDF: bad guy trumpet part 1');

    // The store holds exactly the 12 unique asset blobs (no nested dirs).
    const blobs = await readdir(resolve(dataDir, 'cas'));
    assert.equal(blobs.length, 12);

    // Manifest records provenance, hash, cas path, metadata, and status.
    const manifest = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(Object.keys(manifest.files).length, FIXTURE_FILES.length);
    // The shortcut whose target can't be read is recorded as unreachable (no
    // content), classified by its filename, and carries the target id.
    assert.equal(manifest.files['bg-shortcut'].status, 'unreachable');
    assert.equal(manifest.files['bg-shortcut'].shortcutTarget, 'external-thing');
    assert.equal(manifest.files['bg-shortcut'].sha256, undefined);
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

    // New asset types are accepted with their own type and song attribution.
    assert.equal(manifest.files['bg-cover'].assetType, 'image');
    assert.equal(manifest.files['bg-cover'].songTitle, 'Bad Guy');
    assert.equal(manifest.files['bg-notes-docx'].assetType, 'doc');
    assert.equal(manifest.files['bg-notes-docx'].songTitle, 'Bad Guy');
    // A loose file with no song folder lands in the Misc bucket.
    assert.equal(manifest.files['misc-zip'].assetType, 'archive');
    assert.equal(manifest.files['misc-zip'].songTitle, 'Misc');
    assert.equal(manifest.files['misc-zip'].songTitleSlug, 'misc');
  });
});

test('re-running is idempotent: every blob already cached, nothing re-downloaded', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    const client = createFixtureDriveClient({ files: FIXTURE_FILES });
    await runSync({ driveClient: client, config, now: FIXED_NOW });
    const second = await runSync({ driveClient: client, config, now: FIXED_NOW });

    assert.equal(second.summary.unchanged, 12);
    assert.equal(second.summary.downloaded, 0);
    assert.equal(second.summary.cached, 12);
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
    assert.equal(report.summary.cached, 12);
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
    // Before the first byte was fetched, the manifest held all entries with the
    // 12 assets queued as pending.
    assert.equal(entriesAtFirstDownload, FIXTURE_FILES.length);
    assert.equal(pendingAtFirstDownload, 12);

    // After the run, each downloaded entry carries its hash so a resume skips it.
    const finalManifest = await loadManifest(manifestPath);
    const synced = Object.values(finalManifest.files).find((e) => e.status === 'synced');
    assert.ok(synced.sha256, 'synced entries record a sha256 for resume');
  });
});

test('a source folder that returns no files is reported as a warning, not silently skipped', async () => {
  await withTempDir(async (dataDir) => {
    const config = {
      dataDir,
      manifestPath: resolve(dataDir, 'manifest.json'),
      // A good source plus one that lists nothing (e.g. unshared / mistyped id).
      sources: [...FIXTURE_FOLDERS, { id: 'unshared-folder', label: 'mike-koss-replica' }],
      google: { serviceAccount: { client_email: 'sa@proj.iam.gserviceaccount.com' } },
    };
    const warns = [];
    const logger = { info() {}, warn: (m) => warns.push(String(m)), error() {} };
    const report = await runSync({
      driveClient: createFixtureDriveClient({ files: FIXTURE_FILES }),
      config,
      now: FIXED_NOW,
      logger,
    });

    // Reported in the structured report...
    assert.equal(report.summary.warnings, 1);
    assert.equal(report.warnings.length, 1);
    const w = report.warnings[0];
    assert.equal(w.source, 'mike-koss-replica');
    assert.equal(w.reason, 'empty-or-unshared');
    assert.match(w.message, /Anyone with the link/);
    assert.match(w.message, /sa@proj\.iam\.gserviceaccount\.com/); // actionable: names the SA
    // ...and surfaced live through the logger.
    assert.equal(warns.length, 1);
    // The healthy source still synced as normal.
    assert.equal(report.summary.new, 12);
  });
});

test('a file reachable from two sources is attributed to the higher-priority (earlier) source, once', async () => {
  await withTempDir(async (dataDir) => {
    // 'shared' lives in the primary source and is also pointed at by a shortcut
    // from the secondary source (the fixture resolves it to the same target id).
    const files = [
      { id: 'shared', name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'primary', folderName: 'Bad Guy', content: 'SHARED' },
      {
        id: 'sc',
        name: 'Bad Guy - Trumpet (shortcut).pdf',
        mimeType: 'application/vnd.google-apps.shortcut',
        folderId: 'replica',
        folderName: 'Replica Index',
        shortcutDetails: { targetId: 'shared', targetMimeType: 'application/pdf' },
      },
      { id: 'only-replica', name: 'Honk - Tuba.pdf', mimeType: 'application/pdf', folderId: 'replica', folderName: 'HONK', content: 'NEW' },
    ];
    const config = {
      dataDir,
      manifestPath: resolve(dataDir, 'manifest.json'),
      sources: [{ id: 'primary', label: 'primary' }, { id: 'replica', label: 'replica' }], // priority order
    };
    const report = await runSync({ driveClient: createFixtureDriveClient({ files }), config, now: FIXED_NOW });

    // The shared file is counted once and attributed to the primary source —
    // the replica shortcut does NOT overwrite its provenance.
    assert.equal(report.summary.crossSourceDuplicates, 1);
    assert.equal(report.summary.seen, 2); // shared + only-replica, not 3
    const m = await loadManifest(resolve(dataDir, 'manifest.json'));
    assert.equal(m.files['shared'].sourceFolderLabel, 'primary');
    assert.equal(m.files['shared'].originalFolder, 'Bad Guy');
    // The replica-only file keeps its replica attribution.
    assert.equal(m.files['only-replica'].sourceFolderLabel, 'replica');
    // The shortcut's own id is never a separate asset entry.
    assert.ok(!m.files['sc']);
  });
});

test('sync shares one visited set across sources; a folder covered earlier is not warned as unshared', async () => {
  await withTempDir(async (dataDir) => {
    const received = [];
    // Fake client: the primary source "A" walks and (via a shortcut) also reaches
    // the index source "C"'s root, marking it visited. C then lists nothing new.
    const client = {
      listFiles: async (id, opts = {}) => {
        received.push(opts.visited);
        if (id === 'A') {
          opts.visited?.add('C'); // A's walk already covered C's root folder
          return [{ id: 'a1', name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf', folderName: 'Bad Guy' }];
        }
        return []; // C: real client would see its root already visited -> empty
      },
      downloadFile: async () => Buffer.from('SYNTHETIC'),
    };
    const warns = [];
    const infos = [];
    const logger = { info: (m) => infos.push(String(m)), warn: (m) => warns.push(String(m)), error() {} };

    const config = {
      dataDir,
      manifestPath: resolve(dataDir, 'manifest.json'),
      sources: [{ id: 'A', label: 'primary' }, { id: 'C', label: 'index' }],
    };
    const report = await runSync({ driveClient: client, config, now: FIXED_NOW, logger });

    // The SAME visited Set instance reaches every source listing.
    assert.equal(received.length, 2);
    assert.ok(received[0] instanceof Set);
    assert.strictEqual(received[0], received[1]);
    // C produced nothing because it was already covered — info, not a warning.
    assert.equal(report.summary.warnings, 0);
    assert.equal(warns.length, 0);
    assert.ok(infos.some((m) => /already covered by a/.test(m)), 'logs the already-covered note');
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
    assert.equal(report.summary.new, 12);
    assert.equal(report.summary.downloaded, 0);
    assert.equal(report.summary.pending, 12);
    assert.ok(!(await exists(resolve(dataDir, 'manifest.json'))));
    assert.ok(!(await exists(resolve(dataDir, 'cas'))));
  });
});
