/* ArbiShield — service worker no-op (evita SPA fallback HTML como SW) */
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
        const regs = await self.registration.unregister();
        console.log("[arbishield-sw] unregistered", regs);
      } catch {}
      try {
        const clientsList = await self.clients.matchAll({ type: "window" });
        for (const client of clientsList) {
          client.navigate(client.url);
        }
      } catch {}
    })()
  );
});

self.addEventListener("fetch", (event) => {
  // não intercepta nada
});
