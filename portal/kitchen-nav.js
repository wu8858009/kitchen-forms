/* 加在各系統頁面上的「首頁」按鈕：先把資料存好再回到廚房專用表格系統首頁；也負責擋下沒有權限的人、套用首頁的雲端同步設定 */
(() => {
  'use strict';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const home = '../index.html' + (DESK ? '?desktop=1' : '');
  // 首頁「雲端同步」（或管理者分發）的設定：用各系統自己的連線流程連上
  function applyCloudCfg(md, say) {
    if (md !== 'fridge' && md !== 'dish' && md !== 'sop' && md !== 'equip') return;
    let want = null;
    try { want = (JSON.parse(localStorage.getItem('kitchenforms-cloud')) || {})[md] || null; } catch (e) { want = null; }
    if (!want) return;
    let n = 0;
    const iv = setInterval(async () => {
      if (md === 'equip') {
        const G = window.SG;
        if (!G || !G.sync || !G.db || !G.db.loaded) { if (++n > 120) clearInterval(iv); return; }
        clearInterval(iv);
        const c = G.sync.cfg();
        if (want.off) { if (G.sync.enabled()) { G.sync.disconnect(); say('已依首頁設定停用雲端同步'); } return; }
        if (G.sync.enabled() && c.url === want.url && c.key === want.key) return;
        try { say('依管理者設定連線 Google 雲端…'); await G.sync.connect(want.url, want.key); say('✓ 已連線 Google 雲端同步'); }
        catch (e) { say('雲端連線失敗：' + (e && e.message || e)); }
        return;
      }
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
  // 設備管家：不用它自己的登入畫面，用首頁登入的人直接進去
  // 每個首頁帳號對應一個設備管家帳號（kf_ 開頭、固定 id，所有裝置一樣）；首頁管理者＝設備管家管理員，其他人＝編輯者
  // 桌面版（沒有首頁登入）用「管理者（電腦版）」
  let eqBusy = false;
  function equipAuto() {
    if (eqBusy) return;
    eqBusy = true;
    let hide = document.getElementById('kf-eq-hide');
    if (!hide) { hide = document.createElement('style'); hide.id = 'kf-eq-hide'; hide.textContent = '.auth{visibility:hidden!important}'; document.head.append(hide); }
    const done = () => { eqBusy = false; const x = document.getElementById('kf-eq-hide'); if (x) x.remove(); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      for (let i = 0; i < 150; i++) { // 等設備管家載入完、決定好要顯示哪個畫面
        const G = window.SG;
        if (G && G.auth && G.db && G.db.loaded && (G.auth.current || document.querySelector('.auth'))) break;
        await sleep(200);
      }
      const G = window.SG;
      if (!G || !G.auth || !G.db || !G.db.loaded || G.auth.current) return done();
      // 有分發的雲端設定：先等雲端資料（含帳號）下載完
      let want = null;
      try { want = (JSON.parse(localStorage.getItem('kitchenforms-cloud')) || {}).equip || null; } catch (e) { want = null; }
      if (want && want.url && !want.off) {
        for (let i = 0; i < 60 && !(G.sync.enabled() && G.sync.state !== 'syncing'); i++) await sleep(500);
      }
      const A = window.KitchenAuth, ss = A && A.on ? A.get() : null;
      if (A && A.on && !(ss && ss.me)) return done(); // 首頁還沒登入（照理會被送回首頁）
      const me = ss && ss.me ? { name: ss.me.name, admin: ss.me.role === 'admin' } : { name: '管理者（電腦版）', admin: true, desk: true };
      let h = 2166136261;
      for (const ch of (me.desk ? '#desktop' : me.name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
      const id = 'kf_' + h.toString(36);
      const role = me.admin ? 'admin' : 'editor';
      let u = G.db.get('users', id);
      if (u && u.disabled) return done(); // 設備管家裡被停用的：照原本的登入畫面
      if (!u) {
        const rnd = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
        u = G.db.put('users', { id, username: id, name: me.name, role, salt: rnd(), hash: (rnd() + rnd() + rnd() + rnd()).slice(0, 64), disabled: false });
      } else if (u.role !== role || u.name !== me.name) {
        u = G.db.put('users', Object.assign({}, u, { role, name: me.name }));
      }
      G.auth.saveSession(u, true);
      try { G.db.saveNow(); } catch (e) { /* */ }
      await sleep(400);
      location.reload(); // 設備管家重新開啟時就直接進去了
    })().catch(done);
  }
  // 水電瓦斯抄表：不用它自己的登入畫面，用管理者在首頁「雲端同步」分發的帳號自動登入
  // （雲端回 401 時，build_web.py 加的小程式會發出 kf-energy-401；沒有分發帳號就照原本的登入畫面）
  function energyAuto() {
    let want = null;
    try { want = (JSON.parse(localStorage.getItem('kitchenforms-cloud')) || {}).energy || null; } catch (e) { want = null; }
    if (!want || want.off || !want.user || !want.pw) return;
    const hide = document.createElement('style');
    hide.textContent = '#loginOverlay{visibility:hidden!important} #mLogout{display:none!important}';
    document.head.append(hide);
    const show = () => { hide.textContent = '#mLogout{display:none!important}'; };
    const ov = document.getElementById('loginOverlay');
    if (!ov) return show();
    let tries = 0, busy = false;
    async function login() {
      if (busy) return;
      if (++tries > 2) { show(); return; } // 帳號密碼不對：顯示原本的登入畫面（裡面有錯誤訊息）
      busy = true;
      await new Promise((r) => setTimeout(r, 80)); // 讓它自己先把登入畫面準備好
      const u = document.getElementById('loginUsername'), p = document.getElementById('loginPassword'), f = document.getElementById('loginForm');
      if (!u || !p || !f) { busy = false; show(); return; }
      let last = null; try { last = localStorage.getItem('bitan_last_username_v1'); } catch (e) { /* */ }
      const rem = document.getElementById('loginRemember'); if (rem) rem.checked = !!last;
      u.value = want.user; p.value = want.pw;
      if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true }));
      p.value = '';
      const err = document.getElementById('loginError');
      for (let i = 0; i < 150 && ov.classList.contains('open') && !(err && err.classList.contains('show')); i++) await new Promise((r) => setTimeout(r, 200));
      try { if (last == null) localStorage.removeItem('bitan_last_username_v1'); else localStorage.setItem('bitan_last_username_v1', last); } catch (e) { /* 不動原本記住的帳號 */ }
      busy = false;
      if (ov.classList.contains('open')) { tries = 9; show(); } else tries = 0; // 登入失敗（密碼被改了等）：馬上顯示原本的登入畫面
    }
    window.addEventListener('kf-energy-401', login);
    if (window.__kfE401 && ov.classList.contains('open')) login();
    // 已經登入過的：它自己會關掉登入畫面；20 秒都沒有反應（例如沒網路）就顯示原本的畫面
    setTimeout(() => { if (ov.classList.contains('open') && !busy) show(); }, 20000);
  }
  // 首頁的背景同步框架（看不到的小框架）：只負責同步，不放按鈕、不跳轉、不連線設定
  let BG = false;
  try { BG = window.top !== window; } catch (e) { BG = true; }
  if (BG) {
    const md = (location.pathname.match(/\/(fridge|prep|dish|meal|sop|equip|energy)\//) || [])[1];
    if (md && window.KitchenAuth && !window.KitchenAuth.can(md)) { location.replace('about:blank'); return; }
    applyCloudCfg(md, () => {}); // 背景也照首頁（管理者分發）的設定連上雲端
    if (md === 'equip') equipAuto();
    return;
  }
  // 權限：沒有這個系統權限（或還沒登入）就回首頁
  const mod = (location.pathname.match(/\/(fridge|prep|dish|meal|sop|equip|energy)\//) || [])[1];
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
    .kn-home.kn-float{position:fixed;z-index:9999;left:max(10px,env(safe-area-inset-left));top:calc(env(safe-area-inset-top) + 10px);background:rgba(15,23,42,.72);border-color:rgba(255,255,255,.25);box-shadow:0 4px 14px rgba(0,0,0,.25)}
    @media print{.kn-home{display:none!important}}`;
  document.head.appendChild(st);
  const a = document.createElement('a');
  a.className = 'kn-home'; a.href = home; a.title = '回到廚房專用表格系統首頁';
  a.innerHTML = '<span>⌂</span>首頁';
  async function goHome(e) {
    e.preventDefault();
    await saveAll();
    location.href = home;
  }
  // 各系統把還沒存的資料存好（回首頁、自動更新前都會用）
  async function saveAll() {
    const m = window.__fridge || window.__dish || window.__meal || window.__prep;
    try { if (m && m.flush) await Promise.race([m.flush(), new Promise((r) => setTimeout(r, 3000))]); } catch (err) { /* 照樣回首頁 */ }
    if (mod === 'sop') { window.dispatchEvent(new Event('pagehide')); await new Promise((r) => setTimeout(r, 400)); } // SOP 收到 pagehide 會把還沒存的資料存好
    if (mod === 'equip' && window.SG && SG.db && SG.db.saveNow) { try { SG.db.saveNow(); } catch (err) { /* */ } await new Promise((r) => setTimeout(r, 300)); }
  }
  // 網站有新版：自動存好資料、重新載入
  if (window.KitchenUpdate) window.KitchenUpdate.start(saveAll);
  a.addEventListener('click', goHome);
  // 放進標題列（設備管家的大螢幕是左邊側邊欄）；畫面重畫後（例如登入後）再補上
  function placeHome() {
    const tops = document.querySelectorAll(mod === 'energy' ? '.topbar-inner' : 'header.top, header.topbar, aside.side');
    // 設備管家登入畫面沒有標題列：先放一個浮在左上角的按鈕
    if ((mod === 'equip' || mod === 'energy') && !tops.length) {
      if (!a.isConnected) { a.classList.add('kn-float'); document.body.append(a); }
      return;
    }
    if (a.classList.contains('kn-float')) { a.classList.remove('kn-float'); a.remove(); }
    for (const top of tops) {
      if (top.querySelector(':scope > .kn-home')) continue;
      const b = a.isConnected ? a.cloneNode(true) : a; // 第二個位置（側邊欄）用複製的按鈕
      if (b !== a) b.addEventListener('click', goHome);
      top.insertBefore(b, top.firstChild);
      // 淺色標題列（SOP、設備管家）：按鈕改用深色字
      const bg = getComputedStyle(top).backgroundColor.match(/[\d.]+/g) || [0, 0, 0, 1];
      const alpha = bg.length > 3 ? +bg[3] : 1;
      const lum = alpha < 0.3 ? (matchMedia('(prefers-color-scheme: dark)').matches ? 0 : 255) : (+bg[0] * 299 + +bg[1] * 587 + +bg[2] * 114) / 1000;
      if (lum > 160 && !document.documentElement.classList.contains('kf-dark')) b.classList.add('light'); // 統一暗色主題時一律用深色按鈕
      if (top.matches('aside.side')) b.style.margin = '0 0 10px';
    }
  }
  placeHome();
  if (mod === 'equip' || mod === 'energy') {
    if (mod === 'equip') equipAuto();
    if (mod === 'energy') energyAuto();
    let qd = 0;
    new MutationObserver(() => { if (!qd) qd = requestAnimationFrame(() => { qd = 0; placeHome(); if (mod === 'equip' && document.querySelector('.auth') && window.SG && SG.auth && !SG.auth.current) equipAuto(); }); }).observe(document.body, { childList: true, subtree: true });
  }

  // 首頁「雲端同步」統一設定：冰箱、菜品打開時，用它們自己的連線流程套用首頁存的網址和密碼
  function kToast(msg) {
    let e = document.getElementById('kn-toast');
    if (!e) { e = document.createElement('div'); e.id = 'kn-toast'; e.style.cssText = 'position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:9999;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.3)'; document.body.append(e); }
    e.textContent = msg; e.hidden = false; clearTimeout(kToast.t); kToast.t = setTimeout(() => { e.hidden = true; }, 4000);
  }
  applyCloudCfg(mod, kToast);
})();
