import { test } from 'node:test';
import assert from 'node:assert/strict';

import { track } from '../src/lib/track.ts';

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('track posts activity with the original client timestamp', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true };
  };

  track('score-view', 'Freedom', 'trumpet');
  await tick();

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].type, 'score-view');
  assert.equal(bodies[0].label, 'Freedom');
  assert.equal(bodies[0].detail, 'trumpet');
  assert.match(bodies[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('track remains fire-and-forget when activity cannot post', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  assert.doesNotThrow(() => track('performance', 'Summer Gig', 'set:one'));
  await tick();
});
