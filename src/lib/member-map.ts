export interface MemberLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  instrumentSlug: string | null;
}

export interface GigMapLocation {
  name: string;
  date: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Always keep Clinton through Greenbank visible, even before anyone has added a
// map pin. Member locations expand this frame rather than replacing it.
export const SOUTH_WHIDBEY_BOUNDS: MapBounds = {
  north: 48.12,
  south: 47.94,
  east: -122.31,
  west: -122.75,
};

export function isMapCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** South Whidbey plus every member pin, padded so edge markers stay readable. */
export function fitMemberBounds(
  members: Array<Pick<MemberLocation, 'latitude' | 'longitude'>>,
  base: MapBounds = SOUTH_WHIDBEY_BOUNDS,
): MapBounds {
  let { north, south, east, west } = base;
  for (const member of members) {
    if (!isMapCoordinate(member.latitude, member.longitude)) continue;
    north = Math.max(north, member.latitude);
    south = Math.min(south, member.latitude);
    east = Math.max(east, member.longitude);
    west = Math.min(west, member.longitude);
  }
  const latPad = Math.max(0.01, (north - south) * 0.06);
  const lngPad = Math.max(0.015, (east - west) * 0.06);
  return {
    north: Math.min(90, north + latPad),
    south: Math.max(-90, south - latPad),
    east: Math.min(180, east + lngPad),
    west: Math.max(-180, west - lngPad),
  };
}

export function pointPercent(
  latitude: number,
  longitude: number,
  bounds: MapBounds,
): { left: number; top: number } {
  return {
    left: ((longitude - bounds.west) / (bounds.east - bounds.west)) * 100,
    top: ((bounds.north - latitude) / (bounds.north - bounds.south)) * 100,
  };
}

/** Google Maps opens directions with the device's current location as origin. */
export function directionsUrl(address: string): string {
  const params = new URLSearchParams({ api: '1', destination: address, travelmode: 'driving' });
  return `https://www.google.com/maps/dir/?${params}`;
}

const PLACE_CENTERS: Array<{ matches: string[]; latitude: number; longitude: number }> = [
  { matches: ['whidbey island fairground', 'island county fairground'], latitude: 48.0301, longitude: -122.4029 },
  { matches: ['clinton ferry', 'ferrydock road'], latitude: 47.975, longitude: -122.3531 },
  // Named Freeland venues must precede the town fallback. Otherwise every gig
  // whose address ends in "Freeland" lands on the same town-center pin.
  { matches: ['hierophant meadery', '5586 double bluff'], latitude: 48.00831, longitude: -122.50722 },
  { matches: ['freeland library', 'freeland public library', '5495 harbor'], latitude: 48.01173, longitude: -122.52389 },
  { matches: ['greenbank'], latitude: 48.0986, longitude: -122.5722 },
  { matches: ['freeland'], latitude: 48.0096, longitude: -122.5244 },
  { matches: ['langley'], latitude: 48.04, longitude: -122.4094 },
  { matches: ['clinton'], latitude: 47.978, longitude: -122.356 },
  { matches: ['coupeville'], latitude: 48.2198, longitude: -122.6863 },
  { matches: ['oak harbor'], latitude: 48.2932, longitude: -122.6432 },
  { matches: ['mukilteo'], latitude: 47.9445, longitude: -122.3046 },
  { matches: ['everett'], latitude: 47.979, longitude: -122.2021 },
  { matches: ['edmonds'], latitude: 47.8107, longitude: -122.3774 },
  { matches: ['seattle'], latitude: 47.6062, longitude: -122.3321 },
  { matches: ['bellevue'], latitude: 47.6101, longitude: -122.2015 },
  { matches: ['tacoma'], latitude: 47.2529, longitude: -122.4443 },
];

/**
 * Approximate fallback for gigs whose saved venue predates precise map pins.
 * The exact address still drives Directions; this only chooses an overview pin.
 */
export function inferGigCoordinates(name: string | null, address: string | null) {
  const haystack = `${name ?? ''} ${address ?? ''}`.toLowerCase();
  const match = PLACE_CENTERS.find((place) => place.matches.some((term) => haystack.includes(term)));
  return match ? { latitude: match.latitude, longitude: match.longitude } : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD → MMM-dd without timezone-sensitive Date parsing. */
export function shortGigDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${MONTHS[Number(match[2]) - 1]}-${match[3]}`;
}

/** Calendar date three months before today, used for the map's recent-gig window. */
export function threeMonthCutoff(today = new Date()): string {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, today.getUTCDate()));
  return date.toISOString().slice(0, 10);
}
