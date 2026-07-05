// Minimal offline cache so EpiGuide keeps working once loaded — critical for an
// emergency tool that may be opened with poor connectivity. Network-first for
// navigations, cache-first for static app assets. MediaPipe/fonts CDNs are left
// to the network (they degrade gracefully in the app).

const CACHE = 'epiguide-v18';
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

  // Navigations are NETWORK-FIRST so a fresh deploy shows up on the next
  // visit; the cache is only a fallback for offline use. (Serving these
  // cache-first made the site appear to never update.)
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';
  if (isNavigation) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Static assets: cache-first with background refresh (fast + offline-safe).
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
