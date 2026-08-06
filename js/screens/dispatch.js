// Screen 4 — Dispatch. Post-injection state. Everything here is now REAL:
//
//  • "Call 911" is a real tel:911 link. Tapping it opens the native dialer with
//    911 pre-filled; the user confirms the call and speaks to the dispatcher.
//    A web app cannot (and must not) place the call silently — human-in-the-loop
//    is deliberate: 911 needs a person on the line, and the browser can't hand
//    the dispatcher a location the way a carrier 911 call does.
//    Because of that, the tap only proves the DIALER OPENED — the user can still
//    cancel. Nothing here records a completed call until the user says so with
//    the "I'm on the line with 911" control, which is the only thing that can
//    write CALL_911_CONFIRMED. There is no API on either platform that reports
//    whether a call connected, so the app asks instead of guessing.
//  • The dispatcher script is filled from REAL data: the device's GPS location
//    and the REAL epinephrine timestamp captured when Guide step 6 completed.
//  • "Share status" opens the native share sheet / SMS with a pre-filled message
//    (live location + status) the user sends to a contact. Also user-confirmed.
//  • The elapsed-time stopwatch is real.
//
// The old fake "911 has been called" banner, the moving ambulance, and the
// invented ETA countdown have been removed — the app never claims something
// happened that didn't.

import {
  state, navigate, logIncidentEvent, logIncidentEventOnce, formatClockTime,
  CALL_911_CONFIRMED, CALL_911_DIALER_OPENED,
} from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap, reverseGeocode } from '../map.js';
import { mountVolunteerCard } from '../volunteerCard.js';
import { isNative, nativeShare } from '../native.js';

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
  // By the time anyone reaches Dispatch the dose has been given, so "alert
  // volunteers to bring a pen" is the wrong ask — the right one is a SECOND
  // dose. Symptoms can rebound before EMS arrives and most people carry only
  // one pen, which is the same risk the "may need a second dose" line above
  // already warns about.
  volTeardown = mountVolunteerCard(root.querySelector('#disp-vol'), {
    lead: 'Symptoms can come back before EMS arrives, and a second dose may be needed. '
      + 'If you don\'t have another pen, alert people nearby who carry one.',
    cta: 'Ask nearby volunteers for a second dose',
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
        <div id="disp-911-state"></div>
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

  // Tapping the link opens the dialer. That is ALL it proves — iOS hands the
  // number to the phone app and tells the webview nothing afterwards, so the
  // user may never press call, or may hang up. Log the fact we actually have.
  root.querySelector('.dispatch__call-btn').addEventListener('click', () => {
    if (state.dispatch.call911 !== CALL_911_CONFIRMED) {
      state.dispatch.call911 = CALL_911_DIALER_OPENED;
    }
    logIncidentEventOnce('911-dialer-opened', '911 dialer opened — call not confirmed');
    render911State();
  });
  root.querySelector('#disp-log').addEventListener('click', () => navigate('medicHandoff'));
  root.querySelector('#disp-share').addEventListener('click', shareStatus);

  built = true;
}

// The only thing in the app that can record a REAL 911 call: the user says so.
// Deliberately small and secondary — this screen is used mid-emergency and the
// big red dialer button must stay the obvious target.
function render911State() {
  const host = root.querySelector('#disp-911-state');
  if (!host) return;

  if (state.dispatch.call911 === CALL_911_CONFIRMED) {
    const at = state.dispatch.call911ConfirmedAt;
    host.innerHTML = `<p class="dispatch__call-confirmed">${icons.checkCircle()}
      <span>On the line with 911${at ? ` — confirmed ${formatClockTime(at)}` : ''}</span></p>`;
    return;
  }

  host.innerHTML = `<button class="dispatch__call-confirm" id="disp-911-confirm">
    ${icons.check()} I'm on the line with 911</button>`;
  host.querySelector('#disp-911-confirm').addEventListener('click', () => {
    state.dispatch.call911 = CALL_911_CONFIRMED;
    state.dispatch.call911ConfirmedAt = new Date();
    logIncidentEventOnce('911-confirmed', 'Confirmed talking to a 911 dispatcher');
    render911State();
  });
}

function render() {
  const coords = state.location;

  render911State();

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
  //
  // The 911 line is CONDITIONAL on what really happened. This used to be a
  // hardcoded "911 is being called." that anyone could send without ever
  // touching the dialer, telling the recipient help was on the way when nobody
  // had called. When we don't know a call happened, the message asks THEM to
  // call rather than asserting anything.
  const lines = [
    '🚨 EMERGENCY — anaphylaxis (severe allergic reaction).',
    '',
  ];
  if (state.dispatch.call911 === CALL_911_CONFIRMED) {
    lines.push('911 has been called — someone here is on the line with a dispatcher.');
  } else if (state.dispatch.call911 === CALL_911_DIALER_OPENED) {
    lines.push('The 911 dialer was opened here, but the call is NOT confirmed. Please call 911 now to be sure.');
  } else {
    lines.push('911 has NOT been called yet. Please call 911 now.');
  }
  if (state.dispatch.epinephrineGivenAt) {
    lines.push(`Epinephrine given at ${formatTime(state.dispatch.epinephrineGivenAt)}.`);
  }
  if (coords) {
    lines.push('', `📍 Location: https://maps.google.com/?q=${coords.lat},${coords.lng}`);
  }
  lines.push('', 'Please come if you can.');
  const text = lines.join('\n');

  try {
    // navigator.share is unreliable inside a WKWebView, so the native shell
    // goes straight to the Capacitor share sheet. Both reject on cancel, and
    // both fall through to the SMS composer if unavailable.
    //
    // These two branches DO get a completion signal, which is why they keep the
    // strong "shared" wording: the Capacitor Share plugin resolves only when
    // UIActivityViewController's completionWithItemsHandler reports
    // completed == true and rejects with "Share canceled" otherwise, and
    // navigator.share likewise resolves only on a successful share. The SMS
    // fallback below gets no signal at all — see there.
    if (isNative()) {
      if (await nativeShare({ title: 'Emergency — anaphylaxis', text })) {
        logIncidentEvent('Status shared with a contact');
        return;
      }
    } else if (navigator.share) {
      await navigator.share({ title: 'Emergency — anaphylaxis', text });
      logIncidentEvent('Status shared with a contact');
      return;
    }
  } catch (_) {
    // User dismissed the share sheet — nothing to do.
    return;
  }
  // Fallback: open SMS composer with the body pre-filled (no recipient).
  // Capacitor's navigation delegate hands sms:/tel: to UIApplication.open, so
  // this still escapes the webview in the native shell.
  //
  // Navigating to sms: is fire-and-forget — nothing reports back whether a
  // recipient was picked or Send was ever pressed, and there is no recipient in
  // the URL to begin with. So this logs the composer opening, not a send. It
  // used to log "Status shared with a contact", which EMS then read off the
  // handoff timeline as a message that may never have left the phone.
  window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
  logIncidentEvent('Status message opened in the SMS composer — sending not confirmed');
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
