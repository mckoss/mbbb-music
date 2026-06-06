import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAsset } from '../src/sync/parse-filename.js';

test('score PDF: filename is the slugified original; song + instrument + key detected', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Trumpet in B-flat.pdf',
    songTitle: 'Bad Guy',
    ext: 'pdf',
  });
  assert.equal(p.instrument, 'Trumpet');
  assert.equal(p.key, 'bflat');
  assert.equal(p.partNumber, null);
  // Canonical name keeps the original filename (slugified), not a rebuilt one.
  assert.equal(p.canonicalName, 'bad-guy-trumpet-in-bflat.pdf');
  assert.equal(p.localPath, 'bad-guy/bad-guy-trumpet-in-bflat.pdf');
});

test('score PDF: trailing part number is captured as metadata', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Trumpet in B-flat 2.pdf',
    songTitle: 'Bad Guy',
    ext: 'pdf',
  });
  assert.equal(p.partNumber, 2);
  assert.equal(p.canonicalName, 'bad-guy-trumpet-in-bflat-2.pdf');
});

test('score PDF: instrument with default Eb key and no explicit key token', () => {
  const p = parseAsset({
    originalName: 'Bad Guy - Alto Saxophone.pdf',
    songTitle: 'Bad Guy',
    ext: 'pdf',
  });
  assert.equal(p.instrument, 'Alto saxophone');
  assert.equal(p.instrumentSlug, 'alto-sax');
  // No key token in the name, so no key segment is detected.
  assert.equal(p.key, null);
  // Filename preserves the original spelling, not the instrument slug.
  assert.equal(p.canonicalName, 'bad-guy-alto-saxophone.pdf');
});

test('index-folder file keeps the song title from its original filename', () => {
  // The parent folder is a by-instrument index, NOT the song. The original
  // filename is the only place "Bad Guy" survives — it must be preserved.
  const p = parseAsset({
    sourceLabel: 'MBBB Song Library',
    originalName: 'Bad Guy - Melodica.pdf',
    songTitle: '50 Indexed By Instrument (INCOMPLETE)',
    ext: 'pdf',
  });
  assert.equal(p.canonicalName, 'bad-guy-melodica.pdf');
  assert.equal(
    p.localPath,
    'mbbb-song-library/50-indexed-by-instrument-incomplete/bad-guy-melodica.pdf',
  );
});

test('mp3 and musescore live in the song folder with original slug names', () => {
  const mp3 = parseAsset({ originalName: 'Bad Guy Practice Track.mp3', songTitle: 'Bad Guy', ext: 'mp3' });
  assert.equal(mp3.localPath, 'bad-guy/bad-guy-practice-track.mp3');

  const mscz = parseAsset({ originalName: 'Bad Guy.mscz', songTitle: 'Bad Guy', ext: 'mscz' });
  assert.equal(mscz.localPath, 'bad-guy/bad-guy.mscz');
});

test('sourceLabel prefixes the local path so two libraries cannot collide', () => {
  const a = parseAsset({
    sourceLabel: 'Mutiny Bay Arrangements',
    originalName: 'Iron Man - Trumpet.pdf',
    songTitle: 'Iron Man',
    ext: 'pdf',
  });
  assert.equal(a.sourceSlug, 'mutiny-bay-arrangements');
  assert.equal(a.localPath, 'mutiny-bay-arrangements/iron-man/iron-man-trumpet.pdf');

  // Same song + file in a different library lands on a distinct path.
  const b = parseAsset({
    sourceLabel: "MBBBB's Song Library",
    originalName: 'Iron Man - Trumpet.pdf',
    songTitle: 'Iron Man',
    ext: 'pdf',
  });
  assert.equal(b.localPath, 'mbbbb-s-song-library/iron-man/iron-man-trumpet.pdf');
  assert.notEqual(a.localPath, b.localPath);
});

test('baritone saxophone is not misread as euphonium baritone', () => {
  const p = parseAsset({
    originalName: 'Iron Man - Baritone Saxophone.pdf',
    songTitle: 'Iron Man',
    ext: 'pdf',
  });
  assert.equal(p.instrument, 'Baritone saxophone');
  assert.equal(p.instrumentSlug, 'bari-sax');
});
