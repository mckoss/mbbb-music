#!/usr/bin/env node

// Refresh the small, public OSM-derived vector basemap used by the private
// member roster. This script fetches roads/coastline/place names only; member
// addresses and pins live in data/members.db and must never enter this extract.
//
// Usage:
//   npm run map:update
//   node scripts/update-member-map.mjs --input=/tmp/overpass.json

// OpenStreetMap data is © OpenStreetMap contributors and available under ODbL:
// https://www.openstreetmap.org/copyright

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'static/maps/member-map.json');
// A deliberately low-detail regional frame catches Seattle/Tacoma gigs without
// shipping their street grids. The detailed roads remain limited to Whidbey.
const BOUNDS = { south: 47.15, west: -123.25, north: 48.45, east: -121.9 };
const DETAIL_BOUNDS = { south: 47.85, west: -122.85, north: 48.22, east: -122.25 };
const ISLAND_POLY =
  '47.88 -122.75 47.88 -122.29 48.08 -122.34 48.22 -122.46 48.22 -122.68 48.08 -122.73';

const query = `[out:json][timeout:90];(
  way["natural"="coastline"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["highway"~"^(motorway|trunk)$"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential)$"](poly:"${ISLAND_POLY}");
  node["place"~"^(city|town|village|hamlet)$"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
);out tags geom;`;

const ROAD_LABELS = new Set([
  'State Route 20',
  'State Route 525',
  'Langley Road',
  'Bayview Road',
  'Deer Lake Road',
  'Cultus Bay Road',
  'Maxwelton Road',
  'Double Bluff Road',
  'Fish Road',
  'Mutiny Bay Road',
  'Bush Point Road',
  'Honeymoon Bay Road',
  'Smugglers Cove Road',
  'South Whidbey Harbor Road',
  'Saratoga Road',
  'East Harbor Road',
  'South Harbor Avenue',
  'Clinton Beach Road',
]);
const PLACE_LABELS = new Set(['Clinton', 'Langley', 'Freeland', 'Greenbank']);
const REGIONAL_PLACE_LABELS = new Set([
  'Seattle', 'Tacoma', 'Bellevue', 'Everett', 'Edmonds', 'Mukilteo', 'Bremerton',
  'Port Townsend', 'Coupeville', 'Oak Harbor', 'Clinton', 'Langley', 'Freeland', 'Greenbank',
]);

function sqDistance(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
    dx = p[0] - x;
    dy = p[1] - y;
  }
  return dx * dx + dy * dy;
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const sqTolerance = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = sqTolerance;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = sqDistance(points[i], points[first], points[last]);
      if (distance > max) {
        max = distance;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_point, index) => keep[index]);
}

const round = (n) => Number(n.toFixed(5));
const pointsOf = (element, tolerance) =>
  simplify(
    (element.geometry ?? []).map((point) => [round(point.lat), round(point.lon)]),
    tolerance,
  );

function longestByName(roads) {
  const byName = new Map();
  for (const road of roads) {
    if (!road.name || !ROAD_LABELS.has(road.name)) continue;
    const current = byName.get(road.name);
    if (!current || road.points.length > current.points.length) byName.set(road.name, road);
  }
  return [...byName.values()].map((road) => {
    const point = road.points[Math.floor(road.points.length / 2)];
    return {
      name: road.name.replace('State Route ', 'WA '),
      latitude: point[0],
      longitude: point[1],
    };
  });
}

async function sourceData() {
  const input = process.argv.find((arg) => arg.startsWith('--input='))?.slice('--input='.length);
  if (input) return JSON.parse(await readFile(resolve(input), 'utf8'));
  const body = new URLSearchParams({ data: query });
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'MBBB-Music-map-updater/1.0 (+https://github.com/mckoss/mbbb-music)',
    },
    body,
  });
  if (!response.ok) throw new Error(`Overpass returned ${response.status}: ${await response.text()}`);
  return response.json();
}

const source = await sourceData();
const roadElements = source.elements.filter((element) => element.type === 'way' && element.tags?.highway);
const isDetailedRoad = (element) =>
  (element.geometry ?? []).some((point) =>
    point.lat >= DETAIL_BOUNDS.south && point.lat <= DETAIL_BOUNDS.north &&
    point.lon >= DETAIL_BOUNDS.west && point.lon <= DETAIL_BOUNDS.east &&
    !['motorway', 'trunk'].includes(element.tags.highway));
const roads = roadElements
  .filter(isDetailedRoad)
  .map((element) => ({
    kind: element.tags.highway,
    name: element.tags.name ?? null,
    points: pointsOf(element, element.tags.highway === 'residential' ? 0.000025 : 0.00004),
  }))
  .filter((road) => road.points.length >= 2);
const regionalRoads = roadElements
  .filter((element) => ['motorway', 'trunk'].includes(element.tags.highway))
  .map((element) => ({
    kind: element.tags.highway,
    points: pointsOf(element, 0.00035),
  }))
  .filter((road) => road.points.length >= 2);
const coastlines = source.elements
  .filter((element) => element.type === 'way' && element.tags?.natural === 'coastline')
  .map((element) => pointsOf(element, 0.00008))
  .filter((line) => line.length >= 2);
const places = source.elements
  .filter((element) => element.type === 'node' && PLACE_LABELS.has(element.tags?.name))
  .map((element) => ({ name: element.tags.name, latitude: round(element.lat), longitude: round(element.lon) }));
const regionalPlaces = source.elements
  .filter((element) => element.type === 'node' && REGIONAL_PLACE_LABELS.has(element.tags?.name))
  .map((element) => ({ name: element.tags.name, latitude: round(element.lat), longitude: round(element.lon) }));

const output = {
  source: 'OpenStreetMap contributors',
  license: 'ODbL 1.0',
  sourceUrl: 'https://www.openstreetmap.org/copyright',
  updatedAt: new Date().toISOString().slice(0, 10),
  bounds: BOUNDS,
  detailBounds: DETAIL_BOUNDS,
  coastlines,
  regionalRoads,
  roads,
  roadLabels: longestByName(roads),
  places,
  regionalPlaces,
  landmarks: [
    {
      name: 'Weekly practice · Langley Fairgrounds',
      address: '819 Camano Avenue, Langley, WA 98260',
      latitude: 48.0301,
      longitude: -122.4029,
      icon: '♫',
    },
    {
      name: 'Clinton Ferry Terminal',
      address: '64 South Ferrydock Road, Clinton, WA 98236',
      latitude: 47.975,
      longitude: -122.3531,
      icon: '⛴',
    },
  ],
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output)}\n`);
console.log(
  `Wrote ${OUTPUT} (${coastlines.length} coastline segments, ${regionalRoads.length} regional roads, ${roads.length} detailed roads).`,
);
