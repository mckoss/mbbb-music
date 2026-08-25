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
    instrumentGlyph,
    instrumentHasImage,
    instrumentImageSrc,
  } from '$lib/members';
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
  let loadError = $state(false);

  const escapeHtml = (value: string) =>
    value.replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    })[character] ?? character);

  function iconHtml(member: MemberLocation): string {
    if (instrumentHasImage(member.instrumentSlug)) {
      return `<span class="member-pin-inner"><img src="${instrumentImageSrc(member.instrumentSlug)}" alt=""></span>`;
    }
    return `<span class="member-pin-inner member-pin-glyph">${escapeHtml(instrumentGlyph(member.instrumentSlug))}</span>`;
  }

  function drawMembers(): void {
    if (!leaflet || !map || !memberLayer) return;
    memberLayer.clearLayers();
    for (const member of members) {
      const marker = leaflet.marker([member.latitude, member.longitude], {
        icon: leaflet.divIcon({
          className: 'member-pin',
          html: iconHtml(member),
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
        title: picker ? 'Home map pin' : `${member.name} — directions`,
        keyboard: !picker,
        interactive: !picker,
      });
      marker.bindTooltip(escapeHtml(member.name), {
        permanent: true,
        direction: 'top',
        offset: [0, -16],
        className: 'member-name',
      });
      if (!picker) {
        marker.on('click', (event) => {
          event.originalEvent?.stopPropagation();
          window.open(directionsUrl(member.address), '_blank', 'noopener');
        });
      }
      memberLayer.addLayer(marker);
    }
    for (const gig of gigs) {
      const marker = leaflet.marker([gig.latitude, gig.longitude], {
        icon: leaflet.divIcon({
          className: 'gig-pin',
          html: '<span class="gig-pin-inner" aria-hidden="true"><span>♫</span></span>',
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
        title: `${shortGigDate(gig.date)} ${gig.name} — directions`,
        keyboard: true,
      });
      marker.bindTooltip(`${escapeHtml(shortGigDate(gig.date))} · ${escapeHtml(gig.name)}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -17],
        className: 'gig-name',
      });
      marker.on('click', (event) => {
        event.originalEvent?.stopPropagation();
        window.open(directionsUrl(gig.address), '_blank', 'noopener');
      });
      memberLayer.addLayer(marker);
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

      for (const landmark of mapData.landmarks) {
        const marker = L.marker([landmark.latitude, landmark.longitude], {
          icon: L.divIcon({
            className: 'landmark-pin',
            html: `<span class="landmark-pin-inner">${escapeHtml(landmark.icon)}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          title: `${landmark.name} — directions`,
          keyboard: true,
        });
        marker.bindTooltip(escapeHtml(landmark.name), {
          permanent: !picker,
          direction: landmark.longitude > -122.5 ? 'left' : 'right',
          offset: [landmark.longitude > -122.5 ? -12 : 12, 0],
          className: 'landmark-name',
        });
        marker.on('click', (event) => {
          event.originalEvent?.stopPropagation();
          window.open(directionsUrl(landmark.address), '_blank', 'noopener');
        });
        marker.addTo(map);
      }

      memberLayer = L.layerGroup().addTo(map);
      drawMembers();

      const fitted = fitMemberBounds([...members, ...gigs]);
      const initialBounds = L.latLngBounds([fitted.south, fitted.west], [fitted.north, fitted.east]);
      map.fitBounds(initialBounds, { padding: compact ? [8, 8] : [24, 24], maxZoom: 13 });
      map.setMinZoom(map.getZoom());
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

      if (picker && onPick) {
        map.on('click', (event: Leaflet.LeafletMouseEvent) => onPick(event.latlng.lat, event.latlng.lng));
      }
    }).catch(() => {
      if (!disposed) loadError = true;
    });

    return () => {
      disposed = true;
      map?.remove();
      map = null;
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

  :global(.member-pin) {
    background: transparent;
    border: 0;
  }

  :global(.member-pin-inner) {
    width: 34px;
    height: 34px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    border: 2px solid #fffdf7;
    border-radius: 50%;
    background: #f4b942;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }

  :global(.gig-pin),
  :global(.landmark-pin) {
    background: transparent;
    border: 0;
  }

  :global(.gig-pin-inner),
  :global(.landmark-pin-inner) {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 2px solid #fffdf7;
    background: #7a3152;
    color: #fffdf7;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45);
  }

  :global(.gig-pin-inner) {
    clip-path: polygon(50% 0, 100% 28%, 88% 28%, 88% 100%, 12% 100%, 12% 28%, 0 28%);
    font-size: 1.1rem;
    font-weight: 900;
  }

  :global(.landmark-pin-inner) {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #155e67;
    font-size: 0.95rem;
  }

  :global(.member-pin-inner img) {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  :global(.member-pin-glyph) {
    font-size: 1.25rem;
  }

  :global(.leaflet-tooltip.member-name) {
    border: 0;
    border-radius: 5px;
    background: rgba(32, 33, 36, 0.9);
    color: #fffdf7;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    padding: 3px 6px;
    font: 700 0.72rem/1.2 system-ui, sans-serif;
  }

  :global(.leaflet-tooltip.gig-name),
  :global(.leaflet-tooltip.landmark-name) {
    border: 0;
    border-radius: 5px;
    background: rgba(122, 49, 82, 0.93);
    color: #fffdf7;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    padding: 3px 6px;
    font: 800 0.72rem/1.2 system-ui, sans-serif;
  }

  :global(.leaflet-tooltip.landmark-name) {
    background: rgba(21, 94, 103, 0.93);
  }

  :global(.leaflet-tooltip-top.member-name::before) {
    border-top-color: rgba(32, 33, 36, 0.9);
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
