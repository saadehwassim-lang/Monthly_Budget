/* Cache the shell so the app opens instantly and still works underground in the
   Metro. Data is always fetched live — never served stale from cache, because a
   stale total is worse than no total.

   Everything here is relative, so the same file works at the root of a domain or
   under a GitHub Pages project path like /monthly_budget/. */
const C = "budget-app-v2";
const SHELL = ["./","./index.html","./app.js","./manifest.json","./icon.svg",
               "./icon-180.png","./icon-192.png","./icon-512.png"];
self.addEventListener("install", e =>
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e =>
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;            // saves go straight to the sheet
  if (u.origin !== location.origin) return;          // never touch the Apps Script calls
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone();
        caches.open(C).then(c => c.put(e.request, copy)).catch(()=>{}); return r; })
      .catch(() => caches.match(e.request)
        .then(r => r || caches.match("./index.html", { ignoreSearch:true })))
  );
});
