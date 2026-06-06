import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAsset } from '../src/sync/parse-filename.js';

test('score PDF: song + instrument + key', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Trumpet in B-flat.pdf',
    songTitle: 'Bad Guy',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(p.instrument, 'Trumpet');
  assert.equal(p.key, 'bflat');
  assert.equal(p.partNumber, null);
  assert.equal(p.canonicalName, 'bad-guy-trumpet-bflat.pdf');
  assert.equal(p.localPath, 'bad-guy/bad-guy-trumpet-bflat.pdf');
});

test('score PDF: trailing part number is captured', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Trumpet in B-flat 2.pdf',
    songTitle: 'Bad Guy',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(p.partNumber, 2);
  assert.equal(p.canonicalName, 'bad-guy-trumpet-bflat-2.pdf');
});

test('score PDF: instrument with default Eb key and no explicit key token', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Alto Saxophone.pdf',
    songTitle: 'Bad Guy',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(p.instrument, 'Alto saxophone');
  assert.equal(p.instrumentSlug, 'alto-sax');
  // No key token in the name, so no key segment is emitted.
  assert.equal(p.key, null);
  assert.equal(p.canonicalName, 'bad-guy-alto-sax.pdf');
});

test('score PDF: unknown instrument falls back to descriptor, still grouped by song', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Kazoo.pdf',
    songTitle: 'Bad Guy',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(p.instrument, null);
  assert.equal(p.songSlug, 'bad-guy');
  assert.equal(p.canonicalName, 'bad-guy-kazoo.pdf');
});

test('mp3 and musescore live in the song folder with slug names', () => {
  const mp3 = parseAsset({ originalName: 'Bad Guy Practice Track.mp3', songTitle: 'Bad Guy', assetType: 'mp3', ext: 'mp3' });
  assert.equal(mp3.localPath, 'bad-guy/bad-guy-practice-track.mp3');

  const mscz = parseAsset({ originalName: 'Bad Guy.mscz', songTitle: 'Bad Guy', assetType: 'musescore', ext: 'mscz' });
  assert.equal(mscz.localPath, 'bad-guy/bad-guy.mscz');
});

test('sourceLabel prefixes the local path so two libraries cannot collide', () => {
  const a = parseAsset({
    sourceLabel: 'Mutiny Bay Arrangements',
    originalName: 'Iron Man - Trumpet.pdf',
    songTitle: 'Iron Man',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(a.sourceSlug, 'mutiny-bay-arrangements');
  assert.equal(a.localPath, 'mutiny-bay-arrangements/iron-man/iron-man-trumpet.pdf');

  // Same song + file in a different library lands on a distinct path.
  const b = parseAsset({
    sourceLabel: "MBBBB's Song Library",
    originalName: 'Iron Man - Trumpet.pdf',
    songTitle: 'Iron Man',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(b.localPath, 'mbbbb-s-song-library/iron-man/iron-man-trumpet.pdf');
  assert.notEqual(a.localPath, b.localPath);
});

test('baritone saxophone is not misread as euphonium baritone', () => {
  const p = parseAsset({
    originalName: 'Iron Man - Baritone Saxophone.pdf',
    songTitle: 'Iron Man',
    assetType: 'pdf',
    ext: 'pdf',
  });
  assert.equal(p.instrument, 'Baritone saxophone');
  assert.equal(p.instrumentSlug, 'bari-sax');
});
