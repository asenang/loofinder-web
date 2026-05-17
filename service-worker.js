/* LooFinder service worker
 * Strategy:
 *   - App shell (HTML/CSS/JS, manifest, icons): cache-first w/ network fallback,
 *     refreshed in the background (stale-while-revalidate).
 *   - Leaflet tiles (a.tile.openstreetmap.org etc.): cache-first with a hard
 *     cap so we don't fill the user's disk on long browsing sessions.
 *   - Backend API (loofinder API, Overpass, Nominatim proxy): network-first,
 *     fall back to cache so the last-seen data still renders offline.
 *   - Everything else: network-first.
 */
const SW_VERSION = "v1.0.7";
const APP_CACHE = `loofinder-app-${SW_VERSION}`;
const TILE_CACHE = `loofinder-tiles-${SW_VERSION}`;
const API_CACHE = `loofinder-api-${SW_VERSION}`;
const TILE_CACHE_MAX_ENTRIES = 400;

// Minimal precache: just enough to render an offline shell. Versioned CSS/JS
// (`?v=`) and CDN scripts will be picked up by the runtime stale-while-
// revalidate handler on first page load, so we don't have to bump this list
// on every release.
const APP_SHELL = [
  "/",
  "/index.html",
  "/admin-analytics.html",
  "/privacy.html",
  "/assets/site.webmanifest",
  "/assets/logos/loofinder-logo-icon.svg",
  "/assets/android-chrome-192x192.png",
  "/assets/android-chrome-512x512.png",
  "/assets/favicon.ico",
  "/assets/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) =>
      // Use addAll with individual requests so a single 404 doesn't kill install.
      Promise.all(
        APP_SHELL.map((url) =>
          cache
            .add(new Request(url, { cache: "reload" }))
            .catch((err) => console.warn("[sw] Failed to precache", url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![APP_CACHE, TILE_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return /tile\.openstreetmap\.org|tile\.osm\.org|basemaps\.cartocdn\.com|cartodb-basemaps/.test(
    url.hostname
  );
}

function isApiRequest(url) {
  // Match the LooFinder backend (Render today, but accept any host that
  // starts with "loofinder-api"), the Overpass mirrors, and any path that
  // looks like a JSON API. We never cache POST/PATCH/DELETE — the fetch
  // handler short-circuits on those before reaching here.
  return (
    /^loofinder-api\b/i.test(url.hostname) ||
    /\boverpass[-.]/i.test(url.hostname) ||
    /nominatim\.openstreetmap\.org$/i.test(url.hostname) ||
    url.pathname.startsWith("/api/")
  );
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // FIFO eviction.
  const toDelete = keys.length - maxEntries;
  for (let i = 0; i < toDelete; i++) {
    await cache.delete(keys[i]);
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  return cached || networkPromise || Response.error();
}

async function cacheFirstWithCap(request, cacheName, cap) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).then(() => trimCache(cacheName, cap));
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok && request.method === "GET") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Don't try to cache POST/auth/etc or non-http(s) schemes.
  if (!["http:", "https:"].includes(url.protocol)) return;

  if (isTileRequest(url)) {
    event.respondWith(
      cacheFirstWithCap(request, TILE_CACHE, TILE_CACHE_MAX_ENTRIES)
    );
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Same-origin navigation/document: serve cached index.html offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/index.html").then((res) => res || Response.error())
      )
    );
    return;
  }

  // App shell assets (CSS/JS/images/fonts).
  event.respondWith(staleWhileRevalidate(request, APP_CACHE));
});

// Allow the page to ask us to skipWaiting after a new SW is installed.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
