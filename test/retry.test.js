import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchRetrying, mapLimited } from '../src/lib/retry.ts';

const noSleep = async () => {};
const seq = (...steps) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === 'throw') throw new Error('network down');
    return new Response('x', { status: step });
  };
  return { fn, calls };
};

test('fetchRetrying recovers from a 504 or a dropped connection', async () => {
  const a = seq(504, 'throw', 200);
  const res = await fetchRetrying('/render/x/info', [1, 1], a.fn, noSleep);
  assert.equal(res.status, 200);
  assert.equal(a.calls.length, 3);
});

test('fetchRetrying gives up after its retries, and never retries a 4xx', async () => {
  const down = seq('throw');
  assert.equal((await fetchRetrying('/u', [1, 1], down.fn, noSleep)).status, 504);
  assert.equal(down.calls.length, 3);
  const missing = seq(404);
  assert.equal((await fetchRetrying('/u', [1, 1], missing.fn, noSleep)).status, 404);
  assert.equal(missing.calls.length, 1);
});

test('mapLimited keeps order and never exceeds the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimited([5, 1, 4, 2, 3, 6], 3, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, n));
    inFlight--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 60]);
  assert.equal(peak, 3);
});
