// Global state + screen router. No framework, no build step — plain ES modules.

import { initFind } from './screens/find.js';
import { initRecognize, teardownRecognize } from './screens/recognize.js';
import { initGuide } from './screens/guide.js';
import { initDispatch, teardownDispatch } from './screens/dispatch.js';
import { initChecklist } from './screens/checklist.js';
import { initResponderAlert } from './screens/responderAlert.js';
import { initFirstResponderView } from './screens/firstResponderView.js';
import { initMedicHandoff } from './screens/medicHandoff.js';
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
};

// Screens that show the persistent bottom tab bar. The rest of the flow chains
// forward and hides the tabs so it reads like a focused, linear emergency flow.
const TAB_SCREENS = ['find', 'recognize'];

const ORDER = [
  'find', 'recognize', 'guide', 'dispatch', 'checklist',
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

function updateTabs(active) {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  const showTabs = TAB_SCREENS.includes(active);
  tabbar.classList.toggle('tabbar--visible', showTabs);
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

  // Register a no-op service worker only if one is present; safe to skip.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
