/* 加在各系統頁面上的「首頁」按鈕：先把資料存好再回到廚房專用表格系統首頁；也負責擋下沒有權限的人、套用首頁的雲端同步設定 */
(() => {
  'use strict';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const home = '../index.html' + (DESK ? '?desktop=1' : '');
  // 首頁「雲端同步」（或管理者分發）的設定：用各系統自己的連線流程連上
  function applyCloudCfg(md, say) {
    if (md !== 'fridge' && md !== 'dish' && md !== 'sop') return;
    let want = null;
    try { want = (JSON.parse(localStorage.getItem('kitchenforms-cloud')) || {})[md] || null; } catch (e) { want = null; }
    if (!want) return;
    let n = 0;
    const iv = setInterval(async () => {
      if (md === 'sop') {
        const K = window.__kitchen;
        if (!K || !K.db) { if (++n > 120) clearInterval(iv); return; }
        clearInterval(iv);
        if (want.off || K.db.cloud) return; // 已經連線（或停用）就不動
        // SOP 只能從設定頁連線：自動填網址和密碼、按「連線」（新裝置會直接下載雲端資料；兩邊都有資料時會問要怎麼處理）
        const back = location.hash;
        location.hash = '#/settings';
        let m = 0;
        const iv2 = setInterval(() => {
          const u = document.getElementById('cloudUrl'), k = document.getElementById('cloudKey'), b = document.querySelector('[data-act="cloud-connect"]');
          if (!u || !k || !b) { if (++m > 40) clearInterval(iv2); return; }
          clearInterval(iv2);
          u.value = want.url; k.value = want.key;
          say('依管理者設定連線 Google 雲端…');
          b.click();
          let w = 0;
          const iv3 = setInterval(() => {
            if (window.__kitchen.db.cloud) { clearInterval(iv3); say('✓ 已連線 Google 雲端同步'); if (location.hash === '#/settings') location.hash = back && back !== '#/settings' ? back : '#/'; }
            else if (++w > 240) clearInterval(iv3);
          }, 500);
        }, 250);
        return;
      }
      const M = md === 'fridge' ? window.__fridge : window.__dish;
      if (!M || !M.db || !M.Cloud) { if (++n > 80) clearInterval(iv); return; }
      clearInterval(iv);
      const c = M.db.cloud || {};
      if (want.off) {
        if (c.on) { c.on = false; await M.flush(); M.Cloud.start(); say('已依首頁設定停用雲端同步'); }
        return;
      }
      if (c.on && c.url === want.url && c.pw === want.pw) return;
      try {
        say('依首頁設定連線 Google 雲端…');
        const r = await M.connectCloud(want.url, want.pw);
        if (r) say('✓ 已連線 Google 雲端同步');
      } catch (e) { say('雲端連線失敗：' + (e && e.message || e) + '（請到首頁「雲端同步」檢查密碼）'); }
    }, 250);
  }
  // 首頁的背景同步框架（看不到的小框架）：只負責同步，不放按鈕、不跳轉、不連線設定
  let BG = false;
  try { BG = window.top !== window; } catch (e) { BG = true; }
  if (BG) {
    const md = (location.pathname.match(/\/(fridge|prep|dish|meal|sop)\//) || [])[1];
    if (md && window.KitchenAuth && !window.KitchenAuth.can(md)) { location.replace('about:blank'); return; }
    applyCloudCfg(md, () => {}); // 背景也照首頁（管理者分發）的設定連上雲端
    return;
  }
  // 權限：沒有這個系統權限（或還沒登入）就回首頁
  const mod = (location.pathname.match(/\/(fridge|prep|dish|meal|sop)\//) || [])[1];
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
    .kn-home.light{background:#fdf0e1;border-color:#f3d9bd;color:#b45309} .kn-home.light:hover{background:#fbe3c8}
    .kn-home.light{background:#fdf0e1;border-color:#f3d9bd;color:#b45309} .kn-home.light:hover{background:#fbe3c8}
    @media print{.kn-home{display:none!important}}`;
  document.head.appendChild(st);
  const a = document.createElement('a');
  a.className = 'kn-home'; a.href = home; a.title = '回到廚房專用表格系統首頁';
  a.innerHTML = '<span>⌂</span>首頁';
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const m = window.__fridge || window.__dish || window.__meal || window.__prep;
    try { if (m && m.flush) await Promise.race([m.flush(), new Promise((r) => setTimeout(r, 3000))]); } catch (err) { /* 照樣回首頁 */ }
    if (mod === 'sop') { window.dispatchEvent(new Event('pagehide')); await new Promise((r) => setTimeout(r, 400)); } // SOP 收到 pagehide 會把還沒存的資料存好
    location.href = home;
  });
  const top = document.querySelector('header.top, header.topbar');
  if (top) {
    top.insertBefore(a, top.firstChild);
    // 淺色標題列（SOP）：按鈕改用深色字
    const bg = getComputedStyle(top).backgroundColor.match(/\d+/g) || [0, 0, 0];
    if ((+bg[0] * 299 + +bg[1] * 587 + +bg[2] * 114) / 1000 > 160) a.classList.add('light');
  }

  // 首頁「雲端同步」統一設定：冰箱、菜品打開時，用它們自己的連線流程套用首頁存的網址和密碼
  function kToast(msg) {
    let e = document.getElementById('kn-toast');
    if (!e) { e = document.createElement('div'); e.id = 'kn-toast'; e.style.cssText = 'position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:9999;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.3)'; document.body.append(e); }
    e.textContent = msg; e.hidden = false; clearTimeout(kToast.t); kToast.t = setTimeout(() => { e.hidden = true; }, 4000);
  }
  applyCloudCfg(mod, kToast);
})();
