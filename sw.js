/* Service worker: deja la aplicación disponible sin conexión cuando se sirve por http(s). */
var CACHE = 'medicion-voz-v1';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/bc3-parser.js', 'js/voice-parser.js', 'js/db.js', 'js/speech.js', 'js/export.js',
  'lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // Red primero (para recibir actualizaciones), caché si no hay conexión
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
  } else if (/cdn\.jsdelivr\.net/.test(url.host)) {
    // Librería de Whisper: caché primero (los modelos los guarda Transformers.js en su propia caché)
    e.respondWith(caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (r) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r; });
    }));
  }
});
