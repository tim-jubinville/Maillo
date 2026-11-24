/* Maillo service worker. Built from sw/sw.js by vite.config.ts; the placeholders are filled at build time. */
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = `maillo-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('maillo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: always revalidate with the server, so changed settings from config.php are picked up right away.
    const res = await fetch(request, { cache: 'no-cache' });
    if (cacheable(res)) cache.put(key ?? request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key ?? request, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  // Server endpoints, updater files and logos always go to the network (config.php is kept for offline use).
  if ((/\.php$/.test(path) && path !== 'config.php') || path === 'version.json' || path.startsWith('branding') || path.startsWith('.')) return;

  if (req.mode === 'navigate') {
    // Navigations keep their own redirect handling (Cloudflare Access sign-in); the cache only helps offline.
    event.respondWith(fetch(req).then((res) => {
      if (cacheable(res)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./', copy));
      }
      return res;
    }).catch(() => caches.match('./').then((hit) => hit || Response.error())));
    return;
  }
  if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.registration.scope)) || all[0];
    if (client) {
      await client.focus().catch(() => undefined);
      client.postMessage({ type: 'maillo:open', threadId: data.threadId || '' });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// New mail pushed by push.php (features.push). With Maillo visible, the page refreshes and notifies by its own
// rules; otherwise the worker shows the notification push.php prepared for this device.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    all.forEach((c) => c.postMessage({ type: 'maillo:mail' }));
    if (data.tag !== 'maillo-test' && all.some((c) => c.visibilityState === 'visible')) {
      // Every push must show a notification: Safari cancels the subscription after a few that don't, and
      // Chrome shows its own "updated in the background" one. The open page handles this mail, so show a
      // silent one and close it straight away.
      await self.registration.showNotification('Maillo', { tag: 'maillo-live', silent: true });
      const shown = await self.registration.getNotifications({ tag: 'maillo-live' });
      shown.forEach((n) => n.close());
      return;
    }
    await self.registration.showNotification(data.title || 'Maillo', {
      body: data.body || '',
      tag: data.tag || 'maillo-mail',
      renotify: true,
      silent: !!data.silent,
      icon: './icon-192.png',
      badge: './badge-96.png',
      data: { threadId: data.threadId || '', url: data.threadId ? `./#/inbox/t/${encodeURIComponent(data.threadId)}` : './#/inbox' }
    });
  })());
});
