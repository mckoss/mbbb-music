import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreUrls,
  gigPageUrls,
  urlsToDelete,
  shaFromRenderPath,
  buildShaSongMap,
} from '../src/lib/offline-urls.js';

const SHA = 'a'.repeat(64);
const SHB = 'b'.repeat(64);

test('scoreUrls lists the info sidecar then one webp per page, with the rev', () => {
  assert.deepEqual(scoreUrls('abc', 3, 7), [
    '/render/abc/info',
    '/render/abc/1.webp?r=7',
    '/render/abc/2.webp?r=7',
    '/render/abc/3.webp?r=7',
  ]);
});

test('scoreUrls of a 1-page score is info + one image', () => {
  assert.deepEqual(scoreUrls('z', 1, 1), ['/render/z/info', '/render/z/1.webp?r=1']);
});

test('gigPageUrls covers the page and its SvelteKit data load, id-encoded', () => {
  assert.deepEqual(gigPageUrls('summer fair'), [
    '/gigs/summer%20fair',
    '/gigs/summer%20fair/__data.json',
  ]);
});

function manifest(gigId, urls) {
  return { gigId, title: gigId, instrument: 'trumpet', format: 'letter', urls, pageCount: 0, savedAt: '' };
}

test('urlsToDelete returns everything when no other gig shares the URLs', () => {
  const target = manifest('a', ['/gigs/a', '/render/x/1.webp?r=1']);
  assert.deepEqual(urlsToDelete(target, []), ['/gigs/a', '/render/x/1.webp?r=1']);
});

test('urlsToDelete keeps score pages still used by another downloaded gig', () => {
  const target = manifest('a', ['/gigs/a', '/render/x/1.webp?r=1', '/render/y/1.webp?r=1']);
  const other = manifest('b', ['/gigs/b', '/render/y/1.webp?r=1']); // shares score y
  // x is unique to a → deleted; y is shared with b → kept; a's own page → deleted.
  assert.deepEqual(urlsToDelete(target, [other]), ['/gigs/a', '/render/x/1.webp?r=1']);
});

test('urlsToDelete deletes nothing when another gig is a superset', () => {
  const target = manifest('a', ['/render/x/1.webp?r=1']);
  const other = manifest('b', ['/render/x/1.webp?r=1', '/render/z/1.webp?r=1']);
  assert.deepEqual(urlsToDelete(target, [other]), []);
});

test('shaFromRenderPath extracts the hash from a render path, else null', () => {
  assert.equal(shaFromRenderPath(`/render/${SHA}/3.webp`), SHA);
  assert.equal(shaFromRenderPath(`/render/${SHA}/info`), SHA);
  assert.equal(shaFromRenderPath('/render/notahash/1.webp'), null);
  assert.equal(shaFromRenderPath('/blob/' + SHA), null);
  assert.equal(shaFromRenderPath('/gigs/x'), null);
});

test('buildShaSongMap maps parts, scores, and notes to their song with a label', () => {
  const catalog = {
    tunes: [
      {
        slug: 'el-matador',
        title: 'El Matador',
        parts: [{ sha256: SHA, instrumentSlug: 'trumpet', instrument: 'Trumpet', key: 'B♭', partNumber: 2 }],
        scores: [{ sha256: SHB, originalName: null }],
        notes: [],
      },
    ],
  };
  const map = buildShaSongMap(catalog);
  assert.deepEqual(map.get(SHA), { songSlug: 'el-matador', songTitle: 'El Matador', label: 'Trumpet B♭ 2' });
  assert.deepEqual(map.get(SHB), { songSlug: 'el-matador', songTitle: 'El Matador', label: 'Full score' });
  assert.equal(map.get('missing'), undefined);
});

test('buildShaSongMap keeps the first song a shared hash is seen under', () => {
  const catalog = {
    tunes: [
      { slug: 'a', title: 'A', parts: [{ sha256: SHA, instrumentSlug: 't', instrument: 'T', key: null, partNumber: null }], scores: [], notes: [] },
      { slug: 'b', title: 'B', parts: [{ sha256: SHA, instrumentSlug: 't', instrument: 'T', key: null, partNumber: null }], scores: [], notes: [] },
    ],
  };
  assert.equal(buildShaSongMap(catalog).get(SHA).songSlug, 'a');
});
