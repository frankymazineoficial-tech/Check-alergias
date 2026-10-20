// Service worker de TusAlergias
// - La página siempre se pide primero a internet (así cada versión nueva llega sola)
//   y, sin conexión, se abre la última guardada.
// - Las librerías con versión fija se guardan para funcionar sin conexión.
// - Los datos en vivo (cartas en la nube, productos, mapas, direcciones) nunca se sirven desde aquí.
const CACHE = "tusalergias-v3.6.1";
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

const LIVE = /(^|\.)(firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|openfoodfacts\.org|nominatim\.openstreetmap\.org|tile\.openstreetmap\.org|wa\.me|apis\.google\.com|firebaseapp\.com|web\.app|cloudfunctions\.net|run\.app|stripe\.com|play\.google\.com|google\.com)$/;
const LIBS = /(^|\.)(unpkg\.com|cdn\.jsdelivr\.net|www\.gstatic\.com)$/;

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)); }
const OFFLINE_PAGE = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión · TusAlergias</title><body style="font-family:sans-serif;background:#0b132b;color:#f8fafc;padding:24px;line-height:1.5"><h1 style="font-size:1.2rem">📴 Sin conexión</h1><p>Esta página necesita internet. Vuelve a intentarlo cuando tengas cobertura.</p><p><a href="./" style="color:#38bdf8">Abrir TusAlergias</a></p></body></html>';

// Primero internet (6 s como mucho); si no llega, la copia guardada. La respuesta que llegue tarde
// se guarda igualmente para la próxima vez. Solo la propia app usa index.html como respaldo.
async function networkFirst(request, key, isNav) {
  const cache = await caches.open(CACHE);
  const net = fetch(request).then(response => {
    if (response && response.ok) cache.put(key || request, response.clone()).catch(() => {});
    return response;
  });
  try {
    return await Promise.race([net, timeout(6000)]);
  } catch (e) {
    const hit = await cache.match(key || request, { ignoreSearch: true });
    if (hit) return hit;
    if (key) { const app = await cache.match("./index.html"); if (app) return app; }
    try { return await net; } catch (x) { /* sin conexión de verdad */ }
    if (isNav) return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
    event.respondWith(networkFirst(request, isApp ? "./index.html" : undefined, true));
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
