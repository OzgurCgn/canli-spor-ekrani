"use strict";

const CACHE_NAME = "nabiz90-v2";
const APP_SHELL = ["/", "/css/style.css", "/js/app.js", "/manifest.webmanifest", "/images/app-icon.svg", "/images/app-icon-192.png", "/images/app-icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) { payload = { body: event.data?.text() || "Yeni maç gelişmesi" }; }
  const title = payload.title || "Nabız90";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "Yeni maç gelişmesi",
    icon: payload.icon || "/images/app-icon-192.png",
    badge: "/images/app-icon-192.png",
    tag: payload.tag || "nabiz90-match-update",
    renotify: true,
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (new URL(event.request.url).pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }
  const cacheKey = event.request.mode === "navigate" ? "/" : event.request;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, response.clone()));
        return response;
      })
      .catch(() => caches.match(cacheKey).then(cached => cached || caches.match("/"))),
  );
});
