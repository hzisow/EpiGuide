// Minimal offline cache so EpiGuide keeps working once loaded — critical for an
// emergency tool that may be opened with poor connectivity. Network-first for
// ALL same-origin requests (fresh code always wins online), with the cache as an
// offline / slow-connection fallback. MediaPipe/fonts CDNs are left to the
// network (they degrade gracefully in the app).

const CACHE = 'epiguide-v33';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/screens.css',
  './js/app.js',
  './js/config.js',
  './js/net.js',
  './js/volunteerCard.js',
  './js/epipens.js',
  './js/ocr.js',
  './js/screens/optIn.js',
  './js/icons.js',
  './js/map.js',
  './js/illustrations.js',
  './js/model.js',
  './js/modelUi.js',
  './js/faceVision.js',
  './js/hivesModel.js',
  './js/data/cabinets.js',
  './js/data/guideSteps.js',
  './js/data/checklistItems.js',
  './js/screens/find.js',
  './js/screens/recognize.js',
  './js/screens/guide.js',
  './js/screens/dispatch.js',
  './js/screens/checklist.js',
  './js/screens/responderAlert.js',
  './js/screens/firstResponderView.js',
  './js/screens/medicHandoff.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  // Guide step animation loops (Remotion-rendered) — cached so the guide
  // animates offline; SVG pictograms remain the fallback. WebM is preferred
  // by the <video> sources; MP4 covers browsers without VP9.
  './media/guide/confirm.webm',
  './media/guide/cap.webm',
  './media/guide/thigh.webm',
  './media/guide/push.webm',
  './media/guide/hold.webm',
  './media/guide/remove.webm',
  './media/guide/confirm.mp4',
  './media/guide/cap.mp4',
  './media/guide/thigh.mp4',
  './media/guide/push.mp4',
  './media/guide/hold.mp4',
  './media/guide/remove.mp4',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// --- Web push: show an alert even when the app is closed ---------------------

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || 'EpiGuide alert';
  const body = data.body || 'Someone nearby needs epinephrine';
  e.waitUntil(self.registration.showNotification(title, {
    body,
    tag: 'epiguide-alert',
    requireInteraction: true,
    icon: './icons/icon-192.png',
    badge: './icons/favicon-32.png',
    vibrate: [120, 60, 120],
    data: { alert_id: data.alert_id || '' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.alert_id ? e.notification.data.alert_id : '';
  const url = `./index.html?alert=${encodeURIComponent(id)}`;
  e.waitUntil((async () => {
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsArr) {
      if ('focus' in c) { c.postMessage({ type: 'open-alert', alert_id: id }); return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only handle same-origin requests; let CDN/API requests hit the network.
  if (url.origin !== self.location.origin) return;

  // The vendored OCR assets (Tesseract engine + ~11 MB language data) are large
  // and immutable, and would blow the network-first timeout below on a slow
  // connection. Serve them CACHE-FIRST: download once on the first scan, then
  // serve instantly (and offline) forever after.
  if (url.pathname.includes('/vendor/tesseract/')) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // NETWORK-FIRST for everything else same-origin (HTML, JS, CSS, media). Online
  // users always get the freshly deployed code — previously the app's JS/CSS
  // were served cache-first, so a new index.html would still load STALE modules
  // and the site appeared to never update. The cache is now purely an offline /
  // very-slow-connection fallback, raced against a short timeout so poor
  // connectivity never blocks the UI (this is an emergency app).
  e.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.status === 200) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
    ]);
    if (fresh && fresh.status === 200) cache.put(request, fresh.clone());
    return fresh;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('offline and not cached');
  }
}
