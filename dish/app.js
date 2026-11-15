/* 菜品銷售紀錄系統 — 每日銷量、菜單價格、統計報表（PWA 與桌面版共用） */
(() => {
  'use strict';
  const VERSION = '1.1.0';
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
  const monOf = (s) => { const d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  const validYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(pd(s)) === s;
  const spanDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5) + 1;
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const fmt = (n) => Math.round(n).toLocaleString('zh-TW');
  const money = (n) => (n < 0 ? '-$' : '$') + fmt(Math.abs(n));
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '—');
  const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;

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
  const cur = { view: '', date: today() };
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    const v = ['day', 'menu', 'report', 'settings'].includes(h[0]) ? h[0] : 'day';
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
    $('#tt').hidden = true;
    const el = $('#app');
    el.onclick = el.oninput = el.onchange = el.onkeydown = el.onfocusin = null;
    if (cur.view !== v) window.scrollTo(0, 0);
    cur.view = v;
    if (v === 'menu') viewMenu(el);
    else if (v === 'report') viewReport(el);
    else if (v === 'settings') viewSettings(el);
    else viewDay(el, validYmd(h[1] || '') ? h[1] : today());
  }
  function renderShop() {
    $('#shop').textContent = db.shop || '菜品銷售紀錄';
    document.title = (db.shop ? db.shop + ' · ' : '') + '菜品銷售紀錄系統';
  }

  // ------------------------------------------------------------------ 每日銷量
  let dayFilter = '';
  const kpi = (l, v, s = '', cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

  function viewDay(el, date) {
    cur.date = date;
    const v = dayOf(date);
    const list = liveDishes().filter((d) => !d.off || qOf(v, d.id) > 0);
    const extra = v ? Object.keys(v.items).filter((id) => qOf(v, id) > 0 && !list.some((d) => d.id === id)).map(dishById).filter(Boolean) : [];
    const groups = groupByCat([...list, ...extra]);
    const wd = pd(date).getDay();
    const isToday = date === today();
    el.innerHTML = `
      <div class="page-head">
        <div class="datebar">
          <button class="btn icon" data-act="prev" title="前一天">◀</button>
          <input type="date" id="date" value="${date}">
          <span class="wd${wd % 6 === 0 ? ' we' : ''}">週${WD[wd]}${isToday ? '・今天' : ''}</span>
          <button class="btn icon" data-act="next" title="後一天">▶</button>
          ${isToday ? '' : '<button class="btn" data-act="today">回今天</button>'}
        </div>
        <input id="q" class="search" type="search" placeholder="🔍 搜尋菜品" value="${esc(dayFilter)}">
      </div>
      <div class="kpis" id="daykpi"></div>
      <div class="day-groups">${[...groups].map(([cat, ds]) => `
        <section class="group"><h3>${esc(cat)}</h3>
        ${ds.map((x) => {
          const e = v && v.items[x.id]; const q = e ? e.q : 0; const p = q ? e.p : x.price;
          return `<div class="row${q ? ' has' : ''}" data-id="${x.id}" data-name="${esc(x.name.toLowerCase())}">
            <div class="nm">${esc(x.name || '未命名')}${x.deleted ? '<small class="tag">已刪除</small>' : ''}${x.off ? '<small class="tag">停售</small>' : ''}<small class="pr">$${fmt(p)}</small></div>
            <div class="qty"><button class="btn icon" data-act="dec" tabindex="-1" aria-label="減一">−</button><input type="number" min="0" step="1" inputmode="numeric" value="${q || ''}" placeholder="0" data-q aria-label="${esc(x.name)} 份數"><button class="btn icon" data-act="inc" tabindex="-1" aria-label="加一">＋</button></div>
            <div class="sub">${q ? money(q * p) : ''}</div></div>`;
        }).join('')}
        </section>`).join('') || '<p class="empty">還沒有菜品，請先到「🍱 菜單管理」新增。</p>'}
      </div>
      <p class="empty" id="nomatch" hidden>找不到符合的菜品</p>
      <label class="note">備註<textarea id="note" rows="2" placeholder="例如：下雨、包場、店休…">${esc(v ? v.note : '')}</textarea></label>
      <div class="day-tools">
        <button class="btn" data-act="copy" title="把最近一個有紀錄的日子的份數帶入本日（只填本日沒輸入的菜）">帶入上次份數</button>
        <button class="btn danger" data-act="clearday">清空本日</button>
      </div>`;
    const go = (s) => { location.hash = '#/day/' + s; };
    applyFilter(); renderDayKpi();
    el.onclick = (e) => {
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
      } else if (a === 'clearday') {
        const day = db.sales[date];
        if (!dayHasData(day)) return toast('本日沒有資料');
        if (confirm(`確定清空 ${date} 的所有份數與備註？`)) {
          const t = now();
          for (const e of Object.values(day.items)) if (e.q) { e.q = 0; e.at = t; }
          if (day.note) { day.note = ''; day.noteAt = t; }
          save(); route();
        }
      } else if (a === 'copy') {
        const prev = Object.keys(db.sales).filter((k) => k < date && Object.values(db.sales[k].items).some((e) => e.q > 0)).sort().pop();
        if (!prev) return toast('之前沒有銷售紀錄');
        const day = dayOf(date, true); let n = 0; const t = now();
        for (const [id, e] of Object.entries(db.sales[prev].items)) {
          const x = dishById(id);
          if (!e.q || !x || x.deleted || x.off || qOf(day, id) > 0) continue;
          day.items[id] = { q: e.q, p: x.price, c: x.cost, at: t }; n++;
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
      else day.items[id] = { q, p: x.price, c: x.cost, at: now() }; // 記下當時的售價與成本
    } else if (e) { e.q = 0; e.at = now(); }
    save();
    const ne = day && day.items[id];
    row.classList.toggle('has', q > 0);
    $('.sub', row).textContent = q > 0 ? money(ne.q * ne.p) : '';
    renderDayKpi();
  }
  function renderDayKpi() {
    const t = dayTotals(db.sales[cur.date]);
    $('#daykpi').innerHTML = kpi('本日營收', money(t.rev), '', 'main') + kpi('份數', fmt(t.qty)) + kpi('成本', money(t.cost)) + kpi('毛利', money(t.profit), '毛利率 ' + pct(t.profit, t.rev));
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

  // ------------------------------------------------------------------ 菜單管理
  function viewMenu(el) {
    const list = liveDishes();
    const cats = [...new Set(list.map((d) => d.cat))];
    const avg = list.filter((d) => d.price > 0 && !d.off);
    const avgRate = avg.length ? avg.reduce((s, d) => s + (d.price - d.cost) / d.price, 0) / avg.length : 0;
    el.innerHTML = `
      <div class="page-head"><h2>菜單管理</h2><span class="muted">${list.length} 道菜・${cats.length} 個分類${avg.length ? `・平均毛利率 ${(avgRate * 100).toFixed(1)}%` : ''}</span><div class="sp"></div>
        <button class="btn primary" data-act="add">＋ 新增菜品</button></div>
      <p class="hint">修改會自動儲存。調整售價／成本只影響之後輸入的銷量，過去的紀錄保留當時價格。分類順序依菜品排列順序決定。</p>
      <datalist id="catlist">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      ${list.length ? `<div class="tbl-wrap"><table class="menu-table"><thead><tr><th class="mv">排序</th><th>菜品名稱</th><th>分類</th><th class="r">售價</th><th class="r">成本</th><th class="r">毛利</th><th class="r">毛利率</th><th class="c">停售</th><th></th></tr></thead><tbody>
      ${list.map((d, i) => `<tr data-id="${d.id}" class="${d.off ? 'off' : ''}">
        <td class="mv"><button class="btn icon sm" data-act="up" ${i ? '' : 'disabled'} title="上移">▲</button><button class="btn icon sm" data-act="down" ${i < list.length - 1 ? '' : 'disabled'} title="下移">▼</button></td>
        <td class="f-name"><input data-f="name" value="${esc(d.name)}" placeholder="菜品名稱" aria-label="菜品名稱"></td>
        <td class="f-cat"><input data-f="cat" list="catlist" value="${esc(d.cat)}" placeholder="分類" aria-label="分類"></td>
        <td class="r f-price"><label><span>售價</span><input data-f="price" type="number" min="0" step="any" value="${d.price}"></label></td>
        <td class="r f-cost"><label><span>成本</span><input data-f="cost" type="number" min="0" step="any" value="${d.cost}"></label></td>
        <td class="r f-gp" data-gp>${money(d.price - d.cost)}</td>
        <td class="r f-gr" data-gr>${pct(d.price - d.cost, d.price)}</td>
        <td class="c f-off"><label><input type="checkbox" data-f="off" ${d.off ? 'checked' : ''}><span>停售</span></label></td>
        <td class="f-del"><button class="btn icon sm danger" data-act="del" title="刪除">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">尚無菜品，按「＋ 新增菜品」開始建立菜單。</p>'}`;

    el.onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'add') {
        const last = list[list.length - 1];
        const ord = Math.max(0, ...db.dishes.map((x) => x.ord)) + 1;
        const d = { id: uid(), name: '', cat: last ? last.cat : '未分類', price: 0, cost: 0, off: false, deleted: false, ord, at: now() };
        db.dishes.push(d); save(); viewMenu(el);
        const inp = $(`tr[data-id="${d.id}"] [data-f=name]`, el); inp.scrollIntoView({ block: 'center' }); inp.focus();
        return;
      }
      const tr = b.closest('tr'); if (!tr) return;
      const d = dishById(tr.dataset.id);
      if (a === 'up' || a === 'down') {
        const i = list.indexOf(d), j = a === 'up' ? i - 1 : i + 1;
        if (!list[j]) return;
        const o = list[j], t = now();
        [d.ord, o.ord] = [o.ord, d.ord];
        if (d.ord === o.ord) d.ord += a === 'up' ? -0.5 : 0.5;
        d.at = o.at = t;
        sortDishes(db); save(); viewMenu(el);
        const nb = $(`tr[data-id="${d.id}"] [data-act=${a}]`, el); if (nb && !nb.disabled) nb.focus();
      } else if (a === 'del') {
        const used = hasSales(d.id);
        if (!confirm(`刪除「${d.name || '未命名'}」？${used ? '\n\n這道菜已有銷售紀錄，過去的報表仍會保留它的數字。\n（只是暫時不賣的話，勾「停售」就好）' : ''}`)) return;
        d.deleted = true; d.at = now(); // 保留刪除記號，其他裝置同步時才會一起刪掉
        save(); viewMenu(el);
      }
    };
    el.oninput = (e) => {
      const t = e.target, f = t.dataset.f; if (!f) return;
      const tr = t.closest('tr'), d = dishById(tr.dataset.id);
      if (f === 'name') d.name = t.value.trim();
      else if (f === 'cat') d.cat = t.value.trim() || '未分類';
      else if (f === 'price' || f === 'cost') d[f] = Math.max(0, num(t.value));
      else if (f === 'off') { d.off = t.checked; tr.classList.toggle('off', d.off); }
      d.at = now();
      $('[data-gp]', tr).textContent = money(d.price - d.cost);
      $('[data-gr]', tr).textContent = pct(d.price - d.cost, d.price);
      save();
    };
    el.onchange = (e) => {
      const f = e.target.dataset.f;
      if (f === 'name' && !e.target.value.trim()) { e.target.classList.add('warn'); toast('菜品名稱不能空白'); }
      else e.target.classList.remove('warn');
      if (f === 'cat') {
        const c = [...new Set(liveDishes().map((d) => d.cat))];
        $('#catlist').innerHTML = c.map((x) => `<option value="${esc(x)}">`).join('');
      }
    };
  }

  // ------------------------------------------------------------------ 統計報表
  const PRESETS = [['today', '今天'], ['yday', '昨天'], ['week', '本週'], ['lweek', '上週'], ['month', '本月'], ['lmonth', '上月'], ['30', '近30天'], ['90', '近90天'], ['year', '今年'], ['all', '全部'], ['custom', '自訂']];
  const rep = { preset: 'month', from: '', to: '', gran: 'auto', sort: 'rev', desc: true, zero: true };
  function presetRange(p) {
    const t = today(), d = pd(t);
    switch (p) {
      case 'today': return [t, t];
      case 'yday': { const y = addD(t, -1); return [y, y]; }
      case 'week': return [monOf(t), t];
      case 'lweek': { const m = addD(monOf(t), -7); return [m, addD(m, 6)]; }
      case 'month': return [t.slice(0, 8) + '01', t];
      case 'lmonth': return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
      case '30': return [addD(t, -29), t];
      case '90': return [addD(t, -89), t];
      case 'year': return [t.slice(0, 4) + '-01-01', t];
      case 'all': { const ks = Object.keys(db.sales).sort(); return [ks[0] || t, ks.length && ks[ks.length - 1] > t ? ks[ks.length - 1] : t]; }
      default: return [rep.from || t, rep.to || t];
    }
  }
  function aggregate(from, to) {
    const r = { rev: 0, cost: 0, qty: 0, days: 0, byDish: new Map(), byDay: new Map() };
    for (const [k, v] of Object.entries(db.sales)) {
      if (k < from || k > to) continue;
      const t = dayTotals(v);
      if (!t.qty && !v.note.trim()) continue;
      r.byDay.set(k, t);
      if (t.qty > 0) r.days++;
      r.rev += t.rev; r.cost += t.cost; r.qty += t.qty;
      for (const [id, e] of Object.entries(v.items)) {
        if (!e.q) continue;
        let a = r.byDish.get(id);
        if (!a) r.byDish.set(id, a = { id, qty: 0, rev: 0, cost: 0 });
        a.qty += e.q; a.rev += e.q * e.p; a.cost += e.q * e.c;
      }
    }
    r.profit = r.rev - r.cost;
    return r;
  }
  function autoGran(from, to) { const n = spanDays(from, to); return n <= 45 ? 'day' : n <= 200 ? 'week' : 'month'; }
  function buckets(from, to, gran, byDay) {
    const out = new Map();
    const key = (s) => (gran === 'day' ? s : gran === 'week' ? monOf(s) : s.slice(0, 7));
    const label = (k) => (gran === 'day' ? md(k) : gran === 'week' ? md(k) + '週' : `${k.slice(0, 4)}/${+k.slice(5, 7)}月`);
    const full = (k) => (gran === 'day' ? `${k}（週${WD[pd(k).getDay()]}）` : gran === 'week' ? `${k} 起的一週` : `${k.slice(0, 4)} 年 ${+k.slice(5, 7)} 月`);
    for (let s = from, n = 0; s <= to && n < 4000; s = addD(s, 1), n++) {
      const k = key(s);
      if (!out.has(k)) out.set(k, { key: k, label: label(k), full: full(k), rev: 0, qty: 0, profit: 0, days: 0 });
      const t = byDay.get(s);
      if (t) { const b = out.get(k); b.rev += t.rev; b.qty += t.qty; b.profit += t.profit; if (t.qty) b.days++; }
    }
    return [...out.values()];
  }
  function reportData() {
    const [from, to] = presetRange(rep.preset);
    const gran = rep.gran === 'auto' ? autoGran(from, to) : rep.gran;
    const a = aggregate(from, to);
    const n = spanDays(from, to);
    const prev = aggregate(addD(from, -n), addD(from, -1));
    const rows = [];
    for (const d of db.dishes) {
      const s = a.byDish.get(d.id);
      if (s) rows.push({ d, ...s, profit: s.rev - s.cost });
      else if (rep.zero && !d.deleted && !d.off) rows.push({ d, id: d.id, qty: 0, rev: 0, cost: 0, profit: 0 });
    }
    const cats = new Map();
    for (const r of rows) {
      if (!r.qty) continue;
      const c = cats.get(r.d.cat) || { cat: r.d.cat, rev: 0, qty: 0, profit: 0 };
      c.rev += r.rev; c.qty += r.qty; c.profit += r.profit; cats.set(r.d.cat, c);
    }
    const wk = Array.from({ length: 7 }, (_, i) => ({ wd: i, rev: 0, days: 0 }));
    for (const [k, t] of a.byDay) if (t.qty) { const w = wk[pd(k).getDay()]; w.rev += t.rev; w.days++; }
    return { from, to, n, gran, a, prev, rows, cats: [...cats.values()].sort((x, y) => y.rev - x.rev), wk, buckets: buckets(from, to, gran, a.byDay) };
  }
  function sortRows(rows) {
    const k = rep.sort, m = rep.desc ? -1 : 1;
    const val = (r) => (k === 'name' ? r.d.name : k === 'cat' ? r.d.cat : k === 'rate' ? (r.rev ? r.profit / r.rev : -1) : r[k]);
    return rows.slice().sort((x, y) => {
      const a = val(x), b = val(y);
      const c = typeof a === 'string' ? a.localeCompare(b, 'zh-Hant') : a - b;
      return c * m || y.rev - x.rev || y.qty - x.qty;
    });
  }
  function delta(curV, prevV) {
    if (!prevV) return curV ? '<span class="muted">前期無資料</span>' : '';
    const p = (curV - prevV) / Math.abs(prevV) * 100;
    const cls = p > 0.05 ? 'up' : p < -0.05 ? 'down' : '';
    return `<span class="dl ${cls}">${p > 0.05 ? '▲' : p < -0.05 ? '▼' : '＝'} ${Math.abs(p).toFixed(1)}%</span> <span class="muted">較前期</span>`;
  }

  function viewReport(el) {
    if (!rep.from) { const [f, t] = presetRange('month'); rep.from = f; rep.to = t; }
    const R = reportData();
    const { a, prev } = R;
    const g = { day: '日', week: '週', month: '月' };
    const rows = sortRows(R.rows);
    const maxRev = Math.max(1, ...rows.map((r) => r.rev));
    const th = (k, t, cls = '') => `<th class="${cls} sortable${rep.sort === k ? ' on' : ''}" data-sort="${k}">${t}${rep.sort === k ? (rep.desc ? ' ▼' : ' ▲') : ''}</th>`;
    const showWk = R.n >= 14 && a.days >= 7;
    el.innerHTML = `
      <div class="page-head"><h2>統計報表</h2><div class="sp"></div>
        <button class="btn primary" data-act="xlsx" ${a.qty ? '' : 'disabled'}>⬇ 匯出 Excel</button></div>
      <div class="filters">
        <div class="seg presets">${PRESETS.map(([k, t]) => `<button class="${rep.preset === k ? 'on' : ''}" data-preset="${k}">${t}</button>`).join('')}</div>
        <div class="range"><input type="date" id="from" value="${R.from}"> ～ <input type="date" id="to" value="${R.to}"><span class="muted">共 ${R.n} 天</span></div>
      </div>
      ${a.qty ? '' : `<p class="empty">這段期間沒有銷售紀錄。${Object.keys(db.sales).length ? '' : '<br>到「📝 每日銷量」輸入份數，或在「⚙️ 設定」產生示範資料試用。'}</p>`}
      <div class="kpis">
        ${kpi('營收', money(a.rev), delta(a.rev, prev.rev), 'main')}
        ${kpi('毛利', money(a.profit), '毛利率 ' + pct(a.profit, a.rev))}
        ${kpi('成本', money(a.cost))}
        ${kpi('銷售份數', fmt(a.qty), delta(a.qty, prev.qty))}
        ${kpi('營業天數', a.days + ' 天')}
        ${kpi('日均營收', a.days ? money(a.rev / a.days) : '—', a.days ? '日均 ' + fmt(a.qty / a.days) + ' 份' : '')}
      </div>
      ${a.qty ? `
      <section class="card">
        <div class="card-head"><h3>營收趨勢</h3><div class="sp"></div>
          <div class="seg sm">${['auto', 'day', 'week', 'month'].map((k) => `<button class="${rep.gran === k ? 'on' : ''}" data-gran="${k}">${k === 'auto' ? '自動（' + g[R.gran] + '）' : '每' + g[k]}</button>`).join('')}</div></div>
        <div class="chart" id="trend"></div>
      </section>
      <div class="two">
        <section class="card"><div class="card-head"><h3>分類營收</h3></div>
          <div class="hbars">${R.cats.map((c) => `<div class="hb" data-tip="${esc(`<b>${esc(c.cat)}</b><br>營收 ${money(c.rev)}（${pct(c.rev, a.rev)}）<br>份數 ${fmt(c.qty)}<br>毛利 ${money(c.profit)}`)}">
            <span class="hl">${esc(c.cat)}</span><span class="track"><i style="width:${(c.rev / R.cats[0].rev * 100).toFixed(1)}%"></i></span><span class="hv">${money(c.rev)}<small>${pct(c.rev, a.rev)}</small></span></div>`).join('')}</div>
        </section>
        <section class="card"><div class="card-head"><h3>星期別日均營收</h3></div>
          ${showWk ? `<div class="hbars">${[1, 2, 3, 4, 5, 6, 0].map((i) => R.wk[i]).map((w) => { const avg = w.days ? w.rev / w.days : 0; const mx = Math.max(...R.wk.map((x) => (x.days ? x.rev / x.days : 0))); return `<div class="hb" data-tip="${esc(`<b>週${WD[w.wd]}</b><br>日均營收 ${w.days ? money(avg) : '—'}<br>營業 ${w.days} 天`)}">
            <span class="hl">週${WD[w.wd]}</span><span class="track"><i style="width:${mx ? (avg / mx * 100).toFixed(1) : 0}%"></i></span><span class="hv">${w.days ? money(avg) : '—'}<small>${w.days} 天</small></span></div>`; }).join('')}</div>`
            : '<p class="muted pad">期間至少 14 天、營業 7 天以上才顯示。</p>'}
        </section>
      </div>` : ''}
      <section class="card">
        <div class="card-head"><h3>菜品銷售排行</h3><div class="sp"></div>
          <label class="chk"><input type="checkbox" id="zero" ${rep.zero ? 'checked' : ''}> 顯示沒賣出的菜</label></div>
        <div class="tbl-wrap"><table class="rank">
          <thead><tr><th class="c">#</th>${th('name', '菜品')}${th('cat', '分類')}${th('qty', '份數', 'r')}${th('rev', '營收', 'r')}<th class="share">營收佔比</th>${th('profit', '毛利', 'r')}${th('rate', '毛利率', 'r')}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr class="${r.qty ? '' : 'zero'}">
            <td class="c">${r.qty ? i + 1 : ''}</td><td>${esc(r.d.name || '未命名')}${r.d.deleted ? '<small class="tag">已刪除</small>' : ''}${r.d.off ? '<small class="tag">停售</small>' : ''}</td><td class="muted">${esc(r.d.cat)}</td>
            <td class="r">${fmt(r.qty)}</td><td class="r">${money(r.rev)}</td>
            <td class="share"><span class="track"><i style="width:${(r.rev / maxRev * 100).toFixed(1)}%"></i></span><small>${pct(r.rev, a.rev)}</small></td>
            <td class="r">${money(r.profit)}</td><td class="r">${r.rev ? pct(r.profit, r.rev) : '—'}</td></tr>`).join('')}</tbody>
          ${a.qty ? `<tfoot><tr><td></td><td>合計</td><td></td><td class="r">${fmt(a.qty)}</td><td class="r">${money(a.rev)}</td><td></td><td class="r">${money(a.profit)}</td><td class="r">${pct(a.profit, a.rev)}</td></tr></tfoot>` : ''}
        </table></div>
      </section>`;
    if (a.qty) drawTrend(R);

    el.onclick = (e) => {
      const t = e.target;
      const p = t.closest('[data-preset]');
      if (p) {
        rep.preset = p.dataset.preset;
        if (rep.preset !== 'custom') { const [f, to] = presetRange(rep.preset); rep.from = f; rep.to = to; }
        return viewReport(el);
      }
      const gb = t.closest('[data-gran]'); if (gb) { rep.gran = gb.dataset.gran; return viewReport(el); }
      const s = t.closest('[data-sort]');
      if (s) {
        const k = s.dataset.sort;
        if (rep.sort === k) rep.desc = !rep.desc; else { rep.sort = k; rep.desc = !['name', 'cat'].includes(k); }
        return viewReport(el);
      }
      if (t.closest('[data-act=xlsx]')) exportXlsx(R);
    };
    el.onchange = (e) => {
      const t = e.target;
      if (t.id === 'zero') { rep.zero = t.checked; viewReport(el); }
      else if ((t.id === 'from' || t.id === 'to') && validYmd(t.value)) {
        rep.preset = 'custom'; rep[t.id] = t.value;
        if (rep.from > rep.to) { if (t.id === 'from') rep.to = rep.from; else rep.from = rep.to; }
        viewReport(el);
      }
    };
  }

  // 營收趨勢長條圖（單一系列，SVG，依容器寬度繪製）
  const NS = 'http://www.w3.org/2000/svg';
  function niceStep(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
  }
  const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e4 ? (n / 1e4).toFixed(n % 1e4 ? 1 : 0) + '萬' : fmt(n));
  let lastTrend = null;
  function drawTrend(R) {
    lastTrend = R;
    const box = $('#trend'); if (!box) return;
    const W = Math.max(280, box.clientWidth), H = W < 520 ? 200 : 240;
    const m = { l: 52, r: 8, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const B = R.buckets, n = B.length;
    const max = Math.max(...B.map((b) => b.rev));
    const step = niceStep(max / 4), ticks = Math.max(1, Math.ceil(max / step)), top = step * ticks;
    const band = pw / n, bw = Math.max(2, Math.min(40, band * 0.7));
    const y = (v) => m.t + ph - (v / top) * ph;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="${NS}" role="img" aria-label="營收趨勢">`;
    for (let i = 0; i <= ticks; i++) {
      const v = step * i, yy = y(v);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="${i ? 'grid' : 'axis'}"/><text x="${m.l - 6}" y="${yy + 4}" class="yl">${short(v)}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 46))));
    B.forEach((b, i) => {
      const cx = m.l + band * i + band / 2;
      if (b.rev > 0) {
        const h = Math.max(1, (b.rev / top) * ph), x0 = cx - bw / 2, y0 = m.t + ph - h, r = Math.min(4, bw / 2, h);
        s += `<path class="bar" data-i="${i}" d="M${x0},${m.t + ph}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${m.t + ph}Z"/>`;
      }
      if (i % every === 0) s += `<text x="${cx}" y="${H - 8}" class="xl">${esc(b.label)}</text>`;
    });
    B.forEach((b, i) => { s += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}"/>`; });
    s += '</svg>';
    box.innerHTML = s;
    box.onmousemove = (e) => {
      const h = e.target.closest('.hit');
      $$('.bar.hl', box).forEach((x) => x.classList.remove('hl'));
      if (!h) return hideTip();
      const b = B[+h.dataset.i];
      const bar = $(`.bar[data-i="${h.dataset.i}"]`, box); if (bar) bar.classList.add('hl');
      showTip(e, `<b>${esc(b.full)}</b><br>營收 ${money(b.rev)}<br>份數 ${fmt(b.qty)}<br>毛利 ${money(b.profit)}${R.gran !== 'day' ? `<br>營業 ${b.days} 天` : ''}`);
    };
    box.onmouseleave = () => { hideTip(); $$('.bar.hl', box).forEach((x) => x.classList.remove('hl')); };
  }
  let rsz;
  window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (cur.view === 'report' && lastTrend && $('#trend')) drawTrend(lastTrend); }, 150); });

  function showTip(e, html) {
    const t = $('#tt'); t.innerHTML = html; t.hidden = false;
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14, yy = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, yy) + 'px';
  }
  function hideTip() { $('#tt').hidden = true; }
  document.addEventListener('mousemove', (e) => {
    if (e.target.closest && e.target.closest('#trend')) return;
    const h = e.target.closest && e.target.closest('[data-tip]');
    if (h) showTip(e, h.dataset.tip); else if (!$('#tt').hidden) hideTip();
  });

  // ------------------------------------------------------------------ 匯出 Excel
  function xlsxSheets(R) {
    const B = 1, M = 2, P = 3, BM = 4;
    const { a } = R;
    const shop = db.shop || '菜品銷售紀錄';
    const sum = [
      [{ v: shop + ' 銷售報表', s: B }],
      ['期間', `${R.from} ～ ${R.to}（${R.n} 天）`],
      ['匯出時間', new Date().toLocaleString('zh-TW', { hour12: false })],
      [],
      [{ v: '項目', s: B }, { v: '數值', s: B }],
      ['營收', { v: a.rev, s: M }], ['成本', { v: a.cost, s: M }], ['毛利', { v: a.profit, s: M }],
      ['毛利率', { v: a.rev ? a.profit / a.rev : 0, s: P }], ['銷售份數', a.qty], ['營業天數', a.days],
      ['日均營收', { v: a.days ? Math.round(a.rev / a.days) : 0, s: M }],
      ['前期營收', { v: R.prev.rev, s: M }],
      [],
      [{ v: '分類', s: B }, { v: '份數', s: B }, { v: '營收', s: B }, { v: '毛利', s: B }, { v: '營收佔比', s: B }],
      ...R.cats.map((c) => [c.cat, c.qty, { v: c.rev, s: M }, { v: c.profit, s: M }, { v: a.rev ? c.rev / a.rev : 0, s: P }]),
    ];
    const ranked = R.rows.filter((r) => r.qty).sort((x, y) => y.rev - x.rev);
    const rank = [
      ['排名', '菜品', '分類', '份數', '營收', '成本', '毛利', '毛利率', '營收佔比'].map((v) => ({ v, s: B })),
      ...ranked.map((r, i) => [i + 1, r.d.name + (r.d.deleted ? '（已刪除）' : ''), r.d.cat, r.qty, { v: r.rev, s: M }, { v: r.cost, s: M }, { v: r.profit, s: M }, { v: r.rev ? r.profit / r.rev : 0, s: P }, { v: a.rev ? r.rev / a.rev : 0, s: P }]),
      [null, { v: '合計', s: B }, null, { v: a.qty, s: B }, { v: a.rev, s: BM }, { v: a.cost, s: BM }, { v: a.profit, s: BM }, { v: a.rev ? a.profit / a.rev : 0, s: P }, null],
    ];
    const days = [...a.byDay.keys()].sort();
    const daily = [
      ['日期', '星期', '份數', '營收', '成本', '毛利', '毛利率', '備註'].map((v) => ({ v, s: B })),
      ...days.map((k) => { const t = a.byDay.get(k); return [k, '週' + WD[pd(k).getDay()], t.qty, { v: t.rev, s: M }, { v: t.cost, s: M }, { v: t.profit, s: M }, { v: t.rev ? t.profit / t.rev : 0, s: P }, db.sales[k].note]; }),
      [{ v: '合計', s: B }, null, { v: a.qty, s: B }, { v: a.rev, s: BM }, { v: a.cost, s: BM }, { v: a.profit, s: BM }, { v: a.rev ? a.profit / a.rev : 0, s: P }, null],
    ];
    const dishes = ranked.map((r) => r.d);
    const matrix = [
      [{ v: '日期', s: B }, { v: '星期', s: B }, ...dishes.map((d) => ({ v: d.name, s: B })), { v: '份數合計', s: B }],
      ...days.map((k) => { const it = db.sales[k].items; return [k, '週' + WD[pd(k).getDay()], ...dishes.map((d) => (it[d.id] && it[d.id].q ? it[d.id].q : null)), a.byDay.get(k).qty]; }),
      [{ v: '合計', s: B }, null, ...ranked.map((r) => ({ v: r.qty, s: B })), { v: a.qty, s: B }],
    ];
    return [
      { name: '摘要', rows: sum, cols: [16, 30, 12, 12, 12] },
      { name: '菜品排行', rows: rank, cols: [6, 18, 10, 8, 12, 12, 12, 9, 10], freeze: 1 },
      { name: '每日營收', rows: daily, cols: [12, 6, 8, 12, 12, 12, 9, 30], freeze: 1 },
      { name: '每日銷量明細', rows: matrix, cols: [12, 6, ...dishes.map((d) => Math.max(8, Math.min(16, d.name.length * 2 + 2))), 10], freeze: 1 },
    ];
  }
  const fname = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
  async function exportXlsx(R) {
    const bytes = XLSXW.build(xlsxSheets(R));
    const name = fname(`${db.shop ? db.shop + '_' : ''}銷售報表_${R.from.replace(/-/g, '')}-${R.to.replace(/-/g, '')}.xlsx`);
    await saveFile(bytes, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

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

  // ------------------------------------------------------------------ 設定
  function viewSettings(el) {
    const days = Object.keys(db.sales).filter((k) => dayHasData(db.sales[k])).sort();
    const c = db.cloud || {};
    const on = Cloud.on();
    el.innerHTML = `
      <div class="page-head"><h2>設定</h2></div>
      <section class="card form">
        <label>店名（顯示在標題與匯出檔名）<input id="shopname" value="${esc(db.shop)}" placeholder="例如：阿明小吃店"></label>
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
        <div class="card-head"><h3>資料備份</h3></div>
        <p class="muted pad">目前有 ${liveDishes().length} 道菜、${days.length} 天的銷售紀錄${days.length ? `（${days[0]} ～ ${days[days.length - 1]}）` : ''}。
          ${DESK ? '<br>本機資料檔：<code id="dpath">…</code>（每天自動保留一份備份）' : on ? '' : '<br>資料存在這個瀏覽器裡，換手機或清除瀏覽資料前請先匯出備份。'}</p>
        <div class="btns pad"><button class="btn" data-act="backup">⬇ 匯出備份（JSON）</button>
          <label class="btn">⬆ 從備份還原<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>試用與清除</h3></div>
        <div class="btns pad">
          <button class="btn" data-act="demo" ${on ? 'disabled title="連線雲端時不能產生示範資料"' : ''}>產生近 90 天示範銷售資料</button>
          <button class="btn danger" data-act="clearsales">清除所有銷售紀錄</button>
          <button class="btn danger" data-act="reset" ${on ? 'disabled title="請先中斷雲端連線"' : ''}>全部重設（菜單也清空）</button>
        </div>
        <p class="muted pad">示範資料只會填入「沒有紀錄的日子」，不會覆蓋已輸入的數字。${on ? '<br>連線雲端時「清除所有銷售紀錄」會連雲端一起清除。' : ''}</p>
      </section>
      <p class="muted center">菜品銷售紀錄系統 v${VERSION}${DESK ? '（桌面版）' : ''}・快捷鍵 Alt+1～4 切換頁面</p>`;
    if (DESK) api().then((x) => x.data_path()).then((p) => { const e = $('#dpath'); if (e) e.textContent = p; });

    el.oninput = (e) => { if (e.target.id === 'shopname') { db.shop = e.target.value.trim(); db.shopAt = now(); renderShop(); save(); } };
    el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'cpw') { e.preventDefault(); $('[data-act=connect]', el).click(); } };
    el.onchange = async (e) => {
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
      if (a === 'connect') {
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
      } else if (a === 'demo') {
        if (Cloud.on()) return toast('連線雲端時不能產生示範資料');
        if (!liveDishes().length) return toast('請先建立菜單');
        if (!confirm('在近 90 天沒有紀錄的日子填入隨機的示範銷售資料？（之後可用「清除所有銷售紀錄」移除）')) return;
        const n = demoData(90); save(); viewSettings(el); toast(`已產生 ${n} 天示範資料`);
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
        if (prompt('將刪除全部菜單與銷售紀錄，並恢復範例菜單，無法復原。\n確定請輸入「重設」：') !== '重設') return;
        const keep = db.cloud;
        db = seed(); if (keep) db.cloud = keep;
        save(); renderShop(); viewSettings(el); toast('已重設');
      }
    };
  }
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
        const q = Math.round(pop.get(d.id) * f * (d.price > 100 ? 8 : d.price > 50 ? 14 : 20) * (0.6 + Math.random() * 0.8));
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
    if (e.altKey && !e.ctrlKey && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      location.hash = '#/' + ['day', 'menu', 'report', 'settings'][+e.key - 1];
    }
  });
  window.addEventListener('hashchange', route);

  async function start() {
    let raw = null;
    try { raw = await loadRaw(); } catch (e) { console.error(e); }
    try { db = raw ? norm(JSON.parse(raw)) : null; } catch (e) {
      alert('資料讀取失敗：' + e.message + '\n將以範例菜單啟動（原資料不會被覆蓋，直到你修改）。');
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
  // 測試用
  window.__dish = { get db() { return db; }, flush, Cloud, connectCloud, demoData, reportData, xlsxSheets, buildXlsx: (R) => b64(XLSXW.build(xlsxSheets(R || reportData()))), rep, VERSION };
  start();
})();
