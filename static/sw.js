"use strict";

const CACHE_NAME = "canlispor-v3.3.6";
const APP_SHELL = ["/", "/css/style.css", "/js/app.js", "/manifest.webmanifest", "/images/app-icon.svg", "/images/app-icon-192.png", "/images/app-icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url)))),
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
