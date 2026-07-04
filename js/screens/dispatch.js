// Screen 4 — Dispatch. Post-injection state: SIMULATED emergency dispatch UI
// plus a REAL elapsed-time stopwatch computed from state.dispatch.epinephrineGivenAt.
//
// SIMULATION BOUNDARY: nothing on this screen contacts real emergency services.
// The "911 has been called" banner, the ambulance, and the ETA are UI theater
// only — never wire them to a phone call, SMS, or any dispatch API. No exceptions.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap } from '../map.js';

let root, built = false;
let stopwatchTimer = null;
let ambulanceTimer = null;
let etaTimer = null;
let mapEl;
let volUnsub = null;
const responders = new Map(); // responder_id -> latest response row
let netP;
function net() { return (netP ||= import('../net.js')); }

export function initDispatch() {
  root = document.querySelector('.screen[data-screen="dispatch"]');
  if (!built) build();
  render();
  startStopwatch();
  startSimulations();
}

export function teardownDispatch() {
  clearInterval(stopwatchTimer); stopwatchTimer = null;
  clearInterval(ambulanceTimer); ambulanceTimer = null;
  clearInterval(etaTimer); etaTimer = null;
  if (volUnsub) { volUnsub(); volUnsub = null; }
}

function build() {
  root.innerHTML = `
    <div class="dispatch" style="flex:1;display:flex;flex-direction:column;">
      <div class="dispatch__banner">
        <div class="check-circle">${icons.checkCircle('icon')}</div>
        <div>
          <div style="font-weight:700;font-size:18px;">911 has been called</div>
          <div class="body-sm" style="opacity:0.9;">Location and status shared automatically</div>
        </div>
      </div>
      <div class="dispatch__map" id="disp-map">
        <div class="map"><div class="map__canvas"></div></div>
        <div class="badge-glass" id="disp-eta">${icons.ambulance()} EMS · 6 min away</div>
      </div>
      <div class="scroll-y dispatch__body">
        <div class="card" style="margin-top:16px;">
          <div class="reported-row">${icons.checkCircle()}<span>Exact GPS location sent</span></div>
          <div class="reported-row">${icons.checkCircle()}<span id="disp-epi">Epinephrine administered</span></div>
          <div class="reported-row">${icons.checkCircle()}<span>Symptoms: facial swelling, difficulty breathing</span></div>
        </div>
        <div class="stopwatch">
          <div class="eyebrow">Time since epinephrine</div>
          <div class="stopwatch__num" id="disp-timer">0:00</div>
        </div>
        <button class="btn btn--ghost" id="disp-log" style="margin:0 auto;display:block;">View symptoms log</button>

        <div class="card vol-card" id="disp-vol">
          <div class="vol-card__head">
            <span class="eyebrow" style="color:var(--color-blue);">Nearby volunteers</span>
            <span class="pill pill--blue">Live network</span>
          </div>
          <p class="body-sm text-muted" id="disp-vol-status">
            Alert people nearby who carry an EpiPen and have opted in. Separate from the 911 call above.
          </p>
          <div class="vol-list" id="disp-vol-list"></div>
          <button class="btn btn--vol btn--block" id="disp-vol-btn">${icons.bell()} Alert nearby volunteers</button>
        </div>
      </div>
    </div>`;

  mapEl = root.querySelector('#disp-map .map');
  paintMapBackground(mapEl); // backdrop until the real map loads

  root.querySelector('#disp-log').addEventListener('click', () => navigate('medicHandoff'));
  root.querySelector('#disp-vol-btn').addEventListener('click', alertVolunteers);

  built = true;
}

async function alertVolunteers() {
  const btn = root.querySelector('#disp-vol-btn');
  const status = root.querySelector('#disp-vol-status');
  btn.setAttribute('aria-disabled', 'true');
  btn.innerHTML = `${icons.bell()} Alerting…`;
  try {
    const n = await net();
    const coords = state.location || await n.getPosition();
    const note = state.recognize?.result === 'match'
      ? 'Likely anaphylaxis, epinephrine given'
      : 'Possible anaphylaxis';
    const alert = await n.raiseAlert({ lat: coords.lat, lng: coords.lng, note });
    state.activeAlert = alert;

    btn.hidden = true;
    status.textContent = 'Alert sent. Waiting for a nearby volunteer to respond…';

    responders.clear();
    if (volUnsub) volUnsub();
    volUnsub = n.subscribeToResponses(alert.id, (row) => {
      if (!row) return;
      responders.set(row.responder_id, row);
      renderResponders(coords, n);
    });
  } catch (e) {
    btn.removeAttribute('aria-disabled');
    btn.innerHTML = `${icons.bell()} Alert nearby volunteers`;
    const msg = (e && e.message) || String(e);
    status.textContent = msg === 'SIGN_IN_REQUIRED'
      ? 'Sign in on the Volunteer tab first, then send the alert.'
      : 'Could not send the alert. Check your connection and try again.';
  }
}

function renderResponders(patientCoords, n) {
  const list = root.querySelector('#disp-vol-list');
  const status = root.querySelector('#disp-vol-status');
  const rows = [...responders.values()].filter((r) => r.status !== 'declined');
  if (rows.length === 0) {
    status.textContent = 'Alert sent. Waiting for a nearby volunteer to respond…';
    list.innerHTML = '';
    return;
  }
  status.textContent = `${rows.length} volunteer${rows.length > 1 ? 's' : ''} responding`;
  list.innerHTML = rows.map((r) => {
    let dist = '';
    if (r.responder_lat != null && r.responder_lng != null && n) {
      const mi = n.haversineMeters(patientCoords.lat, patientCoords.lng, r.responder_lat, r.responder_lng) / 1609.34;
      dist = ` · ${mi < 0.1 ? '< 0.1' : mi.toFixed(1)} mi`;
    }
    const label = r.status === 'arrived' ? 'Arrived' : 'On the way';
    return `<div class="vol-row"><span class="vol-row__dot"></span>
      <span class="body-sm"><strong>Volunteer</strong> ${label}${dist}</span></div>`;
  }).join('');
}

function render() {
  // Timestamp line.
  const epiEl = root.querySelector('#disp-epi');
  if (state.dispatch.epinephrineGivenAt) {
    epiEl.textContent = `Epinephrine administered at ${formatTime(state.dispatch.epinephrineGivenAt)}`;
  } else {
    epiEl.textContent = 'Epinephrine administered';
  }

  // Real map centered on and pinned at the patient (user location). The
  // ambulance is a simulated overlay that moves across the map surface.
  const center = state.location || { lat: 37.7793, lng: -122.4193 };
  mountMap(mapEl, center.lat, center.lng, { zoom: 15, interactive: false });

  mapEl.querySelectorAll('.ambulance').forEach((n) => n.remove());
  const amb = document.createElement('div');
  amb.className = 'ambulance';
  amb.id = 'disp-amb';
  amb.style.left = '14%';
  amb.style.top = '16%';
  amb.style.zIndex = '2';
  amb.innerHTML = `<div class="ambulance__badge">${icons.ambulance()}</div>`;
  mapEl.appendChild(amb);
}

function startStopwatch() {
  clearInterval(stopwatchTimer);
  const timerEl = root.querySelector('#disp-timer');
  const tick = () => {
    const start = state.dispatch.epinephrineGivenAt
      ? state.dispatch.epinephrineGivenAt.getTime()
      : Date.now();
    const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const m = Math.floor(elapsed / 60);
    const s = String(elapsed % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  };
  tick();
  stopwatchTimer = setInterval(tick, 1000);
}

// SIMULATED ambulance approach + ETA countdown. Pure UI, no real data.
function startSimulations() {
  clearInterval(ambulanceTimer);
  clearInterval(etaTimer);

  const amb = root.querySelector('#disp-amb');
  let t = 0; // 0..1 progress toward the patient (map centre)
  ambulanceTimer = setInterval(() => {
    t = Math.min(1, t + 0.06);
    if (amb) {
      // Move the overlay from the corner toward the pinned patient at centre.
      amb.style.left = `${14 + t * 36}%`;
      amb.style.top = `${16 + t * 34}%`;
    }
    if (t >= 1) clearInterval(ambulanceTimer);
  }, 1000);

  let etaMin = 6;
  const etaEl = root.querySelector('#disp-eta');
  etaTimer = setInterval(() => {
    if (etaMin > 1) etaMin -= 1;
    etaEl.innerHTML = `${icons.ambulance()} EMS · ${etaMin} min away`;
    if (etaMin <= 1) {
      etaEl.innerHTML = `${icons.ambulance()} EMS arriving`;
      clearInterval(etaTimer);
    }
  }, 4000);
}

function formatTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
