// Offline copy of the program: network first, cache fallback. Star counts are never cached here.
const CACHE = "aaa26-v3";
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
  // network first (so updates reach people), cache when the network is slow or gone
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    const slow = new Promise((res) => setTimeout(res, 3500));
    const first = await Promise.race([net.catch(() => null), slow]);
    if (first) return first;
    const hit = await c.match(e.request, { ignoreSearch: true });
    return hit || net;
  }));
});
