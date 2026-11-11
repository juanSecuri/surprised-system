/* Centinela PWA: red primero para el contenido y caché para no quedarse sin web.
   Así cada deploy se ve al instante con conexión y, sin internet, sigue sirviendo la última copia. */
const CACHE = "centinela-v4";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/sala3d.js", "/manifest.webmanifest", "/vendor/three.module.js", "/vendor/earth.jpg"];

const guardar = (req, res) => {
  if (!res || !res.ok) return res;
  const copia = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
  return res;
};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  // La API nunca se cachea.
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/admin") || u.pathname === "/health" || u.pathname === "/gateway/estado") return;

  // Texturas y Three.js: pesados y estables, caché primero.
  if (u.pathname.startsWith("/vendor/")) {
    e.respondWith(caches.match(e.request).then((hit) => (hit ? hit : fetch(e.request).then((r) => guardar(e.request, r)))));
    return;
  }

  // Resto: red primero (deploy al instante); si falla, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) guardar(e.request, r);
    if (r.ok) return r;
    return caches.match(e.request).then((hit) => hit || r);
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html"))));
});