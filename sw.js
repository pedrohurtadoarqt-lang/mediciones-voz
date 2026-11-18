// Mediciona no está disponible públicamente: este service worker borra la versión guardada y se desinstala.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: 'window' }); cs.forEach((c) => c.navigate(c.url));
  })());
});
