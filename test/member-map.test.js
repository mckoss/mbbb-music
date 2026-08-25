import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOUTH_WHIDBEY_BOUNDS,
  directionsUrl,
  fitMemberBounds,
  inferGigCoordinates,
  isMapCoordinate,
  pointPercent,
  shortGigDate,
  threeMonthCutoff,
} from '../src/lib/member-map.ts';

test('the default map includes Clinton and Greenbank', () => {
  const b = fitMemberBounds([]);
  assert.ok(b.south < 47.98 && b.north > 48.10);
  assert.ok(b.west < -122.74 && b.east > -122.32);
});

test('gig map fallbacks cover local and regional venues without geocoding', () => {
  assert.deepEqual(inferGigCoordinates('Summer show', 'Seattle, WA'), {
    latitude: 47.6062,
    longitude: -122.3321,
  });
  assert.deepEqual(inferGigCoordinates('Whidbey Island Fairgrounds', null), {
    latitude: 48.0301,
    longitude: -122.4029,
  });
  assert.equal(inferGigCoordinates('Mystery venue', 'Somewhere'), null);
});

test('gig map dates are MMM-dd and the recent window is three calendar months', () => {
  assert.equal(shortGigDate('2026-08-05'), 'Aug-05');
  assert.equal(shortGigDate('bad'), 'bad');
  assert.equal(threeMonthCutoff(new Date('2026-08-25T20:00:00Z')), '2026-05-25');
});

test('member pins expand the South Whidbey frame and receive padding', () => {
  const b = fitMemberBounds([{ latitude: 48.3, longitude: -122.9 }]);
  assert.ok(b.north > 48.3);
  assert.ok(b.west < -122.9);
  assert.ok(b.south < SOUTH_WHIDBEY_BOUNDS.south);
});

test('pointPercent projects the bounds corners', () => {
  assert.deepEqual(pointPercent(10, 20, { north: 10, south: 0, east: 20, west: 0 }), {
    left: 100,
    top: 0,
  });
});

test('coordinate and Google directions helpers reject junk and encode addresses', () => {
  assert.equal(isMapCoordinate(48, -122), true);
  assert.equal(isMapCoordinate(91, -122), false);
  const url = new URL(directionsUrl('123 Main St, Langley, WA'));
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('destination'), '123 Main St, Langley, WA');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
});
