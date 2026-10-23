/*
 * Offline support. The app is a handful of static files, so once visited it
 * can run with no network at all. Pages are fetched network-first (so an
 * update is picked up as soon as there is a connection) and fall back to the
 * cache; everything else is cached as it is used.
 */
const CACHE = "aurora-like-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const navigation = request.mode === "navigate";
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (navigation) {
        try {
          const fresh = await fetch(request);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          // Offline: any cached copy of the page will do, whatever its query string.
          return (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match("./")) ?? Response.error();
        }
      }
      const cached = await cache.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })(),
  );
});
