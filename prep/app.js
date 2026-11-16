/* 備料交接日誌 — 依紙本「碧水堂廚房交接表」：時程、站區分配、交接事項、預估銷售量（平日／假日）、早上／下午／晚上交接、值班主管簽名，可列印 A4 交接表 */
(() => {
  'use strict';
  const VERSION = '2.1.0';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  // ------------------------------------------------------------------ 工具
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const WD = '日一二三四五六';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const pd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const now = () => Date.now();
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fname = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  // 輸入文字的小視窗（取代 prompt，手機、桌面版都一樣好用）；取消回傳 null
  function askText(title, value = '', ok = '確定') {
    return new Promise((res) => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<form class="modal"><h3>${esc(title)}</h3><div class="field"><input id="askv" value="${esc(value)}" autocomplete="off"></div>
        <div class="row"><button type="button" class="btn" data-x="no">取消</button><button class="btn pri">${esc(ok)}</button></div></form>`;
      document.body.append(bg);
      const done = (v) => { bg.remove(); res(v); };
      bg.addEventListener('click', (e) => { if (e.target === bg || e.target.dataset.x === 'no') done(null); });
      bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
      $('form', bg).addEventListener('submit', (e) => { e.preventDefault(); const v = $('#askv', bg).value.trim(); if (v) done(v); });
      const inp = $('#askv', bg); inp.focus(); inp.select();
    });
  }
  function setStatus(s, bad) { const e = $('#status'); e.textContent = s; e.classList.toggle('bad', !!bad); }

  const daysLabel = (days) => !days ? '每日' : days.length === 1 ? '週' + WD[+days] : [...days].map((c) => WD[+c]).join('');
  const ml = (s) => esc(s).trim().replace(/\s+/g, '<br>'); // 份量用空格分兩行（例：上午2 晚上1）

  // ------------------------------------------------------------------ 預設內容（照紙本「碧水堂廚房交接表」抄錄）
  const SEED_STATIONS = [
    { id: 'soup', name: '湯', blank: 0 },
    { id: 'plate', name: '', blank: 1 },
    { id: 'light', name: '輕食', blank: 0 },
    { id: 'sea', name: '', blank: 3 },
  ];
  // [站區, 品項, 單位, 平日, 假日]
  const SEED_ITEMS = [
    ['soup', '昆布', '桶', '上午2 晚上1', '上午3 晚上3'],
    ['soup', '番茄', '桶', '上午2 晚上1', '上午2 晚上2'],
    ['soup', '蒜味雞', '桶', '1', '2'],
    ['soup', '麻辣', '桶', '1', '2'],
    ['plate', '菜盤', '個', '40', '晚餐前80'],
    ['plate', '醬料碟', '盤', '3', '下班前5'],
    ['light', '豆干米血糕', '份', '5', '10'],
    ['light', '炸天婦羅', '份', '6', '15'],
    ['light', '麻辣臭豆腐', '份', '8', '15'],
    ['light', '炸物拼盤', '份', '10', '20'],
    ['sea', '海鮮盤', '份', '5', '10'],
  ];
  const SEED_SCHED = [
    ['10:30~11:30', '開檯'], ['11:30~14:00', '餐期出餐'], ['14:00~15:00', '備料'], ['15:00~16:00', '煮員工餐'],
    ['16:00~17:00', '吃飯 檢視晚上餐期物料'], ['17:00~20:00', '餐期 與 備料'], ['20:00~21:00', '收檯'],
  ];
  const SEED_TASKS = ['18:00系統驗收貨單', '20:00前菜商叫貨完成'];
  const ASSIGN = ['火鍋', '控台', '海鮮', '備料'];
  const SHIFTS = [['am', '早上'], ['pm', '下午'], ['ev', '晚上']];
  const assignKeys = () => (Array.isArray(db.assign) ? db.assign : ASSIGN).filter((k) => String(k).trim());

  function seedForm(t) {
    return {
      stations: SEED_STATIONS.map((s, i) => ({ ...s, ord: i + 1, deleted: false, at: t })),
      items: SEED_ITEMS.map(([st, name, unit, wd, hd], i) => ({ id: uid() + i, st, name, unit, wd, hd, days: '', ord: i + 1, deleted: false, at: t })),
      sched: SEED_SCHED.map(([time, name], i) => ({ id: 's' + (i + 1), time, name })),
      tasks: SEED_TASKS.map((name, i) => ({ id: 't' + (i + 1), name })),
      assign: ASSIGN.slice(), rev: { wd: '3萬', hd: '11萬' },
    };
  }
  function seed() {
    const t = now();
    return { ver: 2, title: '碧水堂廚房交接表', titleAt: t, ...seedForm(t), logs: {}, createdAt: t };
  }
  // 舊版（碧潭備料交接日誌）→ 換成新紙本；舊的品項標成刪除，以前每天的記錄保留
  function migrate() {
    if ((db.ver || 1) >= 2) return false;
    const t = now(), f = seedForm(t);
    db.stations.forEach((s) => { s.deleted = true; s.at = t; });
    db.items.forEach((i) => { i.deleted = true; i.at = t; });
    f.stations.forEach((s) => { if (db.stations.some((x) => x.id === s.id)) s.id += '2'; });
    f.items.forEach((i) => { if (!f.stations.some((s) => s.id === i.st)) i.st += '2'; });
    db.stations.push(...f.stations); db.items.push(...f.items);
    Object.assign(db, { sched: f.sched, tasks: f.tasks, assign: f.assign, rev: f.rev, ver: 2, title: '碧水堂廚房交接表', titleAt: t });
    return true;
  }

  // ------------------------------------------------------------------ 儲存（瀏覽器：IndexedDB；桌面版：%APPDATA%\KitchenPrep）
  const IDB = {
    open() {
      return this.p || (this.p = new Promise((res, rej) => {
        const r = indexedDB.open('kitchenprep', 1);
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
  async function loadRaw() { return DESK ? (await api()).load() : IDB.get('db'); }

  let db;
  let saveTimer;
  function save() { setStatus('儲存中…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); }
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
  const stations = () => db.stations.filter((s) => !s.deleted).sort((a, b) => a.ord - b.ord);
  const stById = (id) => db.stations.find((s) => s.id === id);
  const itemsOf = (st) => db.items.filter((i) => !i.deleted && i.st === st).sort((a, b) => a.ord - b.ord);
  // 站區名稱可以空白（紙本有的區沒寫名稱），畫面上用品項名稱代替
  const stName = (s) => s.name || itemsOf(s.id).slice(0, 2).map((i) => i.name).join('・') || '未命名站區';
  const onDay = (it, d) => !it.days || it.days.includes(String(pd(d).getDay()));
  const sched = () => db.sched || [];
  const tasks = () => db.tasks || [];
  function log(d, create) {
    let L = db.logs[d];
    if (!L && create) L = db.logs[d] = { q: {}, sched: {}, tasks: {}, shift: {}, assign: {}, at: now() };
    return L;
  }
  const isHol = (d) => { const L = log(d); return L && L.hol != null ? L.hol : [0, 6].includes(pd(d).getDay()); };
  const target = (it, hol) => (hol ? it.hd || it.wd : it.wd) || '';
  const filled = (e) => !!(e && String(e.v || '').trim());
  function dayStats(d) {
    const L = log(d) || { q: {} };
    let total = 0, done = 0;
    const per = {};
    stations().forEach((s) => {
      let t = 0, n = 0;
      itemsOf(s.id).forEach((it) => { if (onDay(it, d)) { t++; if (filled(L.q[it.id])) n++; } });
      per[s.id] = { t, n }; total += t; done += n;
    });
    const sc = sched().filter((x) => (L.sched || {})[x.id]).length, tk = tasks().filter((x) => (L.tasks || {})[x.id]).length;
    return { total, done, per, signed: !!(L.sign || '').trim(), sched: [sc, sched().length], tasks: [tk, tasks().length] };
  }

  // ------------------------------------------------------------------ 路由
  const cur = { view: 'day', date: today() };
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    const prev = cur.view + '|' + cur.date;
    cur.view = ['day', 'sheet', 'items', 'settings'].includes(h[0]) ? h[0] : 'day';
    if ((cur.view === 'day' || cur.view === 'sheet') && /^\d{4}-\d\d-\d\d$/.test(h[1] || '')) cur.date = h[1];
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === cur.view));
    // 每次換一個新的 #app，舊畫面綁的事件才不會累積（否則按一次會執行好幾次）
    const old = $('#app'), el = old.cloneNode(false);
    const keep = prev === cur.view + '|' + cur.date ? old.scrollTop : 0; // 同一頁重畫時保留捲動位置
    old.replaceWith(el);
    ({ day: viewDay, sheet: viewSheet, items: viewItems, settings: viewSettings })[cur.view](el);
    el.scrollTop = keep;
  }
  window.addEventListener('hashchange', route);
  function dateBar(view) {
    const d = cur.date, hol = isHol(d);
    return `<div class="bar">
      <button class="btn" data-go="${addD(d, -1)}" aria-label="前一天">◀</button>
      <input type="date" id="dpick" value="${d}">
      <button class="btn" data-go="${addD(d, 1)}" aria-label="後一天">▶</button>
      <b>週${WD[pd(d).getDay()]}</b>${d === today() ? '' : `<button class="btn" data-go="${today()}">今天</button>`}
      <button class="pill ${hol ? 'hd' : 'wd'}" data-act="hol" title="點一下切換平日／假日">${hol ? '假日' : '平日'}份量</button>
      <span class="sp"></span>${view === 'day' ? `<a class="btn" href="#/sheet/${d}">🖨️ 列印這天</a>` : ''}</div>`;
  }
  function bindBar(el, view) {
    $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => { location.hash = `#/${view}/${b.dataset.go}`; }));
    $('#dpick', el).addEventListener('change', (e) => { if (e.target.value) location.hash = `#/${view}/${e.target.value}`; });
    $('[data-act=hol]', el).addEventListener('click', () => {
      const L = log(cur.date, true);
      const auto = [0, 6].includes(pd(cur.date).getDay());
      const next = !isHol(cur.date);
      L.hol = next === auto ? null : next; L.at = now(); save(); route();
    });
  }
  // 現在時間落在哪個時段（只有看今天時標示）
  function nowSlot(x) {
    const m = String(x.time).match(/(\d{1,2}):(\d\d)\s*[~～-]\s*(\d{1,2}):(\d\d)/);
    if (!m) return false;
    const d = new Date(), t = d.getHours() * 60 + d.getMinutes();
    return t >= m[1] * 60 + +m[2] && t < m[3] * 60 + +m[4];
  }

  // ------------------------------------------------------------------ 今日備料
  function itemRow(it, L, hol) {
    const e = L.q[it.id] || {};
    const tg = target(it, hol);
    return `<div class="it${filled(e) ? ' done' : ''}" data-id="${it.id}">
      <div class="nm"><span class="nmt">${esc(it.name)}</span>${it.unit ? `<span class="unit-c">${esc(it.unit)}</span>` : ''}<small><em class="tg2">${hol ? '假日' : '平日'} ${esc(tg) || '—'}</em></small></div>
      <span class="tg" title="${hol ? '假日' : '平日'}預估銷售量">${ml(tg) || '—'}</span>
      <input class="q" data-f="v" value="${esc(e.v || '')}" placeholder="實際" aria-label="${esc(it.name)} 實際數量">
      <button class="ck" data-act="ck" title="完成（✓）">✓</button></div>`;
  }
  const chk = (on, act, id, html, cls = '') => `<button class="cl${on ? ' on' : ''}${cls}" data-act="${act}" data-id="${id}"><span class="bx">✓</span>${html}</button>`;
  const PAL = ['#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#6366f1'];
  const pct = (n, t) => (t ? Math.round(n / t * 100) : 0);
  // 圓形進度
  function ring(n, t) {
    const r = 30, c = 2 * Math.PI * r, p = t ? n / t : 0;
    return `<svg viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="${r}" class="rg-bg"/><circle cx="38" cy="38" r="${r}" class="rg-fg" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/></svg>
      <div class="rg-t"><b>${pct(n, t)}<small>%</small></b><span>備料 ${n}/${t}</span></div>`;
  }
  const SHIFT_ICON = { am: '🌅', pm: '☀️', ev: '🌙' };
  function viewDay(el) {
    const d = cur.date, hol = isHol(d), L = log(d) || { q: {}, sched: {}, tasks: {}, shift: {}, assign: {} };
    const S = dayStats(d), isToday = d === today(), dt = pd(d);
    const sts = stations().map((s, i) => {
      const on = itemsOf(s.id).filter((x) => onDay(x, d)), p = S.per[s.id];
      return `<section class="st${p.t && p.n >= p.t ? ' all' : ''}" data-st="${s.id}" style="--c:${PAL[i % PAL.length]}"><div class="st-h"><h2>${esc(stName(s))}</h2><span class="prog${p.n >= p.t ? ' ok' : ''}">${p.n}/${p.t}</span>
        <div class="bar-p"><i style="width:${pct(p.n, p.t)}%"></i></div></div>
        ${on.map((it) => itemRow(it, L, hol)).join('') || '<p class="muted" style="padding:10px 16px;margin:0">這個站區沒有品項</p>'}</section>`;
    }).join('');
    const A = L.assign || {}, SC = L.sched || {}, TK = L.tasks || {}, SH = L.shift || {};
    const rev = (db.rev || {})[hol ? 'hd' : 'wd'] || '';
    el.innerHTML = `<div class="wrap">
      <div class="hero">
        <div class="hero-l"><div class="h-t">${esc(db.title || '碧水堂廚房交接表')}</div>
          <div class="h-d">${dt.getMonth() + 1}月${dt.getDate()}日<span>星期${WD[dt.getDay()]}${isToday ? '・今天' : ''}</span></div>
          <div class="h-k">
            <div class="hk"><span>💰 預估營業額</span><b>${esc(rev) || '—'}</b></div>
            <div class="hk"><span>⏰ 時程</span><b class="k-sch">${S.sched.join('/')}</b></div>
            <div class="hk"><span>📌 交接事項</span><b class="k-tk">${S.tasks.join('/')}</b></div>
            <div class="hk${S.signed ? ' ok' : ''}" id="ksignbox"><span>✍️ 主管簽名</span><b id="ksign">${S.signed ? esc(L.sign) : '未簽'}</b></div>
          </div></div>
        <div class="ring${S.done >= S.total && S.total ? ' ok' : ''}" id="kring" title="備料完成">${ring(S.done, S.total)}</div>
      </div>
      ${dateBar('day')}
      <div class="box"><h3><i class="ic">⏰</i>今日時程<span class="cnt k-sch">${S.sched.join('/')}</span></h3>
        <div class="sched">${sched().map((x) => chk(SC[x.id], 'sch', x.id, `<b>${esc(x.time)}</b><span>${esc(x.name)}</span>${isToday && nowSlot(x) ? '<em class="nowtag">進行中</em>' : ''}`, isToday && nowSlot(x) ? ' now' : '')).join('') || '<span class="muted">在「品項設定」可以新增時段</span>'}</div></div>
      <div class="bottom">
        <div class="box"><h3><i class="ic">👥</i>站區分配<button class="btn sm" data-act="copyassign" title="帶入前一天的站區分配">↺ 帶入前一天</button></h3><div class="grid2">
          ${assignKeys().map((k) => `<label>${esc(k)}</label><input data-assign="${esc(k)}" value="${esc(A[k] || '')}" placeholder="姓名">`).join('') || '<span class="muted">在「品項設定」可以新增站區分配的位置</span>'}</div></div>
        <div class="box"><h3><i class="ic">📌</i>交接事項<span class="cnt k-tk">${S.tasks.join('/')}</span></h3>
          <div class="tasks">${tasks().map((x) => chk(TK[x.id], 'task', x.id, `<span>${esc(x.name)}</span>`)).join('') || '<span class="muted">在「品項設定」可以新增交接事項</span>'}</div></div>
      </div>
      <h3 class="sec"><i class="ic">🍲</i>預估銷售量・備料<span class="cnt" id="kdone">${S.done}/${S.total}</span><span class="pill ${hol ? 'hd' : 'wd'} sm">${hol ? '假日' : '平日'}份量</span></h3>
      <div class="stations">${sts}</div>
      <h3 class="sec"><i class="ic">📝</i>交接紀錄</h3>
      <div class="bottom shifts">
        ${SHIFTS.map(([k, n]) => `<div class="box sh-${k}"><h3><i class="ic">${SHIFT_ICON[k]}</i>${n}交接</h3><textarea rows="3" data-shift="${k}" placeholder="${n}要交接的事情">${esc(SH[k] || '')}</textarea></div>`).join('')}
        <div class="box sh-sign"><h3><i class="ic">✍️</i>值班主管簽名</h3><input class="sign" data-k="sign" value="${esc(L.sign || '')}" placeholder="簽名（輸入姓名）"></div>
      </div></div>`;
    bindBar(el, 'day');
    const touch = () => { const LL = log(d, true); LL.at = now(); save(); return LL; };
    el.addEventListener('input', (e) => {
      const t = e.target;
      const row = t.closest('.it');
      if (row && t.dataset.f) {
        const LL = touch(); const q = LL.q[row.dataset.id] || (LL.q[row.dataset.id] = {});
        q[t.dataset.f] = t.value; q.at = now();
        refreshRow(row);
      } else if (t.dataset.shift) { const LL = touch(); (LL.shift || (LL.shift = {}))[t.dataset.shift] = t.value; }
      else if (t.dataset.assign) { const LL = touch(); (LL.assign || (LL.assign = {}))[t.dataset.assign] = t.value; }
      else if (t.dataset.k) { touch()[t.dataset.k] = t.value; if (t.dataset.k === 'sign') refreshKpi(); }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'ck') {
        const row = b.closest('.it'); const inp = $('input.q', row);
        inp.value = filled({ v: inp.value }) ? '' : '✓';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (a === 'sch' || a === 'task') {
        const LL = touch(), k = a === 'sch' ? 'sched' : 'tasks', m = LL[k] || (LL[k] = {});
        m[b.dataset.id] = !m[b.dataset.id]; b.classList.toggle('on', m[b.dataset.id]); refreshKpi();
      }
      if (a === 'copyassign') {
        let p = addD(d, -1);
        for (let i = 0; i < 14 && !(db.logs[p] && Object.values(db.logs[p].assign || {}).some((v) => v)); i++) p = addD(p, -1);
        const src = db.logs[p] && db.logs[p].assign;
        if (!src || !Object.values(src).some((v) => v)) return toast('前兩週都沒有站區分配可以帶入');
        touch().assign = { ...src }; route(); toast(`已帶入 ${p.slice(5).replace('-', '/')} 的站區分配`);
      }
    });
  }
  function refreshRow(row) {
    const v = $('input.q', row).value;
    row.classList.toggle('done', filled({ v }));
    refreshKpi();
  }
  function refreshKpi() {
    const S = dayStats(cur.date);
    const k = $('#kdone'); if (k) k.textContent = `${S.done}/${S.total}`;
    const r = $('#kring'); if (r) { r.innerHTML = ring(S.done, S.total); r.classList.toggle('ok', S.done >= S.total && !!S.total); }
    $$('.st').forEach((sec) => {
      const p = S.per[sec.dataset.st]; const e = $('.prog', sec); if (!p || !e) return;
      e.textContent = `${p.n}/${p.t}`; e.classList.toggle('ok', p.n >= p.t);
      sec.classList.toggle('all', !!p.t && p.n >= p.t);
      const b = $('.bar-p i', sec); if (b) b.style.width = pct(p.n, p.t) + '%';
    });
    const L = log(cur.date) || {};
    const s = $('#ksign'); if (s) { s.textContent = S.signed ? L.sign : '未簽'; $('#ksignbox').classList.toggle('ok', S.signed); }
    $$('.k-sch').forEach((x) => { x.textContent = S.sched.join('/'); });
    $$('.k-tk').forEach((x) => { x.textContent = S.tasks.join('/'); });
  }

  // ------------------------------------------------------------------ 紙本交接表（照「碧水堂廚房交接表」）
  function sheetHtml(d, blank) {
    const L = log(d) || { q: {} };
    const hol = isHol(d), dt = pd(d);
    const ck = (on) => (!blank && on ? '<span class="v">✓</span>' : '');
    const V = (s) => (blank ? '' : esc(s || ''));
    // 時程：每 6 個一區塊，三欄、每欄兩列（跟紙本一樣由上往下排）
    const SC = sched(), SL = L.sched || {};
    let sch = '';
    for (let b = 0; b < Math.max(1, Math.ceil(SC.length / 6)); b++) {
      for (let r = 0; r < 2; r++) {
        if (b * 6 + r >= SC.length && r) break;
        let tr = '';
        for (let c = 0; c < 3; c++) {
          const x = SC[b * 6 + c * 2 + r];
          tr += x ? `<td class="tm">${esc(x.time)}</td><td class="sl">${esc(x.name)}</td><td>${ck(SL[x.id])}</td>` : '<td></td><td></td><td></td>';
        }
        sch += `<tr>${tr}</tr>`;
      }
    }
    // 站區分配（左，兩個一列）＋交接事項（右）
    const keys = assignKeys(), A = L.assign || {}, TK = tasks(), TL = L.tasks || {};
    const nr = Math.ceil(keys.length / 2), R = Math.max(nr, TK.length + 1, 2);
    let asg = '';
    for (let r = 0; r < R; r++) {
      const k1 = r < nr ? keys[r * 2] : null, k2 = r < nr ? keys[r * 2 + 1] : null;
      const x = r ? TK[r - 1] : null;
      asg += `<tr><td class="lab">${k1 ? esc(k1) + '：' : ''}</td><td class="v l">${k1 ? V(A[k1]) : ''}</td><td class="lab">${k2 ? esc(k2) + '：' : ''}</td><td class="v l">${k2 ? V(A[k2]) : ''}</td>
        ${r ? `<td class="tk">${x ? `${ck(TL[x.id])}${esc(x.name)}` : ''}</td>` : '<td class="hd">交接事項</td>'}</tr>`;
    }
    // 預估銷售量（右邊早上／下午／晚上交接平分）
    const rows = [];
    stations().forEach((s) => {
      const its = itemsOf(s.id), n = its.length + (+s.blank || 0);
      if (!n) return;
      for (let i = 0; i < n; i++) {
        const it = its[i];
        let r = i ? '' : `<td class="stn" rowspan="${n}">${esc(s.name)}</td>`;
        if (it) {
          const e = L.q[it.id] || {}, f = !blank && filled(e);
          const got = f ? (String(e.v).trim() === '✓' ? '<span class="v"> ✓</span>' : `<span class="v got">${esc(e.v)}</span>`) : '';
          r += `<td class="nm">${esc(it.name)}</td><td>${esc(it.unit || '')}</td><td class="q${!blank && !hol ? ' use' : ''}">${ml(it.wd)}${hol ? '' : got}</td><td class="q${!blank && hol ? ' use' : ''}">${ml(it.hd)}${hol ? got : ''}</td>`;
        } else r += '<td></td><td></td><td></td><td></td>';
        rows.push(r);
      }
    });
    const SH = L.shift || {}, tot = rows.length + 2, part = [Math.ceil(tot / 3), Math.ceil((tot - Math.ceil(tot / 3)) / 2)];
    part.push(tot - part[0] - part[1]);
    const shCell = (i) => `<td class="hand" rowspan="${part[i]}"><b>${SHIFTS[i][1]}：</b>${blank ? '' : `<span class="wr">${esc(SH[SHIFTS[i][0]] || '')}</span>`}</td>`;
    const all = [`<td></td><td>品項</td><td>單位</td><td${!blank && !hol ? ' class="use"' : ''}>平日</td><td${!blank && hol ? ' class="use"' : ''}>假日</td>`,
      `<td>站區</td><td>預估營業額</td><td></td><td>${esc((db.rev || {}).wd || '')}</td><td>${esc((db.rev || {}).hd || '')}</td>`, ...rows];
    const body = all.map((r, i) => {
      let x = r;
      if (part[0] && i === 0) x += shCell(0);
      if (part[1] && i === part[0]) x += shCell(1);
      if (part[2] && i === part[0] + part[1]) x += shCell(2);
      return `<tr>${x}</tr>`;
    }).join('');
    return `<div class="sheet${blank ? ' blank' : ''}">
      <div class="sh-t"><b>${esc(db.title || '碧水堂廚房交接表')}</b><span>日期：<u>${blank ? '　' : dt.getMonth() + 1}</u> / <u>${blank ? '　' : dt.getDate()}</u>${blank ? '' : `（${WD[dt.getDay()]}）${hol ? '假日' : '平日'}`}</span></div>
      <table class="sch"><colgroup><col style="width:92px"><col style="width:82px"><col style="width:34px"><col style="width:92px"><col style="width:84px"><col style="width:34px"><col style="width:92px"><col><col style="width:34px"></colgroup>${sch}</table>
      <table class="asg"><colgroup><col style="width:70px"><col style="width:104px"><col style="width:56px"><col style="width:144px"><col></colgroup>${asg}</table>
      <table class="main"><colgroup><col style="width:70px"><col style="width:104px"><col style="width:44px"><col style="width:80px"><col style="width:76px"><col></colgroup>
        <tr class="h"><td colspan="3" class="nb"></td><td colspan="2" class="hd">預估銷售量</td><td class="nb"></td></tr>${body}
        <tr><td colspan="5" class="nb"></td><td class="sg">值班主管簽名：<span class="v">${V(L.sign)}</span></td></tr></table>
      <div class="grow"></div></div>`;
  }
  const sheetPages = (d, blank) => [sheetHtml(d, blank)];
  let blankMode = false;
  function viewSheet(el) {
    const d = cur.date;
    el.innerHTML = `<div class="wrap">${dateBar('sheet')}
      <div class="bar no-print"><button class="btn pri" data-act="print">🖨️ ${DESK || IS_MOBILE ? '存成 PDF' : '列印'}</button>
        <label><input type="checkbox" id="blank" ${blankMode ? 'checked' : ''}> 空白表（只印品項，給現場手寫）</label>
        <span class="muted">A4 直式</span></div>
      <div class="sheets-fit"><div class="sheets">${sheetPages(d, blankMode).join('')}</div></div></div>`;
    bindBar(el, 'sheet');
    fitSheets();
    $('#blank', el).addEventListener('change', (e) => { blankMode = e.target.checked; route(); });
    $('[data-act=print]', el).addEventListener('click', () => printSheets(d));
  }
  // 交接表預覽依畫面寬度等比縮放（手機、平板也能整張看到；列印不受影響）
  function fitSheets() {
    const box = $('.sheets-fit'), sh = $('.sheets', box || document);
    if (!box || !sh) return;
    sh.style.transform = ''; sh.style.width = ''; box.style.height = '';
    const avail = box.clientWidth, k = Math.min(1, avail / 726);
    if (k >= 1) return;
    sh.style.width = '718px'; sh.style.alignItems = 'flex-start';
    sh.style.transform = `scale(${k})`;
    box.style.height = Math.ceil(sh.scrollHeight * k) + 'px';
    box.style.paddingLeft = Math.max(0, (avail - 718 * k) / 2) + 'px';
  }
  let fitT;
  window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { if (cur.view === 'sheet') fitSheets(); }, 120); });

  function loadJs(src) {
    return new Promise((res, rej) => {
      if ($$('script').some((s) => s.src.endsWith(src.replace('../', '')))) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('載入失敗：' + src));
      document.head.append(s);
    });
  }
  async function buildPdf(d) {
    await loadJs('../fridge/vendor/html2canvas.min.js');
    await loadJs('../fridge/vendor/jspdf.umd.min.js');
    const host = document.createElement('div');
    host.className = 'pdf-render';
    host.innerHTML = sheetPages(d, blankMode).join('');
    document.body.append(host);
    try {
      const W = 210, H = 297, MG = 8, cw = W - MG * 2, chh = H - MG * 2;
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      let i = 0;
      for (const sh of host.children) {
        const cv = await window.html2canvas(sh, { scale: 2, backgroundColor: '#ffffff', windowWidth: 800 });
        let w = cw, h = cv.height / cv.width * cw;
        if (h > chh) { w *= chh / h; h = chh; }
        if (i++) pdf.addPage();
        pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', MG + (cw - w) / 2, MG, w, h);
      }
      const name = fname(`${db.title || '備料交接日誌'}_${blankMode ? '空白表' : d.replace(/-/g, '')}.pdf`);
      return new File([pdf.output('blob')], name, { type: 'application/pdf' });
    } finally { host.remove(); }
  }
  async function printSheets(d) {
    if (!DESK && !IS_MOBILE) return window.print();
    toast('PDF 產生中…', 8000);
    try {
      const file = await buildPdf(d);
      await saveFile(new Uint8Array(await file.arrayBuffer()), file.name, 'application/pdf');
    } catch (e) { toast('PDF 產生失敗：' + (e.message || e), 5000); }
  }
  async function saveFile(bytes, name, mime) {
    if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
    if (DESK) {
      const p = await (await api()).export_file(b64(bytes), name);
      if (p) toast('已儲存：' + p, 4000);
      return;
    }
    const blob = new Blob([bytes], { type: mime });
    if (IS_MOBILE && navigator.canShare) {
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

  // ------------------------------------------------------------------ 品項設定
  function listEditor(key, title, hint, addLabel, timeCol) {
    const L = db[key] || [];
    return `<h3 class="sec" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${title}<button class="btn sm pri" data-act="lsadd" data-ls="${key}">＋ ${addLabel}</button></h3>
      <p class="muted" style="margin-top:0">${hint}</p>
      <div class="box"><div class="lslist">${L.map((x, i) => `<div class="ls" data-ls="${key}" data-i="${i}">
        ${timeCol ? `<input class="t" data-lf="time" value="${esc(x.time)}" placeholder="10:30~11:30" aria-label="時間">` : ''}
        <input data-lf="name" value="${esc(x.name)}" aria-label="名稱">
        <button class="btn sm" data-act="lsup" ${i ? '' : 'disabled'} title="往前移">↑</button>
        <button class="btn sm danger" data-act="lsdel" title="刪除">✕</button></div>`).join('') || '<span class="muted">沒有項目</span>'}</div></div>`;
  }
  function viewItems(el) {
    const rows = stations().map((s) => {
      const its = itemsOf(s.id);
      return `<tr class="sth"><td colspan="7">${esc(stName(s))}（${its.length} 項）<button class="btn sm" data-act="add" data-st="${s.id}" style="margin-left:10px">＋ 新增品項</button></td></tr>`
        + its.map((it, i) => `<tr data-id="${it.id}">
          <td class="c-name" data-l="品項"><input data-f="name" value="${esc(it.name)}"></td>
          <td class="c-unit" data-l="單位" style="width:70px"><input data-f="unit" value="${esc(it.unit || '')}"></td>
          <td class="c-wd" data-l="平日" style="width:130px"><input data-f="wd" value="${esc(it.wd)}"></td>
          <td class="c-hd" data-l="假日" style="width:130px"><input data-f="hd" value="${esc(it.hd)}"></td>
          <td class="c-st" data-l="站區" style="width:120px"><select data-f="st">${stations().map((x) => `<option value="${x.id}"${x.id === it.st ? ' selected' : ''}>${esc(stName(x))}</option>`).join('')}
            <option disabled>──────</option><option value="@add">＋ 新增站區…</option><option value="@ren">✎ 修改「${esc(stName(stById(it.st) || {}))}」名稱…</option><option value="@del">✕ 刪除「${esc(stName(stById(it.st) || {}))}」站區…</option></select></td>
          <td class="c-ord" style="width:64px;white-space:nowrap"><button class="btn sm" data-act="up" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-act="down" ${i < its.length - 1 ? '' : 'disabled'}>↓</button></td>
          <td class="c-del" style="width:40px"><button class="btn sm danger" data-act="del" title="刪除">✕</button></td></tr>`).join('');
    }).join('');
    const R = db.rev || {};
    el.innerHTML = `<div class="wrap">
      <p class="muted" style="margin-top:0">直接點欄位修改，會自動儲存。份量要分兩行（例：上午2 晚上1）就用空格隔開。假日欄留白時沿用平日份量。</p>
      <div class="tbl-wrap"><table class="items-t"><thead><tr><th>品項</th><th>單位</th><th>平日</th><th>假日</th><th>站區</th><th>排序</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 class="sec">預估營業額</h3>
      <div class="box"><div class="grid2"><label>平日</label><input data-rev="wd" value="${esc(R.wd || '')}"><label>假日</label><input data-rev="hd" value="${esc(R.hd || '')}"></div></div>
      <h3 class="sec" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">站區<button class="btn sm pri" data-act="addst">＋ 新增站區</button></h3>
      <p class="muted" style="margin-top:0">站區名稱可以留空白（跟紙本一樣不印名稱）。「多留空白行」是列印時在這個站區下面多印幾行空白，給現場手寫。</p>
      <div class="bottom" style="margin-top:0">${stations().map((s, i, arr) => `<div class="box" data-sid="${s.id}">
        <h3>${esc(stName(s))}<span class="muted" style="font-size:13px;font-weight:normal">${itemsOf(s.id).length} 項</span>
          <span style="margin-left:auto;display:flex;gap:4px"><button class="btn sm" data-act="stup" ${i ? '' : 'disabled'} title="往前移">↑</button><button class="btn sm" data-act="stdown" ${i < arr.length - 1 ? '' : 'disabled'} title="往後移">↓</button><button class="btn sm danger" data-act="stdel" title="刪除站區">✕ 刪除</button></span></h3>
        <div class="field"><label>站區名稱</label><input data-s="name" value="${esc(s.name)}" placeholder="（空白）"></div>
        <div class="field"><label>列印時多留空白行</label><select data-s="blank">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}"${(+s.blank || 0) === n ? ' selected' : ''}>${n ? n + ' 行' : '不留'}</option>`).join('')}</select></div></div>`).join('') || '<p class="muted">還沒有站區，按「＋ 新增站區」。</p>'}</div>
      ${listEditor('sched', '時程', '交接表最上面的時段，每天可以打勾。', '新增時段', true)}
      ${listEditor('tasks', '交接事項', '每天固定要完成的交接事項，每天可以打勾。', '新增事項', false)}
      <h3 class="sec" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">站區分配的位置<button class="btn sm pri" data-act="addas">＋ 新增位置</button></h3>
      <p class="muted" style="margin-top:0">每天要填人的位置（例：火鍋、控台、海鮮、備料）。交接表上兩個一列。</p>
      <div class="box"><div class="aslist">${assignKeys().map((k, i) => `<span class="as" data-ai="${i}"><input data-as="${i}" value="${esc(k)}" aria-label="位置名稱"><button class="btn sm danger" data-act="asdel" title="刪除這個位置">✕</button></span>`).join('') || '<span class="muted">沒有位置</span>'}</div></div></div>`;
    const itemOf = (row) => db.items.find((x) => x.id === row.dataset.id);
    el.addEventListener('input', (e) => {
      const t = e.target, row = t.closest('tr[data-id]');
      if (row && t.dataset.f && t.tagName === 'INPUT') { const it = itemOf(row); it[t.dataset.f] = t.value.trim(); it.at = now(); save(); return; }
      if (t.dataset.rev) { (db.rev || (db.rev = {}))[t.dataset.rev] = t.value.trim(); save(); return; }
      if (t.dataset.lf) { const ls = t.closest('[data-ls]'); db[ls.dataset.ls][+ls.dataset.i][t.dataset.lf] = t.value.trim(); save(); return; }
      if (t.dataset.as !== undefined) { db.assign = assignKeys().slice(); db.assign[+t.dataset.as] = t.value.trim(); save(); return; }
      const box = t.closest('[data-sid]');
      if (box && t.dataset.s && t.tagName !== 'SELECT') { const s = stById(box.dataset.sid); s[t.dataset.s] = t.value.trim(); s.at = now(); save(); }
    });
    // 品項「站區」下拉選單的特別選項：新增、改名、刪除站區
    async function stationMenu(t, it) {
      const cmd = t.value;
      t.value = it.st; // 先把選單還原，取消時不會停在特別選項上
      const st = stById(it.st);
      if (cmd === '@add') {
        const name = await askText('新增站區（這個品項會移到新站區）', '', '新增');
        if (!name) return;
        const sts = stations();
        const s = { id: uid(), name, blank: 0, ord: (sts.length ? sts[sts.length - 1].ord : 0) + 1, deleted: false, at: now() };
        db.stations.push(s);
        it.st = s.id; it.ord = 1; it.at = now();
        save(); route(); toast(`已新增站區「${name}」`);
      }
      if (cmd === '@ren' && st) {
        const name = await askText('修改站區名稱', st.name, '儲存');
        if (!name || name === st.name) return;
        st.name = name; st.at = now(); save(); route(); toast(`已改名為「${name}」`);
      }
      if (cmd === '@del' && st) {
        const n = itemsOf(st.id).length;
        if (!confirm(`刪除站區「${stName(st)}」${n ? `和裡面的 ${n} 個品項（包含「${it.name}」）` : ''}？\n（之前日誌裡的記錄會保留）`)) return;
        st.deleted = true; st.at = now();
        itemsOf(st.id).forEach((x) => { x.deleted = true; x.at = now(); });
        save(); route(); toast(`已刪除站區「${stName(st)}」`);
      }
    }
    el.addEventListener('change', (e) => {
      const t = e.target, row = t.closest('tr[data-id]');
      if (row && t.dataset.f === 'st' && t.value.startsWith('@')) { stationMenu(t, itemOf(row)); return; }
      if (row && t.dataset.f === 'st') { const it = itemOf(row); it.st = t.value; it.ord = Math.max(0, ...itemsOf(t.value).map((x) => x.ord)) + 1; it.at = now(); save(); route(); }
      const box = t.closest('[data-sid]');
      if (box && t.dataset.s === 'blank') { const s = stById(box.dataset.sid); s.blank = +t.value; s.at = now(); save(); }
      if (t.dataset.as !== undefined) route();
      if (box && t.dataset.s === 'name') route();
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const row = b.closest('tr[data-id]');
      const a = b.dataset.act;
      const box = b.closest('[data-sid]'), st = box && stById(box.dataset.sid);
      const ls = b.closest('.ls');
      if (a === 'lsadd') {
        const k = b.dataset.ls, list = db[k] || (db[k] = []);
        list.push(k === 'sched' ? { id: uid(), time: '', name: '新時段' } : { id: uid(), name: '新事項' });
        save(); route();
        const ins = $$(`.ls[data-ls=${k}] input[data-lf=${k === 'sched' ? 'time' : 'name'}]`); const inp = ins[ins.length - 1]; if (inp) { inp.focus(); inp.select(); }
        return;
      }
      if ((a === 'lsdel' || a === 'lsup') && ls) {
        const list = db[ls.dataset.ls], i = +ls.dataset.i;
        if (a === 'lsdel') { if (!confirm(`刪除「${list[i].time ? list[i].time + ' ' : ''}${list[i].name}」？`)) return; list.splice(i, 1); }
        else if (i) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        save(); route(); return;
      }
      if (a === 'addst') {
        const sts = stations();
        const id = uid();
        db.stations.push({ id, name: '新站區', blank: 0, ord: (sts.length ? sts[sts.length - 1].ord : 0) + 1, deleted: false, at: now() });
        save(); route();
        const inp = $(`[data-sid="${id}"] input[data-s=name]`); if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.select(); }
        return;
      }
      if (a === 'stdel' && st) {
        const n = itemsOf(st.id).length;
        if (!confirm(`刪除站區「${stName(st)}」${n ? `和裡面的 ${n} 個品項` : ''}？\n（之前日誌裡的記錄會保留）`)) return;
        st.deleted = true; st.at = now();
        itemsOf(st.id).forEach((it) => { it.deleted = true; it.at = now(); });
        save(); route(); toast(`已刪除站區「${stName(st)}」`); return;
      }
      if ((a === 'stup' || a === 'stdown') && st) {
        const sts = stations(), i = sts.indexOf(st), j = a === 'stup' ? i - 1 : i + 1;
        if (sts[j]) { sts.forEach((x, k) => { x.ord = k + 1; }); [st.ord, sts[j].ord] = [sts[j].ord, st.ord]; st.at = sts[j].at = now(); save(); route(); }
        return;
      }
      if (a === 'addas') {
        db.assign = assignKeys().concat('新位置'); save(); route();
        const ins = $$('input[data-as]'); const inp = ins[ins.length - 1]; if (inp) { inp.focus(); inp.select(); }
        return;
      }
      if (a === 'asdel') {
        const i = +b.closest('[data-ai]').dataset.ai, keys = assignKeys();
        if (!confirm(`刪除站區分配的位置「${keys[i]}」？`)) return;
        keys.splice(i, 1); db.assign = keys; save(); route(); return;
      }
      if (a === 'add') {
        const its = itemsOf(b.dataset.st), last = its[its.length - 1];
        db.items.push({ id: uid(), st: b.dataset.st, name: '新品項', unit: last ? last.unit : '', wd: '', hd: '', days: '', ord: (last ? last.ord : 0) + 1, deleted: false, at: now() });
        save(); route();
        const inp = $$('tr[data-id] input[data-f=name]').filter((x) => x.value === '新品項').pop(); if (inp) { inp.focus(); inp.select(); }
      }
      if (!row) return;
      const it = itemOf(row);
      if (a === 'del' && confirm(`刪除「${it.name}」？（之前日誌裡的記錄會保留）`)) { it.deleted = true; it.at = now(); save(); route(); }
      if (a === 'up' || a === 'down') {
        const its = itemsOf(it.st), i = its.indexOf(it), j = a === 'up' ? i - 1 : i + 1;
        if (its[j]) { its.forEach((x, k) => { x.ord = k + 1; }); [it.ord, its[j].ord] = [its[j].ord, it.ord]; it.at = its[j].at = now(); save(); route(); }
      }
    });
  }

  // ------------------------------------------------------------------ 設定
  function viewSettings(el) {
    const n = Object.keys(db.logs).filter((k) => Object.keys(db.logs[k].q || {}).length).length;
    el.innerHTML = `<div class="wrap" style="max-width:640px">
      <div class="box"><h3>表單資訊</h3>
        <div class="field"><label>表單標題</label><input id="ttl" value="${esc(db.title || '')}"></div></div>
      <div class="box" style="margin-top:14px"><h3>資料備份</h3>
        <p class="muted">共 ${n} 天有備料記錄、${db.items.filter((i) => !i.deleted).length} 個品項。
        ${DESK ? '<br>本機資料檔：<code id="dpath">…</code>（每天自動保留一份備份）' : '<br>資料存在這個瀏覽器裡，換手機或清除瀏覽資料前請先匯出備份。'}</p>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" data-act="export">匯出備份（JSON）</button>
          <button class="btn" data-act="import">匯入備份…</button><button class="btn danger" data-act="reset">還原成紙本預設</button></div></div>
      <p class="muted" style="text-align:center">備料交接日誌 v${VERSION}${DESK ? '（桌面版）' : ''}・快捷鍵 Alt+1～4 切換頁面</p></div>`;
    if (DESK) api().then((x) => x.data_path()).then((p) => { const e = $('#dpath'); if (e) e.textContent = p; });
    $('#ttl', el).addEventListener('input', (e) => { db.title = e.target.value; db.titleAt = now(); save(); });
    el.addEventListener('click', (e) => {
      const a = e.target.dataset.act;
      if (a === 'export') saveFile(JSON.stringify(db, null, 1), `備料交接日誌_備份_${today().replace(/-/g, '')}.json`, 'application/json');
      if (a === 'import') {
        const f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json';
        f.onchange = async () => {
          try {
            const d = JSON.parse(await f.files[0].text());
            if (!Array.isArray(d.items) || !d.logs) throw new Error('不是備料交接日誌的備份檔');
            if (!confirm('用備份檔取代目前全部資料？')) return;
            db = d; migrate(); await flush(); toast('已匯入備份'); route();
          } catch (err) { alert('匯入失敗：' + (err.message || err)); }
        };
        f.click();
      }
      if (a === 'reset' && confirm('品項、站區、時程、交接事項、站區分配的位置和預估營業額都還原成紙本預設？（每天的記錄會保留，但自己新增的品項會被刪除）')) {
        const t = now(), f = seedForm(t);
        db.stations.forEach((s) => { s.deleted = true; s.at = t; });
        db.items.forEach((i) => { i.deleted = true; i.at = t; });
        db.stations = db.stations.filter((s) => !f.stations.some((x) => x.id === s.id));
        db.stations.push(...f.stations); db.items.push(...f.items);
        Object.assign(db, { sched: f.sched, tasks: f.tasks, assign: f.assign, rev: f.rev });
        save(); toast('已還原'); route();
      }
    });
  }

  // ------------------------------------------------------------------ 啟動
  document.addEventListener('keydown', (e) => {
    if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); location.hash = '#/' + ['day', 'sheet', 'items', 'settings'][+e.key - 1]; }
  });
  async function init() {
    let raw = null;
    try { raw = await loadRaw(); } catch (e) { /* 第一次 */ }
    try { db = raw ? JSON.parse(raw) : null; } catch (e) { db = null; }
    if (!db || !Array.isArray(db.items)) { db = seed(); await flush(); }
    db.logs = db.logs || {};
    if (migrate()) await flush();
    $('#shop').textContent = '備料交接日誌';
    document.title = db.title || '備料交接日誌';
    route();
  }
  window.__prep = { get db() { return db; }, flush, dayStats, sheetPages, buildPdf, VERSION };
  init();
})();
