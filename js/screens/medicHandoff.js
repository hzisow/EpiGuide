// Screen 8 — Medic Handoff (SIMULATED / demo mode). A structured summary a
// bystander shows to arriving EMS. Deliberately calm/formal styling — dark, not
// the red urgency style used elsewhere.

import { state } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground } from '../map.js';

let root, built = false;

export function initMedicHandoff() {
  root = document.querySelector('.screen[data-screen="medicHandoff"]');
  if (!built) build();
  render();
}

function build() {
  root.innerHTML = `
    <div class="medic" style="flex:1;display:flex;flex-direction:column;">
      <div class="medic__bar">FOR EMS — SHOW THIS SCREEN</div>
      <div class="scroll-y medic__body" style="flex:1;">
        <div class="card">
          <div class="summary-row">
            <span class="eyebrow label">Time of onset</span>
            <span class="value" id="mh-onset">—</span>
          </div>
          <div class="summary-row">
            <span class="eyebrow label">Epinephrine given</span>
            <span class="value" id="mh-epi">—</span>
          </div>
          <div class="summary-row">
            <span class="eyebrow label">Symptoms observed</span>
            <span class="value">Facial swelling, hives, difficulty breathing</span>
          </div>
          <div class="summary-row">
            <span class="eyebrow label">Responder</span>
            <span class="value">Bystander, no medical training</span>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <span class="eyebrow">Patient location</span>
          <div class="medic__thumb map" id="mh-map"><div class="map__canvas"></div></div>
          <p class="body-sm text-muted" style="margin-top:10px;">412 Main St, Lobby</p>
        </div>
      </div>
      <div class="medic__foot">
        <button class="btn btn--dark btn--block" id="mh-share">${icons.share()} Share full timeline with EMS</button>
      </div>
    </div>`;

  const mapEl = root.querySelector('#mh-map');
  paintMapBackground(mapEl);
  const patient = document.createElement('div');
  patient.className = 'marker';
  patient.style.left = '50%';
  patient.style.top = '52%';
  patient.innerHTML = `<span class="marker__dot"></span>`;
  mapEl.appendChild(patient);

  root.querySelector('#mh-share').addEventListener('click', () => {
    const btn = root.querySelector('#mh-share');
    btn.innerHTML = `${icons.checkCircle()} Timeline shared`;
    btn.setAttribute('aria-disabled', 'true');
  });

  built = true;
}

function render() {
  const epi = state.dispatch.epinephrineGivenAt;
  const onsetEl = root.querySelector('#mh-onset');
  const epiEl = root.querySelector('#mh-epi');

  if (epi) {
    // Simulated onset: a couple of minutes before epinephrine for a plausible demo.
    const onset = new Date(epi.getTime() - 3 * 60 * 1000);
    onsetEl.textContent = formatTime(onset);
    epiEl.textContent = `${formatTime(epi)} (1 dose, thigh)`;
  } else {
    // Demo defaults if Guide hasn't been completed this session.
    onsetEl.textContent = 'Approx. 3 min ago';
    epiEl.textContent = 'Pending (1 dose, thigh)';
  }
}

function formatTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
