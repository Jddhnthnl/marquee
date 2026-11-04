// Offline app shell: network first (so edits show up), cache as fallback (so the app opens without the server).
const CACHE = 'marquee-v3';
const SHELL = ['./', 'index.html', 'app.js', 'protocol.js', 'sync.js', 'playback.js', 'manifest.webmanifest', 'icon.svg', 'icon-512.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  const mine = u.origin === location.origin;
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!mine && !font) return; // addon catalogs and streams always go straight to the network, never cached
  e.respondWith(fetch(e.request)
    .then((r) => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })
      .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
