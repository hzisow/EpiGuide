// Global state + screen router. No framework, no build step — plain ES modules.

import { initFind } from './screens/find.js';
import { initRecognize, teardownRecognize } from './screens/recognize.js';
import { initGuide } from './screens/guide.js';
import { initDispatch, teardownDispatch } from './screens/dispatch.js';
import { initChecklist } from './screens/checklist.js';
import { initResponderAlert } from './screens/responderAlert.js';
import { initFirstResponderView } from './screens/firstResponderView.js';
import { initMedicHandoff } from './screens/medicHandoff.js';
import { initOptIn } from './screens/optIn.js';
import { icons } from './icons.js';

export const state = {
  currentScreen: 'find', // find | recognize | guide | dispatch | checklist |
                         // responderAlert | firstResponderView | medicHandoff
  recognize: { result: null },            // null | 'match' | 'noMatch'
  guide: { currentStep: 1 },              // 1-6
  checklist: { checkedItemIds: [] },
  dispatch: { epinephrineGivenAt: null }, // Date, set when Guide step 6 completes
  location: null,                         // { lat, lng } once geolocation resolves
  cabinets: [],                           // generated mock cabinets
  incomingAlert: null,                    // real alert routed to a responder
  activeAlert: null,                      // real alert this device raised (patient side)
};

const ORDER = [
  'find', 'recognize', 'guide', 'dispatch', 'checklist', 'optIn',
  'responderAlert', 'firstResponderView', 'medicHandoff',
];

// Per-screen init hooks. Called the first time a screen is shown (and re-called
// for screens that need fresh data each visit, e.g. guide/dispatch/checklist).
const initializers = {
  find: initFind,
  recognize: initRecognize,
  guide: initGuide,
  dispatch: initDispatch,
  checklist: initChecklist,
  responderAlert: initResponderAlert,
  firstResponderView: initFirstResponderView,
  medicHandoff: initMedicHandoff,
  optIn: initOptIn,
};

// Screens that must re-run their init every time they become active because
// they depend on live state (timestamps, checked items, current step).
const ALWAYS_REINIT = new Set([
  'guide', 'dispatch', 'checklist', 'medicHandoff', 'firstResponderView',
]);

// Teardown hooks (release camera, stop intervals) when leaving a screen.
const teardowns = {
  recognize: teardownRecognize,
  dispatch: teardownDispatch,
};

const inited = new Set();
let animating = false;

function screenEl(name) {
  return document.querySelector(`.screen[data-screen="${name}"]`);
}

export function navigate(to, { direction } = {}) {
  if (to === state.currentScreen && inited.has(to) && !ALWAYS_REINIT.has(to)) return;
  if (animating) return;

  const from = state.currentScreen;
  const fromEl = screenEl(from);
  const toEl = screenEl(to);
  if (!toEl) {
    console.warn('Unknown screen:', to);
    return;
  }

  // Direction: forward if the target is later in ORDER, else back.
  const dir = direction || (ORDER.indexOf(to) >= ORDER.indexOf(from) ? 'forward' : 'back');

  // Run teardown for the screen we're leaving.
  if (teardowns[from] && from !== to) teardowns[from]();

  // Initialize / refresh the target before it animates in.
  if (!inited.has(to) || ALWAYS_REINIT.has(to)) {
    initializers[to]?.();
    inited.add(to);
  }

  state.currentScreen = to;
  updateTabs(to);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || fromEl === toEl) {
    fromEl?.classList.remove('screen--active');
    toEl.classList.add('screen--active');
    return;
  }

  animating = true;

  // Position entering screen off-screen on the correct side.
  toEl.classList.remove('screen--leaving-left', 'screen--leaving-right');
  toEl.classList.add('screen--animating');
  toEl.classList.add(dir === 'forward' ? 'screen--entering-right' : 'screen--entering-left');
  // Force reflow so the entering transform applies before we animate it away.
  void toEl.offsetWidth;
  toEl.classList.add('screen--active');
  toEl.classList.remove('screen--entering-right', 'screen--entering-left');

  if (fromEl && fromEl !== toEl) {
    fromEl.classList.add('screen--animating');
    fromEl.classList.add(dir === 'forward' ? 'screen--leaving-left' : 'screen--leaving-right');
  }

  const done = () => {
    fromEl?.classList.remove('screen--active', 'screen--animating', 'screen--leaving-left', 'screen--leaving-right');
    toEl.classList.remove('screen--animating');
    animating = false;
    toEl.removeEventListener('transitionend', done);
  };
  toEl.addEventListener('transitionend', done);
  // Safety fallback in case transitionend doesn't fire.
  setTimeout(done, 400);
}

// The tab bar stays visible on every screen — including full-screen permission
// modals — so Find / Recognize / Volunteer are always one tap away. Screens
// deeper in a flow (guide, dispatch, …) simply show no selected tab.
function updateTabs(active) {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  tabbar.classList.add('tabbar--visible');
  tabbar.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.target === active));
  });
}

function buildTabBar() {
  const tabbar = document.getElementById('tabbar');
  tabbar.innerHTML = `
    <button class="tab" data-target="find" aria-selected="true">
      ${icons.mapPin()}<span>Find</span>
    </button>
    <button class="tab" data-target="recognize" aria-selected="false">
      ${icons.camera()}<span>Recognize</span>
    </button>
    <button class="tab" data-target="optIn" aria-selected="false">
      ${icons.bell()}<span>Volunteer</span>
    </button>`;
  tabbar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) navigate(tab.dataset.target);
  });
}

// Expose a tiny nav/state handle. Useful for driving the simulated responder
// demo screens (which have no entry point in the primary single-device flow)
// during live demos and QA.
window.EpiGuide = { navigate, state };

// Boot.
function boot() {
  buildTabBar();
  // Show the first screen immediately (no animation on cold start).
  const first = state.currentScreen;
  initializers[first]?.();
  inited.add(first);
  screenEl(first).classList.add('screen--active');
  updateTabs(first);

  // Register the service worker (offline cache + push handling).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // A push tap re-opens the app and posts the alert id here.
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'open-alert') routeToIncomingAlert(ev.data.alert_id);
    });
  }

  // Cold start from a push tap: ?alert=<id> in the launch URL.
  const pendingAlert = new URLSearchParams(location.search).get('alert');
  if (pendingAlert) {
    history.replaceState({}, '', location.pathname);
    routeToIncomingAlert(pendingAlert);
  }

  // Returning from Google sign-in: the OAuth response is still in the URL
  // because net.js (which consumes it) is lazy-loaded. Open the Volunteer tab —
  // that loads net.js, and creating the Supabase client finishes the sign-in
  // and cleans the URL.
  if (/[#&?](access_token|code|error_description)=/.test(location.href)) {
    navigate('optIn');
  }
}

// Look up a real alert by id and drop the responder into the alert screen.
async function routeToIncomingAlert(alertId) {
  if (!alertId) return;
  try {
    const net = await import('./net.js');
    const alert = await net.getAlertById(alertId);
    if (alert && alert.status === 'active') {
      state.incomingAlert = alert;
      navigate('responderAlert');
    }
  } catch (e) {
    console.warn('Could not load incoming alert:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
