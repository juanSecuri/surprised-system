/* Centinela PWA: cache-first para que la web sirva sin internet (modo degradado). */
const CACHE = "centinela-v2";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/sala3d.js", "/manifest.webmanifest", "/vendor/three.module.js", "/vendor/earth.jpg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(()=>{})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k)=>k!==CACHE).map((k)=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/admin") || u.pathname === "/health" || u.pathname === "/gateway/estado") return; // API nunca se cachea
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match("/index.html"))));
});
