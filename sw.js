// Offline copy of the program. Star counts are never cached here.
const CACHE = "aaa26-v4";
const SHELL = ["./", "index.html", "style.css", "app.js", "icon.svg", "data/core.json", "fonts/fonts.css", "fonts/Alegreya-400-latin.woff2", "fonts/AlegreyaSC-500-latin.woff2", "fonts/AlegreyaSC-700-latin.woff2"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const same = u.origin === location.origin;
  if (!same) return;
  // The page itself: network first, but only wait ~1s before using the cached copy.
  // Everything else (css, js, fonts, data): cache first, refreshed in the background.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (e.request.mode === "navigate") {
      const first = await Promise.race([net.catch(() => null), new Promise((res) => setTimeout(res, hit ? 1000 : 15000))]);
      return first || hit || net;
    }
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
