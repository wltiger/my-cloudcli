// Service Worker for CloudCLI PWA
// Cache-first for the app shell so the UI opens with no network connection.
// Picking up a newer shell is a manual action (the "Refresh offline cache"
// control in Settings posts a REFRESH_CACHE message) — there is deliberately no
// automatic staleness detection. See docs/adr/0002-cache-first-app-shell-manual-refresh.md
const CACHE_NAME = 'claude-ui-v3';
// The SPA serves every client-side route from the same document, so the shell
// is cached once under '/' and replayed for any navigation.
const APP_SHELL_URL = '/';
const urlsToCache = [
  APP_SHELL_URL,
  '/manifest.json',
  // Referenced by the shell's own chrome (auth screens), and not under /assets/
  '/logo.svg'
];

// Fetch bypassing the HTTP cache so a (re)populated entry is genuinely fresh.
function cacheFreshCopies() {
  return caches.open(CACHE_NAME).then(cache =>
    Promise.all(
      urlsToCache.map(url =>
        fetch(new Request(url, { cache: 'reload' }))
          .then(response => (response.ok ? cache.put(url, response) : undefined))
          .catch(() => undefined)
      )
    )
  );
}

// Install event
self.addEventListener('install', event => {
  event.waitUntil(cacheFreshCopies());
  self.skipWaiting();
});

// Fetch event — cache-first for the app shell and hashed assets, network-first otherwise
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never intercept API requests or WebSocket upgrades
  if (url.includes('/api/') || url.includes('/ws')) {
    return;
  }

  // Navigation requests (HTML) — cache-first so the app opens offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(APP_SHELL_URL).then(cached => {
        if (cached) return cached;
        // Not precached yet (first ever load, or the install fetch failed)
        return fetch(event.request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(APP_SHELL_URL, clone));
            }
            return response;
          })
          .catch(() =>
            new Response('<h1>Offline</h1><p>Please check your connection.</p>', {
              headers: { 'Content-Type': 'text/html' }
            })
          );
      })
    );
    return;
  }

  // Hashed assets (JS/CSS in /assets/) — cache-first since filenames change per build
  if (url.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Activate event — purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Manual "Refresh offline cache" from Settings — drop everything we cached
// (shell + hashed assets) and re-fetch the shell, then tell the client to reload.
self.addEventListener('message', event => {
  if (event.data?.type === 'REFRESH_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME)
        .then(() => cacheFreshCopies())
        .then(() => {
          event.source?.postMessage({ type: 'REFRESH_CACHE_DONE' });
        })
    );
    return;
  }

  // Opening a session in the app clears its stacked-up push notifications
  // from the phone's notification center.
  if (event.data?.type === 'CLEAR_SESSION_NOTIFICATIONS') {
    event.waitUntil(closeSessionNotifications(event.data.sessionId));
  }
});

// iOS does not replace same-tag notifications (WebKit bug 258922) — `tag` +
// `renotify` only auto-collapses on Chrome/Android. Closing matches by hand
// keeps "one notification per session" true on iOS too.
function closeSessionNotifications(sessionId) {
  if (!sessionId) return Promise.resolve();

  return self.registration.getNotifications().then(notifications =>
    Promise.all(
      notifications
        .filter(notification => notification.data?.sessionId === sessionId)
        .map(notification => notification.close())
    )
  );
}

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'CloudCLI', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/logo-256.png',
    badge: '/logo-128.png',
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true
  };

  event.waitUntil(
    closeSessionNotifications(payload.data?.sessionId).then(() =>
      self.registration.showNotification(payload.title || 'CloudCLI', options)
    )
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const provider = event.notification.data?.provider || null;
  const urlPath = sessionId ? `/session/${sessionId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          client.postMessage({
            type: 'notification:navigate',
            sessionId: sessionId || null,
            provider,
            urlPath
          });
          return;
        }
      }
      return self.clients.openWindow(urlPath);
    })
  );
});
