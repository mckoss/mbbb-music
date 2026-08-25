import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AddressNotFoundError,
  GeocodingUnavailableError,
  geocodeHomeAddressIn,
  shouldGeocodeHomeAddress,
} from '../src/lib/server/geocoding.ts';

test('a changed address or an existing address missing a pin gets one lookup', () => {
  assert.equal(shouldGeocodeHomeAddress({ address: '2398 Sunlight Beach Road', addressChanged: true, hasPin: true, pinEdited: false }), true);
  assert.equal(shouldGeocodeHomeAddress({ address: '2398 Sunlight Beach Road', addressChanged: false, hasPin: false, pinEdited: false }), true);
  assert.equal(shouldGeocodeHomeAddress({ address: '2398 Sunlight Beach Road', addressChanged: true, hasPin: true, pinEdited: true }), false);
  assert.equal(shouldGeocodeHomeAddress({ address: null, addressChanged: true, hasPin: false, pinEdited: false }), false);
});

test('geocoding adds Washington context and restricts results to the member map', async () => {
  let requested;
  const point = await geocodeHomeAddressIn(async (url, init) => {
    requested = { url: new URL(url), init };
    return new Response(JSON.stringify([{ lat: '48.0123', lon: '-122.4567' }]), { status: 200 });
  }, '2398 Sunlight Beach Road');

  assert.deepEqual(point, { latitude: 48.0123, longitude: -122.4567 });
  assert.equal(requested.url.searchParams.get('q'), '2398 Sunlight Beach Road, Washington, USA');
  assert.equal(requested.url.searchParams.get('bounded'), '1');
  assert.equal(requested.url.searchParams.get('countrycodes'), 'us');
  assert.match(requested.init.headers['User-Agent'], /MBBB-Music/);
});

test('geocoding warns on missing, out-of-region, and unavailable results', async () => {
  await assert.rejects(
    geocodeHomeAddressIn(async () => new Response('[]', { status: 200 }), 'Unknown Road'),
    AddressNotFoundError,
  );
  await assert.rejects(
    geocodeHomeAddressIn(async () => new Response(JSON.stringify([{ lat: '40.1', lon: '-122.4' }]), { status: 200 }), 'Far Away'),
    AddressNotFoundError,
  );
  await assert.rejects(
    geocodeHomeAddressIn(async () => new Response('busy', { status: 503 }), 'Known Road'),
    GeocodingUnavailableError,
  );
});
