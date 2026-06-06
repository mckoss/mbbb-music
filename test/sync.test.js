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

    // Canonical filenames are the slugified ORIGINAL Drive names, grouped by song.
    assert.ok(await exists(resolve(dataDir, 'demo-library/bad-guy/bad-guy-trumpet-in-bflat.pdf')));
    assert.ok(await exists(resolve(dataDir, 'demo-library/bad-guy/bad-guy-trumpet-in-bflat-2.pdf')));
    assert.ok(await exists(resolve(dataDir, 'demo-library/bad-guy/bad-guy.mscz')));
    assert.ok(await exists(resolve(dataDir, 'demo-library/track-suit/track-suit-euphonium.pdf')));

    // Ignored files are never written.
    assert.ok(!(await exists(resolve(dataDir, 'demo-library/bad-guy/cover-art.jpg'))));

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
    const bytes = await readFile(resolve(dataDir, 'demo-library/bad-guy/bad-guy-alto-saxophone.pdf'), 'utf8');
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
    assert.ok(await exists(resolve(dataDir, 'demo-library/track-suit/track-suit.mp3')));
  });
});

test('duplicate content is downloaded once; copies are flagged and redirected', async () => {
  await withTempDir(async (dataDir) => {
    const files = [
      { id: 'orig', name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'demo-library', folderName: 'Bad Guy', content: 'SAME-BYTES' },
      { id: 'copy', name: 'Track Suit - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'demo-library', folderName: 'Track Suit', content: 'SAME-BYTES' },
      { id: 'uniq', name: 'Track Suit - Tuba.pdf', mimeType: 'application/pdf', folderId: 'demo-library', folderName: 'Track Suit', content: 'OTHER-BYTES' },
    ];
    const report = await runSync({ driveClient: createFixtureDriveClient({ files }), config: makeConfig(dataDir), now: FIXED_NOW });

    // Two unique contents -> two downloads; the identical copy is skipped.
    assert.equal(report.summary.downloaded, 2);
    assert.equal(report.summary.duplicatesSkipped, 1);

    const manifest = await loadManifest(resolve(dataDir, 'manifest.json'));
    const orig = manifest.files['orig'];
    const copy = manifest.files['copy'];
    // Original chosen deterministically (smallest path): bad-guy < track-suit.
    assert.equal(orig.isDuplicate, false);
    assert.equal(copy.isDuplicate, true);
    assert.equal(copy.duplicateOf, 'orig');
    // The copy is redirected to the original's path; no second file is written.
    assert.equal(copy.localPath, orig.localPath);
    assert.ok(await exists(resolve(dataDir, orig.localPath)));
    assert.ok(!(await exists(resolve(dataDir, 'demo-library/track-suit/track-suit-trumpet.pdf'))));

    // The report surfaces the duplicate set.
    assert.equal(report.summary.duplicateGroups, 1);
    assert.equal(report.summary.duplicateFiles, 2);
  });
});

test('deprioritized folders lose the tie when choosing the canonical copy', async () => {
  await withTempDir(async (dataDir) => {
    const files = [
      { id: 'song', name: 'Iron Man - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: 'Iron Man', content: 'DUP' },
      { id: 'index', name: 'Trumpet.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: '50 Indexed By Instrument (INCOMPLETE)', content: 'DUP' },
    ];
    const config = {
      dataDir,
      manifestPath: resolve(dataDir, 'manifest.json'),
      sources: [{ id: 'lib', label: 'Demo Library' }],
      deprioritize: ['indexed by instrument'],
    };
    const report = await runSync({ driveClient: createFixtureDriveClient({ files }), config, now: FIXED_NOW });

    assert.equal(report.summary.downloaded, 1);
    const m = await loadManifest(resolve(dataDir, 'manifest.json'));
    // The per-song copy is canonical even though the index path ('50-…') sorts first.
    assert.equal(m.files['song'].isDuplicate, false);
    assert.equal(m.files['index'].isDuplicate, true);
    assert.equal(m.files['index'].duplicateOf, 'song');
    assert.equal(m.files['song'].localPath, 'demo-library/iron-man/iron-man-trumpet.pdf');
    assert.equal(m.files['index'].localPath, m.files['song'].localPath);
    assert.ok(await exists(resolve(dataDir, 'demo-library/iron-man/iron-man-trumpet.pdf')));
  });
});

test('deprioritize patterns match the original filename, so "copy of" loses', async () => {
  await withTempDir(async (dataDir) => {
    const files = [
      { id: 'orig', name: 'Trumpet.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: 'Bad Guy', content: 'DUP' },
      { id: 'copy', name: 'Copy of Trumpet.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: 'Bad Guy', content: 'DUP' },
    ];
    const config = {
      dataDir,
      manifestPath: resolve(dataDir, 'manifest.json'),
      sources: [{ id: 'lib', label: 'Demo Library' }],
      // A filename token, written with natural spacing.
      deprioritize: ['copy of'],
    };
    const report = await runSync({ driveClient: createFixtureDriveClient({ files }), config, now: FIXED_NOW });

    assert.equal(report.summary.downloaded, 1);
    const m = await loadManifest(resolve(dataDir, 'manifest.json'));
    // 'copy-of-trumpet' sorts BEFORE 'trumpet' by path, so without the rule the
    // copy would win. The deprioritize match on the filename forces it to lose.
    assert.equal(m.files['orig'].isDuplicate, false);
    assert.equal(m.files['orig'].localPath, 'demo-library/bad-guy/trumpet.pdf');
    assert.equal(m.files['copy'].isDuplicate, true);
    assert.equal(m.files['copy'].duplicateOf, 'orig');
  });
});

test('the first-listed source wins the canonical copy; later sources only add new content', async () => {
  await withTempDir(async (dataDir) => {
    const files = [
      // Same content in both sources -> the Arrangements copy is canonical.
      { id: 'arr-dup', name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'arr', folderName: 'Bad Guy', content: 'SHARED' },
      { id: 'lib-dup', name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: 'Bad Guy', content: 'SHARED' },
      // Content unique to the Song Library still downloads.
      { id: 'lib-only', name: 'Bad Guy - Tuba.pdf', mimeType: 'application/pdf', folderId: 'lib', folderName: 'Bad Guy', content: 'LIB-ONLY' },
    ];
    const config = {
      dataDir,
      manifestPath: resolve(dataDir, 'manifest.json'),
      // Order matters: Arrangements first, Song Library second.
      sources: [{ id: 'arr', label: 'Mutiny Bay Arrangements' }, { id: 'lib', label: 'MBBB Song Library' }],
    };
    const report = await runSync({ driveClient: createFixtureDriveClient({ files }), config, now: FIXED_NOW });

    // Shared content downloaded once (from Arrangements) + the lib-only file.
    assert.equal(report.summary.downloaded, 2);
    assert.equal(report.summary.duplicatesSkipped, 1);

    const m = await loadManifest(resolve(dataDir, 'manifest.json'));
    // Arrangements wins even though 'arr' > 'lib' alphabetically and the song
    // folder/path are identical — source order is the tiebreaker, not the path.
    assert.equal(m.files['arr-dup'].isDuplicate, false);
    assert.equal(m.files['lib-dup'].isDuplicate, true);
    assert.equal(m.files['lib-dup'].duplicateOf, 'arr-dup');
    assert.equal(m.files['arr-dup'].localPath, 'mutiny-bay-arrangements/bad-guy/bad-guy-trumpet.pdf');
    assert.equal(m.files['lib-dup'].localPath, m.files['arr-dup'].localPath);
    // The file with no replica in Arrangements is downloaded into the lib path.
    assert.equal(m.files['lib-only'].isDuplicate, false);
    assert.ok(await exists(resolve(dataDir, 'mbbb-song-library/bad-guy/bad-guy-tuba.pdf')));
  });
});

test('manifest is persisted after each download, so a stop is not lost', async () => {
  await withTempDir(async (dataDir) => {
    const config = makeConfig(dataDir);
    const manifestPath = resolve(dataDir, 'manifest.json');
    const base = createFixtureDriveClient({ files: FIXTURE_FILES });

    let downloads = 0;
    let syncedBeforeSecond = -1;
    const client = {
      listFiles: (f) => base.listFiles(f),
      downloadFile: async (id) => {
        downloads += 1;
        if (downloads === 2) {
          // The first download must already be durably recorded on disk.
          const m = JSON.parse(await readFile(manifestPath, 'utf8'));
          syncedBeforeSecond = Object.values(m.files).filter((e) => e.status === 'synced').length;
        }
        return base.downloadFile(id);
      },
    };

    await runSync({ driveClient: client, config, now: FIXED_NOW });
    // At the 2nd download, ≥1 synced file (with its sha256) was already on disk.
    assert.ok(syncedBeforeSecond >= 1, `expected a synced entry on disk; got ${syncedBeforeSecond}`);

    // Downloaded entries carry their hash, so a resume can skip them.
    const finalManifest = await loadManifest(manifestPath);
    const anySynced = Object.values(finalManifest.files).find((e) => e.status === 'synced');
    assert.ok(anySynced.sha256Checksum, 'downloaded entries record a sha256 for resume');
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
    assert.ok(!(await exists(resolve(dataDir, 'demo-library'))));
  });
});
