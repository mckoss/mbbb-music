import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCountInWav, COUNT_IN_LEAD_SECONDS } from '../src/lib/count-in.ts';

function text(view, offset, length) {
  return String.fromCharCode(...new Uint8Array(view.buffer, offset, length));
}

function peakNear(view, seconds, sampleRate, windowSeconds = 0.04) {
  const first = Math.round(seconds * sampleRate);
  const count = Math.round(windowSeconds * sampleRate);
  let peak = 0;
  for (let i = first; i < first + count; i++) {
    peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true)));
  }
  return peak;
}

test('buildCountInWav creates a playable mono PCM WAV of the requested duration', () => {
  const beats = 4;
  const period = 0.5;
  const wav = buildCountInWav(beats, period);
  const view = new DataView(wav);

  assert.equal(text(view, 0, 4), 'RIFF');
  assert.equal(text(view, 8, 4), 'WAVE');
  assert.equal(text(view, 12, 4), 'fmt ');
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(view, 36, 4), 'data');

  const sampleRate = view.getUint32(24, true);
  const frames = view.getUint32(40, true) / 2;
  assert.equal(sampleRate, 22_050);
  assert.ok(Math.abs(frames / sampleRate - (COUNT_IN_LEAD_SECONDS + beats * period)) < 1 / sampleRate);
});

test('buildCountInWav places every click on its beat and accents the last one', () => {
  const beats = 3;
  const period = 0.4;
  const view = new DataView(buildCountInWav(beats, period));
  const sampleRate = view.getUint32(24, true);
  const peaks = Array.from({ length: beats }, (_, i) =>
    peakNear(view, COUNT_IN_LEAD_SECONDS + i * period, sampleRate)
  );

  assert.ok(peaks[0] > 10_000);
  assert.ok(peaks[1] > 10_000);
  assert.ok(peaks[2] > peaks[1] * 1.4);
  assert.equal(peakNear(view, 0, sampleRate, COUNT_IN_LEAD_SECONDS / 2), 0);
});

test('buildCountInWav rejects invalid count shapes', () => {
  assert.throws(() => buildCountInWav(0, 1), RangeError);
  assert.throws(() => buildCountInWav(4, 0), RangeError);
});
