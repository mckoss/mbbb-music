import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectAssetMetadata } from '../src/sync/metadata.js';

test('detects song + instrument + key', () => {
  const m = detectAssetMetadata({ originalName: 'Bad Guy - Trumpet in B-flat.pdf', songTitle: 'Bad Guy' });
  assert.equal(m.songTitle, 'Bad Guy');
  assert.equal(m.instrument, 'Trumpet');
  assert.equal(m.key, 'bflat');
  assert.equal(m.partNumber, null);
});

test('captures a trailing part number', () => {
  const m = detectAssetMetadata({ originalName: 'Bad Guy - Trumpet in B-flat 2.pdf', songTitle: 'Bad Guy' });
  assert.equal(m.partNumber, 2);
});

test('instrument with default key and no explicit key token', () => {
  const m = detectAssetMetadata({ originalName: 'Bad Guy - Alto Saxophone.pdf', songTitle: 'Bad Guy' });
  assert.equal(m.instrument, 'Alto saxophone');
  assert.equal(m.instrumentSlug, 'alto-sax');
  assert.equal(m.key, null);
});

test('unknown instrument yields null, song title still carried through', () => {
  const m = detectAssetMetadata({ originalName: 'Bad Guy - Kazoo.pdf', songTitle: 'Bad Guy' });
  assert.equal(m.instrument, null);
  assert.equal(m.songTitle, 'Bad Guy');
});

test('baritone saxophone is not misread as euphonium baritone', () => {
  const m = detectAssetMetadata({ originalName: 'Iron Man - Baritone Saxophone.pdf', songTitle: 'Iron Man' });
  assert.equal(m.instrument, 'Baritone saxophone');
  assert.equal(m.instrumentSlug, 'bari-sax');
});

test('the song title comes from the folder, so an index-folder file still detects its instrument', () => {
  // Parent folder is a by-instrument index, not the song. The instrument is
  // still detected from the filename; the song title is whatever folder context
  // is passed (the catalog resolves the real song later from the filename).
  const m = detectAssetMetadata({ originalName: 'Bad Guy - Melodica.pdf', songTitle: '50 Indexed By Instrument (INCOMPLETE)' });
  assert.equal(m.instrument, 'Melodica');
});
