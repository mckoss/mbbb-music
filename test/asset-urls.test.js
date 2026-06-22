import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAssetIndex, urlForSha } from '../src/lib/asset-urls.js';

function part(over) {
  return {
    sha256: 'p1',
    instrumentSlug: 'trumpet',
    instrument: 'Trumpet',
    key: 'bflat',
    partNumber: null,
    format: 'letter',
    originalName: null,
    source: null,
    ...over,
  };
}

function tune(over) {
  return {
    slug: 'el-matador',
    title: 'El Matador',
    status: 'Active',
    lastModified: null,
    parts: [],
    scores: [],
    notes: [],
    audio: [],
    musescore: [],
    images: [],
    files: [],
    unreachable: [],
    ...over,
  };
}

test('instrument part → score/<song>/<instrument>-<key>.pdf, addressed by sha', () => {
  const idx = buildAssetIndex({ tunes: [tune({ parts: [part({ sha256: 'aaa' })] })] });
  assert.equal(idx.byPath.get('score/el-matador/trumpet-bflat.pdf'), 'aaa');
  assert.equal(urlForSha(idx, 'aaa'), '/score/el-matador/trumpet-bflat.pdf');
});

test('partNumber and a non-letter format are encoded in the name', () => {
  const idx = buildAssetIndex({
    tunes: [tune({ parts: [part({ sha256: 'b', partNumber: 2, format: 'lyre' })] })],
  });
  assert.equal(idx.byPath.get('score/el-matador/trumpet-bflat-part2-lyre.pdf'), 'b');
});

test('a combined chart keeps both numbers in the path and the download name', () => {
  const idx = buildAssetIndex({
    tunes: [
      tune({
        slug: 'unholy',
        parts: [part({ sha256: 'c', partNumber: 1, partNumbers: [1, 2], format: 'lyre' })],
      }),
    ],
  });
  assert.equal(idx.byPath.get('score/unholy/trumpet-bflat-part1-2-lyre.pdf'), 'c');
  assert.equal(idx.nameBySha.get('c'), 'unholy-trumpet-bflat-part1-2-lyre.pdf');
});

test('canonical download name is song-prefixed and always spells out the format', () => {
  const idx = buildAssetIndex({
    tunes: [
      tune({
        slug: 'baile-inolvidable',
        parts: [
          part({ sha256: 'L', partNumber: 1, format: 'letter' }),
          part({ sha256: 'Y', partNumber: 1, format: 'lyre' }),
        ],
      }),
    ],
  });
  // The URL path keeps Letter implicit (short), but the DOWNLOAD name spells it out.
  assert.equal(idx.nameBySha.get('L'), 'baile-inolvidable-trumpet-bflat-part1-letter.pdf');
  assert.equal(idx.nameBySha.get('Y'), 'baile-inolvidable-trumpet-bflat-part1-lyre.pdf');
});

test('colliding names get -2, -3 suffixes; both resolve', () => {
  const idx = buildAssetIndex({
    tunes: [
      tune({
        parts: [
          part({ sha256: 'x1' }),
          part({ sha256: 'x2' }), // identical instrument/key/format → same base name
        ],
      }),
    ],
  });
  assert.equal(idx.byPath.get('score/el-matador/trumpet-bflat.pdf'), 'x1');
  assert.equal(idx.byPath.get('score/el-matador/trumpet-bflat-2.pdf'), 'x2');
});

test('full scores, notes, audio, source land in their families', () => {
  const idx = buildAssetIndex({
    tunes: [
      tune({
        scores: [{ sha256: 's', originalName: null, source: null }],
        notes: [{ sha256: 'n', originalName: 'Rehearsal Notes.gdoc', source: null }],
        audio: [{ sha256: 'a', originalName: 'Full Band Take.mp3', source: null }],
        musescore: [{ sha256: 'm', originalName: null, source: null }],
      }),
    ],
  });
  assert.equal(idx.byPath.get('score/el-matador/full-score.pdf'), 's');
  assert.equal(idx.byPath.get('score/el-matador/notes-rehearsal-notes.pdf'), 'n');
  assert.equal(idx.byPath.get('audio/el-matador/full-band-take.mp3'), 'a');
  assert.equal(idx.byPath.get('source/el-matador/full-score.mscz'), 'm');
});

test('display slug, when present, drives the song segment', () => {
  const idx = buildAssetIndex({
    tunes: [tune({ slug: 'raw-id-123', displaySlug: 'El Matador!', parts: [part({ sha256: 'd' })] })],
  });
  assert.equal(urlForSha(idx, 'd'), '/score/el-matador/trumpet-bflat.pdf');
});

test('files keep their original extension; extras get the file/extras prefix', () => {
  const idx = buildAssetIndex({
    tunes: [tune({ files: [{ sha256: 'f', originalName: 'Set List.txt', source: null, assetType: 'doc' }] })],
    extras: [{ sha256: 'e', originalName: 'flyer.PNG', source: null, assetType: 'image' }],
  });
  assert.equal(idx.byPath.get('file/el-matador/set-list.txt'), 'f');
  assert.equal(idx.byPath.get('file/extras/flyer.png'), 'e');
});

test('urlForSha returns null for an unmapped hash', () => {
  const idx = buildAssetIndex({ tunes: [] });
  assert.equal(urlForSha(idx, 'nope'), null);
});
