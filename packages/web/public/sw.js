/* Fleet app-shell service worker. Caches the shell (HTML, built JS/CSS, icons) only.
 * Never caches /api: live fleet data, history and tokens always go to the network. */
importScripts('/sw-policy.js');
const policy = self.fleetSwPolicy;
const VERSION = 'fleet-shell-v2';
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/theme-init.js',
  '/sw-policy.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL.filter((path) => path !== '/'));
  // Read the built index.html to find the hashed JS/CSS it boots from, so offline startup works.
  const response = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
  if (!policy.isShellNavigation('navigate', response.status, response.headers.get('content-type'))) return;
  const html = await response.clone().text();
  await cache.put('/', response);
  await cache.addAll(policy.shellAssets(html));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!policy.shouldHandle(request.method, url, self.location.origin)) return; // /api and token URLs: network only

  if (request.mode === 'navigate') {
    // Network first so a fresh deploy wins; only real HTML documents replace the cached shell.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (policy.isShellNavigation(request.mode, response.status, response.headers.get('content-type'))) {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error())),
    );
    return;
  }

  if (policy.isCacheableAsset(url.pathname, SHELL)) {
    // Hashed assets are immutable: cache first.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
