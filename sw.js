// ============================================================
// Kingdom Grace Pastoral Network — Service Worker
// Offline-first for rural areas with limited connectivity
// ============================================================

const CACHE_NAME = 'kg-pastoral-v10';
// Pre-cache only the immutable app shell. The main HTML is served
// network-first so updates land on every reload without needing a
// cache-name bump.
const CACHE_URLS = [
  '/manifest.json',
  '/icons/kg-logo.jpg',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// ── INSTALL: Pre-cache the app shell ──
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS).catch(()=>{}))
  );
  self.skipWaiting();
});

// ── ACTIVATE: Clean old caches ──
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── FETCH: Network-first for HTML + API, cache-first only for fonts/icons ──
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const req = e.request;

  // Supabase API calls — network-first, cache GET responses for offline reading
  if (url.hostname.includes('supabase.co')) {
    if (req.method === 'GET') {
      e.respondWith(networkFirstThenCache(req));
    } else {
      e.respondWith(networkOrQueue(req));
    }
    return;
  }

  // Google Fonts — cache-first (they rarely change)
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    e.respondWith(cacheFirstThenNetwork(req));
    return;
  }

  // Icons, manifest — cache-first (immutable-ish)
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    e.respondWith(cacheFirstThenNetwork(req));
    return;
  }

  // Navigation (HTML) — network-first so updates land on every reload
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(networkFirstForShell(req));
    return;
  }

  // Everything else — try network, fall back to cache
  e.respondWith(networkFirstThenCache(req));
});

// ── STRATEGY: network-first for the main HTML shell ──
async function networkFirstForShell(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put('/kg-pastoral-network.html', response.clone()).catch(()=>{});
    }
    return response;
  } catch {
    const cached = await caches.match('/kg-pastoral-network.html');
    if (cached) return cached;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ── STRATEGIES ──

async function cacheFirstThenNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not cached — return offline page for navigation
    if (request.mode === 'navigate') {
      return caches.match('/kg-pastoral-network.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstThenCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function networkOrQueue(request) {
  try {
    return await fetch(request);
  } catch {
    // Offline — store the mutation in IndexedDB for later sync
    const body = await request.clone().text();
    await queueMutation({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: body,
      timestamp: Date.now()
    });
    // Notify the client that data was queued
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({ type: 'QUEUED_OFFLINE', url: request.url });
    });
    return new Response(JSON.stringify({ queued: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── INDEXEDDB OFFLINE QUEUE ──

function openQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kg-offline-queue', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('mutations')) {
        db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueMutation(mutation) {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').add(mutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllQueued() {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const req = tx.objectStore('mutations').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearQueued(id) {
  const db = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readwrite');
    tx.objectStore('mutations').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── BACKGROUND SYNC: Replay queued mutations when back online ──

self.addEventListener('sync', (e) => {
  if (e.tag === 'kg-sync-mutations') {
    e.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  const queued = await getAllQueued();
  for (const item of queued) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.method !== 'GET' ? item.body : undefined
      });
      if (response.ok || response.status < 500) {
        await clearQueued(item.id);
      }
    } catch {
      // Still offline — stop trying, sync will fire again
      break;
    }
  }
  // Notify clients of sync result
  const remaining = await getAllQueued();
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({
      type: 'SYNC_COMPLETE',
      remaining: remaining.length,
      synced: queued.length - remaining.length
    });
  });
}

// ── MESSAGE HANDLER: Manual sync trigger from app ──
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (e.data === 'FORCE_SYNC') {
    replayQueue().then(() => {
      e.source.postMessage({ type: 'FORCE_SYNC_DONE' });
    });
  }
  if (e.data === 'GET_QUEUE_COUNT') {
    getAllQueued().then((items) => {
      e.source.postMessage({ type: 'QUEUE_COUNT', count: items.length });
    });
  }
});

// ── PUSH NOTIFICATIONS: receive server-sent push events ──
self.addEventListener('push', (e) => {
  let data = { title: 'Kingdom Grace', body: 'You have a new notification', icon: '/icons/kg-logo.jpg' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; } catch { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/kg-logo.jpg',
      badge: '/icons/kg-logo.jpg',
      tag: data.tag || 'kg-push-' + Date.now(),
      renotify: true,
      data: { screen: data.screen || null, url: data.url || '/' }
    })
  );
});

// ── NOTIFICATION CLICK: open/focus the app ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if available
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return self.clients.openWindow(url);
    })
  );
});
