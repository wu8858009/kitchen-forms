/* 備料交接日誌 — 依紙本「碧潭廚房備料交接日誌」：各站區每日／指定星期的備料品項、備料量、交接事項、站區分配、開台，可列印 A4 交接表 */
(() => {
  'use strict';
  const VERSION = '1.2.0';
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

  // ------------------------------------------------------------------ 預設品項（照紙本抄錄）
  const SEED_STATIONS = [
    { id: 'jian', name: '煎台', page: 1, checks: '檢查配料／醬料\n松阪豬／雞腿／漢堡前置\n煎洋芋' },
    { id: 'lu', name: '爐台', page: 1, checks: '檢查配料／麵飯\n檢查白蝦／魷魚（當天退冰）' },
    { id: 'leng', name: '冷台', page: 2, checks: '檢查配料／醬料／玉米筍／青花菜\n挑山蘿蔔葉／綜合生菜' },
    { id: 'bei', name: '備料區', page: 2, checks: '' },
  ];
  // [站區, 時段, 星期(空白=每日；0=日 1=一…6=六), 品項, 備料時間(分), 平日, 假日]
  const SEED_ITEMS = [
    ['jian', '14-18', '', '低溫羊肩', 5, '10包', '15包'],
    ['jian', '14-18', '', '低溫雞腿', 5, '15包', '30包'],
    ['jian', '14-18', '', '蒸豬腳', 15, '1箱', '1箱'],
    ['jian', '14-18', '', '蒸洋芋', 3, '2斤', '3斤'],
    ['jian', '14-18', '', '調香菜醬', 3, '1包', '2包'],
    ['jian', '14-18', '2', '打花生碎', 15, '2包', ''],
    ['jian', '18-20', '', '退松阪豬(前+後)', 10, '3包', '5包'],
    ['jian', '18-20', '', '退漢堡肉(前+後)', 10, '4包', '8包'],
    ['jian', '18-20', '', '退雞串(前+後)', 10, '6包', '10包'],
    ['jian', '18-20', '', '鮭魚卵', 10, '1盒', '1盒'],
    ['lu', '11-14', '', '蔥絲辣椒絲', 15, '1包', '2包'],
    ['lu', '11-14', '', '柳橙果肉', 5, '5顆', '10顆'],
    ['lu', '11-14', '', '切配料', 10, '1包', '2包'],
    ['lu', '11-14', '', '切芭樂', 3, '1包', '1包'],
    ['lu', '11-14', '', '燒肉醬', 3, '1罐', '1罐'],
    ['lu', '11-14', '', '溫泉蛋', 3, '20顆', '40顆'],
    ['lu', '11-14', '', '切奶油塊', 5, '1塊', '2塊'],
    ['lu', '11-14', '', '煮寬麵', 20, '30份', '40份'],
    ['lu', '11-14', '', '煮義大利米', 20, '30份', '40份'],
    ['lu', '11-14', '', '煮直麵', 20, '30份', '40份'],
    ['lu', '14-18', '1', '海鮮高湯', 30, '4倍', ''],
    ['lu', '14-18', '1', '炒ROUX', 10, '', ''],
    ['lu', '14-18', '2', '修中卷', 30, 'ALL', ''],
    ['lu', '14-18', '2', '修花枝', 30, 'ALL', ''],
    ['lu', '14-18', '3', '松露醬', 15, '10倍', ''],
    ['lu', '14-18', '3', '咖哩麵包粉', 10, '0.5包', ''],
    ['lu', '18-20', '', '退冰五花肉', 10, '10包', '20包'],
    ['lu', '18-20', '', '退冰紅醬', 10, '2包', '2包'],
    ['lu', '18-20', '', '青醬', 10, '5包', '5包'],
    ['lu', '18-20', '', '退冰蝦湯', 10, '1包', '2包'],
    ['leng', '11-14', '', '綜合生菜', 15, '600g', '1200g'],
    ['leng', '11-14', '', '挑山蘿蔔葉', 3, '', ''],
    ['leng', '11-14', '', '鮮奶油紅醬', 3, '1包', '1包'],
    ['leng', '11-14', '', '蒸玉米筍', 3, '5盒', '10盒'],
    ['leng', '11-14', '', '低溫雞胸', 3, '5包', '10包'],
    ['leng', '11-14', '1', '南洋芥末', 15, '11倍', ''],
    ['leng', '11-14', '1', '蜂蜜油醋', 10, '7倍', ''],
    ['leng', '11-14', '1', '烤核桃', 10, '1包', ''],
    ['leng', '14-18', '2', '剝蝦', 60, 'ALL', ''],
    ['leng', '14-18', '2', '椒鹽粉', 10, '150G', ''],
    ['leng', '14-18', '3', '酪梨醬', 30, '13倍', ''],
    ['leng', '18-20', '', '退冰雞胸', 5, '5包', '10包'],
    ['leng', '18-20', '', '退冰千層麵', 5, '4包', '6包'],
    ['bei', '12-18', '1', '香菜醬', 60, '10倍', ''],
    ['bei', '12-18', '1', '炒菇', 120, '20倍', ''],
    ['bei', '12-18', '2', '千層麵', 120, '5倍', ''],
    ['bei', '12-18', '2', '修羊肩', 90, 'ALL', ''],
    ['bei', '12-18', '3', '切cheese', 30, 'ALL', ''],
    ['bei', '12-18', '3', '修雞腿', 70, 'ALL', ''],
    ['bei', '12-18', '3', '修雞胸', 50, 'ALL', ''],
    ['bei', '12-18', '4', '修松阪豬', 60, 'ALL', ''],
    ['bei', '12-18', '4', '包五花肉', 60, 'ALL', ''],
    ['bei', '12-18', '4', '包pizza', 90, 'ALL', ''],
    ['bei', '12-18', '5', '打漢堡肉', 120, 'ALL', ''],
  ];
  const ASSIGN = ['控', '砧板', '烤箱', '爐台', '機動', '煎'];
  const assignKeys = () => (Array.isArray(db.assign) ? db.assign : ASSIGN).filter((k) => String(k).trim());

  function seed() {
    const t = now();
    return {
      ver: 1, title: '碧潭廚房備料交接日誌', area: '碧潭廚房', titleAt: t,
      stations: SEED_STATIONS.map((s, i) => ({ ...s, ord: i + 1, deleted: false, at: t })),
      items: SEED_ITEMS.map(([st, time, days, name, mins, wd, hd], i) => ({ id: uid() + i, st, time, days, name, mins, wd, hd, ord: i + 1, deleted: false, at: t })),
      logs: {}, createdAt: t,
    };
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
  const onDay = (it, d) => !it.days || it.days.includes(String(pd(d).getDay()));
  function log(d, create) {
    let L = db.logs[d];
    if (!L && create) L = db.logs[d] = { q: {}, notes: {}, assign: {}, at: now() };
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
    return { total, done, per, signed: !!(L.sign || '').trim() };
  }

  // ------------------------------------------------------------------ 路由
  const cur = { view: 'day', date: today(), all: {} };
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    const prev = cur.view + '|' + cur.date;
    cur.view = ['day', 'sheet', 'items', 'settings'].includes(h[0]) ? h[0] : 'day';
    if ((cur.view === 'day' || cur.view === 'sheet') && /^\d{4}-\d\d-\d\d$/.test(h[1] || '')) cur.date = h[1];
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === cur.view));
    // 每次換一個新的 #app，舊畫面綁的事件才不會累積（否則按一次會執行好幾次）
    const old = $('#app'), el = old.cloneNode(false);
    const keep = prev === cur.view + '|' + cur.date ? old.scrollTop : 0; // 同一頁重畫（例如新增品項）時保留捲動位置
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

  // ------------------------------------------------------------------ 今日備料
  function itemRow(it, L, hol, on) {
    const e = L.q[it.id] || {};
    const tg = target(it, hol);
    return `<div class="it${filled(e) ? ' done' : ''}${on ? '' : ' off'}" data-id="${it.id}">
      <div class="nm">${esc(it.name)}<small>${esc(it.time)}・${daysLabel(it.days)}${it.mins ? '・' + it.mins + ' 分' : ''}<em class="tg2">・${hol ? '假日' : '平日'} ${esc(tg) || '—'}</em></small></div>
      <span class="tg" title="${hol ? '假日' : '平日'}份量">${esc(tg) || '—'}</span>
      <input class="q" data-f="v" value="${esc(e.v || '')}" placeholder="備料量" aria-label="${esc(it.name)} 備料量">
      <input class="o" data-f="o" value="${esc(e.o || '')}" placeholder="順序" aria-label="${esc(it.name)} 備料順序">
      <button class="ck" data-act="ck" title="完成（✓）">✓</button></div>`;
  }
  function viewDay(el) {
    const d = cur.date, hol = isHol(d), L = log(d) || { q: {}, notes: {}, assign: {} };
    const S = dayStats(d);
    const sts = stations().map((s) => {
      const its = itemsOf(s.id), on = its.filter((i) => onDay(i, d)), off = its.filter((i) => !onDay(i, d));
      const groups = []; let g = null;
      on.forEach((it) => { if (!g || g.time !== it.time) groups.push(g = { time: it.time, list: [] }); g.list.push(it); });
      const showAll = cur.all[s.id];
      const p = S.per[s.id];
      return `<section class="st" data-st="${s.id}"><div class="st-h"><h2>${esc(s.name)}</h2><span class="prog${p.n >= p.t ? ' ok' : ''}">${p.n}/${p.t}</span></div>
        ${groups.map((G) => `<div class="grp">${esc(G.time)}</div>${G.list.map((it) => itemRow(it, L, hol, true)).join('')}`).join('') || '<p class="muted" style="padding:8px 14px;margin:0">今天沒有排定的品項</p>'}
        ${off.length ? (showAll ? `<div class="grp">其他天的品項</div>${off.map((it) => itemRow(it, L, hol, false)).join('')}<button class="more" data-act="all">收起其他天的品項</button>`
          : `<button class="more" data-act="all">顯示其他天的品項（${off.length}）</button>`) : ''}
        <div class="note-box">${s.checks ? `<div class="chk"><b>交接檢查：</b>${esc(s.checks)}</div>` : ''}
          <textarea rows="2" data-note="${s.id}" placeholder="${esc(s.name)}交接事項（例：包豬耳朵、打起司粉×4）">${esc((L.notes || {})[s.id] || '')}</textarea></div></section>`;
    }).join('');
    const A = L.assign || {};
    el.innerHTML = `<div class="wrap">${dateBar('day')}
      <div class="kpis">
        <div class="kpi ${S.done >= S.total && S.total ? 'ok' : 'warn'}"><div class="l">今日備料完成</div><div class="v" id="kdone">${S.done}<small> / ${S.total}</small></div></div>
        <div class="kpi"><div class="l">份量</div><div class="v">${hol ? '假日' : '平日'}</div></div>
        <div class="kpi ${S.signed ? 'ok' : ''}"><div class="l">值班主管簽名</div><div class="v" id="ksign">${S.signed ? esc(L.sign) : '<small>未簽</small>'}</div></div>
      </div>
      <div class="stations">${sts}</div>
      <div class="bottom">
        <div class="box"><h3>站區分配<button class="btn sm" data-act="copyassign" title="帶入前一天的站區分配">帶入前一天</button></h3><div class="grid2">
          ${assignKeys().map((k) => `<label>${esc(k)}</label><input data-assign="${esc(k)}" value="${esc(A[k] || '')}">`).join('') || '<span class="muted">在「品項設定」可以新增站區分配的位置</span>'}</div></div>
        <div class="box"><h3>銷售異動</h3>
          <div class="field"><label>推</label><input data-k="push" value="${esc(L.push || '')}" placeholder="今天要推的菜"></div>
          <div class="field"><label>停</label><input data-k="stop" value="${esc(L.stop || '')}" placeholder="停售品項"></div></div>
        <div class="box"><h3>員工餐</h3><textarea rows="4" data-k="meal" placeholder="今天員工餐內容">${esc(L.meal || '')}</textarea></div>
        <div class="box"><h3>開台</h3>
          <div class="unit"><label>煮湯</label><input data-k="soup" value="${esc(L.soup || '')}" inputmode="decimal"><span>倍</span></div>
          <div class="unit"><label>白飯</label><input data-k="rice" value="${esc(L.rice || '')}" inputmode="decimal"><span>公克</span></div>
          <div class="unit"><label>員工飯</label><input data-k="srice" value="${esc(L.srice || '')}" inputmode="decimal"><span>公克</span></div>
          <div class="field" style="margin-top:12px"><label>值班主管簽名</label><input data-k="sign" value="${esc(L.sign || '')}" placeholder="簽名（輸入姓名）"></div></div>
      </div></div>`;
    bindBar(el, 'day');
    const touch = () => { const LL = log(d, true); LL.at = now(); save(); return LL; };
    el.addEventListener('input', (e) => {
      const t = e.target;
      const row = t.closest('.it');
      if (row && t.dataset.f) {
        const LL = touch(); const q = LL.q[row.dataset.id] || (LL.q[row.dataset.id] = {});
        q[t.dataset.f] = t.value; q.at = now();
        if (t.dataset.f === 'v') refreshRow(row);
      } else if (t.dataset.note) { touch().notes[t.dataset.note] = t.value; }
      else if (t.dataset.assign) { const LL = touch(); (LL.assign || (LL.assign = {}))[t.dataset.assign] = t.value; }
      else if (t.dataset.k) { touch()[t.dataset.k] = t.value; if (t.dataset.k === 'sign') refreshKpi(); }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'ck') {
        const row = b.closest('.it'); const inp = $('input.q', row);
        inp.value = filled({ v: inp.value }) ? '' : '✓';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (b.dataset.act === 'all') { const s = b.closest('.st').dataset.st; cur.all[s] = !cur.all[s]; route(); }
      if (b.dataset.act === 'copyassign') {
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
    const k = $('#kdone'); if (k) { k.innerHTML = `${S.done}<small> / ${S.total}</small>`; k.parentElement.className = `kpi ${S.done >= S.total && S.total ? 'ok' : 'warn'}`; }
    $$('.st').forEach((sec) => { const p = S.per[sec.dataset.st]; const e = $('.prog', sec); if (p && e) { e.textContent = `${p.n}/${p.t}`; e.classList.toggle('ok', p.n >= p.t); } });
    const L = log(cur.date) || {};
    const s = $('#ksign'); if (s) { s.innerHTML = S.signed ? esc(L.sign) : '<small>未簽</small>'; s.parentElement.classList.toggle('ok', S.signed); }
  }

  // ------------------------------------------------------------------ 紙本交接表
  function stationRows(s, d, hol, L, blank, first) {
    const its = itemsOf(s.id);
    if (!its.length) return '';
    const notes = blank ? '' : ((L.notes || {})[s.id] || '').trim();
    const rows = [];
    // 合併儲存格：同一個時段 → 同一個星期
    const span = (arr, i, key) => { let n = 1; while (i + n < arr.length && key(arr[i + n]) === key(arr[i])) n++; return n; };
    its.forEach((it, i) => {
      const e = L.q[it.id] || {};
      let r = '<tr>';
      if (i === 0) r += `<td class="stn" rowspan="${its.length}">${esc(s.name)}</td>`;
      if (i === 0 || its[i - 1].time !== it.time) r += `<td class="tm" rowspan="${span(its, i, (x) => x.time)}">${esc(it.time).replace('-', '<br>-<br>')}</td>`;
      if (i === 0 || its[i - 1].time !== it.time || its[i - 1].days !== it.days) {
        const n = span(its, i, (x) => x.time + '|' + x.days);
        const lab = it.days ? (n > 1 ? '週' : '') + [...it.days].map((c) => WD[+c]).join('') : '每日';
        r += `<td class="dy" rowspan="${n}">${lab}</td>`;
      }
      r += `<td class="nm">${esc(it.name)}</td><td>${it.mins || ''}</td><td>${esc(it.wd)}</td><td>${esc(it.hd)}</td>
        <td class="v">${blank ? '' : esc(e.v || '')}</td><td class="v">${blank ? '' : esc(e.o || '')}</td>`;
      if (i === 0) r += `<td class="hand" rowspan="${its.length}"><b>${esc(s.name)}：</b>${esc(s.checks)}${notes ? `<span class="wr">${esc(notes)}</span>` : ''}</td>`;
      rows.push(r + '</tr>');
    });
    return rows.join('');
  }
  const COLS = '<colgroup><col style="width:26px"><col style="width:30px"><col style="width:24px"><col style="width:118px"><col style="width:36px"><col style="width:46px"><col style="width:46px"><col style="width:50px"><col style="width:40px"><col></colgroup>';
  function sheetHtml(d, page, blank) {
    const L = log(d) || { q: {}, notes: {}, assign: {} };
    const hol = isHol(d);
    const sts = stations().filter((s) => (s.page || 1) === page);
    const dt = pd(d);
    const head = `<div class="sh-t">${esc(db.title || '備料交接日誌')}</div>
      <div class="sh-m"><span>區域：<u>${esc(db.area || '')}</u></span><span>${blank ? '' : (hol ? '假日' : '平日')}</span><span>日期：<u>${blank ? '　　' : dt.getMonth() + 1}</u>月<u>${blank ? '　　' : dt.getDate()}</u>日${blank ? '' : `（${WD[dt.getDay()]}）`}</span></div>`;
    const th = '<tr><th>站<br>區</th><th>時<br>段</th><th></th><th>品項</th><th>備料<br>時間</th><th>平日</th><th>假日</th><th>備料量</th><th>備料<br>順序</th><th>交接事項：</th></tr>';
    const body = sts.map((s, i) => stationRows(s, d, hol, L, blank, i === 0)).join('');
    let low = '';
    if (page === lastPage()) {
      const A = blank ? {} : (L.assign || {});
      const V = (k) => blank ? '' : esc(L[k] || '');
      // 站區分配兩個一列；右邊「推」「停」平分（站區分配的列數＋「員工餐」標題列）
      const keys = assignKeys(), nr = Math.max(1, Math.ceil(keys.length / 2)), R = nr + 1;
      const ps = Math.ceil(R / 2), ss = R - ps;
      const cell = (k) => k ? `<td class="lab">${esc(k)}：</td><td class="v">${esc(A[k] || '')}</td>` : '<td class="lab"></td><td></td>';
      let rows = '';
      for (let r = 0; r < R; r++) {
        let tr = r < nr ? cell(keys[r * 2]) + cell(keys[r * 2 + 1]) : '<td class="hd" colspan="4">員工餐</td>';
        if (r === 0) tr += `<td class="lab" rowspan="${ps}">推：</td><td class="v" rowspan="${ps}">${V('push')}</td>`;
        if (r === ps) tr += `<td class="lab" rowspan="${ss}">停：</td><td class="v" rowspan="${ss}">${V('stop')}</td>`;
        rows += `<tr>${tr}</tr>`;
      }
      low = `<table class="low" style="margin-top:-1px"><colgroup><col style="width:54px"><col><col style="width:54px"><col><col style="width:56px"><col style="width:36%"></colgroup>
        <tr><td class="hd" colspan="4">站區分配</td><td class="hd" colspan="2">銷售異動</td></tr>${rows}
        <tr><td class="v hand" colspan="4" rowspan="4" style="height:112px">${V('meal')}</td><td class="hd" colspan="2">開台</td></tr>
        <tr><td class="lab">煮湯</td><td><span class="v">${V('soup')}</span>　倍</td></tr>
        <tr><td class="lab">白飯</td><td><span class="v">${V('rice')}</span>　公克</td></tr>
        <tr><td class="lab">員工飯</td><td><span class="v">${V('srice')}</span>　公克</td></tr>
        <tr><td colspan="2" class="lab" style="width:auto">值班主管簽名</td><td colspan="4" class="v" style="height:40px">${V('sign')}</td></tr></table>`;
    }
    return `<div class="sheet${blank ? ' blank' : ''}">${head}<table>${COLS}${th}${body}</table>${low}<div class="grow"></div></div>`;
  }
  const lastPage = () => Math.max(1, ...stations().map((s) => s.page || 1));
  function sheetPages(d, blank) {
    const pages = [...new Set(stations().map((s) => s.page || 1))].sort();
    if (!pages.length) pages.push(1);
    return pages.map((p) => sheetHtml(d, p, blank));
  }
  let blankMode = false;
  function viewSheet(el) {
    const d = cur.date;
    el.innerHTML = `<div class="wrap">${dateBar('sheet')}
      <div class="bar no-print"><button class="btn pri" data-act="print">🖨️ ${DESK || IS_MOBILE ? '存成 PDF' : '列印'}</button>
        <label><input type="checkbox" id="blank" ${blankMode ? 'checked' : ''}> 空白表（只印品項，給現場手寫）</label>
        <span class="muted">A4 直式，共 ${sheetPages(d).length} 頁</span></div>
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
  function viewItems(el) {
    const rows = stations().map((s) => {
      const its = itemsOf(s.id);
      return `<tr class="sth"><td colspan="9">${esc(s.name)}（${its.length} 項）<button class="btn sm" data-act="add" data-st="${s.id}" style="margin-left:10px">＋ 新增品項</button></td></tr>`
        + its.map((it, i) => `<tr data-id="${it.id}">
          <td class="c-name" data-l="品項"><input data-f="name" value="${esc(it.name)}"></td>
          <td class="c-time" data-l="時段" style="width:76px"><input data-f="time" value="${esc(it.time)}" placeholder="14-18"></td>
          <td class="c-days" data-l="星期" style="width:200px"><div class="days"><button data-day="" class="${it.days ? '' : 'on'}" title="每天">每</button>${[1, 2, 3, 4, 5, 6, 0].map((n) => `<button data-day="${n}" class="${it.days.includes(String(n)) ? 'on' : ''}">${WD[n]}</button>`).join('')}</div></td>
          <td class="c-mins" data-l="分鐘" style="width:62px"><input data-f="mins" value="${it.mins || ''}" inputmode="numeric"></td>
          <td class="c-wd" data-l="平日" style="width:76px"><input data-f="wd" value="${esc(it.wd)}"></td>
          <td class="c-hd" data-l="假日" style="width:76px"><input data-f="hd" value="${esc(it.hd)}"></td>
          <td class="c-st" data-l="站區" style="width:96px"><select data-f="st">${stations().map((x) => `<option value="${x.id}"${x.id === it.st ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
            <option disabled>──────</option><option value="@add">＋ 新增站區…</option><option value="@ren">✎ 修改「${esc((stById(it.st) || {}).name || '')}」名稱…</option><option value="@del">✕ 刪除「${esc((stById(it.st) || {}).name || '')}」站區…</option></select></td>
          <td class="c-ord" style="width:64px;white-space:nowrap"><button class="btn sm" data-act="up" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-act="down" ${i < its.length - 1 ? '' : 'disabled'}>↓</button></td>
          <td class="c-del" style="width:40px"><button class="btn sm danger" data-act="del" title="刪除">✕</button></td></tr>`).join('');
    }).join('');
    el.innerHTML = `<div class="wrap">
      <p class="muted" style="margin-top:0">直接點欄位修改，會自動儲存。星期按「每」＝每天都要備；選星期（可複選）＝只有那幾天要備。份量欄留白時，假日沿用平日份量。</p>
      <div class="tbl-wrap"><table class="items-t"><thead><tr><th>品項</th><th>時段</th><th>星期</th><th>備料時間(分)</th><th>平日</th><th>假日</th><th>站區</th><th>排序</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">站區與交接檢查事項<button class="btn sm pri" data-act="addst">＋ 新增站區</button></h3>
      <div class="bottom" style="margin-top:0">${stations().map((s, i, arr) => `<div class="box" data-sid="${s.id}">
        <h3>${esc(s.name)}<span class="muted" style="font-size:13px;font-weight:normal">${itemsOf(s.id).length} 項</span>
          <span style="margin-left:auto;display:flex;gap:4px"><button class="btn sm" data-act="stup" ${i ? '' : 'disabled'} title="往前移">↑</button><button class="btn sm" data-act="stdown" ${i < arr.length - 1 ? '' : 'disabled'} title="往後移">↓</button><button class="btn sm danger" data-act="stdel" title="刪除站區">✕ 刪除</button></span></h3>
        <div class="field"><label>站區名稱</label><input data-s="name" value="${esc(s.name)}"></div>
        <div class="field"><label>印在第幾頁</label><select data-s="page">${[1, 2, 3].map((n) => `<option value="${n}"${(s.page || 1) === n ? ' selected' : ''}>第 ${n} 頁</option>`).join('')}</select></div>
        <div class="field"><label>交接檢查事項（每行一項）</label><textarea rows="3" data-s="checks">${esc(s.checks)}</textarea></div></div>`).join('') || '<p class="muted">還沒有站區，按「＋ 新增站區」。</p>'}</div>
      <h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:22px">站區分配的位置<button class="btn sm pri" data-act="addas">＋ 新增位置</button></h3>
      <p class="muted" style="margin-top:0">每天下方「站區分配」要填人的位置（例：控、砧板、烤箱）。交接表上兩個一列。</p>
      <div class="box"><div class="aslist">${assignKeys().map((k, i) => `<span class="as" data-ai="${i}"><input data-as="${i}" value="${esc(k)}" aria-label="位置名稱"><button class="btn sm danger" data-act="asdel" title="刪除這個位置">✕</button></span>`).join('') || '<span class="muted">沒有位置</span>'}</div></div></div>`;
    const itemOf = (row) => db.items.find((x) => x.id === row.dataset.id);
    el.addEventListener('input', (e) => {
      const t = e.target, row = t.closest('tr[data-id]');
      if (row && t.dataset.f && t.tagName === 'INPUT') {
        const it = itemOf(row); it[t.dataset.f] = t.dataset.f === 'mins' ? (parseInt(t.value, 10) || 0) : t.value.trim(); it.at = now(); save();
      }
      if (t.dataset.as !== undefined) { db.assign = assignKeys().slice(); db.assign[+t.dataset.as] = t.value.trim(); db.assignAt = now(); save(); return; }
      const box = t.closest('[data-sid]');
      if (box && t.dataset.s && t.tagName !== 'SELECT') { const s = stById(box.dataset.sid); s[t.dataset.s] = t.value; s.at = now(); save(); }
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
        const s = { id: uid(), name, page: lastPage(), checks: '', ord: (sts.length ? sts[sts.length - 1].ord : 0) + 1, deleted: false, at: now() };
        db.stations.push(s);
        it.st = s.id; it.ord = 1; it.at = now();
        save(); route(); toast(`已新增站區「${name}」`);
      }
      if (cmd === '@ren' && st) {
        const name = await askText(`修改站區名稱`, st.name, '儲存');
        if (!name || name === st.name) return;
        st.name = name; st.at = now(); save(); route(); toast(`已改名為「${name}」`);
      }
      if (cmd === '@del' && st) {
        const n = itemsOf(st.id).length;
        if (!confirm(`刪除站區「${st.name}」${n ? `和裡面的 ${n} 個品項（包含「${it.name}」）` : ''}？\n（之前日誌裡的記錄會保留）`)) return;
        st.deleted = true; st.at = now();
        itemsOf(st.id).forEach((x) => { x.deleted = true; x.at = now(); });
        save(); route(); toast(`已刪除站區「${st.name}」`);
      }
    }
    el.addEventListener('change', (e) => {
      const t = e.target, row = t.closest('tr[data-id]');
      if (row && t.dataset.f === 'st' && t.value.startsWith('@')) { stationMenu(t, itemOf(row)); return; }
      if (row && t.dataset.f === 'st') { const it = itemOf(row); it.st = t.value; it.ord = Math.max(0, ...itemsOf(t.value).map((x) => x.ord)) + 1; it.at = now(); save(); route(); }
      const box = t.closest('[data-sid]');
      if (box && t.dataset.s === 'page') { const s = stById(box.dataset.sid); s.page = +t.value; s.at = now(); save(); }
      if (t.dataset.as !== undefined) route();
      if (box && t.dataset.s === 'name') route();
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const row = b.closest('tr[data-id]');
      if (b.dataset.day !== undefined && row) {
        const it = itemOf(row);
        if (b.dataset.day === '') it.days = '';
        else { const set = new Set(it.days); set.has(b.dataset.day) ? set.delete(b.dataset.day) : set.add(b.dataset.day); it.days = [...set].sort().join(''); }
        it.at = now(); save(); route(); return;
      }
      const a = b.dataset.act;
      const box = b.closest('[data-sid]'), st = box && stById(box.dataset.sid);
      if (a === 'addst') {
        const sts = stations();
        const id = uid();
        db.stations.push({ id, name: '新站區', page: lastPage(), checks: '', ord: (sts.length ? sts[sts.length - 1].ord : 0) + 1, deleted: false, at: now() });
        save(); route();
        const inp = $(`[data-sid="${id}"] input[data-s=name]`); if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.select(); }
        return;
      }
      if (a === 'stdel' && st) {
        const n = itemsOf(st.id).length;
        if (!confirm(`刪除站區「${st.name}」${n ? `和裡面的 ${n} 個品項` : ''}？\n（之前日誌裡的記錄會保留）`)) return;
        st.deleted = true; st.at = now();
        itemsOf(st.id).forEach((it) => { it.deleted = true; it.at = now(); });
        save(); route(); toast(`已刪除站區「${st.name}」`); return;
      }
      if ((a === 'stup' || a === 'stdown') && st) {
        const sts = stations(), i = sts.indexOf(st), j = a === 'stup' ? i - 1 : i + 1;
        if (sts[j]) { sts.forEach((x, k) => { x.ord = k + 1; }); [st.ord, sts[j].ord] = [sts[j].ord, st.ord]; st.at = sts[j].at = now(); save(); route(); }
        return;
      }
      if (a === 'addas') {
        db.assign = assignKeys().concat('新位置'); db.assignAt = now(); save(); route();
        const ins = $$('input[data-as]'); const inp = ins[ins.length - 1]; if (inp) { inp.focus(); inp.select(); }
        return;
      }
      if (a === 'asdel') {
        const i = +b.closest('[data-ai]').dataset.ai, keys = assignKeys();
        if (!confirm(`刪除站區分配的位置「${keys[i]}」？`)) return;
        keys.splice(i, 1); db.assign = keys; db.assignAt = now(); save(); route(); return;
      }
      if (a === 'add') {
        const its = itemsOf(b.dataset.st), last = its[its.length - 1];
        db.items.push({ id: uid(), st: b.dataset.st, time: last ? last.time : '', days: '', name: '新品項', mins: 0, wd: '', hd: '', ord: (last ? last.ord : 0) + 1, deleted: false, at: now() });
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
        <div class="field"><label>表單標題</label><input id="ttl" value="${esc(db.title || '')}"></div>
        <div class="field"><label>區域</label><input id="area" value="${esc(db.area || '')}"></div></div>
      <div class="box" style="margin-top:14px"><h3>資料備份</h3>
        <p class="muted">共 ${n} 天有備料記錄、${db.items.filter((i) => !i.deleted).length} 個品項。
        ${DESK ? '<br>本機資料檔：<code id="dpath">…</code>（每天自動保留一份備份）' : '<br>資料存在這個瀏覽器裡，換手機或清除瀏覽資料前請先匯出備份。'}</p>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" data-act="export">匯出備份（JSON）</button>
          <button class="btn" data-act="import">匯入備份…</button><button class="btn danger" data-act="reset">品項還原成紙本預設</button></div></div>
      <p class="muted" style="text-align:center">備料交接日誌 v${VERSION}${DESK ? '（桌面版）' : ''}・快捷鍵 Alt+1～4 切換頁面</p></div>`;
    if (DESK) api().then((x) => x.data_path()).then((p) => { const e = $('#dpath'); if (e) e.textContent = p; });
    $('#ttl', el).addEventListener('input', (e) => { db.title = e.target.value; db.titleAt = now(); save(); });
    $('#area', el).addEventListener('input', (e) => { db.area = e.target.value; db.titleAt = now(); save(); });
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
            db = d; await flush(); toast('已匯入備份'); route();
          } catch (err) { alert('匯入失敗：' + (err.message || err)); }
        };
        f.click();
      }
      if (a === 'reset' && confirm('品項、站區和站區分配的位置還原成紙本預設？（每天的備料記錄會保留，但自己新增的品項會被刪除）')) {
        const s = seed(); db.stations = s.stations; db.items = s.items; delete db.assign; db.assignAt = now(); save(); toast('已還原'); route();
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
    $('#shop').textContent = '備料交接日誌';
    document.title = db.title || '備料交接日誌';
    route();
  }
  window.__prep = { get db() { return db; }, flush, dayStats, sheetPages, buildPdf, VERSION };
  init();
})();
