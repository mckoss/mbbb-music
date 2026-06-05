import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyManifest, diffManifest, isChanged } from '../src/sync/manifest.js';
import { classifyDriveFile } from '../src/sync/classify.js';

function classified(file) {
  return { file, classification: classifyDriveFile(file) };
}

const pdf = (over = {}) => ({
  id: 'f1',
  name: 'Bad Guy - Trumpet.pdf',
  mimeType: 'application/pdf',
  modifiedTime: '2026-01-01T00:00:00.000Z',
  md5Checksum: 'aaa',
  version: '1',
  ...over,
});

test('isChanged prefers checksum, then version, then time+size', () => {
  assert.equal(isChanged({ md5Checksum: 'a' }, { md5Checksum: 'a' }), false);
  assert.equal(isChanged({ md5Checksum: 'a' }, { md5Checksum: 'b' }), true);
  assert.equal(isChanged({ version: '1' }, { version: '1' }), false);
  assert.equal(isChanged({ version: '1' }, { version: '2' }), true);
  assert.equal(isChanged({ modifiedTime: 't', size: 5 }, { modifiedTime: 't', size: 5 }), false);
  assert.equal(isChanged({ modifiedTime: 't', size: 5 }, { modifiedTime: 't', size: 9 }), true);
});

test('a never-seen asset is classified new', () => {
  const { entries, counts } = diffManifest(emptyManifest(), [classified(pdf())]);
  assert.equal(counts.new, 1);
  assert.equal(entries[0].status, 'new');
});

test('same checksum is unchanged; different checksum is changed', () => {
  const manifest = emptyManifest();
  manifest.files['f1'] = { driveFileId: 'f1', md5Checksum: 'aaa', version: '1', status: 'synced', localPath: 'bad-guy/x.pdf' };

  const unchanged = diffManifest(manifest, [classified(pdf({ md5Checksum: 'aaa' }))]);
  assert.equal(unchanged.counts.unchanged, 1);

  const changed = diffManifest(manifest, [classified(pdf({ md5Checksum: 'zzz', version: '2' }))]);
  assert.equal(changed.counts.changed, 1);
});

test('a tracked file no longer present is deleted (archived), once', () => {
  const manifest = emptyManifest();
  manifest.files['gone'] = { driveFileId: 'gone', md5Checksum: 'x', status: 'synced', localPath: 'bad-guy/gone.pdf' };

  const first = diffManifest(manifest, []);
  assert.equal(first.counts.deleted, 1);
  assert.equal(first.entries[0].status, 'deleted');

  // Once marked deleted in the manifest, it should not be re-reported as deleted.
  manifest.files['gone'].status = 'deleted';
  const second = diffManifest(manifest, []);
  assert.equal(second.counts.deleted, undefined);
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
