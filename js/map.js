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
// Real map — Google Maps embed (an actual interactive Google map in an iframe).
// Keyless: uses the public `output=embed` endpoint, so no API key or paid
// developer account is required. Interactive (pan/zoom) and drops a pin at the
// given coordinates. Requires network, like any real map.
// ---------------------------------------------------------------------------

export function googleMapsEmbedUrl(lat, lng, zoom = 16) {
  return `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&hl=en&output=embed`;
}

// Mount (or update) a Google Maps iframe inside `container`. Returns the iframe.
// interactive:false disables panning (for static thumbnails / status views).
export function mountMap(container, lat, lng, { zoom = 16, interactive = true } = {}) {
  let iframe = container.querySelector('iframe.epi-gmap');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.className = 'epi-gmap';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.setAttribute('allowfullscreen', '');
    iframe.title = 'Map';
    container.appendChild(iframe);
  }
  iframe.src = googleMapsEmbedUrl(lat, lng, zoom);
  iframe.style.pointerEvents = interactive ? 'auto' : 'none';
  return iframe;
}
