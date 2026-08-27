/* Cache the shell so the app opens instantly and still works underground in the
   Metro. Data is always fetched live — never served stale from cache, because a
   stale total is worse than no total. */
const C = "budget-app-v1";
const SHELL = ["./","./index.html","./app.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install", e =>
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e =>
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;          // never touch the n8n calls
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone();
        caches.open(C).then(c => c.put(e.request, copy)).catch(()=>{}); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
