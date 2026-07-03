// Minimal offline cache so EpiGuide keeps working once loaded — critical for an
// emergency tool that may be opened with poor connectivity. Network-first for
// navigations, cache-first for static app assets. MediaPipe/fonts CDNs are left
// to the network (they degrade gracefully in the app).

const CACHE = 'epiguide-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/screens.css',
  './js/app.js',
  './js/icons.js',
  './js/map.js',
  './js/illustrations.js',
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
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
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

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only handle same-origin requests; let CDN/API requests hit the network.
  if (url.origin !== self.location.origin) return;

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
