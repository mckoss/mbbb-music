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
    entry('gone', 'Baile - Tuba.pdf', 'sha-g', { status: 'deleted' }),
    entry('sc', 'Link to Baile', null, { status: 'ignored|google-drive-shortcut', assetType: undefined }),
    entry('zip', 'Baile.zipx', null, { status: 'ignored|unsupported-type:zipx', assetType: undefined }),
    entry('un', 'Baile - Flute.pdf', null, { status: 'unreachable' }),
    entry('err', 'Baile - Drums.pdf', null, { status: 'error', error: 'HTTP 403' }),
  ];
  assert.equal(handle(files, 'gone').state, 'removed');
  assert.equal(handle(files, 'sc').state, 'ignored');
  assert.match(handle(files, 'sc').detail, /shortcut/);
  assert.match(handle(files, 'zip').detail, /\.zipx/);
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
