// One-shot home-address geocoding for profile saves. Member addresses are sent
// only when a location is actually needed; they are never placed in application
// logs or in the committed public basemap.

export interface GeocodedPoint {
  latitude: number;
  longitude: number;
}

export class AddressNotFoundError extends Error {}
export class GeocodingUnavailableError extends Error {}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'MBBB-Music member-map (https://mutinybaybrassband.com)';
const FETCH_TIMEOUT_MS = 6_000;
const MIN_REQUEST_INTERVAL_MS = 1_000;
// Same regional frame as static/maps/member-map.json. Bounded lookup prevents a
// short street-only address from silently landing on a similarly named road far
// away from the map.
const REGION = { south: 47.15, west: -123.25, north: 48.45, east: -121.9 };

type FetchLike = typeof fetch;
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function regionalQuery(address: string): string {
  return /\b(?:WA|Washington)\b/i.test(address)
    ? address
    : `${address}, Washington, USA`;
}

/** Whether a save needs an address lookup instead of preserving a chosen pin. */
export function shouldGeocodeHomeAddress(input: {
  address: string | null;
  addressChanged: boolean;
  hasPin: boolean;
  pinEdited: boolean;
}): boolean {
  return Boolean(input.address && !input.pinEdited && (input.addressChanged || !input.hasPin));
}

/** Injectable implementation used by tests and the rate-limited public wrapper. */
export async function geocodeHomeAddressIn(fetchFn: FetchLike, address: string): Promise<GeocodedPoint> {
  const params = new URLSearchParams({
    q: regionalQuery(address),
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    layer: 'address',
    viewbox: `${REGION.west},${REGION.north},${REGION.east},${REGION.south}`,
    bounded: '1',
  });

  let response: Response;
  try {
    response = await fetchFn(`${ENDPOINT}?${params}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new GeocodingUnavailableError('Address lookup is temporarily unavailable.');
  }
  if (!response.ok) throw new GeocodingUnavailableError('Address lookup is temporarily unavailable.');

  let results: unknown;
  try {
    results = await response.json();
  } catch {
    throw new GeocodingUnavailableError('Address lookup returned an invalid response.');
  }
  const match = Array.isArray(results) ? results[0] : null;
  const latitude = Number(match?.lat);
  const longitude = Number(match?.lon);
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < REGION.south || latitude > REGION.north ||
    longitude < REGION.west || longitude > REGION.east
  ) {
    throw new AddressNotFoundError('Address was not found in the member-map region.');
  }
  return { latitude, longitude };
}

/** Serialize public-service lookups to respect Nominatim's 1 request/second cap. */
export function geocodeHomeAddress(address: string): Promise<GeocodedPoint> {
  const task = requestQueue.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await geocodeHomeAddressIn(fetch, address);
    } finally {
      lastRequestAt = Date.now();
    }
  });
  requestQueue = task.then(() => undefined, () => undefined);
  return task;
}
