const CACHE = "sql-trainer-v28";
const VERSION = "4.0.0";
const BUILD = "20261026.9";
const ROOT = new URL('./', self.registration.scope);
const CACHE_NAME = CACHE + ':' + ROOT.href;
const ASSETS = ["assets/index-BG4jAByO.js","assets/index-BSpOKnRh.css","icons/app.svg","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest","vendor/lucide.js","vendor/sql-wasm.js","vendor/sql-wasm.wasm"];

function validDocument(response) {
  return response && response.ok && /text\/html/i.test(response.headers.get('content-type') || '');
}

async function digest(response) {
  const buffer = await response.clone().arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(new URL('release.json', ROOT), {cache: 'no-store', redirect: 'error'});
    if (!response.ok) throw new Error('发布信息不可用');
    const release = await response.json();
    if (release.app !== 'sql-trainer' || release.version !== VERSION || release.build !== BUILD || release.cache !== CACHE) throw new Error('发布版本不一致');
    const resources = await Promise.all(ASSETS.map(async asset => {
      const entry = release.assets.find(item => item.path === asset);
      if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('发布资源缺少校验');
      const resource = await fetch(new URL(asset, ROOT), {cache: 'no-store', redirect: 'error'});
      if (!resource.ok || (asset === 'index.html' && !validDocument(resource)) || await digest(resource) !== entry.sha256) throw new Error('发布资源校验失败');
      return [new URL(asset, ROOT).href, resource];
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(resources.map(([url, resource]) => cache.put(url, resource)));
  })().catch(async error => {
    await caches.delete(CACHE_NAME);
    throw error;
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(async key => {
      const scoped = /^sql-trainer-v\d+:/.test(key) && key.endsWith(':' + ROOT.href);
      const legacy = /^sql-trainer-v\d+$/.test(key) && await (await caches.open(key)).match(ROOT.href);
      if (scoped || legacy) await caches.delete(key);
    }));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const relative = url.pathname.slice(ROOT.pathname.length);
  if (request.mode === 'navigate' && (relative === '' || relative === 'index.html')) {
    event.respondWith((async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 4500);
      let response;
      try {
        response = await fetch(request, {cache: 'no-store', signal: abort.signal});
        if (validDocument(response)) return response;
      } catch (error) {
        response = null;
      } finally {
        clearTimeout(timer);
      }
      const cached = await (await caches.open(CACHE_NAME)).match(new URL('index.html', ROOT));
      return cached || response || new Response('暂时无法打开，请联网后重试。', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
    })());
  } else if (ASSETS.includes(relative) && relative !== 'index.html' && !url.search) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE_NAME)).match(new URL(relative, ROOT));
      return cached || fetch(request);
    })());
  }
});

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SQLTRAIN_STATUS' && event.ports[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const present = await Promise.all(ASSETS.map(asset => cache.match(new URL(asset, ROOT))));
      event.ports[0].postMessage({version: VERSION, build: BUILD, offline: present.every(Boolean)});
    })());
  }
  if (event.data.type === 'SQLTRAIN_APPLY' && event.data.build === BUILD) event.waitUntil(self.skipWaiting());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const client = windows.find(item => item.url.startsWith(ROOT.href));
    if (client) return client.focus();
    return self.clients.openWindow(ROOT.href);
  })());
});
