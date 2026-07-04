// Screen 7 — First-Responder View. The opt-in responder is en route to the
// patient. Centers on the REAL patient location from the accepted alert; the
// "you" marker and route are simulated overlays. Marks arrival in the database.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap } from '../map.js';

let root, built = false;
let netP;
function net() { return (netP ||= import('../net.js')); }

export function initFirstResponderView() {
  root = document.querySelector('.screen[data-screen="firstResponderView"]');
  if (!built) build();
  render();
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
          <button class="btn btn--primary" id="fr-nav">${icons.compass()} I've arrived</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#fr-cant').addEventListener('click', () => navigate('responderAlert'));
  root.querySelector('#fr-nav').addEventListener('click', arrived);
  built = true;
}

function render() {
  const mapEl = root.querySelector('#fr-map');
  const alert = state.incomingAlert;
  const center = alert ? { lat: alert.lat, lng: alert.lng } : (state.location || { lat: 37.7793, lng: -122.4193 });

  paintMapBackground(mapEl);
  mountMap(mapEl, center.lat, center.lng, { zoom: 16, interactive: false });

  if (!mapEl.querySelector('.route-you')) {
    const you = document.createElement('div');
    you.className = 'route-you';
    you.style.left = '24%'; you.style.top = '74%'; you.style.zIndex = '2';
    you.innerHTML = '<div class="route-you__dot"></div>';
    mapEl.appendChild(you);
  }

  const svg = root.querySelector('#fr-route');
  svg.style.zIndex = '2';
  requestAnimationFrame(() => {
    const r = mapEl.getBoundingClientRect();
    const x1 = r.width * 0.24, y1 = r.height * 0.74;
    const x2 = r.width * 0.50, y2 = r.height * 0.48;
    svg.innerHTML = `<path d="M${x1} ${y1} C ${x1 + 40} ${y1 - 80}, ${x2 - 40} ${y2 + 70}, ${x2} ${y2}"
      fill="none" stroke="#1C7ED6" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 10" opacity="0.95"/>`;
  });
}

async function arrived() {
  const alert = state.incomingAlert;
  if (alert) {
    try { const n = await net(); await n.updateResponderPosition(alert.id, state.responderCoords || null, 'arrived'); } catch (_) {}
  }
  navigate('medicHandoff');
}
