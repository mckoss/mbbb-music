import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDriveFile } from '../src/sync/classify.js';

test('classifies accepted asset types by mime', () => {
  assert.equal(classifyDriveFile({ name: 'x.pdf', mimeType: 'application/pdf' }).assetType, 'pdf');
  assert.equal(classifyDriveFile({ name: 'x.mp3', mimeType: 'audio/mpeg' }).assetType, 'mp3');
});

test('classifies MuseScore files by extension when mime is generic', () => {
  const c = classifyDriveFile({ name: 'Bad Guy.mscz', mimeType: 'application/octet-stream' });
  assert.equal(c.assetType, 'musescore');
  assert.equal(c.ext, 'mscz');
  assert.equal(c.ignored, false);
});

test('ignores Google Drive shortcut files even when named .pdf', () => {
  const c = classifyDriveFile({
    name: 'Reference.pdf',
    mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: 'abc' },
  });
  assert.equal(c.assetType, null);
  assert.equal(c.ignored, true);
  assert.equal(c.ignoreReason, 'google-drive-shortcut');
});

test('ignores shortcuts detected only via shortcutDetails', () => {
  const c = classifyDriveFile({ name: 'thing.pdf', mimeType: 'application/pdf', shortcutDetails: { targetId: 'x' } });
  assert.equal(c.ignored, true);
  assert.equal(c.ignoreReason, 'google-drive-shortcut');
});

test('ignores folders and native Google files', () => {
  assert.equal(classifyDriveFile({ name: 'Songs', mimeType: 'application/vnd.google-apps.folder' }).ignoreReason, 'folder');
  assert.equal(
    classifyDriveFile({ name: 'Notes', mimeType: 'application/vnd.google-apps.document' }).ignoreReason,
    'google-native-file',
  );
});

test('ignores unsupported asset types with a descriptive reason', () => {
  assert.equal(classifyDriveFile({ name: 'cover.jpg', mimeType: 'image/jpeg' }).ignoreReason, 'unsupported-type:jpg');
  assert.equal(classifyDriveFile({ name: 'noext', mimeType: 'application/octet-stream' }).ignoreReason, 'unknown-type');
});
