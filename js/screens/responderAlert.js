// Screen 6 — Responder Alert. Shown to a nearby opt-in carrier when a real alert
// arrives (via live subscription or a push tap). Falls back to scripted content
// if opened manually with no active alert, so single-device demos still work.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';

let root, built = false, agoTimer = null;
let netP;
function net() { return (netP ||= import('../net.js')); }

export function initResponderAlert() {
  root = document.querySelector('.screen[data-screen="responderAlert"]');
  if (!built) build();
  render();
}

function build() {
  root.innerHTML = `
    <div class="responder" style="flex:1;">
      <div class="responder__inner">
        <div class="alert-bell">
          <span class="alert-bell__ring"></span>
          <span class="alert-bell__ring"></span>
          <span class="alert-bell__core">${icons.bell()}</span>
        </div>
        <h1 class="h1">Someone near you needs epinephrine</h1>
        <p class="body text-muted" id="ra-meta" style="margin-top:8px;">Nearby</p>

        <div class="card info-card">
          <div class="info-row">${icons.mapPin()}<span id="ra-loc">Location shared when you accept</span></div>
          <div class="info-row">${icons.clock()}<span id="ra-eta">Tap to navigate</span></div>
          <div class="info-row">${icons.user()}<span id="ra-note">Possible anaphylaxis</span></div>
        </div>

        <div class="responder__actions">
          <button class="btn btn--primary btn--block" id="ra-help">${icons.navigation()} I can help — Navigate</button>
          <button class="btn btn--secondary btn--block" id="ra-cant">Can't make it</button>
        </div>
        <p class="responder__caption">Your response helps close the gap before EMS arrives.</p>
      </div>
    </div>`;

  root.querySelector('#ra-help').addEventListener('click', accept);
  root.querySelector('#ra-cant').addEventListener('click', decline);
  built = true;
}

function render() {
  clearInterval(agoTimer); agoTimer = null;
  const alert = state.incomingAlert;
  const noteEl = root.querySelector('#ra-note');
  const metaEl = root.querySelector('#ra-meta');

  if (!alert) {
    // Scripted fallback (manual/QA demo).
    metaEl.textContent = '0.2 mi away · Sent 8 seconds ago';
    noteEl.textContent = 'Adult, possible anaphylaxis';
    root.querySelector('#ra-loc').textContent = '412 Main St, Lobby';
    return;
  }

  noteEl.textContent = alert.patient_note || 'Possible anaphylaxis';
  root.querySelector('#ra-loc').textContent = 'Exact location unlocks when you accept';

  const tick = () => {
    const secs = Math.max(0, Math.round((Date.now() - new Date(alert.created_at).getTime()) / 1000));
    metaEl.textContent = secs < 60 ? `Nearby · Sent ${secs}s ago` : `Nearby · Sent ${Math.round(secs / 60)} min ago`;
  };
  tick();
  agoTimer = setInterval(tick, 1000);

  // Fill in a straight-line distance once we have this responder's position.
  net().then((n) => n.getPosition()
    .then((coords) => {
      const m = n.haversineMeters(coords.lat, coords.lng, alert.lat, alert.lng);
      const mi = m / 1609.34;
      metaEl.textContent = `${mi < 0.1 ? '< 0.1' : mi.toFixed(1)} mi away · ` + metaEl.textContent.split('· ')[1];
    })
    .catch(() => {}));
}

async function accept() {
  const alert = state.incomingAlert;
  const btn = root.querySelector('#ra-help');
  btn.setAttribute('aria-disabled', 'true'); btn.innerHTML = `${icons.navigation()} Sharing your location…`;
  try {
    if (alert) {
      const n = await net();
      let coords = null;
      try { coords = await n.getPosition(); } catch (_) {}
      await n.acceptAlert(alert, coords);
      state.responderCoords = coords;
    }
    clearInterval(agoTimer); agoTimer = null;
    navigate('firstResponderView');
  } catch (e) {
    btn.removeAttribute('aria-disabled'); btn.innerHTML = `${icons.navigation()} I can help — Navigate`;
    root.querySelector('#ra-meta').textContent = 'Could not accept. Check your connection and try again.';
  }
}

async function decline() {
  const alert = state.incomingAlert;
  clearInterval(agoTimer); agoTimer = null;
  if (alert) { try { const n = await net(); await n.declineAlert(alert); } catch (_) {} }
  state.incomingAlert = null;
  navigate('optIn');
}
