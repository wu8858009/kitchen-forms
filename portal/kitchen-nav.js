/* 加在各系統頁面上的「首頁」按鈕：先把資料存好再回到廚房專用表格系統首頁；也負責擋下沒有權限的人、套用首頁的雲端同步設定 */
(() => {
  'use strict';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const home = '../index.html' + (DESK ? '?desktop=1' : '');
  // 權限：沒有這個系統權限（或還沒登入）就回首頁
  const mod = (location.pathname.match(/\/(fridge|prep|dish|meal)\//) || [])[1];
  if (mod && window.KitchenAuth && !window.KitchenAuth.can(mod)) { location.replace(home); return; }
  // 開著的時候權限被取消、帳號被停用：存好資料再回首頁
  if (mod && window.KitchenAuth && window.KitchenAuth.on) {
    window.KitchenAuth.watch(async () => {
      if (window.KitchenAuth.can(mod)) return;
      const m = window.__fridge || window.__dish || window.__meal || window.__prep;
      try { if (m && m.flush) await Promise.race([m.flush(), new Promise((r) => setTimeout(r, 3000))]); } catch (err) { /* 照樣回首頁 */ }
      try { sessionStorage.setItem('kitchenforms-notice', '你的權限已變更，這個系統目前不能使用'); } catch (err) { /* */ }
      location.replace(home);
    });
  }
  const st = document.createElement('style');
  st.textContent = `.kn-home{display:inline-flex;align-items:center;gap:4px;flex:none;margin-right:8px;padding:5px 10px;border-radius:8px;
    background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);color:#fff;text-decoration:none;font-size:14px;font-weight:700;white-space:nowrap}
    .kn-home:hover{background:rgba(255,255,255,.26)} .kn-home span{font-size:17px;line-height:1}
    @media print{.kn-home{display:none!important}}`;
  document.head.appendChild(st);
  const a = document.createElement('a');
  a.className = 'kn-home'; a.href = home; a.title = '回到廚房專用表格系統首頁';
  a.innerHTML = '<span>⌂</span>首頁';
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const m = window.__fridge || window.__dish || window.__meal || window.__prep;
    try { if (m && m.flush) await Promise.race([m.flush(), new Promise((r) => setTimeout(r, 3000))]); } catch (err) { /* 照樣回首頁 */ }
    location.href = home;
  });
  const top = document.querySelector('header.top');
  if (top) top.insertBefore(a, top.firstChild);

  // 首頁「雲端同步」統一設定：冰箱、菜品打開時，用它們自己的連線流程套用首頁存的網址和密碼
  function kToast(msg) {
    let e = document.getElementById('kn-toast');
    if (!e) { e = document.createElement('div'); e.id = 'kn-toast'; e.style.cssText = 'position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:9999;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.3)'; document.body.append(e); }
    e.textContent = msg; e.hidden = false; clearTimeout(kToast.t); kToast.t = setTimeout(() => { e.hidden = true; }, 4000);
  }
  if (mod === 'fridge' || mod === 'dish') {
    let want = null;
    try { want = (JSON.parse(localStorage.getItem('kitchenforms-cloud')) || {})[mod] || null; } catch (e) { want = null; }
    if (want) {
      let n = 0;
      const iv = setInterval(async () => {
        const M = mod === 'fridge' ? window.__fridge : window.__dish;
        if (!M || !M.db || !M.Cloud) { if (++n > 80) clearInterval(iv); return; }
        clearInterval(iv);
        const c = M.db.cloud || {};
        if (want.off) {
          if (c.on) { c.on = false; await M.flush(); M.Cloud.start(); kToast('已依首頁設定停用雲端同步'); }
          return;
        }
        if (c.on && c.url === want.url && c.pw === want.pw) return;
        try {
          kToast('依首頁設定連線 Google 雲端…');
          const r = await M.connectCloud(want.url, want.pw);
          if (r) kToast('✓ 已連線 Google 雲端同步');
        } catch (e) { kToast('雲端連線失敗：' + (e && e.message || e) + '（請到首頁「雲端同步」檢查密碼）'); }
      }, 250);
    }
  }
})();
