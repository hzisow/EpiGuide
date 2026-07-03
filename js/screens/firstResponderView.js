// Screen 7 — First-Responder View (SIMULATED / demo mode). The opt-in responder
// is en route to the patient. Scripted demo, no live backend.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, hasLeaflet, createLeafletMap, divIcon } from '../map.js';

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
  const patientLL = [center.lat, center.lng];
  const youLL = [center.lat - 0.0035, center.lng - 0.0032]; // ~450 m away

  if (hasLeaflet()) {
    root.querySelector('#fr-route').remove(); // route drawn as a Leaflet polyline
    const map = createLeafletMap(mapEl, center, { zoom: 15, interactive: false });
    window.L.polyline([youLL, patientLL], {
      color: '#E03131', weight: 4, opacity: 0.9, dashArray: '2 10', lineCap: 'round',
    }).addTo(map);
    window.L.marker(youLL, {
      icon: divIcon('<div class="route-you__dot"></div>', 18),
    }).addTo(map);
    window.L.marker(patientLL, {
      icon: divIcon(`<div class="marker"><span class="marker__ring"></span><span class="marker__dot"></span></div>`, 24),
      zIndexOffset: 1000,
    }).addTo(map);
    map.fitBounds(window.L.latLngBounds([youLL, patientLL]).pad(0.4), { animate: false });
    setTimeout(() => map.invalidateSize(), 60);
  } else {
    paintMapBackground(mapEl);
    const you = document.createElement('div');
    you.className = 'route-you';
    you.style.left = '22%';
    you.style.top = '72%';
    you.innerHTML = '<div class="route-you__dot"></div>';
    mapEl.appendChild(you);
    const patient = document.createElement('div');
    patient.className = 'marker';
    patient.style.left = '74%';
    patient.style.top = '28%';
    patient.innerHTML = `<span class="marker__ring"></span><span class="marker__dot"></span>`;
    mapEl.appendChild(patient);
    requestAnimationFrame(() => {
      const svg = root.querySelector('#fr-route');
      const r = mapEl.getBoundingClientRect();
      const x1 = r.width * 0.22, y1 = r.height * 0.72;
      const x2 = r.width * 0.74, y2 = r.height * 0.28;
      svg.innerHTML = `<path d="M${x1} ${y1} C ${x1 + 40} ${y1 - 80}, ${x2 - 60} ${y2 + 90}, ${x2} ${y2}"
        fill="none" stroke="#E03131" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 10" opacity="0.9"/>`;
    });
  }

  root.querySelector('#fr-cant').addEventListener('click', () => navigate('responderAlert'));
  root.querySelector('#fr-nav').addEventListener('click', () => navigate('medicHandoff'));

  built = true;
}
