// Responder-network networking layer. Talks to Supabase (auth, database,
// realtime) and the notify-responders Edge Function (web push fan-out).
//
// IMPORTANT: this module pulls the Supabase client from a CDN, so it must only
// ever be loaded with `await import('./net.js')` from inside an event handler —
// never statically imported into the boot graph. That keeps the core emergency
// flow (Find / Recognize / Guide / Dispatch) fully working offline and immune
// to any CDN outage.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, APPROX_DECIMALS } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // detectSessionInUrl lets the client finish a Google sign-in: when the OAuth
  // redirect lands back on the app, creating this client consumes the tokens
  // from the URL and cleans it up.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Kicks off the Google OAuth redirect. On success the browser navigates away to
// Google and comes back to this page with a session in the URL, so nothing
// meaningful runs after the await — the reloaded app picks the session up.
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
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

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Registers this device to receive alerts even when the app is closed.
export async function enablePush() {
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
  const { data, error } = await supabase.from('alert_responses').upsert({
    alert_id: alert.id, responder_id: user.id, status: 'en_route',
    responder_lat: coords?.lat ?? null, responder_lng: coords?.lng ?? null,
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
