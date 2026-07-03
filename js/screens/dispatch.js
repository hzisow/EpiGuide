// Screen 4 — Dispatch. Post-injection state: SIMULATED emergency dispatch UI
// plus a REAL elapsed-time stopwatch computed from state.dispatch.epinephrineGivenAt.
//
// SIMULATION BOUNDARY: nothing on this screen contacts real emergency services.
// The "911 has been called" banner, the ambulance, and the ETA are UI theater
// only — never wire them to a phone call, SMS, or any dispatch API. No exceptions.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { makeProjection, paintMapBackground } from '../map.js';

let root, built = false;
let stopwatchTimer = null;
let ambulanceTimer = null;
let etaTimer = null;
let mapEl;

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
      </div>
    </div>`;

  mapEl = root.querySelector('#disp-map .map');
  paintMapBackground(mapEl);

  root.querySelector('#disp-log').addEventListener('click', () => navigate('medicHandoff'));

  built = true;
}

function render() {
  // Timestamp line.
  const epiEl = root.querySelector('#disp-epi');
  if (state.dispatch.epinephrineGivenAt) {
    epiEl.textContent = `Epinephrine administered at ${formatTime(state.dispatch.epinephrineGivenAt)}`;
  } else {
    epiEl.textContent = 'Epinephrine administered';
  }

  // Map: patient dot (user location) + a simulated ambulance route.
  const center = state.location || { lat: 37.7793, lng: -122.4193 };
  const rect = mapEl.getBoundingClientRect();
  const w = rect.width || 360;
  const h = rect.height || 200;

  mapEl.querySelectorAll('.marker, .ambulance').forEach((n) => n.remove());

  const patient = document.createElement('div');
  patient.className = 'marker';
  patient.style.left = '50%';
  patient.style.top = '58%';
  patient.innerHTML = `<span class="marker__ring"></span><span class="marker__ring"></span><span class="marker__dot"></span>`;
  mapEl.appendChild(patient);

  const amb = document.createElement('div');
  amb.className = 'ambulance';
  amb.id = 'disp-amb';
  amb.style.left = '12%';
  amb.style.top = '14%';
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
  let t = 0; // 0..1 progress toward patient
  ambulanceTimer = setInterval(() => {
    t = Math.min(1, t + 0.06);
    if (amb) {
      amb.style.left = `${12 + t * 38}%`;
      amb.style.top = `${14 + t * 44}%`;
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
