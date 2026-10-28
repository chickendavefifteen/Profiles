// Profiles service worker: app shell cache only. API calls are NEVER
// cached (they are live agent state) - network always wins there.
const SHELL = ['.', './index.html', './main.js', './manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open('profiles-shell-v1').then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.includes('/api/') || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open('profiles-shell-v1').then((c) => c.put(e.request, copy)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request)));
});
