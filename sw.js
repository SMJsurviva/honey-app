/* Service worker: network-first (never serve a stale app when online),
   cache fallback only when offline. Also handles Web Push for the operator. */

const CACHE = "honey-v3";
const SHELL = [
  "./",
  "./index.html",
  "./operator.html",
  "./analytics.html",
  "./css/style.css",
  "./js/app.js",
  "./js/operator.js",
  "./js/analytics.js",
  "./js/config.js",
  "./js/vendor/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  // cache:"no-cache" forces ETag revalidation — GitHub Pages' max-age=600
  // otherwise lets Chrome serve a stale app for up to 10 minutes after deploy
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch (_) { data = { title: "새 주문", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(
    self.registration.showNotification(data.title || "새 주문", {
      body: data.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: data.tag || "honey-order",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes("operator.html")) return c.focus();
      }
      return clients.openWindow("operator.html");
    })
  );
});
