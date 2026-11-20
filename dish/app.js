/* 菜品銷售紀錄 — 每天賣了哪些菜、各幾份；每月合計（PWA 與桌面版共用） */
(() => {
  'use strict';
  const VERSION = '2.1.0';
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
  const blank = () => ({ ver: 2, shop: '', shopAt: 0, dishes: [], sales: {}, createdAt: Date.now(), seedAt: 0 });
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
        v.items[id] = { q: Math.max(0, Math.floor(num(e.q))), p: num(e.p), c: num(e.c), at: num(e.at) || 1 };
      }
      v.note = String(v.note || '');
      v.noteAt = num(v.noteAt) || (v.note ? 1 : 0);
    }
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

  // ------------------------------------------------------------------ 路由
  // 舊網址 #/menu → 設定、#/report → 每月合計（首頁或書籤的舊連結仍可用）
  const VIEWS = ['day', 'month', 'settings'];
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
      <div class="kpis k3" id="daykpi"></div>
      <div class="day-groups">${[...groups].map(([cat, ds], gi) => `
        <section class="group" style="--gc:var(--c${gi % 6 + 1})"><h3><i class="dot"></i>${esc(cat)}<span class="gn">${ds.length} 道</span><span class="gq" data-gq></span></h3>
        ${ds.map((x) => {
          const q = qOf(v, x.id);
          return `<div class="row${q ? ' has' : ''}" data-id="${x.id}" data-name="${esc(x.name.toLowerCase())}">
            <div class="nm">${esc(x.name || '未命名')}${x.deleted ? '<small class="tag">已刪除</small>' : ''}${x.off ? '<small class="tag">停售</small>' : ''}</div>
            <div class="qty"><button class="btn icon" data-act="dec" tabindex="-1" aria-label="減一">−</button><input type="number" min="0" step="1" inputmode="numeric" value="${q || ''}" placeholder="0" data-q aria-label="${esc(x.name)} 份數"><button class="btn icon" data-act="inc" tabindex="-1" aria-label="加一">＋</button></div></div>`;
        }).join('')}
        </section>`).join('') || '<p class="empty">還沒有菜品，按下方「＋ 新增菜品」開始。</p>'}
      </div>
      <p class="empty" id="nomatch" hidden>找不到符合的菜品</p>
      <label class="note">備註<textarea id="note" rows="2" placeholder="例如：下雨、包場、店休…">${esc(v ? v.note : '')}</textarea></label>
      <div class="day-tools">
        <button class="btn" data-act="add">＋ 新增菜品</button>
        <span class="sp"></span>
        <button class="btn" data-act="copy" title="把最近一個有紀錄的日子的份數帶入本日（只填本日沒輸入的菜）">帶入上次份數</button>
        <button class="btn danger" data-act="clearday">清空本日</button>
      </div>`;
    const go = (s) => { location.hash = '#/day/' + s; };
    applyFilter(); renderDayKpi();
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'prev') go(addD(date, -1));
      else if (a === 'next') go(addD(date, 1));
      else if (a === 'today') go(today());
      else if (a === 'inc' || a === 'dec') {
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
          for (const x of Object.values(day.items)) if (x.q) { x.q = 0; x.at = t; }
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
          day.items[id] = { q: x.q, p: d.price, c: d.cost, at: t }; n++;
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
      if (e && e.q > 0) { e.q = q; e.at = now(); }
      else day.items[id] = { q, p: x.price, c: x.cost, at: now() }; // p/c 保留給舊版與試算表的欄位
    } else if (e) { e.q = 0; e.at = now(); }
    save();
    row.classList.toggle('has', q > 0);
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
  function monthAgg(m) {
    const r = { m, qty: 0, days: 0, byDay: new Map(), byDish: new Map() };
    for (const [k, v] of Object.entries(db.sales)) {
      if (!k.startsWith(m + '-')) continue;
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
    return { ...a, rows, n: daysIn(m) };
  }
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
    el.innerHTML = `
      <div class="page-head">
        <div class="datebar">
          <button class="btn icon" data-act="prev" title="上個月" aria-label="上個月">◀</button>
          <input type="month" id="month" value="${m}" aria-label="月份">
          <button class="btn icon" data-act="next" title="下個月" aria-label="下個月">▶</button>
          ${isCur ? '' : '<button class="btn" data-act="cur">回本月</button>'}
        </div>
        <span class="sp"></span>
        <button class="btn primary" data-act="xlsx" ${R.qty ? '' : 'disabled'}>⬇ 匯出本月 Excel</button>
      </div>
      <div class="kpis">
        ${kpi(`${+m.slice(5, 7)} 月總份數`, fmt(R.qty) + '<small> 份</small>', '', 'main', '🍽')}
        ${kpi('有記錄天數', R.days + '<small> 天</small>', '', '', '🗓')}
        ${kpi('平均每天', R.days ? fmt(R.qty / R.days) + '<small> 份</small>' : '—', '', '', '📈')}
        ${kpi('賣最多', top ? esc(top.d.name) : '—', top ? fmt(top.qty) + ' 份' : '', 'best', '🏆')}
      </div>
      <section class="card">
        <div class="card-head"><h3>📅 ${m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月 每日份數</h3><span class="muted sm">點日期可查看或修改當天紀錄</span></div>
        <div class="cal"><div class="cal-h">${['一', '二', '三', '四', '五', '六', '日'].map((x, i) => `<span${i >= 5 ? ' class="we"' : ''}>${x}</span>`).join('')}</div>
          <div class="cal-g">${cells}</div></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>🏆 本月各菜品合計</h3><span class="muted sm">${R.rows.length} 道菜有賣</span></div>
        ${R.rows.length ? `<div class="tbl-wrap"><table class="rank"><thead><tr><th class="c">#</th><th>菜品</th><th>分類</th><th class="r">份數</th><th class="share">佔比</th></tr></thead>
        <tbody>${R.rows.map((r, i) => `<tr><td class="c"><span class="rk${i < 3 ? ' r' + (i + 1) : ''}">${i + 1}</span></td><td class="b">${esc(r.d.name || '未命名')}${r.d.deleted ? '<small class="tag">已刪除</small>' : ''}</td><td>${r.d.cat ? `<span class="chip">${esc(r.d.cat)}</span>` : ''}</td><td class="r b">${fmt(r.qty)}</td>
          <td class="share"><span class="track"><i style="width:${(r.qty / maxD * 100).toFixed(1)}%"></i></span><small>${(r.qty / R.qty * 100).toFixed(1)}%</small></td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>合計</td><td></td><td class="r">${fmt(R.qty)}</td><td class="share"></td></tr></tfoot></table></div>`
        : `<p class="empty">這個月還沒有銷售紀錄。</p>`}
      </section>`;
    const go = (x) => { location.hash = '#/month/' + x; };
    el.onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'prev') go(addM(m, -1));
      else if (a === 'next') go(addM(m, 1));
      else if (a === 'cur') go(t.slice(0, 7));
      else if (a === 'xlsx') exportXlsx(R);
    };
    el.onchange = (e) => { if (e.target.id === 'month' && /^\d{4}-\d{2}$/.test(e.target.value)) go(e.target.value); };
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
      ['排名', '菜品', '分類', '份數', '佔比'].map((v) => ({ v, s: B })),
      ...R.rows.map((r, i) => [i + 1, r.d.name + (r.d.deleted ? '（已刪除）' : ''), r.d.cat, r.qty, { v: R.qty ? r.qty / R.qty : 0, s: 3 }]),
      [null, { v: '合計', s: B }, null, { v: R.qty, s: B }, null],
    ];
    return [
      { name: '每日銷量', rows: daily, cols: [12, 6, ...dishes.map((d) => Math.max(8, Math.min(16, d.name.length * 2 + 2))), 10, 24], freeze: 3 },
      { name: '菜品合計', rows: sum, cols: [12, 20, 10, 8, 9] },
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
        for (const [id, e] of Object.entries(v.items)) if (e.at > since) out.sales.push({ d: k, id, q: e.q, p: e.p, c: e.c, at: e.at });
        if (v.noteAt > since) out.notes.push({ d: k, note: v.note, at: v.noteAt });
      }
      if (db.shopAt > since) out.shop = { v: db.shop, at: db.shopAt };
      return out;
    },
    pending() {
      const c = this.changes(db.cloud.pushedAt);
      return c.dishes.length + c.sales.length + c.notes.length + (c.shop ? 1 : 0);
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
        if (!l || num(x.at) > l.at) { day.items[x.id] = { q: Math.max(0, Math.floor(num(x.q))), p: num(x.p), c: num(x.c), at: num(x.at) }; ch = true; }
      }
      for (const x of r.notes || []) {
        if (!x || !validYmd(x.d)) continue;
        const day = dayOf(x.d, true);
        if (num(x.at) > day.noteAt) { day.note = String(x.note || ''); day.noteAt = num(x.at); ch = true; }
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
    if (mode === 'replace') db = blank();
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
      <p class="muted center">菜品銷售紀錄 v${VERSION}${DESK ? '（桌面版）' : ''}・快捷鍵 Alt+1～3 切換頁面</p>`;
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
      } else if (a === 'clearsales') {
        if (!days.length) return toast('沒有銷售紀錄');
        if (prompt(`將刪除全部 ${days.length} 天的銷售紀錄${Cloud.on() ? '（雲端也會一起清除）' : ''}，無法復原。\n確定請輸入「清除」：`) !== '清除') return;
        if (Cloud.on()) {
          const t = now();
          for (const v of Object.values(db.sales)) {
            for (const x of Object.values(v.items)) if (x.q) { x.q = 0; x.at = t; }
            if (v.note) { v.note = ''; v.noteAt = t; }
          }
        } else { db.sales = {}; db.dishes = db.dishes.filter((d) => !d.deleted); }
        save(); viewSettings(el); toast('已清除銷售紀錄');
      } else if (a === 'reset') {
        if (Cloud.on()) return toast('請先中斷雲端連線');
        if (prompt('將刪除全部菜品與銷售紀錄，並恢復範例菜品，無法復原。\n確定請輸入「重設」：') !== '重設') return;
        const keep = db.cloud;
        db = seed(); if (keep) db.cloud = keep;
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
    if (e.altKey && !e.ctrlKey && /^[1-3]$/.test(e.key)) {
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
  window.__dish = { get db() { return db; }, flush, Cloud, connectCloud, demoData, monthData, xlsxSheets, buildXlsx: (R) => b64(XLSXW.build(xlsxSheets(R || monthData()))), VERSION };
  start();
})();
