// 首頁與備料交接日誌的離線快取（冰箱、菜品、員工餐資料夾有各自的 sw.js）
// 帶 ?v= 的檔案：先用快取（改版時版本號會變，網址不同就會抓新的）
// 頁面與其他檔案：先抓網路拿最新版，網路 2.5 秒沒回應就先用快取，背景照樣更新
const CACHE = 'kitchenforms-v15';
const SHELL = ['./', 'index.html', 'portal.css?v=5', 'config.js?v=1', 'portal.js?v=13', 'auth.js?v=3', 'auth-ui.js?v=4', 'auth.css?v=3', 'cloud-ui.js?v=1', 'meal/js/core.js?v=1', 'kitchen-nav.js?v=7', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('kitchenforms-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function save(req, res) {
  if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // 冰箱、菜品、員工餐頁面交給它們自己的 service worker
  if (/\/(fridge|dish|meal)\//.test(url.pathname) && !/\/meal\/js\/core\.js$/.test(url.pathname)) return;
  if (url.searchParams.has('u')) return; // 檢查新版用的請求，不要存進快取
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => save(req, res))));
    return;
  }
  // cache: 'no-cache'：不要用瀏覽器 10 分鐘的暫存，每次都跟 GitHub 確認有沒有新版
  const net = fetch(req, { cache: 'no-cache' }).then((res) => save(req, res));
  const cached = () => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : null));
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const go = (r) => { if (!done && r) { done = true; resolve(r); } };
    const t = setTimeout(() => cached().then(go), 2500);
    net.then((r) => { clearTimeout(t); go(r); }).catch(() => { clearTimeout(t); cached().then((r) => { if (r) go(r); else if (!done) { done = true; resolve(Response.error()); } }); });
  }));
  e.waitUntil(net.catch(() => {}));
});
