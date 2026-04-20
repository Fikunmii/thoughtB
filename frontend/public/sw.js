/**
 * sw.js — Thought Biography Service Worker
 * ─────────────────────────────────────────
 * Placed in: frontend/public/sw.js
 * Registered by: frontend/src/main.jsx
 *
 * Strategy:
 *   - App shell (HTML, JS, CSS, fonts) → Cache First
 *     Loads instantly from cache. Updates in background.
 *
 *   - API calls (/entries, /graph, /dashboard, etc.) → Network First
 *     Always tries the live API. Falls back to cached response if offline.
 *     This means the user can still READ their graph offline — they just
 *     can't save new entries until they reconnect.
 *
 *   - Biography SSE stream → Network Only (never cached)
 *     Streaming responses can't be cached meaningfully.
 *
 *   - Google Fonts → Cache First, long TTL
 *     Fonts don't change. Cache forever.
 */

const CACHE_VERSION   = "tb-v1";
const SHELL_CACHE     = `${CACHE_VERSION}-shell`;
const API_CACHE       = `${CACHE_VERSION}-api`;
const FONT_CACHE      = `${CACHE_VERSION}-fonts`;

// App shell assets to pre-cache on install
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// API origin — matches VITE_API_URL
const API_ORIGIN = self.location.origin.includes("localhost")
  ? "http://localhost:8000"
  : "https://api.thoughtbiography.com"; // update this when you deploy

// Routes that should never be cached (writes, streams, auth)
const NEVER_CACHE = [
  "/biography/generate",
  "/biography/stream",
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/transcribe",
  "/digest/send-now",
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      console.log("[SW] Pre-caching app shell");
      return cache.addAll(SHELL_ASSETS);
    })
  );
  // Take over immediately — don't wait for old SW to unregister
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("tb-") && !key.startsWith(CACHE_VERSION))
          .map((key) => {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          })
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ── Fetch: route each request to the right strategy ──────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── 1. Google Fonts → Cache First, long TTL ──────────────────────────────
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // ── 2. API calls → Network First with offline fallback ───────────────────
  if (url.origin === API_ORIGIN) {
    // Never cache these endpoints
    const neverCache = NEVER_CACHE.some((path) => url.pathname.includes(path));
    if (neverCache || request.method !== "GET") {
      event.respondWith(networkOnly(request));
      return;
    }
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // ── 3. App shell (same origin) → Cache First ─────────────────────────────
  if (url.origin === self.location.origin) {
    // For navigation requests (HTML), always serve index.html from cache
    // so the React app handles routing client-side
    if (request.mode === "navigate") {
      event.respondWith(
        caches.match("/index.html").then(
          (cached) => cached || fetch(request)
        )
      );
      return;
    }
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // ── 4. Everything else → Network ─────────────────────────────────────────
  event.respondWith(fetch(request));
});

// ── Strategy implementations ──────────────────────────────────────────────────

/**
 * Cache First: return cached version if it exists.
 * If not cached, fetch and store for next time.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline — asset not cached", { status: 503 });
  }
}

/**
 * Network First: try the network first.
 * If offline or request fails, fall back to cache.
 * Stores every successful GET response for offline fallback.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      console.log("[SW] Offline — serving from cache:", request.url);
      return cached;
    }
    // Return a structured offline response for API calls
    return new Response(
      JSON.stringify({
        offline: true,
        message: "You are offline. This data was not available in the cache.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Network Only: never cache, always fetch live.
 */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ offline: true, message: "This action requires an internet connection." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ── Background sync: queue failed entry saves for when back online ────────────
// Only fires in browsers that support Background Sync (Chrome/Android)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-entries") {
    event.waitUntil(syncPendingEntries());
  }
});

async function syncPendingEntries() {
  // Read queued entries from IndexedDB (written by the frontend when offline)
  // and replay the POST /entries requests now that we're back online.
  // Frontend code to queue entries lives in ThoughtBiography.jsx — see OFFLINE_QUEUE.
  try {
    const db = await openDB();
    const pending = await getAll(db, "pending_entries");
    for (const entry of pending) {
      try {
        const res = await fetch(`${API_ORIGIN}/entries`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${entry.token}`,
          },
          body: JSON.stringify({ content: entry.content, source: "journal" }),
        });
        if (res.ok) {
          await deleteRecord(db, "pending_entries", entry.id);
          console.log("[SW] Synced offline entry:", entry.id);
        }
      } catch (e) {
        console.error("[SW] Failed to sync entry:", e);
      }
    }
  } catch (e) {
    console.error("[SW] Background sync failed:", e);
  }
}

// ── Minimal IndexedDB helpers for offline queue ───────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("thought-bio-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pending_entries")) {
        db.createObjectStore("pending_entries", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function deleteRecord(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Push notifications (for digest alerts) ───────────────────────────────────
// Fires when the backend sends a Web Push notification
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Thought Biography", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Thought Biography", {
      body:    data.body  || "Your weekly concept drift digest is ready.",
      icon:    "/icons/icon-192.png",
      badge:   "/icons/icon-72.png",
      tag:     "digest",
      renotify: false,
      data:    { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(target);
      } else {
        self.clients.openWindow(target);
      }
    })
  );
});