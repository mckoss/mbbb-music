import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCatalog, applyCorrections } from '../src/sync/catalog.js';
import { describeHandling, ignoreReasonText } from '../src/sync/file-handling.js';
import { detectAssetMetadata } from '../src/sync/metadata.js';

// A synced entry in a "Baile" song folder, classified from its name like the sync does.
const entry = (id, name, sha, over = {}) => ({
  driveFileId: id,
  originalName: name,
  sha256: sha,
  status: 'synced',
  assetType: name.endsWith('.mp3') ? 'mp3' : 'pdf',
  sourceFolderLabel: 'Library',
  originalFolder: 'Baile',
  folderPath: ['Baile'],
  songFolderId: 'folder-baile',
  ...detectAssetMetadata({ originalName: name, songTitle: 'Baile' }),
  ...over,
});

const handle = (files, id, sources = ['Library']) => {
  const manifest = { files: Object.fromEntries(files.map((f) => [f.driveFileId, f])) };
  return describeHandling(id, manifest, buildCatalog(manifest, sources));
};

test('a part in a song: instrument, part, and the default copy', () => {
  const h = handle([entry('a', 'baile-Alto_Horn_in_Eb.pdf', 'sha-a'), entry('b', 'baile-Alto_Horn_in_Eb 2.pdf', 'sha-b')], 'b');
  assert.equal(h.state, 'in-library');
  assert.equal(h.placements.length, 1);
  const [p] = h.placements;
  assert.equal(p.song.title, 'Baile');
  assert.equal(p.bucket, 'parts');
  assert.equal(p.instrumentSlug, 'alto-horn');
  assert.equal(p.part, '2');
  assert.equal(p.default, true);
});

test('identical bytes: the second file is a duplicate and names the copy in use', () => {
  const files = [entry('a', 'baile-Alto_Horn_in_Eb.pdf', 'same'), entry('b', 'baile-Alto_Horn_in_Eb 2.pdf', 'same')];
  const h = handle(files, 'b');
  assert.equal(h.state, 'duplicate');
  assert.equal(h.canonical.id, 'a');
  assert.equal(h.canonical.location, 'Library / Baile');
  // ...and shows where that copy is placed.
  assert.equal(h.placements[0].part, null);
});

test('two copies of the same slot: one default, one alternate', () => {
  const files = [
    entry('a', 'Baile - Trumpet 1.pdf', 'sha-a', { modifiedTime: '2026-01-02' }),
    entry('b', 'Baile - Trumpet 1.pdf', 'sha-b', { modifiedTime: '2026-01-01' }),
  ];
  assert.equal(handle(files, 'a').placements[0].default, true);
  const alt = handle(files, 'b').placements[0];
  assert.equal(alt.default, false);
  assert.match(alt.notes[0], /alternate copy/);
});

test('a part alone in its print format is flagged', () => {
  const files = [
    entry('a', 'Baile - Alto Horn.pdf', 'sha-a'),
    entry('b', 'Baile - Alto Horn 2 lyre.pdf', 'sha-b'),
  ];
  const p = handle(files, 'b').placements[0];
  assert.equal(p.format, 'lyre');
  assert.ok(p.notes.some((n) => /only when the lyre format is selected/.test(n)));
});

test('files the library does not use say why', () => {
  const files = [
    entry('gone', 'Baile - Tuba.pdf', 'sha-g', { status: 'deleted', statusBeforeRemoval: 'pending' }),
    entry('sc', 'Link to Baile', null, { status: 'ignored|google-drive-shortcut', assetType: undefined }),
    entry('zip', 'Baile.zipx', null, { status: 'ignored|unsupported-type:zipx', assetType: undefined }),
    entry('un', 'Baile - Flute.pdf', null, { status: 'unreachable' }),
    entry('err', 'Baile - Drums.pdf', null, { status: 'error', error: 'HTTP 403' }),
  ];
  // Removed from Drive before it was ever downloaded: nothing to keep.
  assert.equal(handle(files, 'gone').state, 'removed');
  // Not stored, but still represented: listed on Extra Files with a Drive link.
  assert.equal(handle(files, 'sc').state, 'link-only');
  assert.match(handle(files, 'sc').detail, /shortcut/);
  assert.equal(handle(files, 'zip').state, 'link-only');
  assert.match(handle(files, 'zip').detail, /next sync downloads/);
  assert.equal(handle(files, 'un').state, 'unreachable');
  assert.deepEqual([handle(files, 'err').state, handle(files, 'err').detail], ['failed', 'HTTP 403']);
  assert.equal(handle(files, 'missing'), null);
  assert.match(ignoreReasonText('junk'), /system file/);
});

test('hidden by a correction: kept out of the player views', () => {
  const files = [entry('a', 'Baile - Alto Horn.pdf', 'sha-a')];
  const raw = { files: { a: files[0] } };
  const manifest = applyCorrections(raw, { file: { a: { hidden: 'true' } }, folder: {} });
  const h = describeHandling('a', manifest, buildCatalog(manifest, ['Library']));
  assert.equal(h.state, 'kept-out');
  assert.equal(h.placements[0].bucket, 'hiddenParts');
});

test('a loose file with no song is an Extra File', () => {
  const files = [
    entry('x', 'Warmup scales.pdf', 'sha-x', { sourceFolderLabel: 'Loose', originalFolder: undefined, folderPath: [], songTitle: 'Misc', songTitleSlug: 'misc' }),
  ];
  const manifest = { files: { x: files[0] } };
  const h = describeHandling('x', manifest, buildCatalog(manifest, ['Loose'], ['Loose']));
  assert.equal(h.state, 'extra');
});

test('a file deleted in Drive stays in the library, flagged, until archived', () => {
  const files = [entry('a', 'Baile - Alto Horn.pdf', 'sha-a', { status: 'deleted', statusBeforeRemoval: 'synced' })];
  const h = handle(files, 'a');
  assert.equal(h.state, 'in-library');
  assert.equal(h.removedFromDrive, true);
  assert.match(h.headline, /^Removed from Drive — still in the library/);
  assert.match(h.detail, /Archive it/);

  const raw = { files: { a: files[0] } };
  const manifest = applyCorrections(raw, { file: { a: { archived: 'true' } }, folder: {} });
  const archived = describeHandling('a', manifest, buildCatalog(manifest, ['Library']));
  assert.equal(archived.state, 'archived');
});

test('every Drive file is represented: stored files in songs or Extra Files, the rest as Drive links', () => {
  const files = [
    entry('form', 'Baile sign-up', null, { status: 'ignored|google-native-file', assetType: undefined }),
    entry('big', 'Baile rehearsal.mov', null, { status: 'ignored|too-large', assetType: undefined }),
    entry('ds', '.DS_Store', null, { status: 'ignored|junk', assetType: undefined }),
    entry('arch', 'Old form', null, { status: 'ignored|google-native-file', assetType: undefined, archived: true }),
    entry('lost', 'Elsewhere - Flute.pdf', null, { status: 'unreachable', songTitle: 'Nowhere', songTitleSlug: 'nowhere', shortcutTarget: 'T1' }),
  ];
  const manifest = { files: Object.fromEntries(files.map((f) => [f.driveFileId, f])) };
  const extras = buildCatalog(manifest, ['Library']).extras;
  const byId = Object.fromEntries(extras.map((x) => [x.driveFileId, x]));
  assert.deepEqual(Object.keys(byId).sort(), ['big', 'form', 'lost']); // not junk, not archived
  assert.equal(byId.form.linkOnly, true);
  assert.equal(byId.form.song, 'Baile');
  assert.match(byId.big.reason, /over 100 MB/);
  assert.equal(byId.form.driveUrl, 'https://drive.google.com/file/d/form/view');
  assert.equal(byId.lost.driveUrl, 'https://drive.google.com/file/d/T1/view'); // the shortcut's target
  assert.equal(byId.form.sha256, undefined);
});
