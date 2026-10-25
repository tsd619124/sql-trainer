// SQL 训练营 Service Worker：在线时永远拿最新版，离线时用缓存打开
const CACHE = 'sql-trainer-v18';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(['./']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // CDN 资源交给浏览器自身缓存
  // 只管应用文档（整个应用就是一个单页文档）；网络优先，绕过 HTTP 缓存保证拿到最新
  if (req.mode === 'navigate' || (url.pathname.endsWith('/') && url.pathname.lastIndexOf('/') === url.pathname.length - 1)) {
    e.respondWith(
      fetch(req, { cache: 'reload' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./')))
    );
  }
});
