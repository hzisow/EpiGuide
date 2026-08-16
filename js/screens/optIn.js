// Screen — Volunteer (opt-in). A carrier signs in, describes the auto-injector
// they carry, and toggles themselves available. Going available shares an
// APPROXIMATE location publicly, stores the exact one privately, turns on push
// alerts, and starts listening for nearby emergencies in real time.
//
// The Supabase layer is imported lazily so this screen (and the whole app) still
// loads with no network.

import { state, navigate } from '../app.js';
import { icons } from '../icons.js';
import { mountEpipens, teardownEpipens } from '../epipens.js';
import {
  isNative, requestNativeNotificationPermission, showLocalNotification,
  registerForPushNotifications, APNS_ENABLED,
} from '../native.js';

let root, built = false;
let netP, alertUnsub = null;
// This device's signed-in user id, so the realtime alert feed can skip alerts
// this very user raised. Set in refresh(), cleared on sign-out.
let selfUserId = null;

function net() { return (netP ||= import('../net.js')); }

export function initOptIn() {
  root = document.querySelector('.screen[data-screen="optIn"]');
  if (!built) build();
  refresh();
}

// Stop the EpiPen scanner camera if the user leaves the screen mid-scan.
export function teardownOptIn() {
  teardownEpipens();
}

function build() {
  root.innerHTML = `
    <div class="optin">
      <div class="optin__head">
        <span class="eyebrow" style="color:var(--color-blue);">Responder network</span>
        <h1 class="h1" style="margin-top:4px;">Carry epinephrine? Help someone nearby.</h1>
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
  let anonymous = false;
  try {
    const n = await net();
    user = await n.currentUser();
    anonymous = n.isAnonymousUser(user);
  } catch (e) {
    setBody(`<div class="card"><p class="body">Can't reach the network right now. Check your connection and reopen this tab.</p></div>`);
    return;
  }
  selfUserId = user?.id || null;
  // An anonymous session exists only because a bystander with no account raised
  // an alert. That is an identity for one emergency, not an account, so this
  // screen treats it as signed out: volunteering means being reachable later,
  // across sessions and devices, which needs a real account.
  if (!user || anonymous) return renderSignedOut();
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
      <div class="gsi-mount" id="oi-google" style="margin-top:16px;">
        <button type="button" class="gsi" id="oi-google-fallback" aria-disabled="true">
          ${gsiLabel(isNative() ? 'Sign in with Google' : 'Loading Google…')}
        </button>
      </div>
    </div>
    <p class="optin__note">Volunteers are covered by Good Samaritan laws in all 50 states.</p>`);

  // Native: GIS is blocked in an embedded webview and gid.renderButton() mounts
  // a cross-origin iframe that can't work there, so we draw our own button and
  // hand off to the native Google Sign-In SDK. Web: unchanged — Google Identity
  // Services renders its own button, which hands us an ID token in-page (no
  // redirect through the *.supabase.co URL). The placeholder above is replaced
  // on success, or turned into a retry if Google can't load.
  if (isNative()) mountNativeGoogleButton();
  else mountGoogleButton();
}

// Native-only: a plain, self-rendered button (no cross-origin iframe).
function mountNativeGoogleButton() {
  const mount = root.querySelector('#oi-google');
  if (!mount) return;
  mount.innerHTML = `<button type="button" class="gsi" id="oi-google-native">
    ${gsiLabel('Sign in with Google')}
  </button>`;
  const btn = mount.querySelector('#oi-google-native');
  btn.addEventListener('click', async () => {
    hideError();
    btn.setAttribute('aria-disabled', 'true');
    btn.innerHTML = gsiLabel('Signing in…');
    try {
      const n = await net();
      await n.signInWithGoogleNative();
      refresh();
    } catch (err) {
      // Includes the loud "iOS Google client ID not configured" case, so an
      // unconfigured build is visibly different from a broken one.
      btn.removeAttribute('aria-disabled');
      btn.innerHTML = gsiLabel('Sign in with Google');
      showError(friendly(err));
    }
  });
}

async function mountGoogleButton() {
  const mount = root.querySelector('#oi-google');
  if (!mount) return;
  try {
    const n = await net();
    await n.renderGoogleSignIn(mount, {
      onSignedIn: () => refresh(),
      onError: (err) => showError(friendly(err)),
    });
  } catch (err) {
    // Couldn't load GIS — offer a retry rather than a dead button.
    if (!root.querySelector('#oi-google')) return;
    mount.innerHTML = `<button type="button" class="gsi" id="oi-google-retry">
      ${gsiLabel('Retry Google sign-in')}
    </button>`;
    showError(friendly(err));
    mount.querySelector('#oi-google-retry')
      .addEventListener('click', () => { hideError(); mountGoogleButton(); });
  }
}

function showError(msg) {
  const el = root.querySelector('#oi-error');
  if (!el) return;
  el.textContent = msg; el.hidden = false;
}

function hideError() {
  const el = root.querySelector('#oi-error');
  if (el) { el.textContent = ''; el.hidden = true; }
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

    <div id="oi-epipens"></div>

    <button class="btn btn--ghost" id="oi-signout" style="margin:4px auto 0;display:block;">Sign out</button>
    <p class="optin__note">${isNative()
      ? `Once you allow notifications, we'll remind you 30 days before a pen expires and again on the day. <strong>Closed-app emergency alerts aren't active on iOS yet</strong> — you'll be alerted while EpiGuide is open. Turning off availability stops alerts.`
      : `Your pens' expiry dates are tracked here, but this browser can't schedule a reminder — check back yourself. Emergency alerts reach you even with the app closed once you allow notifications; turning off availability stops them.`}</p>`);

  // Mount the EpiPen inventory (scan a pen, track expirations). Saving a pen
  // also updates the availability profile above (what you carry).
  mountEpipens(root.querySelector('#oi-epipens'));

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
    state.responderSelfCoords = coords; // used to gate alerts by true distance

    // Notifications. On the web this is real closed-app web push. On iOS there
    // is no web push in a WKWebView (pushSupported() reports false there), so we
    // say so plainly instead of dressing a guaranteed failure up as success —
    // and we ask for LOCAL notification permission, which is what actually
    // fires when an alert lands while the app is running.
    let pushMsg = '';
    if (isNative()) {
      const granted = await requestNativeNotificationPermission();
      if (granted) {
        // APNs closed-app delivery. No-ops (and never throws) until
        // APNS_ENABLED is flipped on in js/native.js post-enrolment, so today
        // this line changes nothing.
        await registerForPushNotifications();
      }
      const openAppOnly = APNS_ENABLED ? '' : ' — open-app only on iOS';
      pushMsg = granted
        ? openAppOnly
        : `${openAppOnly} (notifications are off in Settings)`;
    } else {
      try { await n.enablePush(); } catch (e) { pushMsg = ' (allow notifications for closed-app alerts)'; }
    }

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
    // NEVER alert someone about their own emergency. A volunteer who is opted
    // in and then raises an alert themselves is, by definition, 0 m from it, so
    // the distance check below passes trivially — without this guard the
    // patient's own phone would buzz and then navigate itself off the dispatch
    // flow onto the "someone near you needs help" screen, mid-emergency.
    // notify-responders already excludes alert.created_by from the push fan-out;
    // this is the same rule on the realtime path, which had no such filter.
    // Two conditions because a signed-out bystander raises alerts with a null
    // created_by — for them, matching the alert we ourselves raised is the only
    // signal available.
    if (selfUserId && alert.created_by === selfUserId) return;
    if (state.activeAlert && alert.id === state.activeAlert.id) return;

    // The realtime channel (gated by RLS) reaches every available responder;
    // enforce the 0.4-mile alerting radius here by true distance, mirroring the
    // server-side push fan-out. If we don't yet know our own position, allow it.
    const self = state.responderSelfCoords;
    if (self && Number.isFinite(alert.lat) && Number.isFinite(alert.lng)) {
      if (n.haversineMeters(self.lat, self.lng, alert.lat, alert.lng) > n.ALERT_RADIUS_M) return;
    }
    state.incomingAlert = alert;
    // Native: no APNs yet, so fire a LOCAL notification off the same realtime
    // event that drives the screen below. That covers the app being open or
    // recently backgrounded — not a closed app, which is why the UI says so.
    if (isNative()) {
      showLocalNotification({
        title: 'Someone near you needs epinephrine',
        body: alert.patient_note || 'Possible anaphylaxis',
        alertId: alert.id,
      });
    }
    navigate('responderAlert');
  });
}
