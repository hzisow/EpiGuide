// Screen 8 — Medic Handoff. A structured summary a bystander shows to arriving
// EMS. Deliberately calm/formal styling — dark, not the red urgency style used
// elsewhere. Every value here is REAL: the epinephrine time captured at
// injection, the symptoms the user actually checked, and the reverse-geocoded
// address of their real GPS location.

import {
  state, navigate, logIncidentEvent, logIncidentEventOnce, call911Summary,
} from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap, reverseGeocode } from '../map.js';
import { checklistCategories } from '../data/checklistItems.js';
import { guides } from '../data/guideSteps.js';
import { isNative, nativeShare } from '../native.js';

const ALL_ITEMS = checklistCategories.flatMap((c) => c.items);

let root, built = false;

export function initMedicHandoff() {
  root = document.querySelector('.screen[data-screen="medicHandoff"]');
  if (!built) build();
  logIncidentEventOnce('ems-handoff-shown', 'EMS handoff screen shown');
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
            <span class="eyebrow label">911</span>
            <span class="value" id="mh-911">—</span>
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
        <button class="btn btn--ghost" id="mh-summary" style="margin:12px auto 0;display:block;">${icons.fileText()} View incident summary</button>
      </div>
    </div>`;

  root.querySelector('#mh-share').addEventListener('click', shareTimeline);

  root.querySelector('#mh-summary').addEventListener('click', () => navigate('incidentSummary'));

  built = true;
}

function render() {
  // Epinephrine — real timestamp captured at Guide step 6.
  const epi = state.dispatch.epinephrineGivenAt;
  root.querySelector('#mh-epi').textContent = epi
    ? `${formatTime(epi)} (1 dose, thigh)`
    : 'Not yet given';

  // 911 — stated at the top of the handoff because it is the first thing
  // arriving EMS need to know, and because "the dialer was opened" must never
  // read to them as "a call was placed".
  root.querySelector('#mh-911').textContent = call911Summary();

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

// Builds the same handoff the screen displays, as plain text EMS can be sent.
// Mirrors shareSummary() in incidentSummary.js: native share sheet on iOS,
// Web Share API on the web, clipboard as the last resort.
async function shareTimeline() {
  const epi = state.dispatch.epinephrineGivenAt;
  const deviceLabel = state.guide.device ? guides[state.guide.device]?.label : null;
  const ids = state.checklist.checkedItemIds || [];
  const symptomLabels = ids.map((id) => ALL_ITEMS.find((i) => i.id === id)?.label).filter(Boolean);
  const events = [...state.incident.events].sort((a, b) => a.time - b.time);
  const addr = root.querySelector('#mh-addr')?.textContent?.trim();

  const text = [
    'EMS HANDOFF — anaphylaxis',
    '',
    `Epinephrine given: ${epi ? `${formatTime(epi)}${deviceLabel ? ` (${deviceLabel})` : ''}` : 'Not yet given'}`,
    `911: ${call911Summary()}`,
    `Symptoms observed: ${symptomLabels.length ? symptomLabels.join(', ') : 'Not recorded'}`,
    `Patient location: ${addr || 'Not recorded'}`,
    '',
    'Timeline:',
    ...(events.length ? events.map((e) => `  ${formatTime(e.time)} — ${e.label}`) : ['  No events recorded']),
    '',
    'Bystander-recorded handoff — not an official medical record.',
  ].join('\n');

  try {
    if (isNative()) {
      if (await nativeShare({ title: 'EMS handoff', text })) {
        logIncidentEvent('Timeline shared with EMS');
        return;
      }
    } else if (navigator.share) {
      await navigator.share({ title: 'EMS handoff', text });
      logIncidentEvent('Timeline shared with EMS');
      return;
    }
  } catch (_) {
    return; // user dismissed the share sheet
  }

  try {
    await navigator.clipboard.writeText(text);
    logIncidentEvent('Timeline copied for EMS');
    const btn = root.querySelector('#mh-share');
    const original = btn.innerHTML;
    btn.innerHTML = `${icons.checkCircle()} Copied to clipboard`;
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  } catch (_) {
    // No share, no clipboard — nothing more we can do silently.
  }
}

function formatTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
