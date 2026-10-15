const CACHE = 'byte-back-vault-offline-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('byte-back-vault-offline-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // API·세션·자료·POST를 가로채거나 캐시·대기열에 저장하지 않습니다.
  if (request.method !== 'GET' || url.origin !== self.location.origin
      || request.mode !== 'navigate' || !['/', '/index.html'].includes(url.pathname)
      || url.search) return;
  event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () =>
    (await (await caches.open(CACHE)).match(OFFLINE)) ?? new Response('오프라인입니다. 연결 후 다시 접속하세요.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
});
