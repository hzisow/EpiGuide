// Screen 7 — First-Responder View (SIMULATED / demo mode). The opt-in responder
// is en route to the patient. Scripted demo, no live backend.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap } from '../map.js';

let root, built = false;

export function initFirstResponderView() {
  root = document.querySelector('.screen[data-screen="firstResponderView"]');
  if (!built) build();
}

function build() {
  root.innerHTML = `
    <div class="fresponder" style="flex:1;display:flex;flex-direction:column;">
      <div class="fresponder__strip">
        <span class="status-dot">En route</span>
        <span class="pill">ETA 2 min</span>
      </div>
      <div class="fresponder__map map" id="fr-map">
        <div class="map__canvas"></div>
        <svg class="route-line" id="fr-route" style="position:absolute;inset:0;z-index:4;" width="100%" height="100%"></svg>
        <div class="badge-glass">${icons.ambulance()} EMS is 7 min out</div>
      </div>
      <div class="fresponder__foot">
        <div style="font-weight:700;font-size:18px;">Patient location confirmed</div>
        <div class="body-sm text-muted" style="margin-top:4px;">Bring your epinephrine auto-injector if accessible</div>
        <div class="row">
          <button class="btn btn--secondary" id="fr-cant">Can't go</button>
          <button class="btn btn--primary" id="fr-nav">${icons.compass()} Navigating</button>
        </div>
      </div>
    </div>`;

  const mapEl = root.querySelector('#fr-map');
  const center = state.location || { lat: 37.7793, lng: -122.4193 };
  paintMapBackground(mapEl); // backdrop until the map loads

  // Real map, pinned at the patient. "You" + route are simulated overlays.
  mountMap(mapEl, center.lat, center.lng, { zoom: 16, interactive: false });

  const you = document.createElement('div');
  you.className = 'route-you';
  you.style.left = '24%';
  you.style.top = '74%';
  you.style.zIndex = '2';
  you.innerHTML = '<div class="route-you__dot"></div>';
  mapEl.appendChild(you);

  const svg = root.querySelector('#fr-route');
  svg.style.zIndex = '2';
  requestAnimationFrame(() => {
    const r = mapEl.getBoundingClientRect();
    const x1 = r.width * 0.24, y1 = r.height * 0.74;
    const x2 = r.width * 0.50, y2 = r.height * 0.48; // patient pin sits at centre
    svg.innerHTML = `<path d="M${x1} ${y1} C ${x1 + 40} ${y1 - 80}, ${x2 - 40} ${y2 + 70}, ${x2} ${y2}"
      fill="none" stroke="#E03131" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 10" opacity="0.9"/>`;
  });

  root.querySelector('#fr-cant').addEventListener('click', () => navigate('responderAlert'));
  root.querySelector('#fr-nav').addEventListener('click', () => navigate('medicHandoff'));

  built = true;
}
