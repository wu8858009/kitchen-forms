// 有網路時一律抓最新版（避免 iPhone 主畫面卡舊版），離線時用快取
const CACHE = 'dishsales-v6';
const SHELL = ['./', 'index.html', 'styles.css?v=6', 'config.js?v=6', 'xlsx.js?v=6', 'app.js?v=6', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
