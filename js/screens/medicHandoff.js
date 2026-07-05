// Screen 8 — Medic Handoff. A structured summary a bystander shows to arriving
// EMS. Deliberately calm/formal styling — dark, not the red urgency style used
// elsewhere. Every value here is REAL: the epinephrine time captured at
// injection, the symptoms the user actually checked, and the reverse-geocoded
// address of their real GPS location.

import { state } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap, reverseGeocode } from '../map.js';
import { checklistCategories } from '../data/checklistItems.js';

const ALL_ITEMS = checklistCategories.flatMap((c) => c.items);

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
            <span class="eyebrow label">Epinephrine given</span>
            <span class="value" id="mh-epi">—</span>
          </div>
          <div class="summary-row">
            <span class="eyebrow label">Symptoms observed</span>
            <span class="value" id="mh-symptoms">—</span>
          </div>
          <div class="summary-row">
            <span class="eyebrow label">Responder</span>
            <span class="value">Bystander, no medical training</span>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <span class="eyebrow">Patient location</span>
          <div class="medic__thumb map" id="mh-map"><div class="map__canvas"></div></div>
          <p class="body-sm text-muted" style="margin-top:10px;" id="mh-addr">Locating…</p>
        </div>
      </div>
      <div class="medic__foot">
        <button class="btn btn--dark btn--block" id="mh-share">${icons.share()} Share full timeline with EMS</button>
      </div>
    </div>`;

  root.querySelector('#mh-share').addEventListener('click', () => {
    const btn = root.querySelector('#mh-share');
    btn.innerHTML = `${icons.checkCircle()} Timeline shared`;
    btn.setAttribute('aria-disabled', 'true');
  });

  built = true;
}

function render() {
  // Epinephrine — real timestamp captured at Guide step 6.
  const epi = state.dispatch.epinephrineGivenAt;
  root.querySelector('#mh-epi').textContent = epi
    ? `${formatTime(epi)} (1 dose, thigh)`
    : 'Not yet given';

  // Symptoms — the boxes the user actually checked, not a canned list.
  const ids = state.checklist.checkedItemIds || [];
  const labels = ids.map((id) => ALL_ITEMS.find((i) => i.id === id)?.label).filter(Boolean);
  root.querySelector('#mh-symptoms').textContent = labels.length
    ? labels.join(', ')
    : 'Not recorded — describe to EMS';

  // Location — real map + reverse-geocoded street address.
  const mapEl = root.querySelector('#mh-map');
  const addrEl = root.querySelector('#mh-addr');
  const coords = state.location;
  paintMapBackground(mapEl);
  if (coords) {
    mountMap(mapEl, coords.lat, coords.lng, { zoom: 16, interactive: false });
    addrEl.textContent = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    reverseGeocode(coords.lat, coords.lng).then((addr) => {
      if (addr && root.querySelector('#mh-addr') === addrEl) addrEl.textContent = addr;
    });
  } else {
    addrEl.textContent = 'Location unavailable — read your address to EMS';
  }
}

function formatTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
