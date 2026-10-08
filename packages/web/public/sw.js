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

// Web Push. Payload: {title, body, tag, url}. Only same-origin paths are ever opened.
function safePath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch (_) {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Fleet';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        return existing.focus().then((focused) => {
          if (path !== '/' && focused && 'navigate' in focused) return focused.navigate(path);
          return focused;
        });
      }
      return self.clients.openWindow(path);
    }),
  );
});
