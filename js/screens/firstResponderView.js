// Screen 7 — First-Responder View. The opt-in responder is en route to the
// patient. Centers on the REAL patient location from the accepted alert and
// marks arrival in the database. No fabricated ETA/route overlays.

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
      </div>
      <div class="fresponder__map map" id="fr-map">
        <div class="map__canvas"></div>
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
  // Center on the REAL patient location from the accepted alert (fall back to
  // this device's own location only if there's no alert). No fake overlays.
  const center = alert ? { lat: alert.lat, lng: alert.lng } : state.location;
  paintMapBackground(mapEl);
  if (center) mountMap(mapEl, center.lat, center.lng, { zoom: 16, interactive: false });
}

async function arrived() {
  const alert = state.incomingAlert;
  if (alert) {
    try { const n = await net(); await n.updateResponderPosition(alert.id, state.responderCoords || null, 'arrived'); } catch (_) {}
  }
  navigate('medicHandoff');
}
