// Hand-written service worker (no build-step dependency): read-only offline support.
// Caches map tiles + the two main data endpoints so the map stays viewable with weak
// or no signal. Writes (status changes, photo uploads, etc.) are NOT queued while
// offline -- that's a deliberate scope boundary, not an oversight.
const SHELL_CACHE = "shell-v1";
const TILE_CACHE = "map-tiles-v1";
const DATA_CACHE = "map-data-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => ![SHELL_CACHE, TILE_CACHE, DATA_CACHE].includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || cache.match(OFFLINE_URL);
  }
}

self.addEventListener("push", (event) => {
  let data = { title: "یادآوری", body: "یک یادآوری معوق دارید.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // non-JSON payload -- keep the default text rather than fail the whole event
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname.endsWith("basemaps.cartocdn.com")) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }

  if (url.pathname === "/api/districts" || url.pathname === "/api/customers") {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // Next.js static chunks are content-hashed and immutable -- safe to cache aggressively
  // so the app shell (JS/CSS) still loads and hydrates while offline.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // The page document itself: try the network first (so a returning-online user always
  // gets the latest deploy), but keep the last good copy so the map page (not just the
  // generic offline message) actually renders when there's no signal.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
  }
});
