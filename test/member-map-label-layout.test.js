import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutMemberMapLabels, mapLabelLeaderEnd } from '../src/lib/member-map-label-layout.ts';

const overlaps = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

const hits = (rect, dot) => {
  const x = Math.max(rect.x, Math.min(dot.x, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(dot.y, rect.y + rect.height));
  return Math.hypot(x - dot.x, y - dot.y) < dot.radius;
};

test('dense member and gig labels avoid every dot and each other', () => {
  const targets = Array.from({ length: 7 }, (_, index) => ({
    id: `item-${index}`,
    x: 330 + (index % 3) * 12,
    y: 220 + Math.floor(index / 3) * 12,
    width: 150,
    height: 50,
    radius: 6,
  }));
  const placements = layoutMemberMapLabels(targets, { width: 760, height: 520 });
  assert.equal(placements.length, targets.length);
  for (const placement of placements) {
    assert.ok(placement.x >= 6 && placement.y >= 6);
    assert.ok(placement.x + placement.width <= 754);
    assert.ok(placement.y + placement.height <= 514);
    for (const dot of targets) assert.equal(hits(placement, dot), false);
  }
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) assert.equal(overlaps(placements[i], placements[j]), false);
  }
});

test('leader ends on the nearest datablock edge', () => {
  assert.deepEqual(mapLabelLeaderEnd({ x: 100, y: 80, width: 150, height: 50 }, { x: 40, y: 100 }), { x: 100, y: 100 });
  assert.deepEqual(mapLabelLeaderEnd({ x: 100, y: 80, width: 150, height: 50 }, { x: 170, y: 180 }), { x: 170, y: 130 });
});
