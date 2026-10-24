// Service worker de Comeclaro
// - La página siempre se pide primero a internet (así cada versión nueva llega sola)
//   y, sin conexión, se abre la última guardada.
// - Las librerías del propio sitio (mapa, escáner, lector de etiquetas) y el programa de Firebase
//   tienen versión fija: se guardan la primera vez que se usan y después se sirven desde el móvil.
// - Los datos en vivo (cartas en la nube, productos, mapas, direcciones) nunca se sirven desde aquí.
const CACHE = "comeclaro-v3.18.3";
// 3.10: la app está en app.html; la portada (index.html) es la página de presentación.
const SHELL = ["./app.html", "./index.html", "./manifest.json", "./firebase-config.js", "./icon-192.png", "./icon-512.png", "./privacidad.html", "./condiciones.html"];

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
      .then(keys => Promise.all(keys.filter(k => (k.startsWith("comeclaro-") || k.startsWith("tusalergias-")) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const LIVE = /(^|\.)(firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|openfoodfacts\.org|nominatim\.openstreetmap\.org|tile\.openstreetmap\.org|wa\.me|apis\.google\.com|firebaseapp\.com|web\.app|cloudfunctions\.net|run\.app|stripe\.com|play\.google\.com|google\.com)$/;
const LIBS = /(^|\.)www\.gstatic\.com$/;
// Librerías con versión fija servidas por la propia web (junto a index.html)
const LOCAL_LIBS = /\/(leaflet\.(js|css)|html5-qrcode\.min\.js|tesseract[^/]*\.js|spa\.traineddata\.gz|marker-icon(-2x)?\.png|marker-shadow\.png|layers(-2x)?\.png)$/;

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)); }
const OFFLINE_PAGE = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión · Comeclaro</title><body style="font-family:sans-serif;background:#0b132b;color:#f8fafc;padding:24px;line-height:1.5"><h1 style="font-size:1.2rem">📴 Sin conexión</h1><p>Esta página necesita internet. Vuelve a intentarlo cuando tengas cobertura.</p><p><a href="./app.html" style="color:#38bdf8">Abrir Comeclaro</a></p></body></html>';

// Primero internet (6 s como mucho); si no llega, la copia guardada. La respuesta que llegue tarde
// se guarda igualmente para la próxima vez. Solo la propia app usa app.html como respaldo.
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
    if (key === "./app.html") { const app = await cache.match("./app.html"); if (app) return app; }
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
    // La app (app.html, con o sin ?r=…) y la portada (/ o index.html) se guardan cada una con su nombre
    const key = /\/app\.html$/.test(url.pathname) ? "./app.html" : (/\/$/.test(url.pathname) || /\/index\.html$/.test(url.pathname)) ? "./index.html" : undefined;
    event.respondWith(networkFirst(request, key, true));
    return;
  }
  if (url.origin === self.location.origin && LOCAL_LIBS.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(/firebase-config\.js$/.test(url.pathname) ? networkFirst(request) : staleWhileRevalidate(request));
    return;
  }
  if (LIBS.test(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
