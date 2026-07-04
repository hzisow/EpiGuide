// Screen 1 — Find. Real device geolocation, mock cabinets generated relative to
// the user, and a real interactive Google map (embed) you can pan and zoom.
// Honest permission pre-prompt before the native dialog.

import { state } from '../app.js';
import { icons } from '../icons.js';
import { generateMockCabinets } from '../data/cabinets.js';
import { paintMapBackground, mountMap } from '../map.js';

// A neutral fallback location (San Francisco) so the demo still renders if the
// user denies location or geolocation is unavailable. Clearly flagged in the UI.
const FALLBACK = { lat: 37.7793, lng: -122.4193 };

let root, mapEl, topCard, bottomCard, prePrompt;
let built = false;

export function initFind() {
  root = document.querySelector('.screen[data-screen="find"]');
  if (!built) build();
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
        </div>
      </div>
    </div>`;

  mapEl = root.querySelector('#find-map');
  topCard = root.querySelector('#find-top');
  bottomCard = root.querySelector('#find-bottom');
  prePrompt = root.querySelector('#find-preprompt');

  // Stylized backdrop shows only until the real map iframe loads (or if offline).
  paintMapBackground(mapEl);

  root.querySelector('#find-allow').addEventListener('click', requestLocation);

  built = true;

  if (state.location) {
    render();
  } else {
    prePrompt.hidden = false;
    document.getElementById('app').classList.add('epi-modal');
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
  document.getElementById('app').classList.remove('epi-modal');
  render();
}

function render() {
  const nearest = state.cabinets[0];
  // Real, interactive Google map centered on and pinned at the nearest cabinet.
  mountMap(mapEl, nearest.lat, nearest.lng, { zoom: 16, interactive: true });
  renderCards(nearest);
}

function renderCards(nearest) {
  topCard.innerHTML = `
    <div class="card card--elevated">
      <span class="eyebrow">Nearest epinephrine</span>
      <h1 class="h1" style="margin-top:6px;">${nearest.feet} ft away</h1>
      <p class="body-sm text-muted" style="margin-top:2px;">${nearest.walkMin} min walk · ${nearest.label}</p>
      ${state.locationIsDemo ? `<div class="status-note">${icons.crosshair()}<span>Demo location — allow location for real distances</span></div>` : ''}
    </div>`;

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
