// Screen 7 — First-Responder View. The opt-in responder is en route to the
// patient. Centers on the REAL patient location from the accepted alert, shows
// its reverse-geocoded address, hands off to the device's maps app for actual
// turn-by-turn directions, and marks arrival in the database. No fabricated
// ETA/route overlays.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap, reverseGeocode, openDirections } from '../map.js';

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
        <div class="body-sm" id="fr-addr" style="margin-top:4px;font-weight:600;">Looking up the address…</div>
        <div class="body-sm text-muted" style="margin-top:2px;">Bring your epinephrine auto-injector if accessible</div>
        <button class="btn btn--primary btn--block" id="fr-directions" style="margin-top:12px;">
          ${icons.navigation()} Open in Maps
        </button>
        <div class="row">
          <button class="btn btn--secondary" id="fr-cant">Can't go</button>
          <button class="btn btn--secondary" id="fr-nav">${icons.compass()} I've arrived</button>
        </div>
      </div>
    </div>`;

  root.querySelector('#fr-cant').addEventListener('click', () => navigate('responderAlert'));
  root.querySelector('#fr-nav').addEventListener('click', arrived);
  root.querySelector('#fr-directions').addEventListener('click', directions);
  built = true;
}

// Where we're actually sending the responder. Kept in sync with what the map
// and the address line show, so the button can never route somewhere else.
function target() {
  const alert = state.incomingAlert;
  if (alert && Number.isFinite(alert.lat) && Number.isFinite(alert.lng)) {
    return { lat: alert.lat, lng: alert.lng };
  }
  return null;
}

function render() {
  const mapEl = root.querySelector('#fr-map');
  const addrEl = root.querySelector('#fr-addr');
  const dirBtn = root.querySelector('#fr-directions');
  // Center on the REAL patient location from the accepted alert (fall back to
  // this device's own location only if there's no alert). No fake overlays.
  const dest = target();
  const center = dest || state.location;
  paintMapBackground(mapEl);
  if (center) mountMap(mapEl, center.lat, center.lng, { zoom: 16, interactive: true });

  // Without a real alert there is no patient to navigate to — say so and don't
  // offer a button that would send the responder to their own doorstep.
  if (!dest) {
    addrEl.textContent = 'No active alert — nowhere to navigate to';
    dirBtn.hidden = true;
    return;
  }
  dirBtn.hidden = false;

  // Read out a real street address so the responder can find the door (and say
  // it out loud to 911). Falls back to the raw coordinates, which the maps
  // hand-off uses anyway, so the button works either way.
  const coordText = `${dest.lat.toFixed(5)}, ${dest.lng.toFixed(5)}`;
  addrEl.textContent = 'Looking up the address…';
  reverseGeocode(dest.lat, dest.lng).then((addr) => {
    if (root.querySelector('#fr-addr') !== addrEl) return;
    addrEl.textContent = addr || coordText;
  }).catch(() => { addrEl.textContent = coordText; });
}

// Hand off to the device's maps app for real turn-by-turn directions.
function directions() {
  const dest = target();
  if (!dest) return;
  openDirections(dest.lat, dest.lng);
}

async function arrived() {
  const alert = state.incomingAlert;
  if (alert) {
    try { const n = await net(); await n.updateResponderPosition(alert.id, state.responderCoords || null, 'arrived'); } catch (_) {}
  }
  navigate('medicHandoff');
}
