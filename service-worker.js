const CACHE_PREFIX = "nl-exchange-";
const CACHE = CACHE_PREFIX + "__PWA_REVISION__";

const pages = new Set([
  "/index.html",
  "/2026.html",
  "/projekter-2026.html",
  "/qa.html",
  "/pakkeliste.html",
  "/learning-objectives.html",
  "/previous-years.html",
  "/billetter.html",
]);
const assets = new Set([
  "/styles.css",
  "/script.js",
  "/i18n.js",
  "/pwa.js",
  "/billetter.js",
  "/ticket-journeys.mjs",
  "/helmond-program.mjs",
  "/helmond-program-data.mjs",
  "/projekter-2026.mjs",
  "/projekter-2026-data.mjs",
  "/media/2026/viborg-velkomst.webp",
  "/media/2026/borgvold.webp",
  "/media/2026/nytorv.webp",
  "/media/2026/space-jump.webp",
  "/media/2026/den-gamle-by.webp",
  "/media/2026/aarhus-street-food.webp",
  "/media/2026/oelluminati.webp",
  "/media/2026/paletten.webp",
  "/media/2026/domkirke.webp",
  "/media/projects-2026/gruppebillede.webp",
  "/media/projects-2026/warehouse.webp",
  "/media/projects-2026/dmx.webp",
  "/media/projects-2026/railway.webp",
  "/media/projects-2026/projection.webp",
  "/media/projects-2026/sumo.webp",
  "/media/projects-2026/emo.webp",
  "/media/projects-2026/car.webp",
  "/media/projects-2026/arcade.webp",
  "/github-invertocat.svg",
  "/manifest.webmanifest",
  "/favicon.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/app-icon-192.png",
  "/app-icon-512.png",
]);

function pagePath(path) {
  if (path === "/") return "/index.html";
  if (path === "/tidligere") return "/previous-years.html";
  return path.endsWith(".html") ? path : path + ".html";
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...pages, ...assets].map((path) => new Request(path, {
      cache: "reload",
      credentials: "omit",
    })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Only public app files can use the offline cache. Ticket API requests pass through.
  // A link to the full-size image is a navigation to a cached asset.
  const navigation = request.mode === "navigate" && !assets.has(url.pathname);
  const path = navigation ? pagePath(url.pathname) : url.pathname;
  if (!(navigation ? pages : assets).has(path)) return;

  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(request, { signal: controller.signal });
      if (response.status < 500) return response;
    } catch {
      // Network unavailable. Use the files saved during installation.
    } finally {
      clearTimeout(timeout);
    }
    return (await caches.match(path, { cacheName: CACHE })) || Response.error();
  })());
});
