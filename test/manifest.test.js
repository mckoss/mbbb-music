import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyManifest, diffManifest, isChanged, findDuplicates } from '../src/sync/manifest.js';
import { classifyDriveFile } from '../src/sync/classify.js';

function classified(file) {
  return { file, classification: classifyDriveFile(file) };
}

const pdf = (over = {}) => ({
  id: 'f1',
  name: 'Bad Guy - Trumpet.pdf',
  mimeType: 'application/pdf',
  modifiedTime: '2026-01-01T00:00:00.000Z',
  sha256Checksum: 'aaa',
  version: '1',
  ...over,
});

test('isChanged compares the SHA-256 checksum', () => {
  assert.equal(isChanged({ sha256Checksum: 'a' }, { sha256Checksum: 'a' }), false);
  assert.equal(isChanged({ sha256Checksum: 'a' }, { sha256Checksum: 'b' }), true);
});

test('a never-seen asset is classified new', () => {
  const { entries, counts } = diffManifest(emptyManifest(), [classified(pdf())]);
  assert.equal(counts.new, 1);
  assert.equal(entries[0].status, 'new');
});

test('same checksum is unchanged; different checksum is changed', () => {
  const manifest = emptyManifest();
  manifest.files['f1'] = { driveFileId: 'f1', sha256Checksum: 'aaa', version: '1', status: 'synced', localPath: 'bad-guy/x.pdf' };

  const unchanged = diffManifest(manifest, [classified(pdf({ sha256Checksum: 'aaa' }))]);
  assert.equal(unchanged.counts.unchanged, 1);

  const changed = diffManifest(manifest, [classified(pdf({ sha256Checksum: 'zzz', version: '2' }))]);
  assert.equal(changed.counts.changed, 1);
});

test('a tracked file no longer present is deleted (archived), once', () => {
  const manifest = emptyManifest();
  manifest.files['gone'] = { driveFileId: 'gone', sha256Checksum: 'x', status: 'synced', localPath: 'bad-guy/gone.pdf' };

  const first = diffManifest(manifest, []);
  assert.equal(first.counts.deleted, 1);
  assert.equal(first.entries[0].status, 'deleted');

  // Once marked deleted in the manifest, it should not be re-reported as deleted.
  manifest.files['gone'].status = 'deleted';
  const second = diffManifest(manifest, []);
  assert.equal(second.counts.deleted, undefined);
});

test('findDuplicates groups live assets by sha256, regardless of path or source', () => {
  const m = emptyManifest();
  m.files = {
    a: { sha256Checksum: 'h1', localPath: 'song-a/x.pdf', sourceFolderLabel: 'scores', status: 'synced' },
    b: { sha256Checksum: 'h1', localPath: 'song-b/y.pdf', sourceFolderLabel: 'recordings', status: 'synced' },
    c: { sha256Checksum: 'h1', localPath: 'song-c/z.pdf', sourceFolderLabel: 'scores', status: 'unchanged' },
    d: { sha256Checksum: 'h2', localPath: 'song-d/u.pdf', status: 'synced' }, // unique
    e: { sha256Checksum: 'h3', localPath: 'song-e/v.pdf', status: 'deleted' }, // excluded
    f: { sha256Checksum: 'h3', ignored: true, status: 'ignored' }, // excluded
  };

  const groups = findDuplicates(m);
  assert.equal(groups.length, 1); // only h1 has 2+ live files; deleted/ignored excluded
  assert.equal(groups[0].sha256, 'h1');
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].files.map((f) => f.id).sort(), ['a', 'b', 'c']);
});

test('shortcuts and unsupported files are classified ignored, never new', () => {
  const shortcut = {
    id: 's1',
    name: 'ref.pdf',
    mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: 'x' },
  };
  const jpg = { id: 'j1', name: 'cover.jpg', mimeType: 'image/jpeg' };
  const { counts, entries } = diffManifest(emptyManifest(), [classified(shortcut), classified(jpg)]);
  assert.equal(counts.ignored, 2);
  assert.equal(counts.new, undefined);
  assert.ok(entries.every((e) => e.status === 'ignored'));
});
