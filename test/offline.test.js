import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreUrls, gigPageUrls, urlsToDelete } from '../src/lib/offline-urls.js';

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
