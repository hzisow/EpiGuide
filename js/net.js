// Responder-network networking layer. Talks to Supabase (auth, database,
// realtime) and the notify-responders Edge Function (web push fan-out).
//
// IMPORTANT: this module pulls the Supabase client from a CDN, so it must only
// ever be loaded with `await import('./net.js')` from inside an event handler —
// never statically imported into the boot graph. That keeps the core emergency
// flow (Find / Recognize / Guide / Dispatch) fully working offline and immune
// to any CDN outage.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, APPROX_DECIMALS, GOOGLE_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
} from './config.js';
import { isNative, getPlugin } from './native.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // detectSessionInUrl is off: sign-in no longer round-trips through a redirect,
  // so no tokens ever arrive in the URL for the client to consume.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Google sign-in via Google Identity Services (GIS), NOT signInWithOAuth.
//
// signInWithOAuth does a full-page redirect through
// https://<ref>.supabase.co/auth/v1/authorize, so Google's account chooser says
// "to continue to <ref>.supabase.co" and the user visibly lands on the Supabase
// project URL. Instead we render Google's own button; Google returns an ID token
// *in the page*, and we exchange it for a Supabase session with
// signInWithIdToken. No redirect, so the supabase.co URL is never shown.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisPromise = null;

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (gisPromise ||= new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    const script = existing || document.createElement('script');
    const timer = setTimeout(() => {
      gisPromise = null;
      reject(new Error("Couldn't reach Google sign-in. Check your connection."));
    }, 10000);
    script.addEventListener('load', () => { clearTimeout(timer); resolve(); });
    script.addEventListener('error', () => {
      clearTimeout(timer); gisPromise = null;
      reject(new Error("Couldn't load Google sign-in."));
    });
    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }));
}

// The one place a Google ID token becomes a Supabase session. Both the web
// (GIS) and native (SocialLogin) paths funnel through here — same provider,
// same call, one code path.
// `nonce` is the RAW nonce, passed only on the native path. Supabase hashes it
// and compares against the `nonce` claim inside the ID token, so Google must
// have been given the hashed form. GIS (web) issues tokens with no nonce claim
// at all, so the web path omits it — passing one there would fail the same
// "should either both exist or not" check in the opposite direction.
async function exchangeGoogleIdToken(idToken, nonce) {
  if (!idToken) throw new Error('No credential returned from Google.');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    ...(nonce ? { nonce } : {}),
  });
  if (error) throw error;
}

// Google's iOS SDK always embeds a nonce claim in the ID token, so the native
// path has to generate one and hand the same value to both sides.
function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Renders Google's official button into `container`. `onSignedIn` fires after
// the Supabase session exists; `onError` receives any failure.
export async function renderGoogleSignIn(container, { onSignedIn, onError } = {}) {
  await loadGis();
  const gid = window.google?.accounts?.id;
  if (!gid) throw new Error("Couldn't load Google sign-in.");

  gid.initialize({
    client_id: GOOGLE_CLIENT_ID,
    auto_select: false,
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true,
    callback: async (response) => {
      try {
        await exchangeGoogleIdToken(response?.credential);
        onSignedIn?.();
      } catch (err) {
        onError?.(err);
      }
    },
  });

  container.innerHTML = '';
  gid.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: Math.max(200, Math.min(400, Math.floor(container.clientWidth || 320))),
  });
}

// --- native (Capacitor) Google sign-in ---------------------------------------
//
// GIS refuses to run inside an embedded webview, so on iOS we hand off to the
// native Google Sign-In SDK via @capgo/capacitor-social-login and feed the
// resulting ID token into the SAME signInWithIdToken exchange the web uses.
// (Not signInWithOAuth — that redirects through the *.supabase.co URL.)

const IOS_CLIENT_ID_PLACEHOLDER = 'REPLACE_WITH_IOS_CLIENT_ID';

export function nativeGoogleConfigured() {
  return !!GOOGLE_IOS_CLIENT_ID && !GOOGLE_IOS_CLIENT_ID.includes(IOS_CLIENT_ID_PLACEHOLDER);
}

export async function signInWithGoogleNative() {
  const SocialLogin = getPlugin('SocialLogin');
  if (!SocialLogin) {
    throw new Error('Native Google sign-in is unavailable in this build (SocialLogin plugin missing).');
  }
  // Fail LOUDLY when the placeholder is still in place, so "not configured" is
  // never mistaken for "broken" while testing in the simulator.
  if (!nativeGoogleConfigured()) {
    throw new Error(
      'iOS Google client ID not configured — set GOOGLE_IOS_CLIENT_ID in js/config.js '
      + 'and the matching com.googleusercontent.apps.<id> entry in Info.plist.',
    );
  }

  await SocialLogin.initialize({
    google: {
      iOSClientId: GOOGLE_IOS_CLIENT_ID,
      // The *web* client ID is Google's "server client ID": it's the audience
      // Supabase validates the ID token against.
      iOSServerClientId: GOOGLE_CLIENT_ID,
      mode: 'online',
    },
  });

  // The SAME nonce goes to Google and to Supabase. Google echoes it verbatim
  // into the token's `nonce` claim, and Supabase SHA-256-hashes whatever nonce
  // it is given before comparing — so Google gets the hash and Supabase gets the
  // raw value. Omitting the nonce entirely fails too ("Passed nonce and nonce in
  // id_token should either both exist or not"), because Google's iOS SDK always
  // embeds a nonce claim of its own.
  const rawNonce = randomNonce();
  const hashedNonce = await sha256Hex(rawNonce);

  // forcePrompt is REQUIRED, not a UX preference. Without it the plugin takes
  // its `hasPreviousSignIn()` branch and calls restorePreviousSignIn(), which
  // accepts no nonce and returns a cached token still carrying the nonce from
  // the original interactive sign-in — so ours could never match.
  const login = await SocialLogin.login({
    provider: 'google',
    options: { nonce: hashedNonce, forcePrompt: true },
  });
  // The token is nested under `result` — `login.idToken` is undefined.
  const idToken = login?.result?.idToken;
  if (!idToken) throw new Error('Google did not return an ID token.');
  await exchangeGoogleIdToken(idToken, rawNonce);
}

export async function signOut() {
  // Clear the native Google session too, otherwise the next sign-in silently
  // reuses the same account with no chooser.
  const SocialLogin = getPlugin('SocialLogin');
  if (SocialLogin) {
    try { await SocialLogin.logout({ provider: 'google' }); } catch (_) {}
  }
  await supabase.auth.signOut();
}

export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location not available'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

function coarse(v) {
  const f = 10 ** APPROX_DECIMALS;
  return Math.round(v * f) / f;
}

// Alerting radius — a volunteer farther than this can't bring a pen in time, so
// they aren't alerted. 0.4 miles ≈ 644 m: roughly an 8-minute walk, inside the
// window where epinephrine still changes the outcome.
//
// This filter runs on EXACT coordinates on both sides (the raiser's position
// from getPosition(), and the responder's own from goAvailable()), so it is
// accurate at this scale. Note the public `responders` table is deliberately
// coarsened to APPROX_DECIMALS (~1.1 km), which is COARSER than this radius —
// so any server-side fan-out reading that table cannot filter this tightly and
// must use `responder_locations` instead.
export const ALERT_RADIUS_M = 644;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Responder profile + availability
// ---------------------------------------------------------------------------

export async function getProfile() {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supabase.from('responders').select('*').eq('user_id', user.id).maybeSingle();
  return data;
}

export async function saveProfile({ display_name, injector_type, dose }) {
  const user = await currentUser();
  if (!user) throw new Error('Sign in first');
  const { error } = await supabase.from('responders').upsert({
    user_id: user.id, display_name, injector_type, dose,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// EpiPen label reading (Claude Vision, via the scan-epipen Edge Function)
// ---------------------------------------------------------------------------

// Sends the captured label photo to the server-side scanner (which holds the
// Anthropic key) and returns a best-guess { brand, dose, expiration }. Throws on
// any failure so the caller can fall back to on-device OCR. `imageDataUrl` is a
// data: URL from a <canvas>; media_type is derived from it.
export async function scanEpipen(imageDataUrl) {
  const user = await currentUser();
  // The scan function requires a signed-in user (verify_jwt) — surface that as a
  // clear message rather than an opaque 401 that just triggers the OCR fallback.
  if (!user) throw new Error('Sign in to use the camera reader');

  const m = /^data:([^;]+);base64,/.exec(imageDataUrl || '');
  const media_type = m ? m[1] : 'image/jpeg';
  const image_base64 = (imageDataUrl || '').replace(/^data:[^;]+;base64,/, '');
  const { data, error } = await supabase.functions.invoke('scan-epipen', {
    body: { image_base64, media_type },
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return {
    brand: data?.brand ?? null,
    dose: data?.dose ?? null,
    expiration: data?.expiration ?? null,
  };
}

// ---------------------------------------------------------------------------
// EpiPen inventory (per-user, owner-only via RLS)
// ---------------------------------------------------------------------------

export async function listEpipens() {
  const user = await currentUser();
  if (!user) return [];
  const { data } = await supabase.from('epipens')
    .select('*').eq('user_id', user.id).order('expiration_date', { ascending: true });
  return data || [];
}

export async function saveEpipen({ id, brand, dose, expiration_date }) {
  const user = await currentUser();
  if (!user) throw new Error('Sign in first');
  const row = { user_id: user.id, brand, dose, expiration_date, updated_at: new Date().toISOString() };
  if (id) row.id = id;
  // A fresh photo means a fresh pen — clear any prior reminder so the expiry
  // job will notify again for the new expiration date.
  row.reminded_at = null;
  const { data, error } = await supabase.from('epipens')
    .upsert(row, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteEpipen(id) {
  const user = await currentUser();
  if (!user) return;
  await supabase.from('epipens').delete().eq('id', id).eq('user_id', user.id);
}

// Sets availability. When turning on, writes the coarse position to the public
// `responders` row and the exact position to the owner-only `responder_locations`
// row. Exact coordinates are never readable by other users.
export async function setAvailability(isAvailable, coords) {
  const user = await currentUser();
  if (!user) throw new Error('Sign in first');

  const patch = { user_id: user.id, is_available: isAvailable, updated_at: new Date().toISOString() };
  if (isAvailable && coords) {
    patch.approx_lat = coarse(coords.lat);
    patch.approx_lng = coarse(coords.lng);
  }
  const { error } = await supabase.from('responders').upsert(patch, { onConflict: 'user_id' });
  if (error) throw error;

  if (isAvailable && coords) {
    await supabase.from('responder_locations').upsert({
      user_id: user.id, lat: coords.lat, lng: coords.lng, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  }
}

// ---------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Copy shown on the opt-in screen in the native shell. Deliberately blunt: the
// iOS build genuinely CANNOT deliver closed-app alerts yet, and a toggle that
// implies otherwise is worse than no toggle in an emergency app.
export const NATIVE_PUSH_NOTICE =
  'Closed-app alerts are not active on iOS yet — you’ll only be alerted while EpiGuide is open.';

export function pushSupported() {
  // A Capacitor WKWebView has no PushManager and no VAPID web push at all, so
  // report the truth rather than letting the caller hide a guaranteed failure.
  // Real closed-app alerts here need APNs — see the TODO(APNs) in js/native.js.
  if (isNative()) return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Registers this device to receive alerts even when the app is closed.
export async function enablePush() {
  if (isNative()) throw new Error(NATIVE_PUSH_NOTICE);
  if (!pushSupported()) throw new Error('This device or browser does not support push alerts');
  const user = await currentUser();
  if (!user) throw new Error('Sign in first');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are turned off. Enable them in your browser settings.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Alerts — patient side
// ---------------------------------------------------------------------------

export async function raiseAlert({ lat, lng, note }) {
  const user = await currentUser();
  // Client-generate the id so a NOT-signed-in ("anon") bystander can raise an
  // alert without reading the row back — anon has no SELECT on alerts, so a
  // patient's exact location is never exposed to other anonymous clients.
  const id = self.crypto?.randomUUID ? self.crypto.randomUUID() : undefined;
  const row = {
    lat, lng,
    patient_note: note || 'Possible anaphylaxis',
    status: 'active',
    created_by: user ? user.id : null, // null → anon path (allowed by RLS)
  };
  if (id) row.id = id;

  const { error } = await supabase.from('alerts').insert(row);
  if (error) throw error;

  const alert = { ...row, created_at: new Date().toISOString() };
  // Fan out web push to nearby available responders (server-side proximity).
  // If this fails (e.g. anon can't invoke the function), the alert is still
  // live and open-app responders receive it via realtime.
  try {
    await supabase.functions.invoke('notify-responders', { body: { alert_id: alert.id } });
  } catch (e) {
    console.warn('notify-responders failed (alert still live for open apps):', e);
  }
  return alert;
}

export async function resolveAlert(id) {
  await supabase.from('alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
}

export function subscribeToResponses(alertId, cb) {
  const channel = supabase.channel(`responses-${alertId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'alert_responses', filter: `alert_id=eq.${alertId}` },
      (payload) => cb(payload.new))
    .subscribe();
  // Also pull any responses that already exist.
  supabase.from('alert_responses').select('*').eq('alert_id', alertId)
    .then(({ data }) => (data || []).forEach(cb));
  return () => supabase.removeChannel(channel);
}

// ---------------------------------------------------------------------------
// Alerts — responder side
// ---------------------------------------------------------------------------

export async function getAlertById(id) {
  const { data } = await supabase.from('alerts').select('*').eq('id', id).maybeSingle();
  return data;
}

// Live subscription to new alerts. RLS only delivers alerts this user is allowed
// to see, which requires them to be an available responder.
export function subscribeToAlerts(cb) {
  const channel = supabase.channel('alerts-incoming')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'alerts' },
      (payload) => { if (payload.new?.status === 'active') cb(payload.new); })
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export async function acceptAlert(alert, coords) {
  const user = await currentUser();
  if (!user) throw new Error('Sign in first');
  // Attach the injector this volunteer carries so the patient's guide can match
  // the pen that's actually on the way.
  let injector = null, dose = null;
  try {
    const { data: prof } = await supabase.from('responders')
      .select('injector_type,dose').eq('user_id', user.id).maybeSingle();
    if (prof) { injector = prof.injector_type; dose = prof.dose; }
  } catch (_) {}
  const { data, error } = await supabase.from('alert_responses').upsert({
    alert_id: alert.id, responder_id: user.id, status: 'en_route',
    responder_lat: coords?.lat ?? null, responder_lng: coords?.lng ?? null,
    responder_injector: injector, responder_dose: dose,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'alert_id,responder_id' }).select().single();
  if (error) throw error;
  return data;
}

export async function declineAlert(alert) {
  const user = await currentUser();
  if (!user) return;
  await supabase.from('alert_responses').upsert({
    alert_id: alert.id, responder_id: user.id, status: 'declined',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'alert_id,responder_id' });
}

export async function updateResponderPosition(alertId, coords, status) {
  const user = await currentUser();
  if (!user) return;
  const patch = { updated_at: new Date().toISOString() };
  if (coords) { patch.responder_lat = coords.lat; patch.responder_lng = coords.lng; }
  if (status) patch.status = status;
  await supabase.from('alert_responses').update(patch)
    .eq('alert_id', alertId).eq('responder_id', user.id);
}
