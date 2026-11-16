// 首頁的離線快取（冰箱、菜品資料夾有各自的 sw.js）；有網路時一律抓最新版
const CACHE = 'kitchenforms-v4';
const SHELL = ['./', 'index.html', 'portal.css?v=2', 'config.js?v=1', 'portal.js?v=3', 'meal/js/core.js?v=1', 'kitchen-nav.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('kitchenforms-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // 冰箱、菜品、員工餐頁面交給它們自己的 service worker
  if (/\/(fridge|dish|meal)\//.test(url.pathname)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || caches.match('index.html')))
  );
});
