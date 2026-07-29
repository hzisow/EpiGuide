// Capacitor (iOS shell) adapters.
//
// EpiGuide has no bundler — plain ES modules, static files, served as-is from
// GitHub Pages. So we cannot `import` the @capacitor/* npm packages. We don't
// need to: Capacitor's iOS runtime injects the bridge itself. For every
// registered plugin, JSExport.swift adds a WKUserScript at .atDocumentStart
// that defines `window.Capacitor.Plugins.<jsName>.<method>()` as real functions
// backed by `webkit.messageHandlers.bridge`. Nothing is loaded from
// ios/App/App/public/ (which holds only empty cordova.js stubs) and index.html
// needs no extra <script>. So the whole native surface is reachable through
// the `window.Capacitor.Plugins.*` globals used below.
//
// EVERY export here is inert on the web: `isNative()` is false in a browser, so
// `getPlugin()` returns null and each helper no-ops or returns false, letting
// the caller run its existing web code path completely untouched.

/** True only inside the Capacitor native shell. */
export function isNative() {
  try {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  } catch (_) {
    return false;
  }
}

/** A native plugin proxy, or null on the web / if the plugin isn't installed. */
export function getPlugin(name) {
  if (!isNative()) return null;
  return window.Capacitor?.Plugins?.[name] || null;
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

// WKWebView's navigator.geolocation exists but never resolves inside a
// Capacitor app (no origin the system will grant, no permission prompt). The
// @capacitor/geolocation plugin talks to CoreLocation instead.
//
// Rather than touching the two call sites (js/net.js getPosition() and
// js/screens/find.js), we swap the *implementation* underneath them at boot, so
// the existing code — including its success/error handling — keeps working
// verbatim on both platforms.

function geoError(code, message) {
  // Shaped like GeolocationPositionError so existing catch blocks (which read
  // .message, and optIn.js which regex-tests it for /denied|permission/) work.
  const err = new Error(message);
  err.code = code;
  err.PERMISSION_DENIED = 1;
  err.POSITION_UNAVAILABLE = 2;
  err.TIMEOUT = 3;
  return err;
}

function toGeolocationPosition(res) {
  const c = res?.coords || {};
  return {
    coords: {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy ?? null,
      altitude: c.altitude ?? null,
      altitudeAccuracy: c.altitudeAccuracy ?? null,
      heading: c.heading ?? null,
      speed: c.speed ?? null,
    },
    timestamp: res?.timestamp ?? Date.now(),
  };
}

async function nativeGetCurrentPosition(Geo, options) {
  // Ask for permission first — CoreLocation returns an opaque failure if the
  // app has never prompted.
  try {
    let status = await Geo.checkPermissions();
    if (status?.location !== 'granted') status = await Geo.requestPermissions();
    if (status?.location !== 'granted' && status?.coarseLocation !== 'granted') {
      throw geoError(1, 'Location permission denied.');
    }
  } catch (e) {
    if (e?.code === 1) throw e;
    // checkPermissions/requestPermissions itself failed — fall through and let
    // getCurrentPosition produce the real error.
  }

  try {
    const res = await Geo.getCurrentPosition({
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeout: options?.timeout ?? 10000,
      maximumAge: options?.maximumAge ?? 0,
    });
    return toGeolocationPosition(res);
  } catch (e) {
    const msg = (e && (e.message || e.errorMessage)) || String(e);
    if (/denied|denie|permission|authoriz|restricted/i.test(msg)) {
      throw geoError(1, 'Location permission denied. Allow location for EpiGuide in Settings.');
    }
    if (/timeout|timed out/i.test(msg)) throw geoError(3, 'Timed out getting your location.');
    throw geoError(2, msg || 'Location unavailable.');
  }
}

/**
 * Native-only: replace navigator.geolocation.getCurrentPosition with a
 * CoreLocation-backed implementation. No-op on the web.
 */
export function installNativeGeolocation() {
  const Geo = getPlugin('Geolocation');
  if (!Geo) return;

  const getCurrentPosition = (success, error, options) => {
    nativeGetCurrentPosition(Geo, options)
      .then((pos) => { try { success?.(pos); } catch (e) { console.error(e); } })
      .catch((err) => { try { error?.(err); } catch (e) { console.error(e); } });
  };

  const geo = navigator.geolocation;
  if (geo) {
    if (geo.__epiguideNativeShim) return;
    // Own property shadows Geolocation.prototype.getCurrentPosition.
    geo.getCurrentPosition = getCurrentPosition;
    geo.__epiguideNativeShim = true;
  } else {
    // navigator.geolocation is a read-only accessor — define, don't assign.
    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition, watchPosition: () => 0, clearWatch: () => {}, __epiguideNativeShim: true },
      });
    } catch (_) { /* nothing more we can do */ }
  }
}

// ---------------------------------------------------------------------------
// External links
// ---------------------------------------------------------------------------

/**
 * Native-only: send target="_blank" http(s) links to the in-app Safari view.
 * Without this, Capacitor's navigation delegate punts them to the *system*
 * Safari, which throws the user out of the app mid-emergency. No-op on the web,
 * where target="_blank" already opens a normal tab.
 */
export function installExternalLinkHandler() {
  if (!isNative() || window.__epiguideExternalLinks) return;
  window.__epiguideExternalLinks = true;
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[target="_blank"]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!/^https?:/i.test(href)) return; // tel:/sms:/mailto: must keep escaping the webview
    const Browser = getPlugin('Browser');
    if (!Browser) return;
    e.preventDefault();
    Browser.open({ url: href }).catch((err) => console.warn('Browser.open failed:', err));
  }, true);
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

/**
 * Native-only share sheet. Returns false when unavailable so the caller falls
 * through to its existing navigator.share / SMS / clipboard path. Rejects when
 * the user cancels, matching navigator.share.
 */
export async function nativeShare({ title, text }) {
  const Share = getPlugin('Share');
  if (!Share) return false;
  await Share.share({ title, text, dialogTitle: title });
  return true;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

// Two independent delivery paths live below:
//
//   LOCAL notifications — fire only while EpiGuide is running (foreground or
//     recently backgrounded), off the realtime alert subscription. This is what
//     ships today and it works with no Apple Developer account.
//   APNs push          — real closed-app delivery. Everything for it is written
//     below but held behind APNS_ENABLED (default false) until enrolment lands.
//
// See NATIVE_PUSH_NOTICE in js/net.js for the copy the opt-in screen shows.

/** Native-only: ask for notification permission. Returns true if granted. */
export async function requestNativeNotificationPermission() {
  const LN = getPlugin('LocalNotifications');
  if (!LN) return false;
  try {
    let status = await LN.checkPermissions();
    if (status?.display !== 'granted') status = await LN.requestPermissions();
    return status?.display === 'granted';
  } catch (e) {
    console.warn('LocalNotifications permission check failed:', e);
    return false;
  }
}

// How hard a responder alert is allowed to interrupt.
//
//   timeSensitive — breaks through Focus and Do Not Disturb and lights the
//     screen. The entitlement is self-serve (Xcode capability), so this works
//     today and is what we ship.
//   critical      — additionally overrides the ringer/mute switch and plays at
//     full volume, i.e. the closest iOS gets to an AMBER-style alert. It needs
//     Apple's Critical Alerts entitlement, which is granted only on individual
//     application and human review.
//
// Set CRITICAL_ALERTS_APPROVED to true ONLY once that entitlement is actually
// present in the provisioning profile. Claiming `critical` without it makes iOS
// reject the notification outright — which would mean a responder alert that
// silently never appears, strictly worse than the timeSensitive we have now.
const CRITICAL_ALERTS_APPROVED = false;
const ALERT_INTERRUPTION_LEVEL = CRITICAL_ALERTS_APPROVED ? 'critical' : 'timeSensitive';

/** Native-only: fire an immediate local notification. Safe to await-and-ignore. */
export async function showLocalNotification({ title, body, alertId }) {
  const LN = getPlugin('LocalNotifications');
  if (!LN) return false;
  try {
    await LN.schedule({
      notifications: [{
        // iOS requires a 32-bit int id.
        id: Math.floor(Math.random() * 2147483000) + 1,
        title,
        body,
        sound: 'default',
        interruptionLevel: ALERT_INTERRUPTION_LEVEL,
        // Keep it on screen until acted on, matching the web push handler's
        // requireInteraction — a responder alert should not auto-dismiss.
        ongoing: false,
        extra: { alert_id: alertId || '' },
      }],
    });
    return true;
  } catch (e) {
    console.warn('LocalNotifications.schedule failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// EpiPen expiry reminders — future-dated LOCAL notifications
// ---------------------------------------------------------------------------
//
// The app promises "we'll remind you before a pen expires". On the web that
// promise has no mechanism (a scheduled web push needs a server-side job that
// does not exist), so the web copy no longer makes it. Here it is real:
// LocalNotifications.schedule() with `schedule.at` hands iOS a
// UNTimeIntervalNotificationTrigger, which fires whether or not the app is
// running.
//
// Ids are DERIVED FROM THE PEN, not random: scheduling the same id again
// replaces the pending notification, so re-syncing after every add/edit can
// never stack duplicate reminders for one pen.

const PEN_REMINDER_KIND = 'epiguide-pen-expiry';
/** Slot 0 = a month of warning (time to get a new prescription). Slot 1 = the day. */
const PEN_REMINDER_DAYS_BEFORE = [30, 0];
const PEN_REMINDER_HOUR = 9; // local morning, not the middle of the night

// FNV-1a. Any stable 32-bit hash would do; this one is 6 lines and dependency-free.
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// iOS requires a 32-bit int id. Bucketing the hash to 2e8 and reserving the last
// digit for the slot keeps the result under 2^31-1 with room to spare.
function penReminderId(penId, slot) {
  return 1 + (hash32(String(penId)) % 200000000) * 10 + slot;
}

function penReminderDate(expirationDate, daysBefore) {
  const at = new Date(`${expirationDate}T00:00:00`);
  if (Number.isNaN(at.getTime())) return null;
  at.setDate(at.getDate() - daysBefore);
  at.setHours(PEN_REMINDER_HOUR, 0, 0, 0);
  return at;
}

/**
 * Native-only: make the scheduled reminders match `pens` exactly.
 *
 * @param pens  [{ id, expiration_date: 'YYYY-MM-DD', label }]
 * @param requestPermission  true only on an explicit user action (saving a pen).
 *        A background refresh must never trigger the iOS permission alert.
 * @returns true if reminders are now in sync, false if nothing could be done
 *          (web, no plugin, or notifications not granted).
 */
export async function syncPenExpiryReminders(pens, { requestPermission = false } = {}) {
  const LN = getPlugin('LocalNotifications');
  if (!LN) return false;

  let granted = false;
  try {
    const status = await LN.checkPermissions();
    granted = status?.display === 'granted';
    if (!granted && requestPermission) granted = await requestNativeNotificationPermission();
  } catch (e) {
    console.warn('Pen reminder permission check failed:', e);
    return false;
  }
  if (!granted) return false;

  const now = Date.now();
  const wanted = [];
  for (const pen of pens || []) {
    if (!pen || !pen.id || !pen.expiration_date) continue;
    PEN_REMINDER_DAYS_BEFORE.forEach((daysBefore, slot) => {
      const at = penReminderDate(pen.expiration_date, daysBefore);
      // iOS rejects the whole schedule() call if any date is in the past, so a
      // reminder whose moment has already gone is simply dropped.
      if (!at || at.getTime() <= now + 1000) return;
      wanted.push({ id: penReminderId(pen.id, slot), at, daysBefore, pen });
    });
  }

  // Cancel reminders for pens that were deleted or re-dated. Only ours: the
  // filter is on our own `extra.kind`, so an unrelated notification is untouched.
  try {
    const pending = await LN.getPending();
    const keep = new Set(wanted.map((w) => w.id));
    const stale = (pending?.notifications || [])
      .filter((n) => n?.extra?.kind === PEN_REMINDER_KIND && !keep.has(Number(n.id)))
      .map((n) => ({ id: Number(n.id) }));
    if (stale.length) await LN.cancel({ notifications: stale });
  } catch (e) {
    console.warn('Pen reminder cleanup failed:', e);
  }

  if (!wanted.length) return true;
  try {
    await LN.schedule({
      notifications: wanted.map((w) => ({
        id: w.id,
        // Use the pen's own brand — an Auvi-Q owner should not be told their
        // "EpiPen" expires.
        title: `${w.pen.label || 'Your auto-injector'} expires ${w.daysBefore === 0 ? 'today' : 'in a month'}`,
        body: `${w.pen.label || 'Your auto-injector'} expires ${w.pen.expiration_date}.`
          + (w.daysBefore === 0 ? ' Replace it today.' : ' Ask for a replacement prescription now.'),
        sound: 'default',
        schedule: { at: w.at, allowWhileIdle: true },
        extra: { kind: PEN_REMINDER_KIND, pen_id: String(w.pen.id) },
      })),
    });
    return true;
  } catch (e) {
    console.warn('Scheduling pen expiry reminders failed:', e);
    return false;
  }
}

// The ONE "a notification was tapped, open this alert" sink. Both the local
// notification listener below and the APNs listener further down feed it, so
// there is a single route into the app rather than two divergent ones.
let alertTapHandler = null;

function dispatchAlertTap(alertId) {
  if (!alertId || !alertTapHandler) return;
  try {
    alertTapHandler(alertId);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Native-only: route a tapped local notification back into the app, mirroring
 * what the service worker's notificationclick handler does on the web.
 *
 * Registering the callback here also arms the APNs tap path (see
 * registerForPushNotifications) — same callback, same destination screen.
 */
export function onLocalNotificationTap(cb) {
  alertTapHandler = cb;
  const LN = getPlugin('LocalNotifications');
  if (!LN) return;
  try {
    LN.addListener('localNotificationActionPerformed', (ev) => {
      dispatchAlertTap(ev?.notification?.extra?.alert_id);
    });
  } catch (e) {
    console.warn('LocalNotifications listener failed:', e);
  }
}

// ---------------------------------------------------------------------------
// APNs — closed-app push
// ---------------------------------------------------------------------------

/**
 * MASTER SWITCH for everything APNs. Leave false until BOTH are true:
 *
 *   1. The Apple Developer Program enrolment is complete and the App ID
 *      com.epiguide.app has the Push Notifications capability enabled.
 *   2. ios/App/App/App.entitlements actually contains
 *        <key>aps-environment</key><string>development</string>
 *      (see the comment already in that file).
 *
 * JavaScript cannot read the app's entitlements, so this constant is the
 * hand-maintained stand-in for "the aps-environment entitlement is present".
 * Turning it on without the entitlement makes iOS fail registration with
 * "no valid aps-environment entitlement string found" — that failure is caught
 * and logged below rather than thrown, but registration would never succeed.
 *
 * While false, every APNs function here returns immediately and js/net.js is
 * never even imported, so the LOCAL notification path behaves exactly as it
 * does today. On the web isNative() is false, so this is doubly inert.
 */
export const APNS_ENABLED = false;

/** How long to wait for iOS to hand back a device token before giving up. */
const APNS_REGISTRATION_TIMEOUT_MS = 15000;

function apnsAvailable() {
  return APNS_ENABLED && isNative() && !!getPlugin('PushNotifications');
}

let pushListenersInstalled = false;

// Delivery listeners. Installed once, before register(), so no event is missed.
function installPushListeners(PN) {
  if (pushListenersInstalled) return;
  pushListenersInstalled = true;
  try {
    // Tapped an APNs alert (app closed, backgrounded, or the banner tapped in
    // foreground). Routes through the SAME sink as a tapped local notification,
    // i.e. app.js's routeToIncomingAlert.
    PN.addListener('pushNotificationActionPerformed', (ev) => {
      dispatchAlertTap(ev?.notification?.data?.alert_id);
    });

    // Delivered while EpiGuide is frontmost. Deliberately does NOT raise a
    // notification of its own: with the app open, the realtime subscription in
    // js/screens/optIn.js has already fired showLocalNotification() for this
    // same alert and navigated to the responder screen. Re-notifying here would
    // double-banner every foreground alert.
    PN.addListener('pushNotificationReceived', (ev) => {
      const id = ev?.data?.alert_id;
      if (id) console.info('APNs alert received in foreground:', id);
    });
  } catch (e) {
    console.warn('PushNotifications listeners failed:', e);
  }
}

// Waits for the token that arrives asynchronously via the 'registration' event.
function awaitDeviceToken(PN) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      PN.addListener('registration', (ev) => done(ev?.value || null));
      PN.addListener('registrationError', (ev) => {
        // The usual cause is a missing/incorrect aps-environment entitlement.
        console.warn('APNs registration failed:', ev?.error || ev);
        done(null);
      });
    } catch (e) {
      console.warn('PushNotifications registration listeners failed:', e);
      done(null);
    }
    setTimeout(() => done(null), APNS_REGISTRATION_TIMEOUT_MS);
  });
}

// Memoized so repeatedly going available doesn't re-register. Only a SUCCESSFUL
// registration is cached; a failure clears it so the next attempt retries.
let apnsRegistration = null;

async function doRegisterForPushNotifications() {
  const PN = getPlugin('PushNotifications');

  try {
    let status = await PN.checkPermissions();
    if (status?.receive !== 'granted') status = await PN.requestPermissions();
    if (status?.receive !== 'granted') return null;
  } catch (e) {
    console.warn('PushNotifications permission check failed:', e);
    return null;
  }

  // Listen BEFORE register() — the token can come back immediately.
  const tokenPromise = awaitDeviceToken(PN);
  installPushListeners(PN);

  try {
    await PN.register();
  } catch (e) {
    console.warn('PushNotifications.register failed:', e);
    return null;
  }

  const token = await tokenPromise;
  if (!token) return null;

  // Dynamic import, never a static one: js/net.js pulls the Supabase client
  // from a CDN, and the boot graph must stay offline-safe (see the header of
  // js/net.js). This runs only from a user-initiated opt-in, so it is fine here.
  try {
    const net = await import('./net.js');
    await net.saveApnsToken(token);
  } catch (e) {
    // The token is live on the device but unknown to the server: closed-app
    // alerts won't arrive, open-app ones still will. Don't break the opt-in.
    console.warn('Saving APNs token failed:', e);
    return null;
  }
  return token;
}

/**
 * Native-only, APNS_ENABLED-only: register with APNs and persist the device
 * token server-side. Resolves to the token, or null if anything was unavailable
 * or denied. Never throws — the caller's opt-in flow must survive a push
 * failure, since local notifications still work without it.
 */
export function registerForPushNotifications() {
  if (!apnsAvailable()) return Promise.resolve(null);
  return (apnsRegistration ||= doRegisterForPushNotifications().then((token) => {
    if (!token) apnsRegistration = null; // let a later attempt retry
    return token;
  }).catch((e) => {
    apnsRegistration = null;
    console.warn('APNs registration error:', e);
    return null;
  }));
}
