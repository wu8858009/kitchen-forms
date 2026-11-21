/* 菜品銷售紀錄 — 每天賣了哪些菜、各幾份；每月合計（PWA 與桌面版共用） */
(() => {
  'use strict';
  const VERSION = '2.4.0';
  const DESK = new URLSearchParams(location.search).has('desktop');

  // ------------------------------------------------------------------ 工具
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const WD = '日一二三四五六';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => ymd(new Date());
  const validYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(pd(s)) === s;
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const fmt = (n) => Math.round(n).toLocaleString('zh-TW');

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  function setStatus(s, bad) { const e = $('#status'); e.textContent = s; e.classList.toggle('bad', !!bad); }

  // ------------------------------------------------------------------ 儲存（瀏覽器：IndexedDB；桌面版：%APPDATA% 檔案）
  const IDB = {
    open() {
      return this.p || (this.p = new Promise((res, rej) => {
        const r = indexedDB.open('dishsales', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      }));
    },
    async get(k) {
      const d = await this.open();
      return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    },
    async set(k, v) {
      const d = await this.open();
      return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    },
  };
  function api() {
    return new Promise((res) => {
      const ok = () => window.pywebview && window.pywebview.api && window.pywebview.api.load;
      if (ok()) return res(window.pywebview.api);
      const iv = setInterval(() => { if (ok()) { clearInterval(iv); res(window.pywebview.api); } }, 50);
    });
  }
  async function loadRaw() {
    if (DESK) return (await api()).load();
    return IDB.get('db');
  }

  let db;
  let saveTimer;
  function save() {
    setStatus('儲存中…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400);
    Cloud.schedule();
  }
  async function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    const text = JSON.stringify(db);
    try {
      if (DESK) { const r = await (await api()).save(text); if (r !== true) throw new Error(r); } else await IDB.set('db', text);
      setStatus('已儲存');
    } catch (e) {
      setStatus('儲存失敗', true);
      alert('儲存失敗：' + (e && e.message || e));
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });
  window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

  // ------------------------------------------------------------------ 資料
  const SAMPLE = [
    ['飯類', '排骨飯', 100, 45], ['飯類', '雞腿飯', 110, 52], ['飯類', '滷肉飯', 40, 14], ['飯類', '控肉飯', 85, 38],
    ['麵類', '牛肉麵', 160, 78], ['麵類', '餛飩麵', 75, 30], ['麵類', '麻醬麵', 55, 18],
    ['小菜', '燙青菜', 40, 14], ['小菜', '滷蛋', 15, 5], ['小菜', '皮蛋豆腐', 40, 15], ['小菜', '海帶豆干', 35, 12],
    ['湯品', '貢丸湯', 35, 12], ['湯品', '味噌湯', 30, 8],
    ['飲料', '紅茶', 25, 6], ['飲料', '冬瓜茶', 25, 6],
  ];
  // 每筆資料都有 at（最後修改時間，毫秒）供雲端同步比較新舊；份數改成 0 時保留 {q:0} 當作刪除記號
  const blank = () => ({ ver: 2, shop: '', shopAt: 0, dishes: [], sales: {}, createdAt: Date.now(), seedAt: 0, me: '', lock: { days: 0, pin: '', at: 0 } });
  function seed() {
    const d = blank(), now = Date.now();
    d.seedAt = now;
    d.dishes = SAMPLE.map(([cat, name, price, cost], i) => ({ id: uid(), name, cat, price, cost, off: false, deleted: false, ord: i + 1, at: now }));
    return d;
  }
  function normDish(x, i) {
    return {
      id: String(x.id), name: String(x.name ?? '').trim(), cat: String(x.cat || '未分類').trim() || '未分類',
      price: Math.max(0, num(x.price)), cost: Math.max(0, num(x.cost)), off: !!x.off, deleted: !!x.deleted,
      ord: num(x.ord) || i + 1, at: num(x.at) || 1,
    };
  }
  function norm(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.dishes)) throw new Error('不是菜品銷售紀錄的資料');
    d.ver = 2;
    d.shop = String(d.shop || '');
    d.shopAt = num(d.shopAt);
    d.seedAt = num(d.seedAt);
    d.dishes = d.dishes.filter((x) => x && x.id).map(normDish);
    sortDishes(d);
    d.sales = d.sales && typeof d.sales === 'object' ? d.sales : {};
    for (const [k, v] of Object.entries(d.sales)) {
      if (!validYmd(k) || !v || typeof v !== 'object') { delete d.sales[k]; continue; }
      v.items = v.items && typeof v.items === 'object' ? v.items : {};
      for (const [id, e] of Object.entries(v.items)) {
        if (!e) { delete v.items[id]; continue; }
        v.items[id] = entry(Math.max(0, Math.floor(num(e.q))), num(e.p), num(e.c), num(e.at) || 1, e.so, e.by);
      }
      v.note = String(v.note || '');
      v.noteAt = num(v.noteAt) || (v.note ? 1 : 0);
    }
    d.me = String(d.me || '').slice(0, 40);
    d.lock = normLock(d.lock);
    if (d.cloud && typeof d.cloud === 'object') {
      const c = d.cloud;
      d.cloud = { url: String(c.url || ''), pw: String(c.pw || ''), rev: num(c.rev), pushedAt: num(c.pushedAt), on: !!c.on, lastOk: num(c.lastOk), sheet: /^https:\/\/docs\.google\.com\//.test(c.sheet || '') ? String(c.sheet) : '' };
    } else delete d.cloud;
    return d;
  }
  function sortDishes(d) { d.dishes.sort((a, b) => a.ord - b.ord); }
  const dishById = (id) => db.dishes.find((x) => x.id === id);
  const liveDishes = () => db.dishes.filter((x) => !x.deleted);
  const now = () => Date.now();
  function groupByCat(list) {
    const m = new Map();
    for (const d of list) { if (!m.has(d.cat)) m.set(d.cat, []); m.get(d.cat).push(d); }
    return m;
  }
  function dayOf(s, create) {
    let v = db.sales[s];
    if (!v && create) v = db.sales[s] = { items: {}, note: '', noteAt: 0 };
    return v;
  }
  const qOf = (v, id) => (v && v.items[id] ? v.items[id].q : 0);
  function dayTotals(v) {
    let rev = 0, cost = 0, qty = 0;
    if (v) for (const e of Object.values(v.items)) { rev += e.q * e.p; cost += e.q * e.c; qty += e.q; }
    return { rev, cost, qty, profit: rev - cost };
  }
  function cleanupDay(s) {
    const v = db.sales[s];
    if (v && !Object.keys(v.items).length && !v.note.trim() && !v.noteAt) delete db.sales[s];
  }
  const hasSales = (id) => Object.values(db.sales).some((v) => qOf(v, id) > 0);
  const dayHasData = (v) => !!v && (Object.values(v.items).some((e) => e.q > 0) || !!v.note.trim());

  // 份數紀錄 {q, p, c, at, so?: 賣完時間 HH:MM, by?: 最後修改的人}
  const okHm = (t) => (/^\d{1,2}:\d{2}$/.test(String(t || '').trim()) ? String(t).trim().padStart(5, '0') : '');
  function entry(q, p, c, at, so, by) {
    const o = { q, p, c, at };
    const h = okHm(so), w = String(by || '').trim().slice(0, 40);
    if (h) o.so = h;
    if (w) o.by = w;
    return o;
  }
  // 誰在用：廚房專用表格系統登入的人，或設定頁填的「這台裝置的使用者」
  function who() {
    try { const a = window.KitchenAuth && window.KitchenAuth.get(); if (a && a.me && a.me.name) return String(a.me.name); } catch (e) { /* 沒有廚房登入 */ }
    return db.me || '';
  }
  function stamp(e) { e.at = now(); const w = who(); if (w) e.by = w; else delete e.by; }
  const hmOf = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const whenOf = (t) => { const d = new Date(t); return (ymd(d) === today() ? '' : `${d.getMonth() + 1}/${d.getDate()} `) + hmOf(t); };

  // 鎖定過去日期：db.lock {days: 只能改最近幾天（0 不鎖）, pin: 主管密碼雜湊, at}
  function normLock(x) {
    return x && typeof x === 'object' ? { days: Math.max(0, Math.floor(num(x.days))), pin: String(x.pin || ''), at: num(x.at) } : { days: 0, pin: '', at: 0 };
  }
  let unlockUntil = 0;
  const lockOn = () => !!(db.lock && db.lock.days > 0 && db.lock.pin);
  const kitchenAdmin = () => { try { return !!(window.KitchenAuth && window.KitchenAuth.isAdmin()); } catch (e) { return false; } };
  const unlocked = () => !lockOn() || kitchenAdmin() || Date.now() < unlockUntil;
  const isLocked = (date) => lockOn() && date <= addD(today(), -db.lock.days) && !unlocked();
  const lockText = (n) => (n === 1 ? '只能修改今天' : `只能修改最近 ${n} 天`);
  async function pinHash(pin) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dishlock:' + pin));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // 需要主管密碼的動作：沒鎖定、已解鎖或廚房管理者直接通過；解鎖 15 分鐘
  async function askPin(msg) {
    if (unlocked()) return true;
    const p = await askText(msg || '請輸入主管密碼', 'password', '', '輸入後 15 分鐘內不用再輸入');
    if (p == null) return false;
    if (await pinHash(p) === db.lock.pin) { unlockUntil = Date.now() + 15 * 60000; return true; }
    alert('主管密碼不對');
    return false;
  }

  // ------------------------------------------------------------------ 路由
  // 舊網址 #/menu → 設定、#/report → 每月合計（首頁或書籤的舊連結仍可用）
  const VIEWS = ['day', 'month', 'plan', 'insight', 'settings'];
  const cur = { view: '', date: today(), month: today().slice(0, 7) };
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    let v = h[0] === 'menu' ? 'settings' : h[0] === 'report' ? 'month' : h[0];
    if (!VIEWS.includes(v)) v = 'day';
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
    const el = $('#app');
    el.onclick = el.oninput = el.onchange = el.onkeydown = el.onfocusin = null;
    if (cur.view !== v) window.scrollTo(0, 0);
    cur.view = v;
    if (v === 'month') viewMonth(el, /^\d{4}-\d{2}$/.test(h[1] || '') ? h[1] : cur.month);
    else if (v === 'settings') viewSettings(el);
    else if (v === 'insight') viewInsight(el);
    else if (v === 'plan') viewPlan(el, validYmd(h[1] || '') ? h[1] : addD(today(), 1));
    else viewDay(el, validYmd(h[1] || '') ? h[1] : today());
  }
  function renderShop() {
    $('#shop').textContent = db.shop || '菜品銷售紀錄';
    document.title = (db.shop ? db.shop + ' · ' : '') + '菜品銷售紀錄';
  }
  const kpi = (l, v, s = '', cls = '', ic = '') => `<div class="kpi ${cls}"><div class="l">${ic ? `<i class="ki" aria-hidden="true">${ic}</i>` : ''}${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const catList = () => [...new Set(liveDishes().map((d) => d.cat))];

  // 新增菜品（名稱＋分類）；每日頁與設定頁共用
  function askDish() {
    return new Promise((res) => {
      const cats = catList();
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<form class="dlg" role="dialog" aria-modal="true"><h3>新增菜品</h3>
        <label class="fl">菜名<input name="n" required maxlength="40" autocomplete="off" placeholder="例如：排骨飯"></label>
        <label class="fl">分類<input name="c" list="dlgcats" maxlength="20" autocomplete="off" value="${esc(cats[cats.length - 1] || '')}" placeholder="例如：飯類"></label>
        <datalist id="dlgcats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <div class="btns row2"><button type="button" class="btn" data-k="x">取消</button><button class="btn primary">新增</button></div></form>`;
      const done = (v) => { m.remove(); res(v); };
      m.onclick = (e) => { if (e.target === m || e.target.closest('[data-k=x]')) done(null); };
      m.onkeydown = (e) => { if (e.key === 'Escape') done(null); };
      $('form', m).onsubmit = (e) => {
        e.preventDefault();
        const f = e.target, name = f.n.value.trim();
        if (!name) return;
        if (liveDishes().some((d) => d.name === name) && !confirm(`已經有「${name}」，還是要再新增一道同名的菜？`)) return;
        done({ name, cat: f.c.value.trim() || '未分類' });
      };
      document.body.append(m);
      $('input', m).focus();
    });
  }
  function dialog(html, onSubmit) {
    return new Promise((res) => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<form class="dlg" role="dialog" aria-modal="true">${html}</form>`;
      const done = (v) => { m.remove(); res(v); };
      m.onclick = (e) => {
        if (e.target === m || e.target.closest('[data-k=x]')) done(null);
        const k = e.target.closest('[data-k]'); if (k && k.dataset.k !== 'x') done({ k: k.dataset.k });
      };
      m.onkeydown = (e) => { if (e.key === 'Escape') done(null); };
      $('form', m).onsubmit = (e) => { e.preventDefault(); done(onSubmit(e.target)); };
      document.body.append(m);
      const f = $('input', m); if (f) { f.focus(); if (f.select) f.select(); }
    });
  }
  function askText(title, type = 'text', value = '', hint = '') {
    return dialog(`<h3>${esc(title)}</h3>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
      <label class="fl"><input name="v" type="${type}" value="${esc(value)}" autocomplete="off"${type === 'password' ? ' inputmode="numeric"' : ''}></label>
      <div class="btns row2"><button type="button" class="btn" data-k="x">取消</button><button class="btn primary">確定</button></div>`, (f) => f.v.value);
  }
  // 回傳 'HH:MM'（賣完）、''（清除）或 null（取消）
  async function askSoldOut(name, curSo, def) {
    const r = await dialog(`<h3>⏱ ${esc(name)} 賣完時間</h3><p class="muted">記下幾點賣完，備料預估會把這天當作「還能再多賣」。</p>
      <label class="fl">幾點賣完<input name="t" type="time" value="${curSo || def}" required></label>
      <div class="btns row2">${curSo ? '<button type="button" class="btn danger" data-k="clr">沒賣完</button>' : ''}<button type="button" class="btn" data-k="x">取消</button><button class="btn primary">儲存</button></div>`, (f) => okHm(f.t.value));
    if (r == null) return null;
    return typeof r === 'object' ? '' : r;
  }
  function addDish(name, cat) {
    const ord = Math.max(0, ...db.dishes.filter((x) => x.cat === cat && !x.deleted).map((x) => x.ord));
    const d = { id: uid(), name, cat, price: 0, cost: 0, off: false, deleted: false, ord: ord ? ord + 0.001 : Math.max(0, ...db.dishes.map((x) => x.ord)) + 1, at: now() };
    db.dishes.push(d); sortDishes(db);
    // 重新編號，避免小數越來越多
    let i = 0; for (const x of db.dishes) { i++; if (x.ord !== i) { x.ord = i; x.at = d.at; } }
    save();
    return d;
  }

  // ------------------------------------------------------------------ 每日紀錄
  let dayFilter = '';
  function viewDay(el, date) {
    cur.date = date; cur.month = date.slice(0, 7);
    const v = dayOf(date);
    const list = liveDishes().filter((d) => !d.off || qOf(v, d.id) > 0);
    const extra = v ? Object.keys(v.items).filter((id) => qOf(v, id) > 0 && !list.some((d) => d.id === id)).map(dishById).filter(Boolean) : [];
    const groups = groupByCat([...list, ...extra]);
    const wd = pd(date).getDay();
    const isToday = date === today();
    const ro = isLocked(date);
    const dis = ro ? ' disabled' : '';
    const log = v ? Object.entries(v.items).filter(([, e]) => e.at > 1000).sort((a, b) => b[1].at - a[1].at) : [];
    el.innerHTML = `
      <div class="page-head">
        <div class="datebar">
          <button class="btn icon" data-act="prev" title="前一天" aria-label="前一天">◀</button>
          <input type="date" id="date" value="${date}" aria-label="日期">
          <span class="wd${wd % 6 === 0 ? ' we' : ''}">週${WD[wd]}${isToday ? '・今天' : ''}</span>
          <button class="btn icon" data-act="next" title="後一天" aria-label="後一天">▶</button>
          ${isToday ? '' : '<button class="btn" data-act="today">回今天</button>'}
        </div>
        <input id="q" class="search" type="search" placeholder="🔍 搜尋菜品" value="${esc(dayFilter)}">
      </div>
      ${ro ? `<div class="lockbar"><span>🔒 ${lockText(db.lock.days)}的紀錄，這天已鎖定，只能查看。</span><button class="btn" data-act="unlock">輸入主管密碼解鎖</button></div>` : ''}
      <div class="kpis k3" id="daykpi"></div>
      <div class="day-groups${ro ? ' ro' : ''}">${[...groups].map(([cat, ds], gi) => `
        <section class="group" style="--gc:var(--c${gi % 6 + 1})"><h3><i class="dot"></i>${esc(cat)}<span class="gn">${ds.length} 道</span><span class="gq" data-gq></span></h3>
        ${ds.map((x) => {
          const q = qOf(v, x.id), en = v && v.items[x.id];
          return `<div class="row${q ? ' has' : ''}" data-id="${x.id}" data-name="${esc(x.name.toLowerCase())}">
            <div class="nm"${en && en.at > 1000 ? ` title="最後修改：${esc(en.by || '未填名字')} ${whenOf(en.at)}"` : ''}>${esc(x.name || '未命名')}${x.deleted ? '<small class="tag">已刪除</small>' : ''}${x.off ? '<small class="tag">停售</small>' : ''}<small class="so" data-so${q && en.so ? '' : ' hidden'}>⏱ ${q && en.so ? en.so : ''} 賣完</small></div>
            <button class="btn icon sob${q && en.so ? ' on' : ''}" data-act="so" tabindex="-1" title="記錄賣完時間" aria-label="${esc(x.name)} 賣完時間"${q && !ro ? '' : ' disabled'}>⏱</button>
            <div class="qty"><button class="btn icon" data-act="dec" tabindex="-1" aria-label="減一"${dis}>−</button><input type="number" min="0" step="1" inputmode="numeric" value="${q || ''}" placeholder="0" data-q aria-label="${esc(x.name)} 份數"${dis}><button class="btn icon" data-act="inc" tabindex="-1" aria-label="加一"${dis}>＋</button></div></div>`;
        }).join('')}
        </section>`).join('') || '<p class="empty">還沒有菜品，按下方「＋ 新增菜品」開始。</p>'}
      </div>
      <p class="empty" id="nomatch" hidden>找不到符合的菜品</p>
      <label class="note">備註<textarea id="note" rows="2" placeholder="例如：下雨、包場、店休…"${dis}>${esc(v ? v.note : '')}</textarea></label>
      <div class="day-tools">
        <button class="btn" data-act="add">＋ 新增菜品</button>
        <span class="sp"></span>
        ${ro ? '' : `<button class="btn" data-act="copy" title="把最近一個有紀錄的日子的份數帶入本日（只填本日沒輸入的菜）">帶入上次份數</button>
        <button class="btn danger" data-act="clearday">清空本日</button>`}
      </div>
      ${log.length ? `<details class="card daylog"><summary>📝 本日修改紀錄 <span class="muted sm">每道菜最後一次是誰、幾點改的</span></summary>
        <ul>${log.map(([id, e]) => { const d = dishById(id); return `<li><time>${whenOf(e.at)}</time><b>${esc(e.by || '未填名字')}</b><span>${esc(d ? d.name : '（已移除的菜）')}</span><span class="r">${e.q ? fmt(e.q) + ' 份' : '清除'}${e.q && e.so ? `・${e.so} 賣完` : ''}</span></li>`; }).join('')}</ul></details>` : ''}`;
    const go = (s) => { location.hash = '#/day/' + s; };
    applyFilter(); renderDayKpi();
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (ro && !['prev', 'next', 'today', 'add', 'unlock'].includes(a)) return;
      if (a === 'prev') go(addD(date, -1));
      else if (a === 'next') go(addD(date, 1));
      else if (a === 'today') go(today());
      else if (a === 'unlock') { if (await askPin('解鎖過去的紀錄')) { route(); toast('已解鎖 15 分鐘'); } }
      else if (a === 'so') {
        const row = b.closest('.row'), x = dishById(row.dataset.id), en = db.sales[date] && db.sales[date].items[row.dataset.id];
        if (!en || !en.q) return;
        const r = await askSoldOut(x ? x.name : '', en.so || '', date === today() ? hmOf(Date.now()) : '');
        if (r == null || r === (en.so || '')) return;
        if (r) en.so = r; else delete en.so;
        stamp(en); save();
        b.classList.toggle('on', !!r);
        const tg = $('[data-so]', row); tg.hidden = !r; tg.textContent = `⏱ ${r} 賣完`;
        toast(r ? `已記錄 ${x ? x.name : ''} ${r} 賣完` : '已清除賣完時間');
      } else if (a === 'inc' || a === 'dec') {
        const row = b.closest('.row'); const inp = $('[data-q]', row);
        const q = Math.max(0, (parseInt(inp.value, 10) || 0) + (a === 'inc' ? 1 : -1));
        inp.value = q || '';
        setQty(date, row.dataset.id, q, row);
      } else if (a === 'add') {
        const r = await askDish(); if (!r) return;
        const d = addDish(r.name, r.cat);
        dayFilter = ''; route();
        const inp = $(`.row[data-id="${d.id}"] [data-q]`, el);
        if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
        toast(`已新增「${d.name}」`);
      } else if (a === 'clearday') {
        const day = db.sales[date];
        if (!dayHasData(day)) return toast('本日沒有資料');
        if (confirm(`確定清空 ${date} 的所有份數與備註？`)) {
          const t = now();
          for (const x of Object.values(day.items)) if (x.q) { x.q = 0; delete x.so; stamp(x); x.at = t; }
          if (day.note) { day.note = ''; day.noteAt = t; }
          save(); route();
        }
      } else if (a === 'copy') {
        const prev = Object.keys(db.sales).filter((k) => k < date && Object.values(db.sales[k].items).some((x) => x.q > 0)).sort().pop();
        if (!prev) return toast('之前沒有銷售紀錄');
        const day = dayOf(date, true); let n = 0; const t = now();
        for (const [id, x] of Object.entries(db.sales[prev].items)) {
          const d = dishById(id);
          if (!x.q || !d || d.deleted || d.off || qOf(day, id) > 0) continue;
          day.items[id] = entry(x.q, d.price, d.cost, t, '', who()); n++;
        }
        cleanupDay(date); save(); route();
        toast(n ? `已帶入 ${prev} 的 ${n} 道菜份數，請再修正` : '沒有可帶入的菜品');
      }
    };
    el.oninput = (e) => {
      const t = e.target;
      if (t.matches('[data-q]')) {
        const row = t.closest('.row');
        setQty(date, row.dataset.id, Math.max(0, Math.floor(num(t.value))), row);
      } else if (t.id === 'q') { dayFilter = t.value; applyFilter(); }
      else if (t.id === 'note') { const d = dayOf(date, true); d.note = t.value; d.noteAt = now(); save(); }
    };
    el.onchange = (e) => { if (e.target.id === 'date' && validYmd(e.target.value)) go(e.target.value); };
    el.onfocusin = (e) => { if (e.target.matches('[data-q]')) setTimeout(() => e.target.select(), 0); };
    el.onkeydown = (e) => {
      if (!e.target.matches('[data-q]')) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = $$('[data-q]', el).filter((i) => i.offsetParent);
        const i = all.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1);
        if (all[i]) all[i].focus();
      }
    };
  }
  function setQty(date, id, q, row) {
    const x = dishById(id);
    const day = dayOf(date, q > 0);
    const e = day && day.items[id];
    if (e && e.q === q) return;
    if (q > 0) {
      if (e && e.q > 0) { e.q = q; stamp(e); }
      else day.items[id] = entry(q, x.price, x.cost, now(), '', who()); // p/c 保留給舊版與試算表的欄位
    } else if (e) { e.q = 0; delete e.so; stamp(e); }
    save();
    row.classList.toggle('has', q > 0);
    const sb = $('[data-act=so]', row);
    if (sb) { sb.disabled = q <= 0; if (q <= 0) { sb.classList.remove('on'); $('[data-so]', row).hidden = true; } }
    renderDayKpi();
  }
  function renderDayKpi() {
    const v = db.sales[cur.date];
    const t = dayTotals(v);
    const kinds = v ? Object.values(v.items).filter((x) => x.q > 0).length : 0;
    const m = monthAgg(cur.date.slice(0, 7));
    $('#daykpi').innerHTML = kpi('本日總份數', fmt(t.qty) + '<small> 份</small>', '', 'main', '🍽') + kpi('有賣的菜', kinds + '<small> 道</small>', '', '', '🥢')
      + kpi(`${+cur.date.slice(5, 7)} 月累計`, fmt(m.qty) + '<small> 份</small>', `<a href="#/month/${cur.date.slice(0, 7)}">看每月合計 ›</a>`, '', '📅');
    $$('.day-groups .group').forEach((g) => {
      let n = 0; $$('.row', g).forEach((r) => { n += qOf(v, r.dataset.id); });
      $('[data-gq]', g).textContent = n ? n + ' 份' : '';
    });
  }
  function applyFilter() {
    const q = dayFilter.trim().toLowerCase();
    let any = false;
    $$('.day-groups .group').forEach((g) => {
      let n = 0;
      $$('.row', g).forEach((r) => { const ok = !q || r.dataset.name.includes(q); r.hidden = !ok; if (ok) n++; });
      g.hidden = !n; if (n) any = true;
    });
    const nm = $('#nomatch'); if (nm) nm.hidden = any || !q;
  }

  // ------------------------------------------------------------------ 每月合計
  const addM = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const daysIn = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
  function monthAgg(m, upto = 31) {
    const r = { m, qty: 0, days: 0, byDay: new Map(), byDish: new Map() };
    for (const [k, v] of Object.entries(db.sales)) {
      if (!k.startsWith(m + '-') || +k.slice(8) > upto) continue;
      let q = 0;
      for (const [id, e] of Object.entries(v.items)) {
        if (!e.q) continue;
        q += e.q; r.byDish.set(id, (r.byDish.get(id) || 0) + e.q);
      }
      if (q || v.note.trim()) r.byDay.set(k, { qty: q, note: v.note });
      if (q) r.days++;
      r.qty += q;
    }
    return r;
  }
  function monthData(m = cur.month) {
    const a = monthAgg(m);
    const rows = [...a.byDish].map(([id, qty]) => ({ d: dishById(id) || { id, name: '（已移除的菜）', cat: '', deleted: true }, qty }))
      .sort((x, y) => y.qty - x.qty || x.d.name.localeCompare(y.d.name, 'zh-Hant'));
    // 同期比較：本月還沒過完時，上月、去年同月也只算到同一天
    const t = today(), upto = m === t.slice(0, 7) ? +t.slice(8) : 0;
    const prev = monthAgg(addM(m, -1), upto || 31), year = monthAgg(addM(m, -12), upto || 31);
    return { ...a, rows, n: daysIn(m), cmp: { upto, prev, year } };
  }
  let cmpBase = 'prev';
  const pctCh = (a, b) => (b ? (a / b - 1) : null);
  function dlt(a, b, plain) {
    const c = pctCh(a, b);
    if (c == null) return plain ? '—' : (a ? '<span class="dl new">新</span>' : '<span class="muted">—</span>');
    const n = Math.round(c * 100);
    const t = n === 0 ? '持平' : (n > 0 ? '↑' : '↓') + Math.abs(n) + '%';
    return plain ? t : `<span class="dl ${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${t}</span>`;
  }
  const cmpName = (R, base) => (base === 'year' ? `去年 ${+R.m.slice(5, 7)} 月` : '上月') + (R.cmp.upto ? '同期' : '');
  function viewMonth(el, m) {
    cur.month = m;
    const R = monthData(m);
    const t = today();
    const first = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
    const lead = (first.getDay() + 6) % 7; // 週一開頭
    const qs = [...R.byDay.values()].map((x) => x.qty).filter(Boolean);
    const maxQ = Math.max(1, ...qs), minQ = Math.min(maxQ, ...qs);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="cd blank"></span>';
    for (let d = 1; d <= R.n; d++) {
      const k = `${m}-${pad(d)}`, x = R.byDay.get(k), wd = (lead + d - 1) % 7;
      const lvl = x && x.qty ? (maxQ > minQ ? 1 + Math.min(3, Math.floor((x.qty - minQ) / (maxQ - minQ) * 4)) : 3) : 0;
      cells += `<a class="cd${x && x.qty ? ' has l' + lvl : ''}${k === t ? ' today' : ''}${wd >= 5 ? ' we' : ''}${k > t ? ' fut' : ''}" href="#/day/${k}" title="${k}${x && x.note ? '\n備註：' + esc(x.note) : ''}">
        <b>${d}</b>${x && x.qty ? `<span>${fmt(x.qty)}<small> 份</small></span>` : '<span class="z">—</span>'}${x && x.note.trim() ? '<i class="nt" aria-label="有備註">✎</i>' : ''}</a>`;
    }
    const top = R.rows[0];
    const maxD = Math.max(1, ...R.rows.map((r) => r.qty));
    const isCur = m === t.slice(0, 7);
    const C = R.cmp[cmpBase], cn = cmpName(R, cmpBase);
    const avgOf = (x) => (x.days ? x.qty / x.days : 0);
    el.innerHTML = `
      <div class="page-head">
        <div class="datebar">
          <button class="btn icon" data-act="prev" title="上個月" aria-label="上個月">◀</button>
          <input type="month" id="month" value="${m}" aria-label="月份">
          <button class="btn icon" data-act="next" title="下個月" aria-label="下個月">▶</button>
          ${isCur ? '' : '<button class="btn" data-act="cur">回本月</button>'}
        </div>
        <span class="sp"></span>
        <button class="btn" data-act="pdf" ${R.qty ? '' : 'disabled'}>🖨 月報 PDF</button>
        <button class="btn primary" data-act="xlsx" ${R.qty ? '' : 'disabled'}>⬇ 匯出本月 Excel</button>
      </div>
      <div class="kpis">
        ${kpi(`${+m.slice(5, 7)} 月總份數`, fmt(R.qty) + '<small> 份</small>', `${dlt(R.qty, C.qty)} 比${cn}（${fmt(C.qty)} 份）`, 'main', '🍽')}
        ${kpi('有記錄天數', R.days + '<small> 天</small>', `${cn} ${C.days} 天`, '', '🗓')}
        ${kpi('平均每天', R.days ? fmt(R.qty / R.days) + '<small> 份</small>' : '—', R.days ? `${dlt(avgOf(R), avgOf(C))} 比${cn}` : '', '', '📈')}
        ${kpi('賣最多', top ? esc(top.d.name) : '—', top ? fmt(top.qty) + ' 份' : '', 'best', '🏆')}
      </div>
      <section class="card">
        <div class="card-head"><h3>📅 ${m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月 每日份數</h3><span class="muted sm">點日期可查看或修改當天紀錄</span></div>
        <div class="cal"><div class="cal-h">${['一', '二', '三', '四', '五', '六', '日'].map((x, i) => `<span${i >= 5 ? ' class="we"' : ''}>${x}</span>`).join('')}</div>
          <div class="cal-g">${cells}</div></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>🏆 本月各菜品合計</h3><span class="muted sm">${R.rows.length} 道菜有賣${R.cmp.upto ? `・比較都只算 1～${R.cmp.upto} 日` : ''}</span><span class="sp"></span>
          <div class="seg" role="group"><span class="seg-l">比較</span><button data-act="cmp" data-v="prev" class="${cmpBase === 'prev' ? 'on' : ''}">上個月</button><button data-act="cmp" data-v="year" class="${cmpBase === 'year' ? 'on' : ''}">去年同月</button></div></div>
        ${R.rows.length ? `<div class="tbl-wrap"><table class="rank"><thead><tr><th class="c">#</th><th>菜品</th><th>分類</th><th class="r">份數</th><th class="r">${cn}</th><th class="r">增減</th><th class="share">佔比</th></tr></thead>
        <tbody>${R.rows.map((r, i) => `<tr><td class="c"><span class="rk${i < 3 ? ' r' + (i + 1) : ''}">${i + 1}</span></td><td class="b">${esc(r.d.name || '未命名')}${r.d.deleted ? '<small class="tag">已刪除</small>' : ''}</td><td>${r.d.cat ? `<span class="chip">${esc(r.d.cat)}</span>` : ''}</td><td class="r b">${fmt(r.qty)}</td><td class="r muted">${C.byDish.get(r.d.id) ? fmt(C.byDish.get(r.d.id)) : '—'}</td><td class="r">${dlt(r.qty, C.byDish.get(r.d.id) || 0)}</td>
          <td class="share"><span class="track"><i style="width:${(r.qty / maxD * 100).toFixed(1)}%"></i></span><small>${(r.qty / R.qty * 100).toFixed(1)}%</small></td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>合計</td><td></td><td class="r">${fmt(R.qty)}</td><td class="r">${fmt(C.qty)}</td><td class="r">${dlt(R.qty, C.qty)}</td><td class="share"></td></tr></tfoot></table></div>`
        : `<p class="empty">這個月還沒有銷售紀錄。</p>`}
      </section>`;
    const go = (x) => { location.hash = '#/month/' + x; };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'pdf') return runPdf(b, () => buildMonthPdf(R));
      if (a === 'cmp') { cmpBase = b.dataset.v; const y = window.scrollY; viewMonth(el, m); window.scrollTo(0, y); return; }
      if (a === 'prev') go(addM(m, -1));
      else if (a === 'next') go(addM(m, 1));
      else if (a === 'cur') go(t.slice(0, 7));
      else if (a === 'xlsx') exportXlsx(R);
    };
    el.onchange = (e) => { if (e.target.id === 'month' && /^\d{4}-\d{2}$/.test(e.target.value)) go(e.target.value); };
  }

  // ------------------------------------------------------------------ 備料預估與星期分析
  const WDM = [1, 2, 3, 4, 5, 6, 0]; // 週一開頭
  const wdi = (k) => (pd(k).getDay() + 6) % 7; // 0=週一 … 6=週日
  const dayQty = (v) => (v ? Object.values(v.items).reduce((s, e) => s + e.q, 0) : 0);
  const salesDays = () => Object.keys(db.sales).filter((k) => dayQty(db.sales[k]) > 0).sort();
  const plan = { n: 4, buf: 10, weeks: 8, auto: false };
  const SO_BOOST = 0.2;
  // 依過去 n 個「同一個星期幾」有營業的日子平均；同星期幾還沒有紀錄時改用最近 n 天
  function forecast(date, n = plan.n, buf = plan.buf, auto = plan.auto) {
    const C = auto ? corrections() : null;
    const all = salesDays().filter((k) => k < date);
    let ref = all.filter((k) => pd(k).getDay() === pd(date).getDay()).slice(-n);
    const same = ref.length > 0;
    if (!same) ref = all.slice(-n);
    const used = new Set(ref.flatMap((k) => Object.keys(db.sales[k].items).filter((id) => db.sales[k].items[id].q > 0)));
    const list = liveDishes().filter((d) => !d.off || used.has(d.id));
    const rows = list.map((d) => {
      const es = ref.map((k) => db.sales[k].items[d.id]);
      const qs = es.map((e) => (e && e.q ? e.q : 0));
      // 賣完的日子實際需求比賣出的多，份數多算 SO_BOOST
      const adj = es.map((e) => (e && e.q ? (e.so ? e.q * (1 + SO_BOOST) : e.q) : 0));
      const soN = es.filter((e) => e && e.q && e.so).length;
      const avg = adj.length ? adj.reduce((a, b) => a + b, 0) / adj.length : 0;
      const corr = C ? (C.get(d.id) || 1) : 1, fc = avg * corr;
      return { d, avg, fc, corr, soN, max: qs.length ? Math.max(...qs) : 0, last: qs.length ? qs[qs.length - 1] : 0, sug: fc > 0 ? Math.ceil(fc * (1 + buf / 100)) : 0 };
    });
    return { date, ref, same, n, buf, rows, soN: rows.reduce((s, r) => s + r.soN, 0), total: rows.reduce((s, r) => s + r.sug, 0), avgTotal: rows.reduce((s, r) => s + r.avg, 0) };
  }
  // 最近 weeks 週、每個星期幾平均賣幾份（只算有記錄份數的日子，公休日不拉低平均）
  function weekdayStats(weeks = plan.weeks, end = today()) {
    const start = addD(end, -weeks * 7 + 1);
    const days = salesDays().filter((k) => k >= start && k <= end);
    return { start, end, weeks, ...wdAgg(days) };
  }
  function wdAgg(days) {
    const by = WDM.map((w) => ({ w, n: 0, tot: 0, avg: 0 }));
    const per = new Map();
    for (const k of days) {
      const i = wdi(k), v = db.sales[k];
      by[i].n++; by[i].tot += dayQty(v);
      for (const [id, e] of Object.entries(v.items)) {
        if (!e.q) continue;
        if (!per.has(id)) per.set(id, [0, 0, 0, 0, 0, 0, 0]);
        per.get(id)[i] += e.q;
      }
    }
    by.forEach((b) => { b.avg = b.n ? b.tot / b.n : 0; });
    const order = new Map(db.dishes.map((d, i) => [d.id, i]));
    const rows = [...per].map(([id, s]) => ({ d: dishById(id) || { id, name: '（已移除的菜）', cat: '', deleted: true }, avg: s.map((x, i) => (by[i].n ? x / by[i].n : 0)) }))
      .sort((a, b) => (order.get(a.d.id) ?? 1e9) - (order.get(b.d.id) ?? 1e9));
    const open = by.filter((b) => b.n);
    const busy = open.length ? open.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
    const calm = open.length ? open.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
    return { days: days.length, by, rows, busy, calm };
  }
  const f1 = (n) => (n >= 10 || n === 0 ? fmt(n) : n.toFixed(1));
  const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8)}`;
  function seg(k, vals, unit) {
    if (k === 'buf' && !vals.includes(plan.buf)) vals = [...vals, plan.buf].sort((a, b) => a - b);
    return `<div class="seg" role="group">${vals.map((v) => `<button data-act="set" data-k="${k}" data-v="${v}" class="${plan[k] === v ? 'on' : ''}">${unit(v)}</button>`).join('')}</div>`;
  }
  function viewPlan(el, date) {
    const F = forecast(date);
    const W = weekdayStats();
    const t = today(), wd = pd(date).getDay();
    const rel = date === t ? '今天' : date === addD(t, 1) ? '明天' : date === addD(t, 2) ? '後天' : '';
    const byCat = new Map();
    for (const r of F.rows) { if (!byCat.has(r.d.cat)) byCat.set(r.d.cat, []); byCat.get(r.d.cat).push(r); }
    const maxBar = Math.max(1, ...W.by.map((b) => b.avg));
    const heat = (v, lo, hi) => (v > 0 ? ` style="background:color-mix(in srgb, var(--brand) ${Math.round(5 + 33 * (hi > lo ? (v - lo) / (hi - lo) : 1))}%, transparent)"` : '');
    el.innerHTML = `
      <div class="page-head"><h2>備料預估與分析</h2></div>
      <section class="card" id="fc">
        <div class="card-head"><h3>🧾 備料預估</h3><span class="muted sm">用過去同一個星期幾賣的份數，估計這天要備多少</span><span class="sp"></span>
          <button class="btn" data-act="fcpdf" ${F.ref.length ? '' : 'disabled'}>⬇ 備料單 PDF</button></div>
        <div class="ctl pad">
          <div class="datebar">
            <button class="btn icon" data-act="prev" title="前一天" aria-label="前一天">◀</button>
            <input type="date" id="pdate" value="${date}" aria-label="預估日期">
            <span class="wd${wd % 6 === 0 ? ' we' : ''}">週${WD[wd]}${rel ? '・' + rel : ''}</span>
            <button class="btn icon" data-act="next" title="後一天" aria-label="後一天">▶</button>
          </div>
          <div class="opt"><span>參考最近</span>${seg('n', [4, 6, 8], (v) => `${v} 次`)}</div>
          <div class="opt"><span>多備</span>${seg('buf', [0, 10, 20], (v) => (v ? `+${v}%` : '不加'))}</div>
          ${plan.auto ? '<a class="opt chip on" href="#/insight" title="到進階分析關閉">🎯 自動修正中</a>' : ''}
        </div>
        ${!F.ref.length ? '<p class="empty">還沒有銷售紀錄，記錄幾天之後就能預估。</p>' : `
        <p class="hint pad${F.same ? '' : ' warn-t'}">${F.same ? `參考 ${F.ref.length} 個週${WD[wd]}：` : `還沒有週${WD[wd]}的紀錄，先用最近 ${F.ref.length} 天：`}${F.ref.slice().reverse().map(md).join('、')}${F.soN ? `<br>⏱ 有標記「賣完」的日子，那天的份數多算 ${SO_BOOST * 100}%（實際想買的人比賣出的多）。` : ''}</p>
        <div class="kpis k3 pad">
          ${kpi('建議總備量', fmt(F.total) + '<small> 份</small>', F.buf ? `平均再多備 ${F.buf}%` : '照平均', 'main', '🧾')}
          ${kpi('平均賣出', f1(F.avgTotal) + '<small> 份</small>', '', '', '📊')}
          ${kpi('要備的菜', F.rows.filter((r) => r.sug).length + '<small> 道</small>', '', '', '🥢')}
        </div>
        <div class="tbl-wrap"><table class="fc"><thead><tr><th>菜品</th><th class="r">平均</th><th class="r">上次</th><th class="r">最多</th><th class="r">建議備</th></tr></thead>
          <tbody>${[...byCat].map(([cat, rs], gi) => `<tr class="fg" style="--gc:var(--c${gi % 6 + 1})"><td colspan="5"><i class="dot"></i>${esc(cat)}<span>${fmt(rs.reduce((s, r) => s + r.sug, 0))} 份</span></td></tr>`
            + rs.map((r) => `<tr class="fr${r.sug ? '' : ' z'}"><td>${esc(r.d.name || '未命名')}${r.d.off ? '<small class="tag">停售</small>' : ''}${r.soN ? `<small class="tag sot">賣完 ${r.soN} 次</small>` : ''}${r.corr !== 1 ? `<small class="tag fix" title="依最近 4 週誤差自動修正">修正 ${r.corr > 1 ? '↑' : '↓'}${Math.round(Math.abs(r.corr - 1) * 100)}%</small>` : ''}</td><td class="r">${f1(r.avg)}</td><td class="r muted">${r.last}</td><td class="r muted">${r.max}</td><td class="r"><b class="sug">${r.sug || '—'}</b></td></tr>`).join('')).join('')}</tbody>
          <tfoot><tr><td>合計</td><td class="r">${f1(F.avgTotal)}</td><td></td><td></td><td class="r">${fmt(F.total)}</td></tr></tfoot></table></div>`}
      </section>
      <section class="card" id="wk">
        <div class="card-head"><h3>📊 星期分析</h3><span class="muted sm">${W.start.replace(/-/g, '/')} ～ ${W.end.replace(/-/g, '/')}，共 ${W.days} 天有營業</span><span class="sp"></span>${seg('weeks', [4, 8, 12], (v) => `${v} 週`)}</div>
        ${!W.days ? '<p class="empty">這段期間沒有銷售紀錄。</p>' : `
        <p class="pad insight">🔥 最忙是<b>週${WD[W.busy.w]}</b>，平均 <b>${fmt(W.busy.avg)}</b> 份；🌙 最閒是<b>週${WD[W.calm.w]}</b>，平均 <b>${fmt(W.calm.avg)}</b> 份${W.calm.avg ? `，相差 ${Math.round((W.busy.avg / W.calm.avg - 1) * 100)}%` : ''}。</p>
        <div class="wbars pad">${W.by.map((b) => `<div class="wb${b === W.busy ? ' hi' : ''}${b.w % 6 === 0 ? ' we' : ''}" title="週${WD[b.w]}：${b.n} 天，共 ${fmt(b.tot)} 份">
            <span class="bv">${b.n ? fmt(b.avg) : '—'}</span><div class="bt"><i style="height:${(b.avg / maxBar * 100).toFixed(1)}%"></i></div><b>${WD[b.w]}</b><small>${b.n} 天</small></div>`).join('')}</div>
        <div class="card-head"><h3 class="sm-h">各菜品每個星期幾平均份數</h3><span class="muted sm">顏色越深賣越多（每道菜各自比較）</span></div>
        <div class="tbl-wrap"><table class="wk"><thead><tr><th>菜品</th>${WDM.map((w) => `<th class="r${w % 6 === 0 ? ' we' : ''}">${WD[w]}</th>`).join('')}</tr></thead>
          <tbody>${W.rows.map((r) => { const m = Math.max(...r.avg), lo = Math.min(...r.avg.filter((x) => x > 0)); return `<tr><td>${esc(r.d.name || '未命名')}${r.d.deleted ? '<small class="tag">已刪除</small>' : ''}</td>${r.avg.map((v) => `<td class="r${v === m && m > 0 ? ' b' : ''}"${heat(v, lo, m)}>${v ? f1(v) : '<span class="muted">—</span>'}</td>`).join('')}</tr>`; }).join('')}</tbody>
          <tfoot><tr><td>每天合計</td>${W.by.map((b) => `<td class="r">${b.n ? fmt(b.avg) : '—'}</td>`).join('')}</tr></tfoot></table></div>`}
      </section>`;
    const go = (s) => { location.hash = '#/plan/' + s; };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'prev') go(addD(date, -1));
      else if (a === 'next') go(addD(date, 1));
      else if (a === 'set') { plan[b.dataset.k] = +b.dataset.v; if (b.dataset.k === 'buf') LS.set('buf', plan.buf); const y = window.scrollY; viewPlan(el, date); window.scrollTo(0, y); }
      else if (a === 'fcpdf') await runPdf(b, () => buildForecastPdf(F));
    };
    el.onchange = (e) => { if (e.target.id === 'pdate' && validYmd(e.target.value)) go(e.target.value); };
  }

  // ------------------------------------------------------------------ 進階分析（只用現有的份數、單價、賣完時間）
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('dishsales.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('dishsales.' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ } },
  };
  plan.buf = Math.min(60, Math.max(0, Math.round(num(LS.get('buf', 10)))));
  plan.auto = !!LS.get('auto', false);
  const ins = { days: 84, ym: 'qty' };
  const dishOf = (id) => dishById(id) || { id, name: '（已移除的菜）', cat: '', deleted: true };
  const inRange = (days, end) => { const s = addD(end, -days + 1); return salesDays().filter((k) => k >= s && k <= end); };
  const hm2m = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  const m2hm = (m) => `${pad(Math.floor(m / 60))}:${pad(Math.round(m % 60))}`;
  const pctTxt = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
  function pearson(xs, ys) {
    const n = xs.length; if (n < 3) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  // 1. 預估準確度：把過去每一天「當時會算出的預估（不加安全量）」和實際賣出對照
  function accuracy(days = 28, end = addD(today(), -1), auto = false) {
    const per = new Map(); const ratios = [];
    let fT = 0, aT = 0, absDay = 0, absDish = 0, n = 0, hit = 0, cnt = 0;
    for (const k of inRange(days, end)) {
      const F = forecast(k, plan.n, 0, auto);
      if (!F.ref.length) continue;
      const v = db.sales[k], fm = new Map(F.rows.map((r) => [r.d.id, r.fc]));
      const ids = new Set([...fm.keys(), ...Object.keys(v.items).filter((id) => v.items[id].q > 0)]);
      let fs = 0, as = 0;
      for (const id of ids) {
        const f = fm.get(id) || 0, e = v.items[id], a = e && e.q ? e.q : 0;
        if (!f && !a) continue;
        let p = per.get(id); if (!p) per.set(id, p = { d: dishOf(id), n: 0, f: 0, a: 0, abs: 0, short: 0, so: 0 });
        p.n++; p.f += f; p.a += a; p.abs += Math.abs(f - a);
        if (a > f) p.short++;
        if (e && e.so) p.so++;
        fs += f; as += a; absDish += Math.abs(f - a);
        if (f >= 1) { ratios.push(a / f); cnt++; if (a <= Math.ceil(f * (1 + plan.buf / 100)) && !(e && e.so)) hit++; }
      }
      fT += fs; aT += as; absDay += Math.abs(fs - as); n++;
    }
    const rows = [...per.values()].filter((p) => p.n >= 3 && p.a > 0).map((p) => ({ ...p, err: p.abs / p.a, bias: (p.f - p.a) / p.a, corr: p.f > 0 ? Math.min(1.3, Math.max(0.7, p.a / p.f)) : 1 }));
    ratios.sort((a, b) => a - b);
    const p80 = ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.8))] : 1;
    const sugBuf = Math.min(40, Math.max(0, Math.ceil((p80 - 1) * 100 / 5) * 5));
    return {
      days: n, end, dayAcc: aT ? Math.max(0, 1 - absDay / aT) : 0, dishAcc: aT ? Math.max(0, 1 - absDish / aT) : 0,
      bias: aT ? (fT - aT) / aT : 0, hitRate: cnt ? hit / cnt : 0, sugBuf, rows,
      over: rows.filter((r) => r.bias >= 0.15).sort((a, b) => b.bias - a.bias),
      under: rows.filter((r) => r.bias <= -0.15).sort((a, b) => a.bias - b.bias),
    };
  }
  // 每道菜的自動修正倍數（最近 4 週預估偏高就少備、偏低就多備，最多 ±30%）
  let corrCache = { key: '', map: new Map() };
  function corrections() {
    const key = today() + '|' + plan.n + '|' + salesDays().length + '|' + Object.values(db.sales).reduce((s, v) => s + Object.values(v.items).reduce((t, e) => t + e.q + e.at % 997, 0), 0);
    if (corrCache.key !== key) {
      const A = accuracy(28, addD(today(), -1), false);
      corrCache = { key, map: new Map(A.rows.filter((r) => r.n >= 4).map((r) => [r.d.id, r.corr])) };
    }
    return corrCache.map;
  }

  // 2. 菜單結構 ABC：依份數由多到少累計，前 80% 是 A、到 95% 是 B、其餘 C
  function abc(days = ins.days, end = today()) {
    const m = new Map(); let tot = 0, rev = 0;
    const ds = inRange(days, end);
    for (const k of ds) {
      for (const [id, e] of Object.entries(db.sales[k].items)) {
        if (!e.q) continue;
        const r = m.get(id) || { q: 0, rev: 0, days: 0 };
        r.q += e.q; r.rev += e.q * e.p; r.days++; m.set(id, r); tot += e.q; rev += e.q * e.p;
      }
    }
    for (const d of liveDishes()) if (!d.off && !m.has(d.id) && ds.length) m.set(d.id, { q: 0, rev: 0, days: 0 });
    const rows = [...m].map(([id, r]) => ({ d: dishOf(id), ...r })).sort((a, b) => b.q - a.q || a.d.name.localeCompare(b.d.name, 'zh-Hant'));
    let cum = 0;
    for (const r of rows) { const before = tot ? cum / tot : 1; cum += r.q; r.share = tot ? r.q / tot : 0; r.cum = tot ? cum / tot : 0; r.cls = r.q && before < 0.8 ? 'A' : r.q && before < 0.95 ? 'B' : 'C'; }
    const cnt = (c) => rows.filter((r) => r.cls === c);
    const A = cnt('A'), B = cnt('B'), C = cnt('C');
    return { days: ds.length, tot, rev, rows, A, B, C, aShare: A.reduce((s, r) => s + r.q, 0) / (tot || 1), hasRev: rev > 0,
      drop: C.filter((r) => !r.d.deleted && !r.d.off) };
  }

  // 3. 趨勢警示：最近 4 週和前 4 週比（都用「有營業的日子平均」），最近 7 天突然掉很多另外提醒
  function trends(end = addD(today(), -1)) {
    const ds = salesDays();
    const s1 = addD(end, -27), s0 = addD(end, -55), w = addD(end, -6);
    const cur = ds.filter((k) => k >= s1 && k <= end), prev = ds.filter((k) => k >= s0 && k < s1);
    const last = cur.filter((k) => k >= w), before = cur.filter((k) => k < w);
    const avgOf = (days, id) => (days.length ? days.reduce((s, k) => s + qOf(db.sales[k], id), 0) / days.length : 0);
    const tot = (days) => (days.length ? days.reduce((s, k) => s + dayQty(db.sales[k]), 0) / days.length : 0);
    const weeks = [...Array(8)].map((_, i) => { const e = addD(end, -7 * (7 - i)), s = addD(e, -6); return ds.filter((k) => k >= s && k <= e); });
    const ok = cur.length >= 3 && prev.length >= 3;
    const rows = [];
    if (ok) {
      for (const d of liveDishes()) {
        if (d.off) continue;
        const a = avgOf(cur, d.id), b = avgOf(prev, d.id);
        if (!a && !b) continue;
        const r = { d, a, b, ch: b ? a / b - 1 : null, spark: weeks.map((x) => avgOf(x, d.id)) };
        const la = avgOf(last, d.id), bb = avgOf(before, d.id);
        r.kind = b === 0 ? (a >= 1 ? 'new' : '') : r.ch >= 0.25 && a >= 1 ? 'up' : r.ch <= -0.25 && b >= 1 ? 'down' : '';
        if (last.length >= 2 && before.length >= 3 && bb >= 2 && la <= bb * 0.6) { r.drop = la / bb - 1; r.la = la; r.bb = bb; }
        rows.push(r);
      }
    }
    return { ok, end, cur: cur.length, prev: prev.length, totA: tot(cur), totB: tot(prev),
      up: rows.filter((r) => r.kind === 'up').sort((a, b) => b.ch - a.ch),
      down: rows.filter((r) => r.kind === 'down').sort((a, b) => a.ch - b.ch),
      fresh: rows.filter((r) => r.kind === 'new'), sudden: rows.filter((r) => r.drop != null).sort((a, b) => a.drop - b.drop) };
  }

  // 4. 售完損失：和之前同星期幾「沒賣完」的日子比，少賣的就是估計損失；至少算多 SO_BOOST
  function soldOut(days = ins.days, end = today()) {
    const all = salesDays(), per = new Map(), wdN = [0, 0, 0, 0, 0, 0, 0];
    let ev = 0, lost = 0, lostRev = 0;
    for (const k of inRange(days, end)) {
      for (const [id, e] of Object.entries(db.sales[k].items)) {
        if (!e.q || !e.so) continue;
        const ok = (x) => { const y = db.sales[x].items[id]; return y && y.q > 0 && !y.so; };
        const prior = all.filter((x) => x < k && x >= addD(k, -91));
        let ref = prior.filter((x) => pd(x).getDay() === pd(k).getDay() && ok(x)).slice(-8);
        if (ref.length < 2) ref = prior.filter(ok).slice(-8);
        const base = ref.length ? ref.reduce((s, x) => s + db.sales[x].items[id].q, 0) / ref.length : 0;
        const est = Math.max(1, Math.round(base - e.q), Math.round(e.q * SO_BOOST));
        let p = per.get(id); if (!p) per.set(id, p = { d: dishOf(id), n: 0, lost: 0, rev: 0, times: [], last: '' });
        p.n++; p.lost += est; p.rev += est * e.p; p.times.push(hm2m(e.so)); p.last = k;
        ev++; lost += est; lostRev += est * e.p; wdN[wdi(k)]++;
      }
    }
    const rows = [...per.values()].map((p) => ({ ...p, early: Math.min(...p.times), avgT: p.times.reduce((a, b) => a + b, 0) / p.times.length }))
      .sort((a, b) => b.lost - a.lost || b.n - a.n);
    return { ev, lost, lostRev, rows, wdN };
  }

  // 5. 新菜上市追蹤：開始記錄 2 週後才第一次出現、而且是最近 120 天內上市的菜
  function newDishes(end = today()) {
    const ds = salesDays(); if (!ds.length) return { rows: [] };
    const firstOf = new Map();
    for (const k of ds) for (const [id, e] of Object.entries(db.sales[k].items)) if (e.q > 0 && !firstOf.has(id)) firstOf.set(id, k);
    const rows = [];
    for (const [id, f] of firstOf) {
      if (f <= addD(ds[0], 14) || f < addD(end, -120)) continue;
      const d = dishById(id); if (!d || d.deleted) continue;
      const span = ds.filter((k) => k >= f && k <= addD(f, 27) && k <= end);
      const q = span.reduce((s, k) => s + qOf(db.sales[k], id), 0);
      const avg = span.length ? q / span.length : 0;
      const old = (x) => x.id !== id && (firstOf.get(x.id) || '9999') < f && span.some((k) => qOf(db.sales[k], x.id) > 0);
      let peers = liveDishes().filter((x) => x.cat === d.cat && old(x)), same = true;
      if (!peers.length) { peers = liveDishes().filter(old); same = false; }
      const pAvg = peers.length && span.length ? span.reduce((s, k) => s + peers.reduce((t, x) => t + qOf(db.sales[k], x.id), 0), 0) / span.length / peers.length : 0;
      const wk = [0, 1, 2, 3].map((i) => { const ks = span.filter((k) => k >= addD(f, i * 7) && k <= addD(f, i * 7 + 6)); return ks.length ? ks.reduce((s, k) => s + qOf(db.sales[k], id), 0) / ks.length : null; });
      const age = Math.round((pd(end) - pd(f)) / 864e5) + 1;
      const ratio = pAvg ? avg / pAvg : null;
      const w = wk.filter((x) => x != null);
      rows.push({ d, first: f, age, days: span.length, q, avg, pAvg, same, ratio, wk, grow: w.length >= 2 && w[0] ? w[w.length - 1] / w[0] - 1 : null,
        verdict: ratio == null ? '' : ratio >= 1 ? 'good' : ratio >= 0.7 ? 'ok' : 'weak' });
    }
    return { rows: rows.sort((a, b) => (a.first < b.first ? 1 : -1)) };
  }

  // 6. 互相排擠：先扣掉「星期幾」的影響，再看兩道菜佔當天比例的相關係數；明顯負相關代表搶同一批客人
  function cannibal(days = ins.days, end = today()) {
    const ds = inRange(days, end);
    const ids = [...new Set(ds.flatMap((k) => Object.keys(db.sales[k].items).filter((id) => db.sales[k].items[id].q > 0)))]
      .filter((id) => { const d = dishById(id); return d && !d.deleted && !d.off; });
    const res = new Map();
    for (const id of ids) {
      const sh = ds.map((k) => { const v = db.sales[k], t = dayQty(v), q = qOf(v, id); return q > 0 && t ? q / t : null; });
      // 先扣掉前後 2 週的平均（慢慢變熱門或退流行不算排擠），再扣掉星期幾的平均
      const loc = sh.map((x, i) => { if (x == null) return null; const lo = addD(ds[i], -14), hi = addD(ds[i], 14); let s = 0, c = 0; sh.forEach((y, j) => { if (y != null && ds[j] >= lo && ds[j] <= hi) { s += y; c++; } }); return x - s / c; });
      const mean = [0, 1, 2, 3, 4, 5, 6].map((w) => { const xs = loc.filter((x, i) => x != null && wdi(ds[i]) === w); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; });
      res.set(id, { sh: loc.map((x, i) => (x == null ? null : x - mean[wdi(ds[i])])), raw: ds.map((k) => qOf(db.sales[k], id)) });
    }
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = res.get(ids[i]), B = res.get(ids[j]), xs = [], ys = [], ia = [];
        A.sh.forEach((x, t) => { if (x != null && B.sh[t] != null) { xs.push(x); ys.push(B.sh[t]); ia.push(t); } });
        if (xs.length < 12) continue;
        const r = pearson(xs, ys);
        if (r > -0.45) continue;
        // A 賣得比平常多的日子（前 1/3），B 平均比平常少幾份
        const ord = ia.map((t, k) => [xs[k], t]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(3, Math.floor(ia.length / 3))).map((x) => x[1]);
        const bAll = ia.reduce((s, t) => s + B.raw[t], 0) / ia.length, bHi = ord.reduce((s, t) => s + B.raw[t], 0) / ord.length;
        if (bHi > bAll * 0.9) continue; // 份數上看不出差別，不算
        const a = dishById(ids[i]), b = dishById(ids[j]);
        pairs.push({ a, b, r, n: xs.length, same: a.cat === b.cat, bAll, bHi });
      }
    }
    return { days: ds.length, dishes: ids.length, pairs: pairs.sort((x, y) => x.r - y.r).slice(0, 8) };
  }

  // 7. 年度走勢：最近 12 個月，每月和去年同月比（用每天平均比較，營業天數不同也公平）
  function yearTrend(m = today().slice(0, 7)) {
    const ms = []; for (let i = 11; i >= 0; i--) ms.push(addM(m, -i));
    const cm = today().slice(0, 7);
    const rows = ms.map((x) => { const a = monthAgg(x), b = monthAgg(addM(x, -12)); return { m: x, qty: a.qty, days: a.days, avg: a.days ? a.qty / a.days : 0, ly: b.qty, lyDays: b.days, lyAvg: b.days ? b.qty / b.days : 0, part: x === cm }; });
    const full = rows.filter((r) => r.days && !r.part);
    const peak = full.length ? full.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
    const low = full.length ? full.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
    const both = rows.filter((r) => r.qty && r.ly); // 只比兩年都有資料的月份，才不會因為去年還沒開始記錄而失真
    const tq = rows.reduce((s, r) => s + r.qty, 0);
    const bq = both.reduce((s, r) => s + r.qty, 0), lq = both.reduce((s, r) => s + r.ly, 0);
    return { rows, peak, low, tq, bq, lq, nb: both.length, hasLy: rows.some((r) => r.ly) };
  }

  function insightData() {
    const end = addD(today(), -1);
    return { A: accuracy(28, end, false), Aa: plan.auto ? accuracy(28, end, true) : null, B: abc(), T: trends(end), S: soldOut(), N: newDishes(), X: cannibal(), Y: yearTrend(), days: ins.days };
  }
  const spark = (vals) => { const mx = Math.max(...vals, 0.0001); return `<span class="spark" aria-hidden="true">${vals.map((v) => `<i style="height:${Math.max(6, v / mx * 100).toFixed(0)}%"></i>`).join('')}</span>`; };
  const nm = (d) => `${esc(d.name || '未命名')}${d.deleted ? '<small class="tag">已刪除</small>' : d.off ? '<small class="tag">停售</small>' : ''}`;
  const periodTxt = (n) => ({ 28: '最近 4 週', 84: '最近 12 週', 182: '最近半年' }[n] || `最近 ${n} 天`);
  const ymTxt = (m) => `${+m.slice(5, 7)} 月`;
  const VERD = { good: ['✅ 表現好', 'good'], ok: ['➖ 普通', 'ok'], weak: ['⚠ 偏弱', 'weak'] };

  function viewInsight(el) {
    const D = insightData();
    const { A, B, T, S, N, X, Y } = D;
    const pt = periodTxt(ins.days);
    const accTxt = A.days ? Math.round(A.dishAcc * 100) + '<small> %</small>' : '—';
    const alerts = T.down.length + T.sudden.length;
    const maxY = Math.max(1, ...Y.rows.map((r) => (ins.ym === 'avg' ? Math.max(r.avg, r.lyAvg) : Math.max(r.qty, r.ly))));
    const hasPrice = B.hasRev;
    el.innerHTML = `
      <div class="page-head"><h2>進階分析</h2><span class="sp"></span>
        <div class="seg" role="group" aria-label="分析期間"><span class="seg-l">期間</span>${[28, 84, 182].map((v) => `<button data-act="days" data-v="${v}" class="${ins.days === v ? 'on' : ''}">${{ 28: '4 週', 84: '12 週', 182: '半年' }[v]}</button>`).join('')}</div>
        <button class="btn primary" data-act="inspdf" ${salesDays().length ? '' : 'disabled'}>🖨 分析報告 PDF</button>
      </div>
      <div class="kpis">
        ${kpi('預估準確度', accTxt, A.days ? `最近 ${A.days} 天・照 +${plan.buf}% 備料 ${Math.round(A.hitRate * 100)}% 夠用` : '資料還不夠', 'main', '🎯')}
        ${kpi('A 類主力菜', B.A.length + '<small> 道</small>', B.tot ? `占 ${Math.round(B.aShare * 100)}% 銷量` : '', '', '🅰')}
        ${kpi('趨勢警示', alerts + '<small> 道</small>', T.ok ? `📈 ${T.up.length} 道成長` : '要 8 週紀錄', alerts ? 'warn' : '', '📉')}
        ${kpi('賣完少賣', fmt(S.lost) + '<small> 份</small>', S.ev ? `${pt}賣完 ${S.ev} 次${S.lostRev ? `・約 $${fmt(S.lostRev)}` : ''}` : `${pt}沒有賣完紀錄`, '', '⏱')}
      </div>

      <section class="card" id="acc">
        <div class="card-head"><h3>🎯 備料預估準確度</h3><span class="muted sm">最近 4 週，每天「當時的預估平均」和實際賣出對照（到昨天）</span></div>
        ${!A.days ? '<p class="empty">要先有幾週的紀錄，才能回頭檢查預估準不準。</p>' : `
        <div class="kpis k3 pad">
          ${kpi('每道菜準確度', Math.round(A.dishAcc * 100) + '<small> %</small>', '逐道菜誤差', '', '🥢')}
          ${kpi('總量準確度', Math.round(A.dayAcc * 100) + '<small> %</small>', `整體${A.bias > 0.03 ? `估多 ${pctTxt(A.bias)}` : A.bias < -0.03 ? `估少 ${pctTxt(-A.bias).slice(1)}` : '差不多'}`, '', '🧾')}
          ${kpi(`+${plan.buf}% 夠用率`, Math.round(A.hitRate * 100) + '<small> %</small>', '沒賣完、也沒超過建議量', '', '✅')}
        </div>
        <div class="pad tune">
          <p class="insight">💡 要讓大約 8 成的情況都夠用，建議多備 <b>+${A.sugBuf}%</b>${A.sugBuf === plan.buf ? '（就是目前的設定）' : `，目前設定 +${plan.buf}%`}。</p>
          <div class="btns">
            ${A.sugBuf !== plan.buf ? `<button class="btn primary" data-act="usebuf" data-v="${A.sugBuf}">套用 +${A.sugBuf}%</button>` : ''}
            <label class="sw"><input type="checkbox" data-act="auto" ${plan.auto ? 'checked' : ''}> 依每道菜的誤差自動修正備料（最多 ±30%）</label>
          </div>
          ${D.Aa ? `<p class="hint">開啟自動修正後，過去 4 週每道菜準確度會是 <b>${Math.round(D.Aa.dishAcc * 100)}%</b>（原本 ${Math.round(A.dishAcc * 100)}%）。</p>` : ''}
        </div>
        <div class="two">
          <div><h4>⬆ 常常估太多（可以少備）</h4>${A.over.length ? `<ul class="lst">${A.over.slice(0, 6).map((r) => `<li><span>${nm(r.d)}</span><b class="dl new">多 ${Math.round(r.bias * 100)}%</b><small>預估 ${f1(r.f / r.n)}／實際 ${f1(r.a / r.n)}</small></li>`).join('')}</ul>` : '<p class="muted sm">沒有明顯估太多的菜 👍</p>'}</div>
          <div><h4>⬇ 常常估太少（要多備）</h4>${A.under.length ? `<ul class="lst">${A.under.slice(0, 6).map((r) => `<li><span>${nm(r.d)}${r.so ? `<small class="tag sot">賣完 ${r.so} 次</small>` : ''}</span><b class="dl down">少 ${Math.round(-r.bias * 100)}%</b><small>預估 ${f1(r.f / r.n)}／實際 ${f1(r.a / r.n)}</small></li>`).join('')}</ul>` : '<p class="muted sm">沒有明顯估太少的菜 👍</p>'}</div>
        </div>`}
      </section>

      <section class="card" id="abc">
        <div class="card-head"><h3>🔤 菜單結構（ABC 分析）</h3><span class="muted sm">${pt}，${B.days} 天有營業</span></div>
        ${!B.tot ? '<p class="empty">這段期間沒有銷售紀錄。</p>' : `
        <p class="pad insight">🅰 <b>${B.A.length}</b> 道菜就賣了 <b>${Math.round(B.aShare * 100)}%</b> 的份數，這些是主力菜，絕對不能缺貨；
          🅲 有 <b>${B.C.length}</b> 道菜合計只占 ${Math.round(B.C.reduce((s, r) => s + r.share, 0) * 100)}%${B.drop.length ? `，其中 ${B.drop.length} 道還在菜單上，可以考慮汰換或改良` : ''}。</p>
        <div class="abcbar pad">${['A', 'B', 'C'].map((c) => { const s = B[c].reduce((t, r) => t + r.share, 0); return s > 0 ? `<i class="ab-${c.toLowerCase()}" style="flex:${s.toFixed(4)}"><b>${c}</b> ${B[c].length} 道・${Math.round(s * 100)}%</i>` : ''; }).join('')}</div>
        <div class="tbl-wrap"><table class="abc"><thead><tr><th class="c">類</th><th>菜品</th><th class="r">份數</th>${hasPrice ? '<th class="r">營業額</th>' : ''}<th class="r">佔比</th><th class="r">累計</th><th class="r">賣出天數</th></tr></thead>
          <tbody>${B.rows.map((r) => `<tr class="ab-${r.cls.toLowerCase()}"><td class="c"><span class="abk">${r.cls}</span></td><td class="b">${nm(r.d)}</td><td class="r b">${fmt(r.q)}</td>${hasPrice ? `<td class="r">${r.rev ? '$' + fmt(r.rev) : '—'}</td>` : ''}<td class="r">${(r.share * 100).toFixed(1)}%</td><td class="r muted">${(r.cum * 100).toFixed(0)}%</td><td class="r muted">${r.days} / ${B.days}</td></tr>`).join('')}</tbody></table></div>`}
      </section>

      <section class="card" id="trend">
        <div class="card-head"><h3>📈 趨勢警示</h3><span class="muted sm">最近 4 週 vs 前 4 週（有營業的日子平均，到昨天）</span></div>
        ${!T.ok ? '<p class="empty">要有大約 8 週的紀錄，才能比較趨勢。</p>' : `
        <p class="pad insight">整體每天平均 <b>${fmt(T.totA)}</b> 份，前 4 週 ${fmt(T.totB)} 份（${dlt(T.totA, T.totB)}）。</p>
        ${T.sudden.length ? `<div class="alert pad"><b>⚠ 最近 7 天突然下滑</b>${T.sudden.map((r) => `<span>${nm(r.d)}：每天 ${f1(r.la)} 份，之前 ${f1(r.bb)} 份（${Math.round(r.drop * 100)}%）</span>`).join('')}<small>可能是口味、份量、備料或擺放位置改變了，建議確認一下。</small></div>` : ''}
        <div class="two">
          <div><h4>📈 明顯成長</h4>${T.up.length ? `<ul class="lst">${T.up.slice(0, 8).map((r) => `<li><span>${nm(r.d)}</span>${spark(r.spark)}<b class="dl up">↑${Math.round(r.ch * 100)}%</b><small>${f1(r.b)} → ${f1(r.a)} 份/天</small></li>`).join('')}</ul>` : '<p class="muted sm">沒有成長超過 25% 的菜。</p>'}
            ${T.fresh.length ? `<p class="muted sm">🆕 前 4 週沒賣、最近開始賣：${T.fresh.map((r) => esc(r.d.name)).join('、')}</p>` : ''}</div>
          <div><h4>📉 明顯衰退</h4>${T.down.length ? `<ul class="lst">${T.down.slice(0, 8).map((r) => `<li><span>${nm(r.d)}</span>${spark(r.spark)}<b class="dl down">↓${Math.round(-r.ch * 100)}%</b><small>${f1(r.b)} → ${f1(r.a)} 份/天</small></li>`).join('')}</ul>` : '<p class="muted sm">沒有衰退超過 25% 的菜 👍</p>'}</div>
        </div>
        <p class="hint pad">小長條是最近 8 週、每週每天平均賣幾份。</p>`}
      </section>

      <section class="card" id="so">
        <div class="card-head"><h3>⏱ 售完損失估算</h3><span class="muted sm">${pt}・和之前同星期幾沒賣完的日子比</span></div>
        ${!S.ev ? '<p class="empty">這段期間沒有記錄「賣完」。在每日紀錄按 ⏱ 記下賣完時間，就能估計少賣多少。</p>' : `
        <p class="pad insight">共賣完 <b>${S.ev}</b> 次，估計少賣 <b>${fmt(S.lost)}</b> 份${S.lostRev ? `，約 <b>$${fmt(S.lostRev)}</b>` : ''}。最常賣完的是 <b>${esc(S.rows[0].d.name)}</b>（${S.rows[0].n} 次，平均 ${m2hm(S.rows[0].avgT)} 賣完）。</p>
        <div class="tbl-wrap"><table class="sot"><thead><tr><th>菜品</th><th class="r">賣完次數</th><th class="r">平均時間</th><th class="r">最早</th><th class="r">估計少賣</th>${S.lostRev ? '<th class="r">少賺</th>' : ''}<th class="r">最近一次</th></tr></thead>
          <tbody>${S.rows.map((r) => `<tr><td class="b">${nm(r.d)}</td><td class="r">${r.n}</td><td class="r">${m2hm(r.avgT)}</td><td class="r muted">${m2hm(r.early)}</td><td class="r b">${fmt(r.lost)} 份</td>${S.lostRev ? `<td class="r">${r.rev ? '$' + fmt(r.rev) : '—'}</td>` : ''}<td class="r muted">${md(r.last)}</td></tr>`).join('')}</tbody></table></div>
        <p class="hint pad">各星期幾賣完次數：${WDM.map((w, i) => `週${WD[w]} ${S.wdN[i]}`).join('・')}</p>`}
      </section>

      <section class="card" id="nd">
        <div class="card-head"><h3>🆕 新菜上市追蹤</h3><span class="muted sm">最近 120 天上市的菜，前 4 週和同分類的舊菜比</span></div>
        ${!N.rows.length ? '<p class="empty">最近沒有新菜。新增菜品並開始記錄後，這裡會追蹤它前 4 週的表現。</p>' : `
        <div class="tbl-wrap"><table class="nd"><thead><tr><th>菜品</th><th>上市</th><th class="r">每天平均</th><th class="r">同類舊菜</th><th class="c">第 1～4 週</th><th>判斷</th></tr></thead>
          <tbody>${N.rows.map((r) => `<tr><td class="b">${nm(r.d)}<small class="muted"> ${esc(r.d.cat)}</small></td><td>${md(r.first)}<small class="muted">・第 ${r.age} 天</small></td><td class="r b">${f1(r.avg)}</td><td class="r muted">${r.pAvg ? f1(r.pAvg) + (r.same ? '' : '*') : '—'}</td>
            <td class="c">${spark(r.wk.map((x) => x || 0))}${r.grow != null ? ` <small class="dl ${r.grow > 0.05 ? 'up' : r.grow < -0.05 ? 'down' : ''}">${r.grow > 0.05 ? '漸升' : r.grow < -0.05 ? '漸降' : '持平'}</small>` : ''}</td>
            <td>${r.verdict ? `<span class="vd ${VERD[r.verdict][1]}">${VERD[r.verdict][0]}</span> <small class="muted">${Math.round(r.ratio * 100)}%</small>` : '—'}${r.age < 28 ? '<small class="muted">（觀察中）</small>' : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="hint pad">「同類舊菜」是同一分類、上市前就有在賣的菜，同一段期間每道每天平均；* 代表同分類沒有舊菜，改和全部舊菜比。達到 100% 以上算表現好，70% 以下偏弱。</p>`}
      </section>

      <section class="card" id="cn">
        <div class="card-head"><h3>🔀 菜品互相排擠</h3><span class="muted sm">${pt}・已扣掉星期幾的影響</span></div>
        ${X.days < 12 ? '<p class="empty">要有至少 12 天的紀錄才能分析。</p>' : !X.pairs.length ? `<p class="pad insight">👍 ${X.days} 天的紀錄裡，沒有發現明顯互相搶客人的菜。</p>` : `
        <p class="pad insight">下面這些菜，<b>一道賣得比平常好，另一道通常就賣得比較差</b>，代表客人常常二選一。可以考慮不要同一天推出，或拉開口味、價位。</p>
        <ul class="lst cn pad">${X.pairs.map((p) => `<li><span><b>${esc(p.a.name)}</b> ⇄ <b>${esc(p.b.name)}</b>${p.same ? '<small class="tag">同分類</small>' : ''}</span><b class="str ${p.r <= -0.7 ? 'hi' : ''}">${p.r <= -0.7 ? '強' : '中'}</b><small>${esc(p.a.name)} 賣得好的日子，${esc(p.b.name)} 平均 ${f1(p.bHi)} 份（平常 ${f1(p.bAll)}）・${p.n} 天</small></li>`).join('')}</ul>`}
      </section>

      <section class="card" id="yr">
        <div class="card-head"><h3>📅 年度走勢</h3><span class="muted sm">最近 12 個月${Y.hasLy ? '，淡色是去年同月' : ''}</span><span class="sp"></span>
          <div class="seg" role="group"><button data-act="ym" data-v="qty" class="${ins.ym === 'qty' ? 'on' : ''}">每月總份數</button><button data-act="ym" data-v="avg" class="${ins.ym === 'avg' ? 'on' : ''}">每天平均</button></div></div>
        ${!Y.tq ? '<p class="empty">最近 12 個月沒有銷售紀錄。</p>' : `
        ${Y.peak ? `<p class="pad insight">🔥 旺季：<b>${Y.peak.m.slice(0, 4)} 年 ${ymTxt(Y.peak.m)}</b>（每天 ${fmt(Y.peak.avg)} 份）${Y.low !== Y.peak ? `；🌙 淡季：<b>${Y.low.m.slice(0, 4)} 年 ${ymTxt(Y.low.m)}</b>（每天 ${fmt(Y.low.avg)} 份）` : ''}${Y.nb >= 3 ? `；兩年都有紀錄的 ${Y.nb} 個月，合計比去年 ${dlt(Y.bq, Y.lq)}` : ''}。</p>` : ''}
        <div class="ybars pad">${Y.rows.map((r) => { const v = ins.ym === 'avg' ? r.avg : r.qty, l = ins.ym === 'avg' ? r.lyAvg : r.ly; const tip = `${r.m.slice(0, 4)} 年 ${ymTxt(r.m)}：${fmt(r.qty)} 份、${r.days} 天（每天 ${fmt(r.avg)} 份）${r.ly ? `；去年 ${fmt(r.ly)} 份（每天 ${fmt(r.lyAvg)}）` : ''}`; return `<div class="yb${r === Y.peak ? ' hi' : ''}${r.part ? ' part' : ''}" title="${tip}" data-act="ytip" data-tip="${tip}">
            <span class="bv">${v ? fmt(v) : '—'}</span><div class="bt">${l ? `<em style="height:${(l / maxY * 100).toFixed(1)}%"></em>` : ''}<i style="height:${(v / maxY * 100).toFixed(1)}%"></i></div><b>${+r.m.slice(5, 7)}<span class="mo">月</span></b><small>${r.ly && r.lyAvg && r.avg ? dlt(r.avg, r.lyAvg) : r.part ? '進行中' : r.m.slice(2, 4) + '年'}</small></div>`; }).join('')}</div>
        <p class="hint pad">和去年比較用「每天平均」，營業天數不同也公平；斜線是還沒過完的本月。點長條可看詳細數字。</p>`}
      </section>`;
    const again = () => { const y = window.scrollY; viewInsight(el); window.scrollTo(0, y); };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'days') { ins.days = +b.dataset.v; again(); }
      else if (a === 'ym') { ins.ym = b.dataset.v; again(); }
      else if (a === 'ytip') toast(b.dataset.tip, 4000);
      else if (a === 'usebuf') { plan.buf = +b.dataset.v; LS.set('buf', plan.buf); toast(`備料預估改成多備 +${plan.buf}%`); again(); }
      else if (a === 'inspdf') await runPdf(b, () => buildInsightPdf(insightData()));
    };
    el.onchange = (e) => {
      if (e.target.dataset.act === 'auto') { plan.auto = e.target.checked; LS.set('auto', plan.auto); toast(plan.auto ? '已開啟自動修正，備料分析頁的建議量會跟著調整' : '已關閉自動修正'); again(); }
    };
  }

  async function buildInsightPdf(D) {
    const { A, B, T, S, N, X, Y } = D;
    const pt = periodTxt(D.days);
    const box = (t, body) => `<div class="rp-box"><h2>${t}</h2>${body}</div>`;
    const maxY = Math.max(1, ...Y.rows.map((r) => Math.max(r.qty, r.ly)));
    const p1 = `<div class="rp">
      ${rpHead('菜品進階分析報告', `${pt}（${addD(today(), -D.days + 1).replace(/-/g, '/')} ～ ${today().replace(/-/g, '/')}）`)}
      <div class="rp-ks">${rpKpi('預估準確度', A.days ? Math.round(A.dishAcc * 100) + '%' : '—')}${rpKpi('建議多備', '+' + A.sugBuf + '%')}${rpKpi('A 類主力菜', `${B.A.length} 道（${Math.round(B.aShare * 100)}%）`)}${rpKpi('趨勢警示', (T.down.length + T.sudden.length) + ' 道')}${rpKpi('賣完少賣', fmt(S.lost) + ' 份')}</div>
      ${box('🎯 備料預估準確度（最近 4 週）', A.days ? `<p class="rp-p">每道菜準確度 <b>${Math.round(A.dishAcc * 100)}%</b>，總量準確度 <b>${Math.round(A.dayAcc * 100)}%</b>；照目前 +${plan.buf}% 備料，${Math.round(A.hitRate * 100)}% 的情況夠用；要 8 成夠用建議 +${A.sugBuf}%。${plan.auto ? '（已開啟每道菜自動修正）' : ''}</p>
        <div class="rp-cols"><div><b class="rp-mini">常估太多</b>${A.over.length ? A.over.slice(0, 6).map((r) => `<div class="rp-li">${esc(r.d.name)}<span>多 ${Math.round(r.bias * 100)}%</span></div>`).join('') : '<div class="rp-li">無</div>'}</div>
        <div><b class="rp-mini">常估太少</b>${A.under.length ? A.under.slice(0, 6).map((r) => `<div class="rp-li">${esc(r.d.name)}<span>少 ${Math.round(-r.bias * 100)}%</span></div>`).join('') : '<div class="rp-li">無</div>'}</div></div>` : '<p class="rp-p">資料不足</p>')}
      ${box(`🔤 菜單結構 ABC（${pt}）`, B.tot ? `<p class="rp-p">A 類 ${B.A.length} 道占 ${Math.round(B.aShare * 100)}%；B 類 ${B.B.length} 道；C 類 ${B.C.length} 道${B.drop.length ? `（可考慮汰換：${B.drop.slice(0, 8).map((r) => esc(r.d.name)).join('、')}）` : ''}。</p>
        <table class="rp-t"><thead><tr><th>類</th><th>菜品</th><th class="r">份數</th>${B.hasRev ? '<th class="r">營業額</th>' : ''}<th class="r">佔比</th><th class="r">累計</th></tr></thead><tbody>${B.rows.slice(0, 24).map((r) => `<tr><td><b class="rp-abc ${r.cls}">${r.cls}</b></td><td>${esc(r.d.name)}</td><td class="r"><b>${fmt(r.q)}</b></td>${B.hasRev ? `<td class="r">${r.rev ? '$' + fmt(r.rev) : '—'}</td>` : ''}<td class="r">${(r.share * 100).toFixed(1)}%</td><td class="r">${(r.cum * 100).toFixed(0)}%</td></tr>`).join('')}</tbody></table>${B.rows.length > 24 ? `<p class="rp-p">…其餘 ${B.rows.length - 24} 道省略</p>` : ''}` : '<p class="rp-p">沒有紀錄</p>')}
    </div>`;
    const p2 = `<div class="rp">
      ${rpHead('菜品進階分析報告（續）', pt)}
      ${box('📈 趨勢警示（最近 4 週 vs 前 4 週）', T.ok ? `<p class="rp-p">整體每天 ${fmt(T.totA)} 份，前 4 週 ${fmt(T.totB)} 份（${dlt(T.totA, T.totB, true)}）。${T.sudden.length ? `<br>⚠ 最近 7 天突然下滑：${T.sudden.map((r) => `${esc(r.d.name)}（${Math.round(r.drop * 100)}%）`).join('、')}` : ''}</p>
        <div class="rp-cols"><div><b class="rp-mini">明顯成長</b>${T.up.length ? T.up.slice(0, 8).map((r) => `<div class="rp-li">${esc(r.d.name)}<span>↑${Math.round(r.ch * 100)}%</span></div>`).join('') : '<div class="rp-li">無</div>'}</div>
        <div><b class="rp-mini">明顯衰退</b>${T.down.length ? T.down.slice(0, 8).map((r) => `<div class="rp-li">${esc(r.d.name)}<span>↓${Math.round(-r.ch * 100)}%</span></div>`).join('') : '<div class="rp-li">無</div>'}</div></div>` : '<p class="rp-p">要有約 8 週紀錄</p>')}
      ${box(`⏱ 售完損失（${pt}）`, S.ev ? `<p class="rp-p">賣完 ${S.ev} 次，估計少賣 <b>${fmt(S.lost)}</b> 份${S.lostRev ? `，約 $${fmt(S.lostRev)}` : ''}。</p>
        <table class="rp-t"><thead><tr><th>菜品</th><th class="r">次數</th><th class="r">平均時間</th><th class="r">最早</th><th class="r">估計少賣</th></tr></thead><tbody>${S.rows.slice(0, 12).map((r) => `<tr><td>${esc(r.d.name)}</td><td class="r">${r.n}</td><td class="r">${m2hm(r.avgT)}</td><td class="r">${m2hm(r.early)}</td><td class="r"><b>${fmt(r.lost)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="rp-p">沒有賣完紀錄</p>')}
      <div class="rp-cols">
        ${box('🆕 新菜上市追蹤', N.rows.length ? N.rows.slice(0, 8).map((r) => `<div class="rp-li">${esc(r.d.name)}（${md(r.first)}）<span>${f1(r.avg)} 份/天・${r.verdict ? VERD[r.verdict][0].slice(2) + ' ' + Math.round(r.ratio * 100) + '%' : '—'}</span></div>`).join('') : '<p class="rp-p">最近沒有新菜</p>')}
        ${box('🔀 互相排擠', X.pairs.length ? X.pairs.slice(0, 8).map((p) => `<div class="rp-li">${esc(p.a.name)} ⇄ ${esc(p.b.name)}<span>${p.r <= -0.7 ? '強' : '中'}</span></div>`).join('') : '<p class="rp-p">沒有發現明顯互相排擠的菜</p>')}
      </div>
      ${box('📅 年度走勢（最近 12 個月，淡色為去年同月）', Y.tq ? `<div class="rp-yb">${Y.rows.map((r) => `<div><span>${r.qty ? fmt(r.qty) : ''}</span><div class="rp-yt">${r.ly ? `<em style="height:${(r.ly / maxY * 100).toFixed(0)}%"></em>` : ''}<i style="height:${(r.qty / maxY * 100).toFixed(0)}%"></i></div><b>${ymTxt(r.m)}</b></div>`).join('')}</div>
        ${Y.peak ? `<p class="rp-p">旺季 ${Y.peak.m.replace('-', '/')}（每天 ${fmt(Y.peak.avg)} 份），淡季 ${Y.low.m.replace('-', '/')}（每天 ${fmt(Y.low.avg)} 份）</p>` : ''}` : '<p class="rp-p">沒有紀錄</p>')}
    </div>`;
    return [await htmlToPdf([p1, p2]), fname(`${db.shop ? db.shop + '_' : ''}進階分析_${today().replace(/-/g, '')}.pdf`)];
  }

  // ------------------------------------------------------------------ PDF（月報、備料單）：html2canvas 截圖成 A4
  const loadedJs = {};
  const loadJs = (src) => loadedJs[src] || (loadedJs[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete loadedJs[src]; rej(new Error('無法載入 PDF 元件，請確認網路後再試')); };
    document.head.append(s);
  }));
  async function htmlToPdf(pages) {
    await loadJs('vendor/html2canvas.min.js');
    await loadJs('vendor/jspdf.umd.min.js');
    const host = document.createElement('div');
    host.className = 'pdf-render';
    host.innerHTML = pages.join('');
    document.body.append(host);
    try {
      const W = 210, H = 297, MG = 10, cw = W - MG * 2, chh = H - MG * 2;
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      let i = 0;
      for (const sh of host.children) {
        const cv = await window.html2canvas(sh, { scale: 2, backgroundColor: '#ffffff', windowWidth: 800 });
        let w = cw, h = cv.height / cv.width * cw;
        if (h > chh) { w *= chh / h; h = chh; } // 太長就等比縮小放進一頁
        if (i++) pdf.addPage();
        pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', MG + (cw - w) / 2, MG, w, h);
      }
      return new Uint8Array(pdf.output('arraybuffer'));
    } finally { host.remove(); }
  }
  async function runPdf(btn, make) {
    const t = btn.textContent;
    btn.disabled = true; btn.textContent = '產生中…';
    try { const [bytes, name] = await make(); await saveFile(bytes, name, 'application/pdf'); } catch (err) { alert('PDF 產生失敗：' + err.message); } finally { btn.disabled = false; btn.textContent = t; }
  }
  const rpHead = (title, sub) => `<div class="rp-h"><div><div class="rp-shop">${esc(db.shop || '菜品銷售紀錄')}</div><h1>${title}</h1></div><div class="rp-sub">${sub}<br>列印時間 ${new Date().toLocaleString('zh-TW', { hour12: false })}</div></div>`;
  const rpKpi = (l, v) => `<div class="rp-k"><span>${l}</span><b>${v}</b></div>`;
  async function buildMonthPdf(R) {
    const m = R.m, title = `${m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月 菜品銷售月報`;
    const lead = (new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).getDay() + 6) % 7;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="rp-d blank"></div>';
    const maxQ = Math.max(1, ...[...R.byDay.values()].map((x) => x.qty));
    for (let d = 1; d <= R.n; d++) {
      const k = `${m}-${pad(d)}`, x = R.byDay.get(k), w = (lead + d - 1) % 7;
      cells += `<div class="rp-d${w >= 5 ? ' we' : ''}"${x && x.qty ? ` style="background:rgba(217,72,15,${(0.06 + 0.3 * x.qty / maxQ).toFixed(2)})"` : ''}><i>${d}</i><b>${x && x.qty ? fmt(x.qty) : ''}</b>${x && x.note.trim() ? '<em>✎</em>' : ''}</div>`;
    }
    const W = wdAgg([...R.byDay.keys()].filter((k) => R.byDay.get(k).qty > 0));
    const maxW = Math.max(1, ...W.by.map((b) => b.avg));
    const half = R.rows.length > 18 ? Math.ceil(R.rows.length / 2) : R.rows.length;
    const maxD = Math.max(1, ...R.rows.map((r) => r.qty));
    const tbl = (rs, off) => `<table class="rp-t"><thead><tr><th>#</th><th>菜品</th><th>分類</th><th class="r">份數</th><th class="r">佔比</th></tr></thead><tbody>${rs.map((r, i) => `<tr><td>${i + off + 1}</td><td><b>${esc(r.d.name || '未命名')}</b></td><td>${esc(r.d.cat)}</td><td class="r"><b>${fmt(r.qty)}</b></td><td class="r"><span class="rp-bar" style="background:linear-gradient(90deg,#f08c2e ${(r.qty / maxD * 100).toFixed(0)}%,#f2ede5 0)"></span>${(r.qty / R.qty * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>`;
    const notes = [...R.byDay].filter(([, x]) => x.note.trim()).sort(([a], [b]) => (a < b ? -1 : 1));
    const top = R.rows[0];
    const page = `<div class="rp">
      ${rpHead(title, `${m.replace('-', '/')}/01 ～ ${m.replace('-', '/')}/${R.n}`)}
      <div class="rp-ks">${rpKpi('本月總份數', fmt(R.qty) + ' 份')}${rpKpi('有記錄天數', R.days + ' 天')}${rpKpi('平均每天', R.days ? fmt(R.qty / R.days) + ' 份' : '—')}${rpKpi(`比${cmpName(R, 'prev')}`, dlt(R.qty, R.cmp.prev.qty, true))}${rpKpi('賣最多', top ? esc(top.d.name) + `（${fmt(top.qty)}）` : '—')}</div>
      <div class="rp-row">
        <div class="rp-box rp-cal"><h2>每日份數</h2><div class="rp-g">${['一', '二', '三', '四', '五', '六', '日'].map((x, i) => `<div class="rp-wh${i >= 5 ? ' we' : ''}">${x}</div>`).join('')}${cells}</div></div>
        <div class="rp-box rp-wk"><h2>星期平均</h2>${W.by.map((b) => `<div class="rp-wr${b.w % 6 === 0 ? ' we' : ''}"><span>週${WD[b.w]}</span><span class="rp-bar"><i style="width:${(b.avg / maxW * 100).toFixed(0)}%"></i></span><b>${b.n ? fmt(b.avg) : '—'}</b></div>`).join('')}
          ${W.busy ? `<p>最忙週${WD[W.busy.w]}，最閒週${WD[W.calm.w]}</p>` : ''}</div>
      </div>
      <div class="rp-box"><h2>各菜品合計（${R.rows.length} 道）</h2>${R.rows.length ? `<div class="rp-cols">${tbl(R.rows.slice(0, half), 0)}${half < R.rows.length ? tbl(R.rows.slice(half), half) : ''}</div>` : '<p>本月沒有銷售紀錄</p>'}</div>
      ${notes.length ? `<div class="rp-box"><h2>備註</h2><ul class="rp-n">${notes.map(([k, x]) => `<li><b>${md(k)}（${WD[pd(k).getDay()]}）</b>${esc(x.note)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
    return [await htmlToPdf([page]), fname(`${db.shop ? db.shop + '_' : ''}菜品銷售月報_${m.replace('-', '')}.pdf`)];
  }
  async function buildForecastPdf(F) {
    const wd = pd(F.date).getDay();
    const byCat = new Map();
    for (const r of F.rows) { if (!byCat.has(r.d.cat)) byCat.set(r.d.cat, []); byCat.get(r.d.cat).push(r); }
    const page = `<div class="rp">
      ${rpHead(`備料單 ${F.date.replace(/-/g, '/')}（週${WD[wd]}）`, `${F.same ? `參考最近 ${F.ref.length} 個週${WD[wd]}` : `參考最近 ${F.ref.length} 天`}${F.buf ? `，多備 ${F.buf}%` : ''}<br>${F.ref.slice().reverse().map(md).join('、')}`)}
      <div class="rp-ks">${rpKpi('建議總備量', fmt(F.total) + ' 份')}${rpKpi('平均賣出', f1(F.avgTotal) + ' 份')}${rpKpi('要備的菜', F.rows.filter((r) => r.sug).length + ' 道')}</div>
      <table class="rp-t rp-fc"><thead><tr><th>菜品</th><th class="r">平均</th><th class="r">上次</th><th class="r">最多</th><th class="r">建議備</th><th class="c">實際備</th><th class="c">賣完時間</th></tr></thead>
        <tbody>${[...byCat].map(([cat, rs]) => `<tr class="rp-cat"><td colspan="7">${esc(cat)}　<small>${fmt(rs.reduce((s, r) => s + r.sug, 0))} 份</small></td></tr>`
          + rs.map((r) => `<tr><td><b>${esc(r.d.name || '未命名')}</b>${r.soN ? `<small class="rp-so">賣完${r.soN}次</small>` : ''}</td><td class="r">${f1(r.avg)}</td><td class="r">${r.last}</td><td class="r">${r.max}</td><td class="r big">${r.sug || '—'}</td><td class="wr"></td><td class="wr"></td></tr>`).join('')).join('')}</tbody>
        <tfoot><tr><td>合計</td><td class="r">${f1(F.avgTotal)}</td><td></td><td></td><td class="r big">${fmt(F.total)}</td><td></td><td></td></tr></tfoot></table>
      <div class="rp-sign"><span>備料人：</span><span>確認：</span></div>
    </div>`;
    return [await htmlToPdf([page]), fname(`${db.shop ? db.shop + '_' : ''}備料單_${F.date.replace(/-/g, '')}.pdf`)];
  }

  // ------------------------------------------------------------------ 匯出 Excel（單月：每日銷量明細＋菜品合計）
  function xlsxSheets(R) {
    const B = 1;
    const shop = db.shop || '菜品銷售紀錄';
    const title = `${R.m.slice(0, 4)} 年 ${+R.m.slice(5, 7)} 月`;
    const dishes = R.rows.map((r) => r.d);
    const days = [...R.byDay.keys()].sort();
    const daily = [
      [{ v: `${shop} ${title} 每日銷量`, s: B }],
      [],
      [{ v: '日期', s: B }, { v: '星期', s: B }, ...dishes.map((d) => ({ v: d.name, s: B })), { v: '當日合計', s: B }, { v: '備註', s: B }],
      ...days.map((k) => { const it = db.sales[k].items; const x = R.byDay.get(k); return [k, '週' + WD[pd(k).getDay()], ...dishes.map((d) => (it[d.id] && it[d.id].q ? it[d.id].q : null)), x.qty, x.note || null]; }),
      [{ v: '合計', s: B }, null, ...R.rows.map((r) => ({ v: r.qty, s: B })), { v: R.qty, s: B }, null],
    ];
    const sum = [
      [{ v: `${shop} ${title} 菜品合計`, s: B }],
      ['匯出時間', new Date().toLocaleString('zh-TW', { hour12: false })],
      ['總份數', R.qty], ['有記錄天數', R.days],
      [],
      ['排名', '菜品', '分類', '份數', '佔比', cmpName(R, 'prev'), '比上月', cmpName(R, 'year'), '比去年'].map((v) => ({ v, s: B })),
      ...R.rows.map((r, i) => {
        const pq = R.cmp.prev.byDish.get(r.d.id) || 0, yq = R.cmp.year.byDish.get(r.d.id) || 0;
        const pc = pctCh(r.qty, pq), yc = pctCh(r.qty, yq);
        return [i + 1, r.d.name + (r.d.deleted ? '（已刪除）' : ''), r.d.cat, r.qty, { v: R.qty ? r.qty / R.qty : 0, s: 3 }, pq || null, pc == null ? null : { v: pc, s: 3 }, yq || null, yc == null ? null : { v: yc, s: 3 }];
      }),
      [null, { v: '合計', s: B }, null, { v: R.qty, s: B }, null, { v: R.cmp.prev.qty, s: B }, pctCh(R.qty, R.cmp.prev.qty) == null ? null : { v: pctCh(R.qty, R.cmp.prev.qty), s: 3 }, { v: R.cmp.year.qty, s: B }, pctCh(R.qty, R.cmp.year.qty) == null ? null : { v: pctCh(R.qty, R.cmp.year.qty), s: 3 }],
    ];
    const sold = [];
    for (const k of days) for (const [id, e] of Object.entries(db.sales[k].items)) if (e.q && e.so) { const d = dishById(id); sold.push([k, '週' + WD[pd(k).getDay()], d ? d.name : '（已移除的菜）', d ? d.cat : '', e.q, e.so, e.by || null]); }
    sold.sort((a, b) => (a[0] + a[5] < b[0] + b[5] ? -1 : 1));
    return [
      { name: '每日銷量', rows: daily, cols: [12, 6, ...dishes.map((d) => Math.max(8, Math.min(16, d.name.length * 2 + 2))), 10, 24], freeze: 3 },
      { name: '菜品合計', rows: sum, cols: [12, 20, 10, 8, 9, 12, 9, 14, 9] },
      ...(sold.length ? [{ name: '售完紀錄', rows: [[{ v: `${shop} ${title} 售完紀錄`, s: B }], [], ['日期', '星期', '菜品', '分類', '份數', '賣完時間', '記錄人'].map((v) => ({ v, s: B })), ...sold], cols: [12, 6, 18, 10, 8, 10, 12], freeze: 3 }] : []),
    ];
  }
  const fname = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
  async function exportXlsx(R) {
    const bytes = XLSXW.build(xlsxSheets(R));
    const name = fname(`${db.shop ? db.shop + '_' : ''}菜品銷量_${R.m.replace('-', '')}.xlsx`);
    await saveFile(bytes, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  // ------------------------------------------------------------------ 存檔／分享
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function saveFile(data, name, mime) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (DESK) {
      const p = await (await api()).export_file(b64(bytes), name);
      if (p) toast('已儲存：' + p, 4000);
      return;
    }
    const blob = new Blob([bytes], { type: mime });
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && navigator.canShare) {
      const file = new File([blob], name, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('已下載：' + name);
  }

  // ------------------------------------------------------------------ Google 雲端同步
  const Cloud = {
    busy: false, again: false, timer: null, poll: null, state: '', err: '',
    on() { return !!(db.cloud && db.cloud.on && db.cloud.url && db.cloud.pw); },
    async req(body, c = db.cloud) {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 45000);
      try {
        const r = await fetch(c.url, { method: 'POST', body: JSON.stringify({ ...body, pw: c.pw }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal });
        const t = await r.text();
        let j;
        try { j = JSON.parse(t); } catch (e) { throw new Error(r.ok ? '雲端回應格式不對（網址正確嗎？）' : '雲端錯誤 HTTP ' + r.status); }
        if (!j.ok) { const e = new Error(j.err || '雲端錯誤'); e.auth = !!j.auth; throw e; }
        return j;
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('連線逾時');
        if (e instanceof TypeError) throw new Error('無法連線（請檢查網路或網址）');
        throw e;
      } finally { clearTimeout(to); }
    },
    changes(since) {
      const out = { dishes: [], sales: [], notes: [] };
      for (const d of db.dishes) if (d.at > since) out.dishes.push(d);
      for (const [k, v] of Object.entries(db.sales)) {
        for (const [id, e] of Object.entries(v.items)) if (e.at > since) out.sales.push({ d: k, id, q: e.q, p: e.p, c: e.c, at: e.at, so: e.so || '', by: e.by || '' });
        if (v.noteAt > since) out.notes.push({ d: k, note: v.note, at: v.noteAt });
      }
      if (db.shopAt > since) out.shop = { v: db.shop, at: db.shopAt };
      if (db.lock.at > since) out.settings = { v: JSON.stringify({ lock: { days: db.lock.days, pin: db.lock.pin } }), at: db.lock.at };
      return out;
    },
    pending() {
      const c = this.changes(db.cloud.pushedAt);
      return c.dishes.length + c.sales.length + c.notes.length + (c.shop ? 1 : 0) + (c.settings ? 1 : 0);
    },
    merge(r) {
      let ch = false;
      for (const x of r.dishes || []) {
        if (!x || !x.id) continue;
        const l = dishById(x.id);
        if (!l) { db.dishes.push(normDish(x, db.dishes.length)); ch = true; } else if (num(x.at) > l.at) { Object.assign(l, normDish(x, 0)); ch = true; }
      }
      if (ch) sortDishes(db);
      for (const x of r.sales || []) {
        if (!x || !validYmd(x.d) || !x.id) continue;
        const day = dayOf(x.d, true), l = day.items[x.id];
        if (!l || num(x.at) > l.at) { day.items[x.id] = entry(Math.max(0, Math.floor(num(x.q))), num(x.p), num(x.c), num(x.at), x.so, x.by); ch = true; }
      }
      for (const x of r.notes || []) {
        if (!x || !validYmd(x.d)) continue;
        const day = dayOf(x.d, true);
        if (num(x.at) > day.noteAt) { day.note = String(x.note || ''); day.noteAt = num(x.at); ch = true; }
      }
      if (r.settings && num(r.settings.at) > db.lock.at) {
        try { const v = JSON.parse(r.settings.v || '{}'); if (v.lock) { db.lock = normLock({ ...v.lock, at: r.settings.at }); ch = true; } } catch (e) { /* 格式不對就略過 */ }
      }
      if (r.shop && num(r.shop.at) > db.shopAt) { db.shop = String(r.shop.v || ''); db.shopAt = num(r.shop.at); renderShop(); ch = true; }
      return ch;
    },
    schedule(ms = 1500) { if (!this.on()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), ms); },
    async sync() {
      if (!this.on()) return false;
      if (this.busy) { this.again = true; return false; }
      clearTimeout(this.timer);
      this.busy = true; this.show('sync');
      const c = db.cloud;
      try {
        const t0 = now() - 1;
        const r = await this.req({ a: 'sync', since: c.rev, changes: this.changes(c.pushedAt) });
        if (db.cloud !== c || !this.on()) return false;
        const changed = this.merge(r);
        c.rev = r.rev; c.pushedAt = t0; c.lastOk = now();
        if (r.sheet) c.sheet = r.sheet;
        await flush();
        this.err = ''; this.show('ok');
        if (changed) refresh();
        return true;
      } catch (e) {
        this.err = e.message; this.show(e.auth ? 'auth' : 'err');
        return false;
      } finally {
        this.busy = false;
        if (this.again) { this.again = false; this.schedule(300); }
      }
    },
    async tick() {
      if (document.hidden || this.busy || !this.on()) return;
      if (this.state !== 'ok' || this.pending()) return this.sync();
      try {
        const r = await this.req({ a: 'rev' });
        if (r.rev !== db.cloud.rev) this.sync();
      } catch (e) { this.err = e.message; this.show(e.auth ? 'auth' : 'err'); }
    },
    start() {
      clearInterval(this.poll);
      if (!this.on()) { this.show(''); return; }
      this.poll = setInterval(() => this.tick(), 15000);
      this.sync();
    },
    show(s) {
      this.state = s;
      const e = $('#cloudst');
      const map = { sync: ['☁ 同步中…', ''], ok: ['☁ 已同步', 'ok'], err: ['☁ 離線', 'bad'], auth: ['☁ 密碼錯誤', 'bad'] };
      const [t, cls] = map[s] || ['', ''];
      e.textContent = t; e.className = 'cloudst ' + cls;
      e.title = s === 'ok' ? '最後同步 ' + new Date(db.cloud.lastOk).toLocaleTimeString('zh-TW', { hour12: false }) : this.err;
      e.hidden = !t;
      const box = $('#cloudinfo'); if (box) box.innerHTML = cloudInfo();
    },
  };
  let pendingRefresh = false;
  function refresh() {
    const a = document.activeElement;
    if (a && $('#app').contains(a) && a.matches('input, textarea, select')) { pendingRefresh = true; return; }
    pendingRefresh = false;
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRefresh) refresh(); }, 80));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Cloud.tick(); });
  window.addEventListener('online', () => Cloud.tick());

  function choose(msg, opts) {
    return new Promise((res) => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="btns">${opts.map(([k, t], i) => `<button class="btn${i ? '' : ' primary'}" data-k="${k}">${esc(t)}</button>`).join('')}</div></div>`;
      m.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b || e.target === m) { m.remove(); res(b ? b.dataset.k : null); } };
      document.body.append(m);
      $('.btn', m).focus();
    });
  }
  const isPristine = () => !Object.values(db.sales).some(dayHasData) && db.dishes.every((d) => d.at <= db.seedAt);
  async function connectCloud(url, pw) {
    url = url.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\/?/.test(url)) throw new Error('網址格式不對，應該像 https://script.google.com/macros/s/…/exec');
    if (pw.length < 4) throw new Error('密碼至少 4 個字');
    const c = { url, pw, rev: 0, pushedAt: 0, on: true, lastOk: 0 };
    const r = await Cloud.req({ a: 'ping' }, c);
    let mode = 'merge';
    if (r.counts.dishes > 0) {
      if (isPristine()) mode = 'replace';
      else {
        mode = await choose(`雲端已經有資料（菜品 ${r.counts.dishes} 道、銷售 ${r.counts.sales} 筆），這台裝置也有資料。要怎麼處理？`,
          [['merge', '合併（兩邊都保留）'], ['replace', '改用雲端資料（這台的資料清掉）'], ['cancel', '取消']]);
        if (!mode || mode === 'cancel') return null;
      }
    }
    if (mode === 'replace') { const me = db.me; db = blank(); db.me = me; }
    db.cloud = c;
    if (r.sheet) c.sheet = r.sheet;
    await flush();
    const ok = await Cloud.sync();
    Cloud.start();
    if (!ok) throw new Error(Cloud.err || '同步失敗');
    return { claimed: r.claimed, mode, cloudHad: r.counts.dishes > 0 };
  }
  function cloudInfo() {
    const c = db.cloud;
    if (!Cloud.on()) return '';
    const st = Cloud.state === 'ok' ? `<span class="dl up">● 已同步</span>` : Cloud.state === 'sync' ? '同步中…' : `<span class="dl down">● ${esc(Cloud.err || '尚未同步')}</span>`;
    return `${st}${c.lastOk ? `・最後同步 ${new Date(c.lastOk).toLocaleString('zh-TW', { hour12: false })}` : ''}`;
  }


  // ------------------------------------------------------------------ 設定（店名、菜品清單、雲端、備份）
  function dishListHtml() {
    const list = liveDishes();
    return list.length ? `<ul class="dlist">${list.map((d, i) => `<li data-id="${d.id}" class="${d.off ? 'off' : ''}">
        <span class="mv"><button class="btn icon sm" data-act="up" ${i ? '' : 'disabled'} title="上移" aria-label="上移">▲</button><button class="btn icon sm" data-act="down" ${i < list.length - 1 ? '' : 'disabled'} title="下移" aria-label="下移">▼</button></span>
        <input class="f-name" data-f="name" value="${esc(d.name)}" placeholder="菜名" aria-label="菜名">
        <input class="f-cat" data-f="cat" list="catlist" value="${esc(d.cat)}" placeholder="分類" aria-label="分類">
        <label class="chk f-off"><input type="checkbox" data-f="off" ${d.off ? 'checked' : ''}> 停售</label>
        <button class="btn icon sm danger f-del" data-act="del" title="刪除" aria-label="刪除">✕</button></li>`).join('')}</ul>`
      : '<p class="empty">尚無菜品，按「＋ 新增菜品」開始。</p>';
  }
  function viewSettings(el) {
    const days = Object.keys(db.sales).filter((k) => dayHasData(db.sales[k])).sort();
    const c = db.cloud || {};
    const on = Cloud.on();
    const live = liveDishes();
    el.innerHTML = `
      <div class="page-head"><h2>菜品與設定</h2></div>
      <section class="card form">
        <label>🏪 店名（顯示在標題與匯出檔名）<input id="shopname" value="${esc(db.shop)}" placeholder="例如：阿明小吃店"></label>
      </section>
      <section class="card form">
        ${(() => { const k = (() => { try { const a = window.KitchenAuth && window.KitchenAuth.get(); return a && a.me && a.me.name; } catch (e) { return ''; } })();
          return k ? `<label>👤 修改紀錄的名字</label><p class="muted" style="margin:6px 0 0">目前用廚房專用表格系統登入的名字：<b>${esc(k)}</b></p>`
            : `<label>👤 這台裝置的使用者（記在修改紀錄裡）<input id="me" value="${esc(db.me)}" maxlength="40" placeholder="例如：王小明"></label>`; })()}
      </section>
      <section class="card" id="lockcard">
        <div class="card-head"><h3>🔒 鎖定過去的紀錄</h3>${lockOn() ? `<span class="chip on">${lockText(db.lock.days)}</span>` : ''}</div>
        <p class="muted pad">避免不小心改到以前的份數。鎖定後，比較早的日子只能查看，要輸入主管密碼才能修改（清除、還原資料也要密碼）。${on ? '設定會同步到所有連線的裝置。' : ''}${kitchenAdmin() ? '你是廚房系統的管理者，不受鎖定限制。' : ''}</p>
        <div class="pad opt"><span>鎖定</span><div class="seg" role="group">${[[0, '不鎖定'], [1, '只能改今天'], [3, '最近 3 天'], [7, '最近 7 天']].map(([n, t]) => `<button data-act="lockdays" data-v="${n}" class="${(lockOn() ? db.lock.days : 0) === n ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        ${lockOn() ? '<div class="btns pad" style="margin-top:12px"><button class="btn" data-act="lockpin">修改主管密碼</button><button class="btn" data-act="lockforgot">忘記主管密碼</button></div>' : ''}
      </section>
      <section class="card" id="dishes">
        <div class="card-head"><h3>🍱 菜品清單</h3><span class="muted sm">${live.length} 道菜・${catList().length} 個分類</span><div class="sp"></div>
          <button class="btn primary" data-act="add">＋ 新增菜品</button></div>
        <p class="hint pad">修改會自動儲存。分類順序依菜品排列順序決定；暫時不賣的菜勾「停售」，每日頁面就不會出現。</p>
        <datalist id="catlist">${catList().map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <div id="dlist">${dishListHtml()}</div>
      </section>
      <section class="card">
        <div class="card-head"><h3>☁ Google 雲端同步</h3></div>
        ${on ? `
          <p class="pad">資料存在你的 Google 試算表，所有連線的手機、電腦自動同步。<br><span id="cloudinfo">${cloudInfo()}</span></p>
          <div class="btns pad">
            <button class="btn primary" data-act="syncnow">立即同步</button>
            ${c.sheet ? `<a class="btn" href="${esc(c.sheet)}" target="_blank" rel="noopener" data-act="opensheet">開啟試算表</a>` : ''}
            <button class="btn" data-act="pushall" title="把這台裝置的所有資料重新上傳一次（雲端較新的資料不會被蓋掉）">全部重新上傳</button>
            <button class="btn" data-act="setpw">修改密碼</button>
            <button class="btn danger" data-act="disconnect">中斷連線</button>
          </div>`
        : `
          <p class="muted pad">連上 Google 試算表後，資料會存在雲端，多台手機和電腦可以共用同一份資料。</p>
          <div class="form pad cloudform">
            <label>雲端網址<input id="curl" value="${esc(c.url || window.DISH_CLOUD_URL || '')}" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false" autocomplete="off"></label>
            <label>同步密碼<input id="cpw" type="password" autocomplete="current-password" placeholder="至少 4 個字"></label>
            <button class="btn primary" data-act="connect">連線</button>
          </div>
          <p class="muted pad">第一台連線時輸入的密碼會成為雲端密碼，其他裝置請輸入同一組密碼。</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h3>💾 資料備份</h3></div>
        <p class="muted pad">目前有 ${live.length} 道菜、${days.length} 天的銷售紀錄${days.length ? `（${days[0]} ～ ${days[days.length - 1]}）` : ''}。
          ${DESK ? '<br>本機資料檔：<code id="dpath">…</code>（每天自動保留一份備份）' : on ? '' : '<br>資料存在這個瀏覽器裡，換手機或清除瀏覽資料前請先匯出備份。'}</p>
        <div class="btns pad"><button class="btn" data-act="backup">⬇ 匯出備份（JSON）</button>
          <label class="btn">⬆ 從備份還原<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>🗑 清除</h3></div>
        <div class="btns pad">
          <button class="btn danger" data-act="clearsales">清除所有銷售紀錄</button>
          <button class="btn danger" data-act="reset" ${on ? 'disabled title="請先中斷雲端連線"' : ''}>全部重設（菜品也清空）</button>
        </div>
        ${on ? '<p class="muted pad">連線雲端時「清除所有銷售紀錄」會連雲端一起清除。</p>' : ''}
      </section>
      <p class="muted center">菜品銷售紀錄 v${VERSION}${DESK ? '（桌面版）' : ''}・快捷鍵 Alt+1～5 切換頁面</p>`;
    if (DESK) api().then((x) => x.data_path()).then((p) => { const e = $('#dpath'); if (e) e.textContent = p; });
    const redrawList = (focusId, sel) => {
      $('#dlist').innerHTML = dishListHtml();
      $('#catlist').innerHTML = catList().map((x) => `<option value="${esc(x)}">`).join('');
      const b = focusId && $(`li[data-id="${focusId}"] ${sel}`, el);
      if (b && !b.disabled) b.focus();
    };

    el.oninput = (e) => {
      const t = e.target;
      if (t.id === 'shopname') { db.shop = t.value.trim(); db.shopAt = now(); renderShop(); save(); return; }
      if (t.id === 'me') { db.me = t.value.trim().slice(0, 40); save(); return; }
      const f = t.dataset.f; if (!f) return;
      const li = t.closest('li'), d = dishById(li.dataset.id);
      if (f === 'name') { if (!t.value.trim()) return; d.name = t.value.trim(); }
      else if (f === 'cat') d.cat = t.value.trim() || '未分類';
      else if (f === 'off') { d.off = t.checked; li.classList.toggle('off', d.off); }
      d.at = now(); save();
    };
    el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'cpw') { e.preventDefault(); $('[data-act=connect]', el).click(); } };
    el.onchange = async (e) => {
      const f = e.target.dataset.f;
      if (f === 'name') {
        if (!e.target.value.trim()) { e.target.value = dishById(e.target.closest('li').dataset.id).name; toast('菜名不能空白'); }
        return;
      }
      if (f === 'cat') { $('#catlist').innerHTML = catList().map((x) => `<option value="${esc(x)}">`).join(''); return; }
      if (e.target.id !== 'restore' || !e.target.files[0]) return;
      if (!(await askPin('還原備份需要主管密碼'))) { e.target.value = ''; return; }
      try {
        const d = norm(JSON.parse(await e.target.files[0].text()));
        const n = Object.values(d.sales).filter(dayHasData).length;
        if (!confirm(`還原這份備份？\n菜品 ${d.dishes.filter((x) => !x.deleted).length} 道、銷售紀錄 ${n} 天。\n\n${Cloud.on() ? '備份內容會覆蓋雲端上相同日期、相同菜品的資料。' : '目前的資料會被完全取代。'}`)) return;
        if (Cloud.on()) {
          // 連線中：把備份當成最新修改，同步上去
          const t = now();
          d.dishes.forEach((x) => { x.at = t; });
          for (const v of Object.values(d.sales)) { Object.values(v.items).forEach((x) => { x.at = t; }); if (v.noteAt) v.noteAt = t; }
          if (d.shop) d.shopAt = t;
          d.cloud = db.cloud;
        } else delete d.cloud;
        d.me = db.me;
        db = d; await flush(); renderShop(); viewSettings(el); toast('已還原備份');
        Cloud.schedule(200);
      } catch (err) { alert('無法讀取備份：' + err.message); } finally { e.target.value = ''; }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      const li = b.closest('li[data-id]');
      if (a === 'add') {
        const r = await askDish(); if (!r) return;
        const d = addDish(r.name, r.cat);
        redrawList();
        const row = $(`li[data-id="${d.id}"]`, el); if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
        toast(`已新增「${d.name}」`);
      } else if ((a === 'up' || a === 'down') && li) {
        const list = liveDishes(), d = dishById(li.dataset.id);
        const i = list.indexOf(d), j = a === 'up' ? i - 1 : i + 1;
        if (!list[j]) return;
        const o = list[j], t = now();
        [d.ord, o.ord] = [o.ord, d.ord];
        if (d.ord === o.ord) d.ord += a === 'up' ? -0.5 : 0.5;
        d.at = o.at = t;
        sortDishes(db); save(); redrawList(d.id, `[data-act=${a}]`);
      } else if (a === 'del' && li) {
        const d = dishById(li.dataset.id);
        const used = hasSales(d.id);
        if (!confirm(`刪除「${d.name || '未命名'}」？${used ? '\n\n這道菜已有銷售紀錄，過去的紀錄與月合計仍會保留它的份數。\n（只是暫時不賣的話，勾「停售」就好）' : ''}`)) return;
        d.deleted = true; d.at = now(); // 保留刪除記號，其他裝置同步時才會一起刪掉
        save(); redrawList();
      } else if (a === 'connect') {
        b.disabled = true; b.textContent = '連線中…';
        try {
          const r = await connectCloud($('#curl').value, $('#cpw').value);
          if (r) {
            renderShop();
            toast(r.claimed ? '已連線，這組密碼已設為雲端密碼' : r.cloudHad ? (r.mode === 'replace' ? '已連線，已下載雲端資料' : '已連線，資料已合併') : '已連線，資料已上傳到雲端', 4000);
          }
        } catch (err) { alert('連線失敗：' + err.message); }
        viewSettings(el);
      } else if (a === 'syncnow') {
        const ok = await Cloud.sync(); toast(ok ? '同步完成' : '同步失敗：' + Cloud.err);
      } else if (a === 'pushall') {
        if (!confirm('把這台裝置的所有資料重新上傳一次？（雲端上較新的資料不會被蓋掉）')) return;
        db.cloud.pushedAt = 0; db.cloud.rev = 0;
        const ok = await Cloud.sync(); toast(ok ? '已重新上傳並下載雲端資料' : '失敗：' + Cloud.err);
      } else if (a === 'opensheet') {
        if (DESK) { e.preventDefault(); (await api()).open_url(db.cloud.sheet); }
      } else if (a === 'setpw') {
        const np = prompt('輸入新的同步密碼（至少 4 個字）。\n改完後其他裝置要用新密碼重新連線。');
        if (np == null) return;
        if (np.length < 4) return alert('密碼至少 4 個字');
        if (prompt('再輸入一次新密碼確認：') !== np) return alert('兩次輸入不一樣，沒有修改');
        try { await Cloud.req({ a: 'setpw', newpw: np }); db.cloud.pw = np; await flush(); toast('密碼已修改'); } catch (err) { alert('修改失敗：' + err.message); }
      } else if (a === 'disconnect') {
        if (!confirm('中斷這台裝置的雲端連線？\n資料會留在這台和雲端，之後可以再連線。')) return;
        await Cloud.sync();
        db.cloud.on = false; db.cloud.pw = '';
        await flush(); Cloud.start(); viewSettings(el); toast('已中斷雲端連線');
      } else if (a === 'backup') {
        const copy = { ...db }; delete copy.cloud;
        await saveFile(JSON.stringify(copy, null, 1), fname(`${db.shop ? db.shop + '_' : ''}菜品銷售備份_${today().replace(/-/g, '')}.json`), 'application/json');
      } else if (a === 'lockdays') {
        const n = +b.dataset.v;
        if (n === (lockOn() ? db.lock.days : 0)) return;
        if (!(await askPin('修改鎖定設定需要主管密碼'))) return;
        let pin = lockOn() ? db.lock.pin : '';
        if (n > 0 && !pin) {
          const p1 = await askText('設定主管密碼', 'password', '', '4～8 位數字。解鎖過去的紀錄時要輸入這組密碼。');
          if (p1 == null) return;
          if (!/^\d{4,8}$/.test(p1)) return alert('主管密碼請輸入 4～8 位數字');
          if ((await askText('再輸入一次主管密碼', 'password')) !== p1) return alert('兩次輸入不一樣，沒有設定');
          pin = await pinHash(p1);
        }
        db.lock = { days: n, pin: n > 0 ? pin : '', at: now() };
        save(); viewSettings(el); toast(n ? `已鎖定：${lockText(n)}` : '已取消鎖定');
      } else if (a === 'lockpin') {
        if (!(await askPin('請輸入目前的主管密碼'))) return;
        const p1 = await askText('新的主管密碼', 'password', '', '4～8 位數字');
        if (p1 == null) return;
        if (!/^\d{4,8}$/.test(p1)) return alert('主管密碼請輸入 4～8 位數字');
        if ((await askText('再輸入一次新密碼', 'password')) !== p1) return alert('兩次輸入不一樣，沒有修改');
        db.lock = { ...db.lock, pin: await pinHash(p1), at: now() };
        save(); toast('主管密碼已修改');
      } else if (a === 'lockforgot') {
        if (Cloud.on()) {
          const p = await askText('輸入雲端同步密碼來取消鎖定', 'password', '', '忘記主管密碼時，用雲端同步密碼取消鎖定，再重新設定。');
          if (p == null) return;
          if (p !== db.cloud.pw) return alert('雲端同步密碼不對');
        } else if (prompt('忘記主管密碼：確定要取消鎖定請輸入「取消鎖定」') !== '取消鎖定') return;
        db.lock = { days: 0, pin: '', at: now() };
        save(); viewSettings(el); toast('已取消鎖定，可以重新設定');
      } else if (a === 'clearsales') {
        if (!days.length) return toast('沒有銷售紀錄');
        if (!(await askPin('清除銷售紀錄需要主管密碼'))) return;
        if (prompt(`將刪除全部 ${days.length} 天的銷售紀錄${Cloud.on() ? '（雲端也會一起清除）' : ''}，無法復原。\n確定請輸入「清除」：`) !== '清除') return;
        if (Cloud.on()) {
          const t = now();
          for (const v of Object.values(db.sales)) {
            for (const x of Object.values(v.items)) if (x.q) { x.q = 0; delete x.so; x.at = t; }
            if (v.note) { v.note = ''; v.noteAt = t; }
          }
        } else { db.sales = {}; db.dishes = db.dishes.filter((d) => !d.deleted); }
        save(); viewSettings(el); toast('已清除銷售紀錄');
      } else if (a === 'reset') {
        if (Cloud.on()) return toast('請先中斷雲端連線');
        if (!(await askPin('全部重設需要主管密碼'))) return;
        if (prompt('將刪除全部菜品與銷售紀錄，並恢復範例菜品，無法復原。\n確定請輸入「重設」：') !== '重設') return;
        const keep = db.cloud;
        const me = db.me;
        db = seed(); db.me = me; if (keep) db.cloud = keep;
        save(); renderShop(); viewSettings(el); toast('已重設');
      }
    };
  }
  // 示範資料（只給自我測試用，畫面上不再提供按鈕）
  function demoData(nDays) {
    const list = liveDishes().filter((d) => !d.off);
    const pop = new Map(list.map((d) => [d.id, 0.3 + Math.random() * 1.7]));
    let n = 0; const t = now();
    for (let i = nDays - 1; i >= 0; i--) {
      const k = addD(today(), -i);
      if (dayHasData(db.sales[k])) continue;
      const wd = pd(k).getDay();
      if (wd === 1) continue; // 週一公休
      const f = (wd === 0 || wd === 6 ? 1.35 : 1) * (0.8 + Math.random() * 0.4);
      const items = {};
      for (const d of list) {
        const q = Math.round(pop.get(d.id) * f * 12 * (0.6 + Math.random() * 0.8));
        if (q > 0) items[d.id] = { q, p: d.price, c: d.cost, at: t };
      }
      const rain = Math.random() < 0.06;
      db.sales[k] = { items, note: rain ? '下雨' : '', noteAt: rain ? t : 0 };
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ 啟動
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && /^[1-5]$/.test(e.key)) {
      e.preventDefault();
      location.hash = '#/' + VIEWS[+e.key - 1];
    }
  });
  window.addEventListener('hashchange', route);

  async function start() {
    let raw = null;
    try { raw = await loadRaw(); } catch (e) { console.error(e); }
    try { db = raw ? norm(JSON.parse(raw)) : null; } catch (e) {
      alert('資料讀取失敗：' + e.message + '\n將以範例菜品啟動（原資料不會被覆蓋，直到你修改）。');
      db = seed();
    }
    if (!db) { db = seed(); await flush(); }
    renderShop();
    route();
    setStatus('');
    Cloud.start();
    if (!DESK && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  // 測試用（廚房專用表格系統也會用 db / Cloud / connectCloud / flush）
  window.__dish = { get db() { return db; }, flush, Cloud, connectCloud, demoData, monthData, forecast, weekdayStats, insightData, insightPdf: () => buildInsightPdf(insightData()), monthPdf: (m) => buildMonthPdf(monthData(m)), forecastPdf: (d) => buildForecastPdf(forecast(d || addD(today(), 1))), xlsxSheets, buildXlsx: (R) => b64(XLSXW.build(xlsxSheets(R || monthData()))), VERSION };
  start();
})();
