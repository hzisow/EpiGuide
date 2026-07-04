// Screen — Volunteer (opt-in). A carrier signs in, describes the auto-injector
// they carry, and toggles themselves available. Going available shares an
// APPROXIMATE location publicly, stores the exact one privately, turns on push
// alerts, and starts listening for nearby emergencies in real time.
//
// The Supabase layer is imported lazily so this screen (and the whole app) still
// loads with no network.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';

let root, built = false;
let netP, alertUnsub = null;

function net() { return (netP ||= import('../net.js')); }

export function initOptIn() {
  root = document.querySelector('.screen[data-screen="optIn"]');
  if (!built) build();
  refresh();
}

function build() {
  root.innerHTML = `
    <div class="optin">
      <div class="optin__head">
        <span class="eyebrow" style="color:var(--color-blue);">Responder network</span>
        <h1 class="h1" style="margin-top:4px;">Carry an EpiPen? Help someone nearby.</h1>
        <p class="body-sm text-muted" style="margin-top:6px;">
          Opt in and you'll get a live alert if someone close by needs epinephrine before EMS arrives.
        </p>
      </div>
      <div class="optin__body" id="optin-body"></div>
    </div>`;
  built = true;
}

function setBody(html) { root.querySelector('#optin-body').innerHTML = html; }

async function refresh() {
  setBody(`<div class="optin__note">Loading…</div>`);
  let user = null;
  try {
    const n = await net();
    user = await n.currentUser();
  } catch (e) {
    setBody(`<div class="card"><p class="body">Can't reach the network right now. Check your connection and reopen this tab.</p></div>`);
    return;
  }
  if (!user) return renderSignedOut();
  return renderSignedIn(user);
}

// --- signed out -----------------------------------------------------------

// Official "Sign in with Google" button, per Google's sign-in branding
// guidelines (light theme: white fill, #747775 stroke, 18px "G" logo,
// Roboto-weight medium label).
const GOOGLE_LOGO = `<svg class="gsi__logo" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

const gsiLabel = (text) => `${GOOGLE_LOGO}<span class="gsi__text">${text}</span>`;

function renderSignedOut() {
  setBody(`
    <div class="card">
      <p class="body-sm text-muted" style="margin:0;">
        Sign in so the network can reach you across sessions and devices.
      </p>
      <div id="oi-error" class="optin__error" hidden></div>
      <button type="button" class="gsi" id="oi-google" style="margin-top:16px;">
        ${gsiLabel('Sign in with Google')}
      </button>
    </div>
    <p class="optin__note">Volunteers are covered by Good Samaritan laws in all 50 states.</p>`);

  root.querySelector('#oi-google').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.setAttribute('aria-disabled', 'true');
    btn.innerHTML = gsiLabel('Opening Google…');
    try {
      const n = await net();
      await n.signInWithGoogle(); // navigates away; nothing runs after this on success
    } catch (err) {
      btn.removeAttribute('aria-disabled');
      btn.innerHTML = gsiLabel('Sign in with Google');
      showError(friendly(err));
    }
  });
}

function showError(msg) {
  const el = root.querySelector('#oi-error');
  if (!el) return;
  el.textContent = msg; el.hidden = false;
}

function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/provider is not enabled|unsupported provider/i.test(m)) {
    return 'Google sign-in is not enabled for this project yet. Enable the Google provider in the Supabase dashboard.';
  }
  return m;
}

// --- signed in ------------------------------------------------------------

async function renderSignedIn(user) {
  setBody(`<div class="optin__note">Loading your profile…</div>`);
  let profile = null;
  try { const n = await net(); profile = await n.getProfile(); } catch (_) {}

  const available = !!profile?.is_available;
  setBody(`
    <div class="card">
      <div class="toggle-row">
        <div>
          <div class="toggle-row__label">Available to help</div>
          <div class="body-sm text-muted">Shares your neighborhood, not your address.</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="oi-avail" ${available ? 'checked' : ''} />
          <span class="switch__slider"></span>
        </label>
      </div>
      <div id="oi-status" class="oi-status">${available
        ? `<span class="status-pill status-pill--on">${icons.check('icon')} Listening for nearby alerts</span>`
        : `<span class="status-pill status-pill--off">Off</span>`}</div>
    </div>

    <div class="card">
      <span class="eyebrow">What you carry</span>
      <div class="field" style="margin-top:10px;">
        <label for="oi-type">Auto-injector</label>
        <select id="oi-type">
          <option value="epipen">EpiPen</option>
          <option value="auvi-q">Auvi-Q</option>
          <option value="generic">Generic epinephrine</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field" style="margin-top:12px;">
        <label for="oi-dose">Dose</label>
        <select id="oi-dose">
          <option value="adult">Adult (0.3 mg)</option>
          <option value="junior">Junior (0.15 mg)</option>
          <option value="unknown">Not sure</option>
        </select>
      </div>
      <button class="btn btn--secondary btn--block" id="oi-save" style="margin-top:14px;">Save what I carry</button>
    </div>

    <button class="btn btn--ghost" id="oi-signout" style="margin:4px auto 0;display:block;">Sign out</button>
    <p class="optin__note">Alerts reach you even with the app closed once you allow notifications. Turning off availability stops them.</p>`);

  if (profile?.injector_type) root.querySelector('#oi-type').value = profile.injector_type;
  if (profile?.dose) root.querySelector('#oi-dose').value = profile.dose;

  root.querySelector('#oi-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget; const label = btn.textContent; btn.textContent = 'Saving…';
    try {
      const n = await net();
      await n.saveProfile({
        display_name: 'EpiGuide volunteer',
        injector_type: root.querySelector('#oi-type').value,
        dose: root.querySelector('#oi-dose').value,
      });
      btn.textContent = 'Saved'; setTimeout(() => (btn.textContent = label), 1400);
    } catch (err) { btn.textContent = label; setStatus(friendly(err), 'off'); }
  });

  root.querySelector('#oi-avail').addEventListener('change', (e) => {
    e.target.checked ? goAvailable(e.target) : goUnavailable();
  });

  root.querySelector('#oi-signout').addEventListener('click', async () => {
    await goUnavailable();
    try { const n = await net(); await n.signOut(); } catch (_) {}
    renderSignedOut();
  });
}

function setStatus(html, kind) {
  const el = root.querySelector('#oi-status');
  if (!el) return;
  el.innerHTML = kind === 'on'
    ? `<span class="status-pill status-pill--on">${icons.check('icon')} ${html}</span>`
    : `<span class="status-pill status-pill--off">${html}</span>`;
}

async function goAvailable(toggleEl) {
  setStatus('Getting your location…', 'off');
  try {
    const n = await net();
    const coords = await n.getPosition();
    await n.setAvailability(true, coords);

    // Best-effort push; the live in-app path works regardless.
    let pushMsg = '';
    try { await n.enablePush(); } catch (e) { pushMsg = ' (allow notifications for closed-app alerts)'; }

    startListening(n);
    setStatus(`Listening for nearby alerts${pushMsg}`, 'on');
  } catch (e) {
    if (toggleEl) toggleEl.checked = false;
    setStatus(n_friendly(e), 'off');
  }
}

function n_friendly(e) {
  const m = (e && e.message) || String(e);
  if (/denied|permission/i.test(m)) return 'Location is off. Allow it to go available.';
  return friendly(e);
}

async function goUnavailable() {
  if (alertUnsub) { alertUnsub(); alertUnsub = null; }
  try { const n = await net(); await n.setAvailability(false, null); } catch (_) {}
  setStatus('Off', 'off');
  const cb = root?.querySelector('#oi-avail');
  if (cb) cb.checked = false;
}

// Route incoming live alerts to the responder alert screen.
function startListening(n) {
  if (alertUnsub) alertUnsub();
  alertUnsub = n.subscribeToAlerts((alert) => {
    state.incomingAlert = alert;
    navigate('responderAlert');
  });
}
