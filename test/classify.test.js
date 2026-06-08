import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDriveFile } from '../src/sync/classify.js';

test('classifies accepted asset types by mime', () => {
  const pdf = classifyDriveFile({ name: 'x.pdf', mimeType: 'application/pdf' });
  assert.equal(pdf.assetType, 'pdf');
  assert.deepEqual(pdf.download, { mode: 'media' });
  assert.equal(classifyDriveFile({ name: 'x.mp3', mimeType: 'audio/mpeg' }).assetType, 'mp3');
});

test('accepts native Google editor files as PDFs fetched via export', () => {
  for (const mimeType of [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
    'application/vnd.google-apps.drawing',
  ]) {
    const c = classifyDriveFile({ name: 'Notes', mimeType });
    assert.equal(c.ignored, false, mimeType);
    assert.equal(c.assetType, 'pdf', mimeType);
    assert.equal(c.ext, 'pdf', mimeType);
    assert.deepEqual(c.download, { mode: 'export', mimeType: 'application/pdf' }, mimeType);
  }
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

test('ignores folders and non-exportable native Google files', () => {
  assert.equal(classifyDriveFile({ name: 'Songs', mimeType: 'application/vnd.google-apps.folder' }).ignoreReason, 'folder');
  assert.equal(
    classifyDriveFile({ name: 'Sign-up', mimeType: 'application/vnd.google-apps.form' }).ignoreReason,
    'google-native-file',
  );
});

test('ignores unsupported asset types with a descriptive reason', () => {
  assert.equal(classifyDriveFile({ name: 'data.db', mimeType: 'application/octet-stream' }).ignoreReason, 'unsupported-type:db');
  assert.equal(classifyDriveFile({ name: 'noext', mimeType: 'application/octet-stream' }).ignoreReason, 'unknown-type');
});

test('accepts images as downloadable/embeddable assets', () => {
  const jpg = classifyDriveFile({ name: 'cover.jpg', mimeType: 'image/jpeg' });
  assert.equal(jpg.ignored, false);
  assert.equal(jpg.assetType, 'image');
  assert.deepEqual(jpg.download, { mode: 'media' });
  // Recognized by extension even when Drive gives a generic mime.
  assert.equal(classifyDriveFile({ name: 'photo.JPEG', mimeType: 'application/octet-stream' }).assetType, 'image');
});

test('ignores OS/system junk files', () => {
  for (const name of ['._You_Move-melody.pdf', '.DS_Store', 'delete', 'Thumbs.db', '.hidden']) {
    const c = classifyDriveFile({ name, mimeType: 'application/pdf' });
    assert.equal(c.ignored, true, `${name} should be ignored`);
    assert.equal(c.ignoreReason, 'junk', `${name} reason`);
  }
  // A normal file is not junk.
  assert.equal(classifyDriveFile({ name: 'Bad Guy - Trumpet.pdf', mimeType: 'application/pdf' }).ignored, false);
});

test('accepts uploaded .docx (download-only) and .zip archives', () => {
  const docx = classifyDriveFile({
    name: 'Notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.equal(docx.ignored, false);
  assert.equal(docx.assetType, 'doc');
  assert.deepEqual(docx.download, { mode: 'media' }); // downloaded as-is, not exported

  const zip = classifyDriveFile({ name: 'charts.zip', mimeType: 'application/zip' });
  assert.equal(zip.ignored, false);
  assert.equal(zip.assetType, 'archive');
});
