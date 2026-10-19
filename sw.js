// Service worker de TusAlergias
// - La página siempre se pide primero a internet (así cada versión nueva llega sola)
//   y, sin conexión, se abre la última guardada.
// - Las librerías con versión fija se guardan para funcionar sin conexión.
// - Los datos en vivo (cartas en la nube, productos, mapas, direcciones) nunca se sirven desde aquí.
const CACHE = "tusalergias-v3.1.0";
const SHELL = ["./", "./index.html", "./manifest.json", "./firebase-config.js", "./icon-192.png", "./icon-512.png", "./privacidad.html", "./condiciones.html"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("tusalergias-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const LIVE = /(^|\.)(firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|openfoodfacts\.org|nominatim\.openstreetmap\.org|tile\.openstreetmap\.org|wa\.me|apis\.google\.com|firebaseapp\.com|web\.app|cloudfunctions\.net|run\.app|stripe\.com|play\.google\.com)$/;
const LIBS = /(^|\.)(unpkg\.com|cdn\.jsdelivr\.net|www\.gstatic\.com)$/;

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)); }

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([fetch(request), timeout(6000)]);
    if (response && response.ok) cache.put(key || request, response.clone());
    return response;
  } catch (e) {
    const hit = (await cache.match(key || request, { ignoreSearch: true })) || (await cache.match("./index.html"));
    if (hit) return hit;
    throw e;
  }
}
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const update = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return hit || (await update) || Response.error();
}
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol) || LIVE.test(url.hostname)) return;

  if (request.mode === "navigate") {
    if (url.origin !== self.location.origin) return;
    const isApp = url.origin === self.location.origin && (/\/$/.test(url.pathname) || /\/index\.html$/.test(url.pathname));
    event.respondWith(networkFirst(request, isApp ? "./index.html" : undefined));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(/firebase-config\.js$/.test(url.pathname) ? networkFirst(request) : staleWhileRevalidate(request));
    return;
  }
  if (LIBS.test(url.hostname)) {
    // Librerías sin versión fija (por ejemplo "tesseract.js@5"): se actualizan en segundo plano
    event.respondWith(/@\d+\//.test(url.pathname) ? staleWhileRevalidate(request) : cacheFirst(request));
  }
});
