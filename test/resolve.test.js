import { test } from 'node:test';
import assert from 'node:assert/strict';

import { partOptionLabel, partShortLabel } from '../src/lib/format.js';
import { activePdf } from '../src/lib/resolve.js';

function part(over) {
  return {
    sha256: 'sha',
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

function tune(parts) {
  return { slug: 'bella-ciao', title: 'Bella Ciao', parts, scores: [], audio: [] };
}

test('partOptionLabel leaves a uniquely-labelled part as the plain label', () => {
  const a = part({ sha256: 'a', partNumber: 1 });
  const b = part({ sha256: 'b', partNumber: 2 });
  assert.equal(partOptionLabel(a, [a, b]), 'Trumpet (B♭) 1');
  assert.equal(partOptionLabel(b, [a, b]), 'Trumpet (B♭) 2');
});

test('partOptionLabel disambiguates two same-labelled variants by filename', () => {
  // Two different Trumpet (B♭) arrangements, both with no part number — the exact
  // Bella Ciao case the dropdown could not tell apart.
  const a = part({ sha256: 'a', originalName: 'bella-ciao-for-marching-band-Trompette_en_Sib.pdf' });
  const b = part({ sha256: 'b', originalName: 'Bella Ciao v3.1 - Trumpet in Bb.pdf' });
  const la = partOptionLabel(a, [a, b]);
  const lb = partOptionLabel(b, [a, b]);
  assert.notEqual(la, lb); // distinguishable
  assert.ok(la.startsWith('Trumpet (B♭) — '));
  assert.match(la, /Trompette en Sib/);
  assert.match(lb, /v3\.1/);
});

test('partOptionLabel falls back to source when filenames are absent', () => {
  const a = part({ sha256: 'a', originalName: null, source: 'mutiny-bay-arrangements' });
  const b = part({ sha256: 'b', originalName: null, source: 'honk-all-stars' });
  assert.match(partOptionLabel(a, [a, b]), /mutiny-bay-arrangements/);
  assert.match(partOptionLabel(b, [a, b]), /honk-all-stars/);
});

test('partShortLabel drops the instrument, keeping just the part number', () => {
  const a = part({ sha256: 'a', partNumber: 1 });
  const b = part({ sha256: 'b', partNumber: 2 });
  assert.equal(partShortLabel(a, [a, b]), 'Part 1');
  assert.equal(partShortLabel(b, [a, b]), 'Part 2');
});

test('a combined chart reads "Part 1 & 2" (short) and "Trumpet (B♭) 1 & 2" (full)', () => {
  const a = part({ sha256: 'a', partNumber: 1, partNumbers: [1, 2] });
  assert.equal(partShortLabel(a, [a]), 'Part 1 & 2');
  assert.equal(partOptionLabel(a, [a]), 'Trumpet (B♭) 1 & 2');
});

test('partShortLabel disambiguates same-numbered siblings by variant tag', () => {
  // Two "Part 1" arrangements would collide, so each gets its filename tag.
  const a = part({ sha256: 'a', partNumber: 1, originalName: 'Bella Ciao - march.pdf' });
  const b = part({ sha256: 'b', partNumber: 1, originalName: 'Bella Ciao - v3.pdf' });
  const la = partShortLabel(a, [a, b]);
  const lb = partShortLabel(b, [a, b]);
  assert.notEqual(la, lb);
  assert.ok(la.startsWith('Part 1 — '));
  assert.match(lb, /v3/);
});

test('activePdf selects a specific variant by its sha (not by part number)', () => {
  const a = part({ sha256: 'aaa', originalName: 'arr-A.pdf' });
  const b = part({ sha256: 'bbb', originalName: 'arr-B.pdf' });
  const t = tune([a, b]);
  // Both have partNumber null; only a sha can address the second one.
  assert.equal(activePdf(t, 'trumpet', 'letter', 'bbb')?.sha, 'bbb');
  assert.equal(activePdf(t, 'trumpet', 'letter', 'aaa')?.sha, 'aaa');
  // Unknown/empty selection falls back to the first match.
  assert.equal(activePdf(t, 'trumpet', 'letter', null)?.sha, 'aaa');
  assert.equal(activePdf(t, 'trumpet', 'letter', 'nope')?.sha, 'aaa');
});

test("activePdf's label is the disambiguated variant label", () => {
  const a = part({ sha256: 'aaa', originalName: 'bella-ciao-for-marching-band-Trompette_en_Sib.pdf' });
  const b = part({ sha256: 'bbb', originalName: 'Bella Ciao v3.1 - Trumpet in Bb.pdf' });
  const t = tune([a, b]);
  assert.match(activePdf(t, 'trumpet', 'letter', 'bbb')?.label ?? '', /v3\.1/);
});
