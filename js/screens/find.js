// Screen 1 — Find. Real device geolocation, mock cabinets generated relative to
// the user, custom map surface. Honest permission pre-prompt before the native
// dialog.

import { state } from '../app.js';
import { icons } from '../icons.js';
import { generateMockCabinets } from '../data/cabinets.js';
import { makeProjection, paintMapBackground } from '../map.js';

// A neutral fallback location (San Francisco) so the demo still renders if the
// user denies location or geolocation is unavailable. Clearly flagged in the UI.
const FALLBACK = { lat: 37.7793, lng: -122.4193 };

let root, mapEl, topCard, bottomCard, prePrompt;
let built = false;

export function initFind() {
  root = document.querySelector('.screen[data-screen="find"]');
  if (!built) build();
  // Re-render markers/cards if we already have a location (e.g. returning tab).
  if (state.location) render();
}

function build() {
  root.innerHTML = `
    <div class="find" style="position:relative;flex:1;">
      <div class="map" id="find-map"><div class="map__canvas"></div></div>
      <div class="find__top" id="find-top"></div>
      <div class="find__bottom" id="find-bottom"></div>
      <div class="pre-prompt" id="find-preprompt" hidden>
        <div class="pre-prompt__card">
          <div class="pre-prompt__icon">${icons.mapPin()}</div>
          <h2 class="h2">Find the nearest epinephrine</h2>
          <p class="body text-muted mt-4">EpiGuide needs your location to find the nearest epinephrine.</p>
          <button class="btn btn--primary btn--block" id="find-allow">Allow location</button>
          <button class="btn btn--ghost" id="find-skip" style="margin:12px auto 0;display:block;">Skip — use a demo location</button>
        </div>
      </div>
    </div>`;

  mapEl = root.querySelector('#find-map');
  topCard = root.querySelector('#find-top');
  bottomCard = root.querySelector('#find-bottom');
  prePrompt = root.querySelector('#find-preprompt');

  paintMapBackground(mapEl);

  root.querySelector('#find-allow').addEventListener('click', requestLocation);
  root.querySelector('#find-skip').addEventListener('click', () => {
    useLocation(FALLBACK, { demo: true });
  });

  built = true;

  if (state.location) {
    render();
  } else {
    prePrompt.hidden = false;
  }
}

function requestLocation() {
  const allowBtn = root.querySelector('#find-allow');
  allowBtn.textContent = 'Locating…';
  allowBtn.setAttribute('aria-disabled', 'true');

  if (!('geolocation' in navigator)) {
    useLocation(FALLBACK, { demo: true });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => useLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { demo: false }),
    () => useLocation(FALLBACK, { demo: true }),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

function useLocation(coords, { demo }) {
  state.location = coords;
  state.locationIsDemo = demo;
  state.cabinets = generateMockCabinets(coords.lat, coords.lng);
  prePrompt.hidden = true;
  render();
}

function render() {
  const nearest = state.cabinets[0];
  const rect = mapEl.getBoundingClientRect();
  const w = rect.width || 390;
  const h = rect.height || 700;

  // Scale so the nearest cabinet sits comfortably on screen.
  const project = makeProjection(state.location, w, h, 1.4);

  // Clear old markers.
  mapEl.querySelectorAll('.marker, .pin, .me-dot').forEach((n) => n.remove());

  // "You are here" dot at center.
  const me = document.createElement('div');
  me.className = 'route-you me-dot';
  me.style.left = '50%';
  me.style.top = '50%';
  me.innerHTML = '<div class="route-you__dot"></div>';
  mapEl.appendChild(me);

  // Additional cabinets as static gray pins (skip nearest).
  state.cabinets.slice(1).forEach((c) => {
    const p = project(c);
    const pin = document.createElement('div');
    pin.className = 'pin';
    pin.style.left = `${clamp(p.x, w)}px`;
    pin.style.top = `${clamp(p.y, h)}px`;
    pin.innerHTML = icons.mapPin();
    mapEl.appendChild(pin);
  });

  // Nearest cabinet as pulsing red marker.
  const np = project(nearest);
  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.style.left = `${clamp(np.x, w)}px`;
  marker.style.top = `${clamp(np.y, h)}px`;
  marker.innerHTML = `<span class="marker__ring"></span><span class="marker__ring"></span><span class="marker__dot"></span>`;
  mapEl.appendChild(marker);

  // Top card.
  topCard.innerHTML = `
    <div class="card card--elevated">
      <span class="eyebrow">Nearest epinephrine</span>
      <h1 class="h1" style="margin-top:6px;">${nearest.feet} ft away</h1>
      <p class="body-sm text-muted" style="margin-top:2px;">${nearest.walkMin} min walk · ${nearest.label}</p>
      ${state.locationIsDemo ? `<div class="status-note">${icons.crosshair()}<span>Demo location — allow location for real distances</span></div>` : ''}
    </div>`;

  // Bottom card.
  const maps = `https://maps.apple.com/?daddr=${nearest.lat},${nearest.lng}`;
  bottomCard.innerHTML = `
    <div class="card card--elevated">
      <div class="find__route">
        <div class="find__route-icon">${icons.route()}</div>
        <div>
          <div class="body" style="font-weight:600;">${nearest.feet} ft · ${nearest.walkMin} min walk</div>
          <div class="body-sm text-muted">${nearest.label}</div>
        </div>
      </div>
      <a class="btn btn--primary btn--block" href="${maps}" target="_blank" rel="noopener">
        ${icons.navigation()} Get Directions
      </a>
    </div>`;
}

// Keep markers within the visible map bounds with a little padding.
function clamp(v, max) {
  const pad = 40;
  return Math.max(pad, Math.min(max - pad, v));
}
