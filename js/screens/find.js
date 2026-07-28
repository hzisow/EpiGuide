// Screen 1 — Find. Real device geolocation on a real interactive Google map, an
// honest permission pre-prompt, and the real "alert nearby volunteers" network.
// (An earlier build listed nearby EpiPen cabinets, but there is no real public
// registry of cabinet locations, so that fabricated data was removed — the
// volunteer network is the real way to get a pen fast.)

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { paintMapBackground, mountMap, reverseGeocode } from '../map.js';
import { mountVolunteerCard } from '../volunteerCard.js';

let root, mapEl, topCard, bottomCard, prePrompt;
let built = false;
let rendered = false; // map + cards mounted (don't remount on every tab visit)

export function initFind() {
  root = document.querySelector('.screen[data-screen="find"]');
  if (!built) build();
  if (state.location && !rendered) render();
}

function build() {
  root.innerHTML = `
    <div class="find" style="position:relative;flex:1;">
      <div class="map" id="find-map"><div class="map__canvas"></div></div>
      <div class="find__top" id="find-top"></div>
      <div class="find__bottom" id="find-bottom"></div>
      <div class="pre-prompt" id="find-preprompt" hidden>
        <div class="welcome">
          <div class="welcome__hero">
            <img class="welcome__logo" src="icons/icon-192.png" alt="" width="76" height="76" />
            <span class="eyebrow welcome__brand">EpiGuide</span>
            <h1 class="display">What's happening?</h1>
          </div>

          <!-- Action-first triage. Nothing here is gated on a permission: the
               emergency paths are one tap away the moment the app opens, and
               location is requested inside the path that actually needs it. -->
          <div class="triage">
            <button class="triage__act triage__act--urgent" id="find-reacting">
              ${icons.alertTriangle('icon')}
              <span>
                <strong>Someone is reacting now</strong>
                <small>Use an auto-injector — step by step</small>
              </span>
            </button>

            <a class="triage__act triage__act--call" href="tel:911" id="find-call">
              ${icons.phone('icon')}
              <span>
                <strong>Call 911</strong>
                <small>Opens your phone's dialer</small>
              </span>
            </a>

            <button class="triage__act" id="find-allow">
              ${icons.mapPin('icon')}
              <span>
                <strong>Find epinephrine near me</strong>
                <small>Needs your location — used for your 911 address and, only if you ask, to alert nearby volunteers</small>
              </span>
            </button>
          </div>

          <p class="welcome__error" id="find-error" hidden></p>
          <p class="welcome__fine">Free · No account needed · Works offline</p>
        </div>
      </div>
    </div>`;

  mapEl = root.querySelector('#find-map');
  topCard = root.querySelector('#find-top');
  bottomCard = root.querySelector('#find-bottom');
  prePrompt = root.querySelector('#find-preprompt');

  // Stylized backdrop shows only until the real map iframe loads (or if offline).
  paintMapBackground(mapEl);

  root.querySelector('#find-allow').addEventListener('click', requestLocation);

  // Straight to the injection guide — the one action that is useful with no
  // permission, no account and no network.
  root.querySelector('#find-reacting').addEventListener('click', () => {
    state.guide.currentStep = 1;
    navigate('guide');
  });

  built = true;

  if (state.location) {
    render();
  } else {
    prePrompt.hidden = false;
  }
}

function requestLocation() {
  const allowBtn = root.querySelector('#find-allow');
  const errEl = root.querySelector('#find-error');
  errEl.hidden = true;
  allowBtn.textContent = 'Locating…';
  allowBtn.setAttribute('aria-disabled', 'true');

  const fail = (msg) => {
    allowBtn.textContent = 'Allow location';
    allowBtn.removeAttribute('aria-disabled');
    errEl.textContent = msg;
    errEl.hidden = false;
  };

  if (!('geolocation' in navigator)) {
    fail('This device can’t share its location. Turn on location services and try again.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => useLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => fail('Location access is needed to find help nearby. Enable it in your browser settings, then try again.'),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

function useLocation(coords) {
  state.location = coords;
  prePrompt.hidden = true;
  render();
}

function render() {
  rendered = true;
  const { lat, lng } = state.location;
  // Real, interactive Google map centered on and pinned at the user's location.
  mountMap(mapEl, lat, lng, { zoom: 16, interactive: true });
  renderCards();
}

function renderCards() {
  const { lat, lng } = state.location;

  // "You are here" — real reverse-geocoded address, useful to read to 911 or a
  // volunteer. Falls back to raw coordinates if geocoding can't resolve.
  topCard.innerHTML = `
    <div class="card card--elevated">
      <span class="eyebrow">You are here</span>
      <div class="body" id="find-addr" style="font-weight:600;margin-top:6px;">Locating your address…</div>
      <p class="body-sm text-muted" style="margin-top:2px;">Share this with 911 or a nearby volunteer.</p>
    </div>`;
  reverseGeocode(lat, lng).then((addr) => {
    const el = topCard.querySelector('#find-addr');
    if (el) el.textContent = addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  });

  // The real Plan B: summon a nearby volunteer who carries an EpiPen.
  bottomCard.innerHTML = `<div id="find-vol"></div>`;
  mountVolunteerCard(bottomCard.querySelector('#find-vol'));
}
