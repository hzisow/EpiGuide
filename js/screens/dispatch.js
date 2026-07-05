// Screen 4 — Dispatch. Post-injection state. Everything here is now REAL:
//
//  • "Call 911" is a real tel:911 link. Tapping it opens the native dialer with
//    911 pre-filled; the user confirms the call and speaks to the dispatcher.
//    A web app cannot (and must not) place the call silently — human-in-the-loop
//    is deliberate: 911 needs a person on the line, and the browser can't hand
//    the dispatcher a location the way a carrier 911 call does.
//  • The dispatcher script is filled from REAL data: the device's GPS location
//    and the REAL epinephrine timestamp captured when Guide step 6 completed.
//  • "Share status" opens the native share sheet / SMS with a pre-filled message
//    (live location + status) the user sends to a contact. Also user-confirmed.
//  • The elapsed-time stopwatch is real.
//
// The old fake "911 has been called" banner, the moving ambulance, and the
// invented ETA countdown have been removed — the app never claims something
// happened that didn't.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap, reverseGeocode } from '../map.js';
import { mountVolunteerCard } from '../volunteerCard.js';

let root, built = false;
let stopwatchTimer = null;
let mapEl;
let volTeardown = null;

export function initDispatch() {
  root = document.querySelector('.screen[data-screen="dispatch"]');
  if (!built) build();
  render();
  startStopwatch();
  // Live volunteer status. The alert itself is raised from the Find screen;
  // if one is active this shows responders, otherwise it offers the button.
  volTeardown = mountVolunteerCard(root.querySelector('#disp-vol'), {
    lead: 'No pen nearby? Alert people close by who carry an EpiPen — separate from your 911 call.',
  });
}

export function teardownDispatch() {
  clearInterval(stopwatchTimer); stopwatchTimer = null;
  if (volTeardown) { volTeardown(); volTeardown = null; }
}

function build() {
  root.innerHTML = `
    <div class="dispatch" style="flex:1;display:flex;flex-direction:column;">
      <div class="dispatch__call">
        <a class="btn btn--danger btn--block dispatch__call-btn" href="tel:911">
          ${icons.phone()} Call 911
        </a>
        <p class="dispatch__call-note">Opens your phone's dialer. You confirm the call and talk to the dispatcher.</p>
      </div>

      <div class="dispatch__map" id="disp-map">
        <div class="map"><div class="map__canvas"></div></div>
      </div>

      <div class="scroll-y dispatch__body">
        <div class="card">
          <span class="eyebrow">When the dispatcher answers, tell them</span>
          <div class="script-row">${icons.alertTriangle()}<span>Severe allergic reaction — <strong>anaphylaxis</strong>.</span></div>
          <div class="script-row">${icons.mapPin()}<span id="disp-loc">Your location</span></div>
          <div class="script-row">${icons.clock()}<span id="disp-epi">Epinephrine given</span></div>
          <div class="script-row">${icons.user()}<span>May need a second dose; watch breathing.</span></div>
        </div>

        <button class="btn btn--secondary btn--block" id="disp-share">${icons.share()} Share status with a contact</button>

        <div class="stopwatch">
          <div class="eyebrow">Time since epinephrine</div>
          <div class="stopwatch__num" id="disp-timer">0:00</div>
        </div>
        <button class="btn btn--ghost" id="disp-log" style="margin:0 auto;display:block;">View symptoms log</button>

        <div id="disp-vol"></div>
      </div>
    </div>`;

  mapEl = root.querySelector('#disp-map .map');
  paintMapBackground(mapEl); // backdrop until the real map loads

  root.querySelector('#disp-log').addEventListener('click', () => navigate('medicHandoff'));
  root.querySelector('#disp-share').addEventListener('click', shareStatus);

  built = true;
}

function render() {
  const coords = state.location;

  // Location line for the dispatcher script — real coordinates, upgraded to a
  // precise street address as soon as reverse geocoding resolves. Tappable to
  // open a map. If we have no fix, tell the user to read their address.
  const locEl = root.querySelector('#disp-loc');
  if (coords) {
    const ll = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    const link = `<a href="https://maps.google.com/?q=${coords.lat},${coords.lng}" target="_blank" rel="noopener">${ll}</a>`;
    locEl.innerHTML = `Your location: ${link}`;
    reverseGeocode(coords.lat, coords.lng).then((addr) => {
      if (addr && root.querySelector('#disp-loc') === locEl) {
        locEl.innerHTML = `Your location: <strong>${addr}</strong> · ${link}`;
      }
    });
  } else {
    locEl.textContent = 'Your exact address or nearest cross-streets';
  }

  // Epinephrine timing line — real timestamp captured at injection.
  const epiEl = root.querySelector('#disp-epi');
  epiEl.textContent = state.dispatch.epinephrineGivenAt
    ? `Epinephrine given at ${formatTime(state.dispatch.epinephrineGivenAt)}`
    : 'Epinephrine given (note the time)';

  // Real map centered on and pinned at the patient (user location). No overlays.
  // With no fix we leave the painted backdrop rather than centering somewhere fake.
  if (coords) mountMap(mapEl, coords.lat, coords.lng, { zoom: 15, interactive: false });
}

// Pre-fill a message with live location + status and hand it to the native
// share sheet (or SMS as a fallback). The user picks the recipient and sends —
// the app never sends silently.
async function shareStatus() {
  const coords = state.location;

  // Build a clean, scannable message — one fact per line, so it reads well in
  // a text message rather than as a run-on sentence.
  const lines = [
    '🚨 EMERGENCY — anaphylaxis (severe allergic reaction).',
    '',
    '911 is being called.',
  ];
  if (state.dispatch.epinephrineGivenAt) {
    lines.push(`Epinephrine given at ${formatTime(state.dispatch.epinephrineGivenAt)}.`);
  }
  if (coords) {
    lines.push('', `📍 Location: https://maps.google.com/?q=${coords.lat},${coords.lng}`);
  }
  lines.push('', 'Please come if you can.');
  const text = lines.join('\n');

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Emergency — anaphylaxis', text });
      return;
    }
  } catch (_) {
    // User dismissed the share sheet — nothing to do.
    return;
  }
  // Fallback: open SMS composer with the body pre-filled (no recipient).
  window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
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

function formatTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
