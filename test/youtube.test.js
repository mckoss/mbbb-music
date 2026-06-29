import { test } from 'node:test';
import assert from 'node:assert/strict';

import { youtubeId, youtubeThumb, youtubeWatchUrl } from '../src/lib/youtube.js';

test('youtubeId extracts the id from the common URL forms', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(youtubeId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(youtubeId(`https://youtu.be/${id}`), id);
  assert.equal(youtubeId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(youtubeId(`https://www.youtube.com/shorts/${id}`), id);
  // extra query params around the id still resolve
  assert.equal(youtubeId(`https://www.youtube.com/watch?v=${id}&t=42s`), id);
  assert.equal(youtubeId(`https://youtu.be/${id}?si=abc`), id);
  // a bare id pasted on its own
  assert.equal(youtubeId(id), id);
});

test('youtubeId rejects non-YouTube and empty input', () => {
  assert.equal(youtubeId(''), null);
  assert.equal(youtubeId('   '), null);
  assert.equal(youtubeId('https://vimeo.com/123456'), null);
  assert.equal(youtubeId('not a url'), null);
  assert.equal(youtubeId('https://www.youtube.com/watch?v=tooShort'), null);
});

test('canonical watch URL and thumbnail are derived from the id', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(youtubeWatchUrl(id), `https://www.youtube.com/watch?v=${id}`);
  assert.equal(youtubeThumb(id), `https://img.youtube.com/vi/${id}/mqdefault.jpg`);
});
