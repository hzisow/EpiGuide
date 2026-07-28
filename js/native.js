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

// Honest scope: these are LOCAL notifications. They fire only while EpiGuide is
// running (foreground or recently backgrounded) — they are NOT a substitute for
// closed-app push. See NATIVE_PUSH_NOTICE in js/net.js for the copy the opt-in
// screen shows, and the APNs TODO below.
//
// TODO(APNs): real closed-app alerts need @capacitor/push-notifications:
//   PushNotifications.requestPermissions() -> PushNotifications.register(),
//   then persist the APNs device token server-side and fan out from the
//   notify-responders Edge Function alongside web push. Blocked on an Apple
//   Developer account (push capability + APNs auth key), which we don't have.

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
        extra: { alert_id: alertId || '' },
      }],
    });
    return true;
  } catch (e) {
    console.warn('LocalNotifications.schedule failed:', e);
    return false;
  }
}

/**
 * Native-only: route a tapped local notification back into the app, mirroring
 * what the service worker's notificationclick handler does on the web.
 */
export function onLocalNotificationTap(cb) {
  const LN = getPlugin('LocalNotifications');
  if (!LN) return;
  try {
    LN.addListener('localNotificationActionPerformed', (ev) => {
      const id = ev?.notification?.extra?.alert_id;
      if (id) cb(id);
    });
  } catch (e) {
    console.warn('LocalNotifications listener failed:', e);
  }
}
