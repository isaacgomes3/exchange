/* ArbiShield — SW no-op que se remove (sem reload em loop) */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      try {
        await self.clients.claim();
      } catch {}
    })()
  );
});

self.addEventListener("fetch", () => {
  /* passa direto — não cacheia */
});
