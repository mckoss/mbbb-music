<script lang="ts">
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';

  import {
    fitMemberBounds,
    directionsUrl,
    shortGigDate,
    type GigMapLocation,
    type MemberLocation,
  } from '$lib/member-map';
  import {
    layoutMemberMapLabels,
    mapLabelLeaderEnd,
  } from '$lib/member-map-label-layout';
  import type * as Leaflet from 'leaflet';

  type Point = [number, number];
  interface MapData {
    bounds: { south: number; west: number; north: number; east: number };
    coastlines: Point[][];
    regionalRoads: Array<{ kind: string; points: Point[] }>;
    roads: Array<{ kind: string; name: string | null; points: Point[] }>;
    roadLabels: Array<{ name: string; latitude: number; longitude: number }>;
    places: Array<{ name: string; latitude: number; longitude: number }>;
    regionalPlaces: Array<{ name: string; latitude: number; longitude: number }>;
    landmarks: Array<{
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      icon: string;
    }>;
  }

  let {
    members,
    gigs = [],
    interactive = true,
    compact = false,
    picker = false,
    onPick,
  }: {
    members: MemberLocation[];
    gigs?: GigMapLocation[];
    interactive?: boolean;
    compact?: boolean;
    picker?: boolean;
    onPick?: (latitude: number, longitude: number) => void;
  } = $props();

  let container: HTMLDivElement;
  let leaflet: typeof Leaflet | null = null;
  let map: Leaflet.Map | null = null;
  let memberLayer: Leaflet.LayerGroup | null = null;
  let leaderRenderer: Leaflet.Renderer | null = null;
  let mapLandmarks: MapData['landmarks'] = [];
  let loadError = $state(false);

  const escapeHtml = (value: string) =>
    value.replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    })[character] ?? character);

  interface DisplayItem {
    id: string;
    kind: 'member' | 'gig' | 'practice' | 'ferry';
    name: string;
    detail: string;
    address: string;
    latitude: number;
    longitude: number;
  }

  function blockHtml(item: DisplayItem): string {
    const icon = item.kind === 'gig' ? '♫' : item.kind === 'practice' ? '🏫' : item.kind === 'ferry' ? '⛴' : '';
    return `<div class="map-datablock ${item.kind}">
      <span class="map-block-icon ${item.kind}" aria-hidden="true">${icon}</span>
      <span class="map-block-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.detail)}</span></span>
    </div>`;
  }

  function openDirections(item: DisplayItem, event: Leaflet.LeafletMouseEvent): void {
    event.originalEvent?.stopPropagation();
    window.open(directionsUrl(item.address), '_blank', 'noopener');
  }

  function drawMembers(): void {
    if (!leaflet || !map || !memberLayer) return;
    memberLayer.clearLayers();
    const items: DisplayItem[] = [
      ...members.map((member, index) => ({
        id: `member:${index}:${member.name}`,
        kind: 'member' as const,
        name: member.name,
        detail: 'Member home',
        address: member.address,
        latitude: member.latitude,
        longitude: member.longitude,
      })),
      ...gigs.map((gig, index) => ({
        id: `gig:${index}:${gig.name}:${gig.date}`,
        kind: 'gig' as const,
        name: gig.name,
        detail: shortGigDate(gig.date),
        address: gig.address,
        latitude: gig.latitude,
        longitude: gig.longitude,
      })),
      ...mapLandmarks.map((landmark, index) => ({
        id: `landmark:${index}:${landmark.name}`,
        kind: landmark.icon === '⛴' ? 'ferry' as const : 'practice' as const,
        name: landmark.icon === '⛴' ? landmark.name : landmark.name.replace(/^Weekly practice\s*·\s*/i, ''),
        detail: landmark.icon === '⛴' ? 'Ferry terminal' : 'Practice location',
        address: landmark.address,
        latitude: landmark.latitude,
        longitude: landmark.longitude,
      })),
    ];
    const canOpen = interactive && !picker;
    const dots = items.map((item) => {
      const diameter = picker ? 13 : 11;
      const dot = leaflet!.marker([item.latitude, item.longitude], {
        icon: leaflet!.divIcon({
          className: 'map-location-dot',
          html: '<span class="map-location-dot-inner"></span>',
          iconSize: [diameter, diameter],
          iconAnchor: [diameter / 2, diameter / 2],
        }),
        title: canOpen ? `${item.name} — directions` : item.name,
        keyboard: canOpen,
        interactive: canOpen,
        zIndexOffset: 200,
      });
      if (canOpen) dot.on('click', (event) => openDirections(item, event));
      dot.addTo(memberLayer!);
      return { item, dot };
    });
    // Picker maps need the precise point but deliberately omit the overview
    // datablock so the surrounding map remains easy to tap.
    if (picker || compact || !items.length) return;

    const blockWidth = compact ? 132 : 190;
    const blockHeight = compact ? 44 : 52;
    const points = items.map((item) => map!.latLngToContainerPoint([item.latitude, item.longitude]));
    const targets = items.map((item, index) => ({
      id: item.id,
      x: points[index].x,
      y: points[index].y,
      width: blockWidth,
      height: blockHeight,
      radius: 7,
    }));
    const size = map.getSize();
    const placements = layoutMemberMapLabels(targets, { width: size.x, height: size.y });

    // Leaders first, dots second, datablocks last: location dots stay legible
    // over crossing lines while the white blocks remain above all map artwork.
    for (const [index, placement] of placements.entries()) {
      const end = mapLabelLeaderEnd(placement, targets[index]);
      const color = items[index].kind === 'member' ? '#7a3152' : '#242124';
      leaflet.polyline(
        [[items[index].latitude, items[index].longitude], map.containerPointToLatLng([end.x, end.y])],
        { color, weight: 1.5, opacity: 0.82, interactive: false, className: 'map-datablock-leader', renderer: leaderRenderer! },
      ).addTo(memberLayer);
    }
    for (const [index, placement] of placements.entries()) {
      const item = items[index];
      const marker = leaflet.marker(map.containerPointToLatLng([placement.x, placement.y]), {
        icon: leaflet.divIcon({
          className: 'map-datablock-host',
          html: blockHtml(item),
          iconSize: [blockWidth, blockHeight],
          iconAnchor: [0, 0],
        }),
        title: `${item.name} — ${item.detail} — directions`,
        keyboard: canOpen,
        interactive: canOpen,
      });
      if (canOpen) marker.on('click', (event) => openDirections(item, event));
      marker.addTo(memberLayer);
    }
  }

  $effect(() => {
    members;
    gigs;
    drawMembers();
  });

  onMount(() => {
    let disposed = false;
    void Promise.all([
      import('leaflet'),
      fetch('/maps/member-map.json').then((response) => {
        if (!response.ok) throw new Error(`Map data returned ${response.status}`);
        return response.json() as Promise<MapData>;
      }),
    ]).then(([module, mapData]) => {
      if (disposed) return;
      leaflet = module;
      const L = module;
      const sourceBounds = L.latLngBounds(
        [mapData.bounds.south, mapData.bounds.west],
        [mapData.bounds.north, mapData.bounds.east],
      );
      map = L.map(container, {
        attributionControl: true,
        zoomControl: interactive,
        dragging: interactive,
        touchZoom: interactive,
        doubleClickZoom: interactive,
        scrollWheelZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        tapHold: interactive,
        maxBounds: sourceBounds.pad(-0.04),
        maxBoundsViscosity: 1,
        maxZoom: 17,
        zoomSnap: 0.5,
        renderer: L.canvas({ padding: 0.2 }),
      });
      map.attributionControl.setPrefix(false);
      map.attributionControl.addAttribution(
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
      );
      leaderRenderer = L.svg({ padding: 0.2 });

      const coast = mapData.coastlines.map((line) => line.map(([lat, lng]) => L.latLng(lat, lng)));
      L.polyline(coast, { color: '#78aab8', weight: 1.5, opacity: 0.9, interactive: false }).addTo(map);

      const regionalRoads = mapData.regionalRoads.map((road) =>
        road.points.map(([lat, lng]) => L.latLng(lat, lng)));
      L.polyline(regionalRoads, { color: '#b79561', weight: 1.4, opacity: 0.75, interactive: false }).addTo(map);

      const roadStyles: Record<string, Leaflet.PolylineOptions> = {
        primary: { color: '#c18a38', weight: 3.2, opacity: 0.95 },
        secondary: { color: '#d4a85d', weight: 2.5, opacity: 0.9 },
        tertiary: { color: '#b9a98b', weight: 1.8, opacity: 0.85 },
        local: { color: '#c8c3b8', weight: 1, opacity: 0.72 },
      };
      const detailLayer = L.layerGroup();
      for (const kind of Object.keys(roadStyles)) {
        const lines = mapData.roads
          .filter((road) => (kind === 'local' ? !['primary', 'secondary', 'tertiary'].includes(road.kind) : road.kind === kind))
          .map((road) => road.points.map(([lat, lng]) => L.latLng(lat, lng)));
        L.polyline(lines, { ...roadStyles[kind], interactive: false, smoothFactor: 1.2 }).addTo(detailLayer);
      }

      const label = (
        latitude: number,
        longitude: number,
        text: string,
        className: string,
        target: Leaflet.LayerGroup | Leaflet.Map = map!,
      ) =>
        L.marker([latitude, longitude], {
          interactive: false,
          icon: L.divIcon({
            className,
            html: escapeHtml(text),
            iconSize: undefined,
          }),
        }).addTo(target);
      const detailLabels = L.layerGroup();
      const roadLabels = L.layerGroup();
      for (const place of mapData.regionalPlaces) label(place.latitude, place.longitude, place.name, 'place-label regional');
      const regionalNames = new Set(mapData.regionalPlaces.map((place) => place.name));
      for (const place of mapData.places) {
        if (!regionalNames.has(place.name)) {
          label(place.latitude, place.longitude, place.name, 'place-label local', detailLabels);
        }
      }
      for (const road of mapData.roadLabels) {
        if (!compact || road.name.startsWith('WA ')) {
          label(road.latitude, road.longitude, road.name, 'road-label', roadLabels);
        }
      }

      mapLandmarks = mapData.landmarks;

      memberLayer = L.layerGroup().addTo(map);

      // Every roster map opens on South Whidbey. Regional member/gig records do
      // not pull the compact preview or expanded map toward Seattle/Tacoma.
      const fitted = fitMemberBounds([]);
      const initialBounds = L.latLngBounds([fitted.south, fitted.west], [fitted.north, fitted.east]);
      map.fitBounds(initialBounds, { padding: compact ? [8, 8] : [24, 24], maxZoom: 13 });
      map.setMinZoom(map.getZoom());
      drawMembers();
      const updateDetail = () => {
        if (!map) return;
        if (map.getZoom() >= 10) {
          if (!map.hasLayer(detailLayer)) detailLayer.addTo(map);
          if (!map.hasLayer(detailLabels)) detailLabels.addTo(map);
        } else if (map.hasLayer(detailLayer)) {
          map.removeLayer(detailLayer);
          map.removeLayer(detailLabels);
        }
        if (map.getZoom() >= 12) {
          if (!map.hasLayer(roadLabels)) roadLabels.addTo(map);
        } else if (map.hasLayer(roadLabels)) {
          map.removeLayer(roadLabels);
        }
      };
      updateDetail();
      map.on('zoomend', updateDetail);
      map.on('zoomend moveend resize', drawMembers);

      if (picker && onPick) {
        map.on('click', (event: Leaflet.LeafletMouseEvent) => onPick(event.latlng.lat, event.latlng.lng));
      }
    }).catch((error) => {
      console.error('Member map failed to initialize', error);
      if (!disposed) loadError = true;
    });

    return () => {
      disposed = true;
      map?.remove();
      map = null;
      leaderRenderer = null;
      leaflet = null;
    };
  });
</script>

<div class="map-shell">
  <div class:compact class="map" bind:this={container} aria-label="Member home map"></div>
  {#if loadError}<p class="map-error">The offline map could not be loaded.</p>{/if}
</div>

<style>
  .map-shell {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .map {
    width: 100%;
    height: 100%;
    min-height: 260px;
    background: #e8f1f3;
    color: #36342f;
    font-family: inherit;
  }

  .map-error {
    position: absolute;
    inset: 50% auto auto 50%;
    z-index: 600;
    transform: translate(-50%, -50%);
    padding: 10px;
    border-radius: 6px;
    background: var(--panel);
    color: var(--muted);
    font-size: 0.8rem;
  }

  .map.compact {
    min-height: 190px;
  }

  :global(.map-datablock-host) {
    background: transparent;
    border: 0;
  }

  :global(.map-location-dot) {
    display: grid;
    place-items: center;
    background: transparent;
    border: 0;
  }

  :global(.map-location-dot-inner) {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: block;
    border: 1.5px solid #fffdf7;
    border-radius: 50%;
    background: #242124;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.38);
  }

  :global(.map-datablock) {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    align-items: center;
    gap: 7px;
    border: 2px solid #7a3152;
    border-radius: 4px;
    background: #fffdf7;
    color: #341729;
    box-shadow: 0 2px 6px rgba(31, 20, 25, 0.3);
    padding: 5px 7px;
    cursor: pointer;
  }

  :global(.map-datablock.gig),
  :global(.map-datablock.practice),
  :global(.map-datablock.ferry) {
    border-color: #242124;
    color: #242124;
  }

  :global(.map-block-icon) {
    width: 28px;
    height: 28px;
    position: relative;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #7a3152;
    color: #fffdf7;
    font: 900 1.05rem/1 system-ui, sans-serif;
  }

  :global(.map-block-icon.gig),
  :global(.map-block-icon.practice),
  :global(.map-block-icon.ferry) {
    background: #242124;
  }

  :global(.map-block-icon.member::before) {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fffdf7;
    box-shadow: 0 9px 0 3px #fffdf7;
    transform: translateY(-4px);
  }

  :global(.map-block-copy) {
    min-width: 0;
    display: grid;
    line-height: 1.05;
  }

  :global(.map-block-copy strong),
  :global(.map-block-copy span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.map-block-copy strong) {
    font-size: 0.75rem;
    font-weight: 850;
  }

  :global(.map-block-copy span) {
    margin-top: 4px;
    color: #735d68;
    font-size: 0.64rem;
    font-weight: 750;
    letter-spacing: 0.02em;
  }

  :global(.map.compact .map-datablock) {
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 5px;
    padding: 4px 5px;
  }

  :global(.map.compact .map-block-icon) {
    width: 22px;
    height: 22px;
    font-size: 0.85rem;
  }

  :global(.map.compact .map-block-icon.member::before) {
    width: 6px;
    height: 6px;
    box-shadow: 0 7px 0 2px #fffdf7;
    transform: translateY(-3px);
  }

  :global(.map.compact .map-block-copy strong) {
    font-size: 0.66rem;
  }

  :global(.map.compact .map-block-copy span) {
    margin-top: 2px;
    font-size: 0.57rem;
  }

  :global(.place-label),
  :global(.road-label) {
    width: max-content !important;
    height: auto !important;
    background: rgba(255, 253, 247, 0.72);
    color: #555047;
    white-space: nowrap;
    pointer-events: none;
  }

  :global(.place-label) {
    font: 800 0.75rem/1 system-ui, sans-serif;
    letter-spacing: 0.02em;
  }

  :global(.road-label) {
    font: 600 0.62rem/1 system-ui, sans-serif;
  }

  :global(.leaflet-control-attribution) {
    font-size: 9px;
  }
</style>
