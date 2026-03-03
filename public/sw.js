/**
 * Service Worker - Göz Takip Analizi PWA
 *
 * Cache stratejileri:
 * - Cache-first: /_next/static/* (JS, CSS bundle)
 * - Network-first: Sayfa navigasyonları → offline fallback
 * - Stale-while-revalidate: CDN kaynakları (MediaPipe)
 */

const CACHE_VERSION = "v1";
const CACHE_STATIC = "goz-takip-static-" + CACHE_VERSION;
const CACHE_DYNAMIC = "goz-takip-dynamic-" + CACHE_VERSION;
const CACHE_CDN = "goz-takip-cdn-" + CACHE_VERSION;

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// Install: pre-cache kritik dosyalar
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: eski cache'leri temizle
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("goz-takip-") &&
              key !== CACHE_STATIC &&
              key !== CACHE_DYNAMIC &&
              key !== CACHE_CDN
          )
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch stratejileri
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Sadece GET istekleri
  if (event.request.method !== "GET") return;

  // 1. Static assets (JS/CSS bundles) — Cache-first
  if (
    url.origin === location.origin &&
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // 2. CDN kaynakları (MediaPipe modelleri) — Stale-while-revalidate
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_CDN));
    return;
  }

  // 3. Sayfa navigasyonları — Network-first, offline fallback
  if (event.request.mode === "navigate") {
    event.respondWith(
      networkFirst(event.request, CACHE_DYNAMIC).catch(
        () => caches.match("/offline.html")
      )
    );
    return;
  }

  // 4. Diğer same-origin istekler — Network-first
  if (url.origin === location.origin) {
    event.respondWith(networkFirst(event.request, CACHE_DYNAMIC));
  }
});

// --- Cache stratejisi fonksiyonları ---

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("No cache available");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}
