// Hand-written service worker (no build-step dependency).
//
// Reads: caches map tiles + two data endpoints + the app shell so the map stays
// viewable with weak or no signal.
//
// Writes (Phase 4): the offline outbox lives in the PAGE (lib/offline/*), not here --
// every write goes through lib/offline/net.postJSON, which enqueues to IndexedDB when
// navigator.onLine is false. This worker's only write-side job is to wake a client on a
// Background Sync event so the queue drains without the user re-opening the tab. See
// docs/HANDOFF-2026-09-02-phase-4-offline-first.md for why the SW does not intercept the
// POST bodies itself.
//
// Cache names bumped to v3 for the Phase 4 shell change; activate() below deletes any
// cache not named here.
const SHELL_CACHE = "shell-v3";
const TILE_CACHE = "map-tiles-v3";
const DATA_CACHE = "map-data-v3";
const GEOMETRY_CACHE = "map-geometry-v3";
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
            .filter((k) => ![SHELL_CACHE, TILE_CACHE, DATA_CACHE, GEOMETRY_CACHE].includes(k))
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

// Production chunks explicitly advertise immutability. Turbopack development URLs
// can be reused after edits, so cache-first would mix incompatible module factories.
// Validate old entries too: shell-v3 may already contain development responses.
async function immutableChunk(request) {
  const cache = await caches.open(SHELL_CACHE);
  const immutable = (response) => response && response.ok &&
    /(?:^|,)\s*immutable\s*(?:,|$)/i.test(response.headers.get("Cache-Control") || "");
  const cached = await cache.match(request);
  if (immutable(cached)) return cached;
  if (cached) await cache.delete(request);
  try {
    const response = await fetch(request);
    if (immutable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    // Offline development must fail rather than executing obsolete JavaScript.
    return Response.error();
  }
}

async function cacheFirstGeometry(request, url) {
  const cache = await caches.open(GEOMETRY_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      // Drop every other tier/version once a new one lands. Keys are compared on the
      // ?v= stamp only, so both precision tiers of the current version survive.
      const version = url.searchParams.get("v");
      for (const key of await cache.keys()) {
        if (new URL(key.url).searchParams.get("v") !== version) await cache.delete(key);
      }
    }
    return response;
  } catch {
    // Offline and this exact version isn't cached -- which happens when the app was
    // updated while this install was away. Slightly stale polygons of the right tier
    // still draw a usable map; district *status* comes from /api/districts, not from
    // here, so nothing shown is wrong, only the boundaries may lag a deploy behind.
    const tier = url.searchParams.get("p");
    for (const key of await cache.keys()) {
      if (new URL(key.url).searchParams.get("p") === tier) {
        const fallback = await cache.match(key);
        if (fallback) return fallback;
      }
    }
    return Response.error();
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

// Background Sync: the browser fires this when it regains connectivity, even if no tab
// is open. Wake every client so its SyncEngine drains the outbox; if none is open, the
// next app start does it.
self.addEventListener("sync", (event) => {
  if (event.tag !== "routeflow-sync") return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "flush" });
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // OSM's own tile server asks that clients cache heavily rather than re-request, so this
  // is politeness as much as offline support. The list mirrors the basemap providers in
  // lib/mapLayers.ts -- every host a chosen style can pull tiles from.
  if (
    url.hostname === "server.arcgisonline.com" ||
    url.hostname === "tile.openstreetmap.org" ||
    url.hostname.endsWith(".tile.openstreetmap.fr") ||
    url.hostname === "tiles.stadiamaps.com" ||
    url.hostname === "api.maptiler.com" ||
    // CARTO's vector styles: the style JSON, the .mvt tiles off tiles-{a..d}, and the
    // glyph/sprite files the renderer needs before it can draw any text.
    url.hostname.endsWith("basemaps.cartocdn.com")
  ) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }

  // District geometry is immutable per ?v= stamp, so cache-first is exact rather than
  // merely tolerable: a hit is guaranteed to be the right bytes, and a version bump
  // simply misses and fetches the new URL. Old versions are swept below so a long-lived
  // install doesn't accumulate a copy of every generation ever served.
  if (url.pathname === "/api/districts/geometry") {
    event.respondWith(cacheFirstGeometry(request, url));
    return;
  }

  if (url.pathname === "/api/districts" || url.pathname === "/api/customers") {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // Only immutable production chunks are safe to reuse without revalidation.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(immutableChunk(request));
    return;
  }

  // The page document itself: try the network first (so a returning-online user always
  // gets the latest deploy), but keep the last good copy so the map page (not just the
  // generic offline message) actually renders when there's no signal.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
  }
});
