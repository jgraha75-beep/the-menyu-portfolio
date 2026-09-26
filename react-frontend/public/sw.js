const CACHE_NAME = "the-menyu-shell-v2";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/brand/the-menyu-icon-192.png",
  "/brand/the-menyu-icon-512.png",
  "/brand/apple-touch-icon.png",
  "/brand/chip-chop-lockup.png",
  "/brand/chip-chop-sidebar-lockup.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.filter((cacheName) => cacheName.startsWith("the-menyu-shell-") && cacheName !== CACHE_NAME).map((cacheName) => caches.delete(cacheName)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { signal: AbortSignal.timeout(4000) }).then((response) => {
      if (!response.ok) throw new Error("App shell unavailable");
      return response;
    }).catch(() => caches.match("/")));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    })));
  }
});
