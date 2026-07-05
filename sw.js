// Sube este número cada vez que cambies index.html, style.css, app.js o los iconos,
// si no, los navegadores que ya tengan la PWA instalada seguirán usando los archivos viejos.
const CACHE_NAME = "bolsa-bf-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css?v=4",
  "./app.js?v=4",
  "./manifest.json?v=4",
  "./ICONS/icon-192.png?v=4",
  "./ICONS/icon-512.png?v=4"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never intercept Firebase/network calls, only cache same-origin static assets
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => cached)
      );
    })
  );
});
