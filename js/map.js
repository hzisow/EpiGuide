// Minimal self-contained map surface. No external tile layer or map library so
// the demo works reliably regardless of network — a stylized light-gray street
// grid with absolutely-positioned markers projected from real lat/lng.
//
// Projection: local equirectangular around a center point. Good enough at the
// ~300 m scale we render at; markers land in the right relative direction and
// distance from the user.

const METERS_PER_DEG_LAT = 111320;

export function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

// Returns a function that maps {lat,lng} -> {x,y} in pixels within an element of
// the given width/height, centered on `center`, at `metersPerPixel` scale.
export function makeProjection(center, width, height, metersPerPixel = 1.2) {
  const mLat = METERS_PER_DEG_LAT;
  const mLng = metersPerDegLng(center.lat);
  return ({ lat, lng }) => {
    const dxм = (lng - center.lng) * mLng;
    const dyм = (lat - center.lat) * mLat;
    return {
      x: width / 2 + dxм / metersPerPixel,
      y: height / 2 - dyм / metersPerPixel, // north is up
    };
  };
}

// Paint the stylized grid + a couple of "roads" into a container. Idempotent-ish:
// clears prior grid elements first.
export function paintMapBackground(container) {
  container.querySelectorAll('.map__grid, .map__road').forEach((n) => n.remove());
  const grid = document.createElement('div');
  grid.className = 'map__grid';
  container.prepend(grid);

  // A few faux roads for texture.
  const roads = [
    { top: '38%', left: '-10%', width: '120%', height: '10px' },
    { top: '0', left: '58%', width: '10px', height: '120%' },
    { top: '70%', left: '-10%', width: '120%', height: '8px' },
  ];
  roads.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'map__road';
    Object.assign(el.style, r);
    container.appendChild(el);
  });
}

// ---------------------------------------------------------------------------
// Real interactive map (Leaflet, vendored). Falls back to the stylized map
// above when Leaflet isn't available (e.g. it failed to load).
// ---------------------------------------------------------------------------

export function hasLeaflet() {
  return typeof window !== 'undefined' && !!window.L;
}

// Clean light-gray basemap (CARTO Positron) — matches the app's minimal look.
// Tiles load from CARTO's public CDN; free, no API key. Requires network (as any
// real map does); markers still render if tiles are slow.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';

export function createLeafletMap(container, center, { zoom = 16, interactive = true } = {}) {
  if (!hasLeaflet()) return null;
  const map = window.L.map(container, {
    center: [center.lat, center.lng],
    zoom,
    zoomControl: false,             // mobile uses pinch-to-zoom
    attributionControl: true,
    dragging: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
    touchZoom: interactive,
    tap: interactive,
  });
  window.L.tileLayer(TILE_URL, {
    maxZoom: 20,
    subdomains: 'abcd',
    detectRetina: true,
    attribution: TILE_ATTR,
  }).addTo(map);
  return map;
}

// Build a Leaflet divIcon from raw HTML (used for our custom pulsing/pin markers).
export function divIcon(html, size = 24, anchor) {
  return window.L.divIcon({
    html,
    className: 'epi-divicon',
    iconSize: [size, size],
    iconAnchor: anchor || [size / 2, size / 2],
  });
}
