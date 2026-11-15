// 員工餐金額總計 網頁版：有網路時一律抓最新版（避免手機主畫面卡舊版），離線時用快取
const CACHE = 'mealtracker-v1';
const SHELL = ['./', 'index.html', 'styles.css?v=1', 'config.js?v=1', 'js/core.js?v=1', 'js/ui.js?v=1', 'js/net.js?v=1',
  'js/p-dash.js?v=1', 'js/p-records.js?v=1', 'js/p-ing.js?v=1', 'js/p-order.js?v=1', 'js/p-sched.js?v=1', 'js/p-menu.js?v=1',
  'js/p-lunar.js?v=1', 'js/p-recipe.js?v=1', 'js/p-report.js?v=1', 'js/p-settings.js?v=1', 'js/p-ocr.js?v=1', 'js/app.js?v=1',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mealtracker-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || caches.match('index.html')))
  );
});
