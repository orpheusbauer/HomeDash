const CACHE = 'homedash-shell-v2';

self.addEventListener('install', (event) => {
  // Installation must also succeed while the Pi is restarting.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('homedash-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function usable(response, request) {
  if (!response || !response.ok) return false;
  const type = response.headers.get('Content-Type') || '';
  if (request.mode === 'navigate') return type.includes('text/html');
  if (request.destination === 'script' || new URL(request.url).pathname.endsWith('.js')) {
    return /(?:java|ecma)script/i.test(type);
  }
  if (request.destination === 'style' || new URL(request.url).pathname.endsWith('.css')) {
    return type.includes('text/css');
  }
  return !type.includes('text/html');
}

async function respond(request, event) {
  let cache;
  let cached;
  try {
    cache = await caches.open(CACHE);
    cached = await cache.match(request);
  } catch {
    // A full or unavailable cache must not prevent a network load.
  }
  const asset = new URL(request.url).pathname.startsWith('/assets/');
  // Vite assets have content hashes. Keep the exact old bundle usable during a rollout.
  if (asset && usable(cached, request)) return cached;
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (usable(response, request)) {
      if (cache) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      return response;
    }
    if (usable(cached, request)) return cached;
    return response;
  } catch (error) {
    if (usable(cached, request)) return cached;
    // Never substitute HTML for a missing JavaScript or CSS file.
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/health/') ||
    url.pathname === '/sw.js'
  )
    return;
  event.respondWith(respond(event.request, event));
});
