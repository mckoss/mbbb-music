import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDriveFile, MAX_GENERIC_BYTES } from '../src/sync/classify.js';

test('classifies accepted asset types by mime', () => {
  const pdf = classifyDriveFile({ name: 'x.pdf', mimeType: 'application/pdf' });
  assert.equal(pdf.assetType, 'pdf');
  assert.deepEqual(pdf.download, { mode: 'media' });
  assert.equal(classifyDriveFile({ name: 'x.mp3', mimeType: 'audio/mpeg' }).assetType, 'mp3');
});

test('accepts native Google editor files as notes fetched via PDF export', () => {
  for (const mimeType of [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
    'application/vnd.google-apps.drawing',
  ]) {
    const c = classifyDriveFile({ name: 'Notes', mimeType });
    assert.equal(c.ignored, false, mimeType);
    // Typed `notes`, not `pdf`: a Google Doc is never a score, but it still
    // exports to PDF so it renders and downloads through the PDF path.
    assert.equal(c.assetType, 'notes', mimeType);
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

test('classifies an unreachable shortcut stand-in by its filename, not ignored', () => {
  const c = classifyDriveFile({
    name: 'Iron Man-Euphonium.pdf',
    mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: 'x' },
    unreachable: true,
  });
  assert.equal(c.unreachable, true);
  assert.equal(c.ignored, false);
  assert.equal(c.assetType, 'pdf'); // typed from the filename
  assert.equal(c.download, null); // never fetched
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

test('every other real file is downloaded as a generic file, unless too large', () => {
  // Nothing in Drive goes unrepresented: unrecognized types are still band material.
  for (const name of ['take.wav', 'tune.mid', 'chart.sib', 'score.musicxml', 'noext']) {
    const c = classifyDriveFile({ name, mimeType: 'application/octet-stream', size: '1048576' });
    assert.equal(c.ignored, false, name);
    assert.equal(c.assetType, 'file', name);
    assert.deepEqual(c.download, { mode: 'media' });
  }
  assert.equal(classifyDriveFile({ name: 'tune.mid', mimeType: 'audio/midi' }).ext, 'mid');
  assert.equal(classifyDriveFile({ name: 'noext', mimeType: 'application/octet-stream' }).ext, 'bin');
  // Too big for the store: left in Drive (listed on Extra Files as a link).
  const big = classifyDriveFile({ name: 'gig.mov', mimeType: 'video/quicktime', size: String(MAX_GENERIC_BYTES + 1) });
  assert.equal(big.ignored, true);
  assert.equal(big.ignoreReason, 'too-large');
  // A Google file with no export (a Form) stays ignored — nothing to download.
  assert.equal(classifyDriveFile({ name: 'Sign-up', mimeType: 'application/vnd.google-apps.form' }).ignoreReason, 'google-native-file');
});

test('PNG, GIF and WebP are images like JPEG', () => {
  for (const [name, mimeType] of [['a.png', 'image/png'], ['b.gif', 'image/gif'], ['c.webp', 'image/webp']]) {
    assert.equal(classifyDriveFile({ name, mimeType }).assetType, 'image', name);
  }
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
