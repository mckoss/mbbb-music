import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildOriginRecord,
  recordOrigin,
  loadOrigin,
  originsDirFor,
  recoverOrigins,
} from '../src/sync/origins.js';

async function tmp() {
  return mkdtemp(join(tmpdir(), 'mbbb-origins-'));
}

test('buildOriginRecord snapshots metadata, drops volatile status, sets provenance', () => {
  const entry = {
    driveFileId: 'f1',
    sha256: 'abc',
    size: 1234,
    sourceFolderLabel: 'mutiny-bay-arrangements',
    sourceFolderId: 'src1',
    originalFolder: 'Bad Guy',
    originalName: 'Bad Guy - Trumpet.pdf',
    instrument: 'Trumpet',
    status: 'synced', // volatile — must NOT appear in the record
  };
  const rec = buildOriginRecord(entry, { createdAt: '2026-06-15T00:00:00.000Z', provenance: 'sync' });
  assert.equal(rec.sha256, 'abc');
  assert.equal(rec.byteLength, 1234); // derived from size when byteLength absent
  assert.equal(rec.createdAt, '2026-06-15T00:00:00.000Z');
  assert.equal(rec.provenance, 'sync');
  // Source/folder provenance lives ONLY in manifestEntry — not duplicated top-level.
  assert.equal('sourceFolderLabel' in rec, false);
  assert.equal('sourceFolderId' in rec, false);
  assert.equal('originalFolder' in rec, false);
  assert.equal(rec.manifestEntry.instrument, 'Trumpet');
  assert.equal(rec.manifestEntry.sourceFolderLabel, 'mutiny-bay-arrangements');
  assert.equal(rec.manifestEntry.sourceFolderId, 'src1');
  assert.equal(rec.manifestEntry.originalFolder, 'Bad Guy');
  assert.equal('status' in rec.manifestEntry, false);
});

test('buildOriginRecord supports an orphan with no entry (explicit sha/size, unknown provenance)', () => {
  const rec = buildOriginRecord(null, { sha256: 'deadbeef', byteLength: 42, provenance: 'unknown' });
  assert.deepEqual(rec, {
    sha256: 'deadbeef',
    byteLength: 42,
    provenance: 'unknown',
    sourceFolderLabel: 'unknown', // an unassociated CAS file: source unrecoverable
    originalFolder: 'unknown', // ...and we don't know which in-source folder either
  });
  assert.equal('manifestEntry' in rec, false); // nothing recoverable
  assert.equal('createdAt' in rec, false); // null dropped
  assert.equal('sourceFolderId' in rec, false); // no meaningful id, null dropped
});

test('recordOrigin keeps a known origin but upgrades an unknown one', async () => {
  const dir = await tmp();
  try {
    const originsDir = originsDirFor(join(dir, 'cas'));

    // A known origin is immutable: a second known write is kept, not overwritten.
    assert.equal(await recordOrigin(originsDir, 'aa', { sha256: 'aa', provenance: 'sync' }), 'written');
    assert.equal(await recordOrigin(originsDir, 'aa', { sha256: 'aa', provenance: 'recovered' }), 'kept');
    assert.equal((await loadOrigin(originsDir, 'aa')).provenance, 'sync');

    // An unknown origin is upgraded the moment a real (known) source turns up...
    assert.equal(await recordOrigin(originsDir, 'bb', { sha256: 'bb', provenance: 'unknown' }), 'written');
    assert.equal(
      await recordOrigin(originsDir, 'bb', {
        sha256: 'bb',
        provenance: 'sync',
        manifestEntry: { sourceFolderLabel: 'real' },
      }),
      'upgraded',
    );
    const upgraded = await loadOrigin(originsDir, 'bb');
    assert.equal(upgraded.provenance, 'sync');
    assert.equal(upgraded.manifestEntry.sourceFolderLabel, 'real');

    // ...but never downgraded back to unknown.
    assert.equal(await recordOrigin(originsDir, 'bb', { sha256: 'bb', provenance: 'unknown' }), 'kept');
    assert.equal((await loadOrigin(originsDir, 'bb')).provenance, 'sync');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recoverOrigins backfills from the manifest and marks true orphans unknown', async () => {
  const dir = await tmp();
  try {
    const casDir = join(dir, 'cas');
    await mkdir(casDir, { recursive: true });
    const liveSha = 'a'.repeat(64);
    const orphanSha = 'b'.repeat(64);
    await writeFile(join(casDir, liveSha), 'live-bytes');
    await writeFile(join(casDir, orphanSha), 'orphan-bytes');

    const manifestPath = join(dir, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        files: {
          f1: { sha256: liveSha, status: 'synced', originalName: 'Song - Trumpet.pdf', syncedAt: '2026-01-02T00:00:00.000Z' },
        },
      }),
    );

    const res = await recoverOrigins({ casDir, manifestPath });
    assert.equal(res.blobs, 2);
    assert.equal(res.recovered, 1);
    assert.equal(res.orphans, 1);
    assert.equal(res.written, 2);
    assert.equal(res.skipped, 0);

    const originsDir = originsDirFor(casDir);
    const live = await loadOrigin(originsDir, liveSha);
    assert.equal(live.provenance, 'recovered');
    assert.equal(live.createdAt, '2026-01-02T00:00:00.000Z'); // best date we have
    assert.equal(live.manifestEntry.originalName, 'Song - Trumpet.pdf');

    const orphan = await loadOrigin(originsDir, orphanSha);
    assert.equal(orphan.provenance, 'unknown');
    assert.equal(orphan.sourceFolderLabel, 'unknown'); // unassociated → source unknown
    assert.equal(orphan.byteLength, 'orphan-bytes'.length);

    // Re-running is idempotent: nothing new is written.
    const again = await recoverOrigins({ casDir, manifestPath });
    assert.equal(again.written, 0);
    assert.equal(again.skipped, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recoverOrigins upgrades a previously-unknown orphan once the manifest associates it', async () => {
  const dir = await tmp();
  try {
    const casDir = join(dir, 'cas');
    await mkdir(casDir, { recursive: true });
    const sha = 'e'.repeat(64);
    await writeFile(join(casDir, sha), 'bytes');
    const manifestPath = join(dir, 'manifest.json');

    // First pass: no entry references the blob → recorded as unknown.
    await writeFile(manifestPath, JSON.stringify({ version: 1, files: {} }));
    const first = await recoverOrigins({ casDir, manifestPath });
    assert.equal(first.orphans, 1);
    assert.equal((await loadOrigin(originsDirFor(casDir), sha)).provenance, 'unknown');

    // A later sync associates a real Drive file with that content. Re-run: upgrade.
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        files: {
          f1: { sha256: sha, status: 'synced', originalName: 'Found.pdf', sourceFolderLabel: 'scores', originalFolder: 'Song X', syncedAt: '2026-06-01T00:00:00.000Z' },
        },
      }),
    );
    const second = await recoverOrigins({ casDir, manifestPath });
    assert.equal(second.upgraded, 1);
    assert.equal(second.skipped, 0);
    const rec = await loadOrigin(originsDirFor(casDir), sha);
    assert.equal(rec.provenance, 'recovered');
    assert.equal(rec.manifestEntry.sourceFolderLabel, 'scores');
    assert.equal(rec.manifestEntry.originalFolder, 'Song X');
    assert.equal('sourceFolderLabel' in rec, false); // no top-level duplication

    // Idempotent thereafter: a known origin is never re-touched.
    const third = await recoverOrigins({ casDir, manifestPath });
    assert.equal(third.upgraded, 0);
    assert.equal(third.skipped, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recoverOrigins prefers a live entry over a deleted tombstone for the same blob', async () => {
  const dir = await tmp();
  try {
    const casDir = join(dir, 'cas');
    await mkdir(casDir, { recursive: true });
    const sha = 'c'.repeat(64);
    await writeFile(join(casDir, sha), 'shared');
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        files: {
          gone: { sha256: sha, status: 'deleted', originalName: 'Old.pdf', syncedAt: '2026-01-01T00:00:00.000Z' },
          live: { sha256: sha, status: 'synced', originalName: 'Current.pdf', syncedAt: '2026-05-01T00:00:00.000Z' },
        },
      }),
    );
    await recoverOrigins({ casDir, manifestPath });
    const rec = await loadOrigin(originsDirFor(casDir), sha);
    assert.equal(rec.manifestEntry.originalName, 'Current.pdf'); // live beats tombstone
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dry run computes the plan without writing sidecars', async () => {
  const dir = await tmp();
  try {
    const casDir = join(dir, 'cas');
    await mkdir(casDir, { recursive: true });
    const sha = 'd'.repeat(64);
    await writeFile(join(casDir, sha), 'x');
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ version: 1, files: {} }));

    const res = await recoverOrigins({ casDir, manifestPath, dryRun: true });
    assert.equal(res.written, 1);
    assert.equal(res.orphans, 1);
    assert.equal(await loadOrigin(originsDirFor(casDir), sha), null); // nothing on disk
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
