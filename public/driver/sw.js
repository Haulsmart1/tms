/* Only driver documents and immutable Next assets. API requests (including
 * mutations and auth) always reach the network; data lives in owner-keyed IDB. */
const VERSION = "tms-driver-v1";
const DOCUMENTS = `${VERSION}-documents`;
const ASSETS = `${VERSION}-assets`;
const documentPath = (path) => path === "/driver/dashboard" || path === "/driver/walkaround" || /^\/driver\/jobs\/[^/]+$/.test(path);
async function put(cacheName, key, response, limit) {
  const cache = await caches.open(cacheName);
  await cache.put(key, response);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(old);
}
async function saveDocument(url, response) {
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("text/html")) return;
  // Prepare assets even when the first page loaded before SW control began.
  const html = await response.clone().text();
  const paths = [...new Set(html.match(/\/_next\/static\/[^"\s<>\\]+\.(?:js|css|woff2)/g) || [])];
  await Promise.all(paths.map(async (path) => {
    try {
      if (await caches.match(path, { cacheName: ASSETS })) return;
      const asset = await fetch(path);
      if (asset.ok) await put(ASSETS, path, asset, 250);
    } catch { /* try on next visit */ }
  }));
  await put(DOCUMENTS, url, response.clone(), 100);
}
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(ASSETS).then((cache) => cache.addAll([
    "/driver/offline.html", "/driver/icon-192.png", "/driver/icon-512.png",
  ])));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("tms-driver-") && ![DOCUMENTS, ASSETS].includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_DRIVER_PAGES" || !Array.isArray(event.data.paths)) return;
  event.waitUntil((async () => {
    // Sequential warming avoids saturating a phone connection.
    for (const path of event.data.paths.slice(0, 80)) {
      const url = new URL(path, self.location.origin);
      if (url.origin !== self.location.origin || !documentPath(url.pathname)) continue;
      try { await saveDocument(url.href, await fetch(url.href, { cache: "no-store" })); } catch { /* offline */ }
    }
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: ASSETS });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await put(ASSETS, request, response.clone(), 250);
      return response;
    })());
  } else if (request.mode === "navigate" && documentPath(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        // A login redirect or denial is authoritative; never replace it with cache.
        if (response.ok && !response.redirected) event.waitUntil(saveDocument(url.href, response.clone()));
        else await (await caches.open(DOCUMENTS)).delete(url.href);
        return response;
      } catch {
        return (await caches.match(url.href, { cacheName: DOCUMENTS })) ||
          (await caches.match("/driver/offline.html", { cacheName: ASSETS })) || Response.error();
      }
    })());
  }
});
