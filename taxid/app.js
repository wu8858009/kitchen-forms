/* 統編紀錄系統 — 網頁版與桌面版共用（桌面版網址帶 ?desktop=1，資料改存 %APPDATA%\TaxIdRecord） */
(function () {
  'use strict';
  const VERSION = '1.4.1';
  const T = window.TaxId;
  const LS_KEY = 'taxid.db';
  const DESKTOP = new URLSearchParams(location.search).has('desktop');
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 7);
  const FIELDS = [
    ['no', '統一編號'], ['name', '公司名稱／發票抬頭'], ['boss', '負責人'], ['addr', '地址'], ['tel', '電話'],
    ['contact', '聯絡人'], ['email', 'Email'], ['tags', '分類'], ['note', '備註'],
  ];

  let db = blank();
  const view = { q: '', tag: '', sort: localGet('taxid.sort') || 'recent', online: null };

  function blank() { return { app: 'TaxIdRecord', v: 1, items: [], cloud: null, dupIgnore: [] }; }
  function localGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function localSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 私密模式 */ } }

  /* ---------- 存取 ---------- */
  async function api() {
    for (let i = 0; i < 100 && !(window.pywebview && window.pywebview.api); i++) await new Promise((r) => setTimeout(r, 50));
    return window.pywebview && window.pywebview.api;
  }
  async function load() {
    let text = '';
    if (DESKTOP) { const a = await api(); text = a ? await a.load() : ''; } else text = localGet(LS_KEY) || '';
    if (text) {
      try { db = normalize(JSON.parse(text)); } catch (e) { toast('資料讀取失敗，已用空白資料開啟', 'err'); }
    }
  }
  function normalize(d) {
    const out = blank();
    out.items = (Array.isArray(d && d.items) ? d.items : []).filter((x) => x && x.no).map(fix);
    out.dupIgnore = Array.isArray(d && d.dupIgnore) ? d.dupIgnore.filter((k) => typeof k === 'string') : [];
    const c = d && d.cloud;
    if (c && c.url && c.pw) out.cloud = { url: String(c.url), pw: String(c.pw), rev: +c.rev || 0, pushedAt: +c.pushedAt || 0, on: c.on !== false, lastOk: +c.lastOk || 0, sheet: c.sheet || '' };
    return out;
  }
  function fix(x) {
    const it = { id: x.id || uid() };
    for (const [k] of FIELDS) it[k] = k === 'tags' ? toTags(x.tags) : String(x[k] == null ? '' : x[k]).trim();
    it.no = T.clean(it.no);
    it.star = !!x.star;
    it.status = String(x.status || '');
    it.uses = +x.uses || 0;
    it.lastUsed = +x.lastUsed || 0;
    it.createdAt = +x.createdAt || now();
    it.updatedAt = +x.updatedAt || it.createdAt;
    it.checkedAt = +x.checkedAt || 0;
    it.deleted = !!x.deleted; // 刪除只做標記，雲端同步時其他裝置才會知道
    it.ut = +x.ut || 0; // 使用次數最後變動時間（同步用）
    it.regName = String(x.regName || ''); // 經濟部登記名稱（每週檢查用來比對改名）
    return it;
  }
  const live = () => db.items.filter((x) => !x.deleted);
  function toTags(v) {
    const a = Array.isArray(v) ? v : String(v || '').split(/[,，、;；/|]/);
    return [...new Set(a.map((s) => String(s).trim()).filter(Boolean))];
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
    Cloud.schedule();
  }
  async function flush() {
    clearTimeout(saveTimer);
    const text = JSON.stringify(db);
    if (DESKTOP) {
      const a = await api();
      const r = a ? await a.save(text) : '找不到桌面介面';
      if (r !== true) toast('儲存失敗：' + r, 'err');
    } else localSet(LS_KEY, text);
  }
  window.addEventListener('beforeunload', () => { if (!DESKTOP) localSet(LS_KEY, JSON.stringify(db)); });

  /* ---------- 線上查詢 ---------- */
  const G0V = 'https://company.g0v.ronny.tw/api';
  async function getJson(url, ms = 9000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  /** 依統編查公司／商號資料；找不到回傳 null，連不上丟出錯誤 */
  async function lookup(no) {
    let err = null;
    try {
      const j = await getJson(`${G0V}/show/${no}`);
      const r = T.fromG0v(j && j.data, no);
      if (r) return r;
    } catch (e) { err = e; }
    if (DESKTOP) { // 桌面版改由程式直接問經濟部
      const a = await api();
      if (a) {
        const raw = await a.lookup(no);
        if (raw && raw.error) { if (err) throw new Error(raw.error); } else if (raw) return T.fromGcis(raw);
      }
    }
    if (err) throw err;
    return null;
  }
  async function searchName(q) {
    const j = await getJson(`${G0V}/search?q=${encodeURIComponent(q)}`);
    return (j && Array.isArray(j.data) ? j.data : []).map((d) => T.fromG0v(d)).filter((x) => x && x.no.length === 8);
  }

  /* ---------- 小工具 ---------- */
  let toastTimer = 0;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    const up = document.getElementById('upd'); // 更新提示在畫面上時，訊息放在它上方
    el.style.bottom = up && !up.hidden ? (innerHeight - up.getBoundingClientRect().top + 10) + 'px' : '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 4500 : 2200);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.readOnly = true; // readonly：iPhone 不會跳出鍵盤
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  async function copyItem(it, what) {
    const text = what === 'name' ? it.name : it.no;
    if (!text) return;
    if (await copyText(text)) {
      it.uses++; it.lastUsed = now(); it.ut = now(); save();
      toast(`已複製 ${what === 'name' ? '抬頭' : '統編'}：${text}`, 'ok');
      renderList();
    } else toast('無法複製，請手動選取', 'err');
  }
  const fmtNo = (no) => esc(no);
  function ago(t) {
    if (!t) return '';
    const d = (now() - t) / 1000;
    if (d < 60) return '剛剛';
    if (d < 3600) return Math.floor(d / 60) + ' 分鐘前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小時前';
    if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
    const x = new Date(t);
    return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
  }
  function hl(text, q) {
    text = String(text || '');
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  const allTags = () => {
    const m = new Map();
    for (const it of live()) for (const t of it.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
  };
  const findNo = (no, exceptId) => db.items.find((x) => !x.deleted && x.no === no && x.id !== exceptId);
  const findDead = (no) => db.items.find((x) => x.deleted && x.no === no);

  /* ---------- 篩選與排序 ---------- */
  function matches(it, q) {
    if (!q) return true;
    const qd = T.clean(q);
    if (qd && qd === q.replace(/\s/g, '') && it.no.includes(qd)) return true;
    const lq = q.toLowerCase();
    return [it.name, it.boss, it.addr, it.tel, it.contact, it.email, it.note, it.tags.join(' ')].some((s) => String(s).toLowerCase().includes(lq))
      || (qd.length >= 3 && it.tel.replace(/\D/g, '').includes(qd));
  }
  function filtered() {
    const q = view.q.trim();
    const inTag = (it) => !view.tag || (view.tag === '★' ? it.star : view.tag === '⚠' ? needsCare(it) : it.tags.includes(view.tag));
    let list = live().filter((it) => matches(it, q) && inTag(it));
    const by = {
      recent: (a, b) => (b.lastUsed || b.createdAt) - (a.lastUsed || a.createdAt),
      uses: (a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed,
      name: (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),
      no: (a, b) => a.no.localeCompare(b.no),
      added: (a, b) => b.createdAt - a.createdAt,
    }[view.sort] || (() => 0);
    list.sort((a, b) => (b.star - a.star) || by(a, b));
    if (q) { // 搜尋時：統編開頭相符、名稱開頭相符的排前面
      const qd = T.clean(q), score = (it) => (qd && it.no.startsWith(qd) ? 2 : 0) + (it.name.startsWith(q) ? 1 : 0);
      list = list.map((it, i) => [it, i]).sort((a, b) => score(b[0]) - score(a[0]) || a[1] - b[1]).map((x) => x[0]);
    }
    return list;
  }

  /* ---------- 畫面 ---------- */
  const ICON = {
    all: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    db: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    rows: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    dup: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
  };
  const ico = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const needsCare = (it) => T.badStatus(it.status) || !T.valid(it.no);
  const DAY = 86400000;
  let listMode = localGet('taxid.mode') || (matchMedia('(min-width: 1000px)').matches ? 'table' : 'card');

  function render() {
    $('#app').innerHTML = `
      <section id="kpis" class="kpis"></section>
      <section class="searchbar">
        <div class="sbox">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
          <input id="q" type="search" placeholder="搜尋統編、公司名稱、電話、聯絡人…" title="Enter：複製第一筆的統編　Ctrl+F：回到搜尋框" autocomplete="off" enterkeyhint="search" value="${esc(view.q)}">
          <kbd class="khint">Enter 複製</kbd>
          <button class="x" data-act="clearq" title="清除" ${view.q ? '' : 'hidden'}>✕</button>
        </div>
        <div id="qhint" class="qhint"></div>
      </section>
      <section class="bar">
        <div id="chips" class="chips"></div>
        <div class="bar-r">
          <span id="rcount" class="rcount"></span>
          <div class="seg" role="group" aria-label="顯示方式">
            <button data-mode="card" title="卡片檢視">${ico('grid')}<span>卡片</span></button>
            <button data-mode="table" title="表格檢視">${ico('rows')}<span>表格</span></button>
          </div>
          <label class="sort"><span>排序</span>
            <select id="sort">
              <option value="recent">最近使用</option><option value="uses">最常使用</option>
              <option value="name">名稱</option><option value="no">統編</option><option value="added">最新加入</option>
            </select>
          </label>
        </div>
      </section>
      <section id="online" class="online" hidden></section>
      <section id="list" class="list"></section>`;
    $('#sort').value = view.sort;
    renderList();
  }

  function renderNav() {
    const tags = allTags(), L = live(), total = L.length;
    const stars = L.filter((x) => x.star).length, care = L.filter(needsCare).length, dups = dupCount();
    if (view.tag && !['★', '⚠'].includes(view.tag) && !tags.some(([t]) => t === view.tag)) view.tag = '';
    if (view.tag === '⚠' && !care) view.tag = '';
    const item = (tag, icon, label, n, cls = '') => `<button class="nv ${cls} ${view.tag === tag ? 'on' : ''}" data-tag="${esc(tag)}">${ico(icon)}<span>${esc(label)}</span><i>${n}</i></button>`;
    const side = $('#sidenav');
    if (side) {
      side.innerHTML = `<div class="nsec">檢視</div>
        ${item('', 'all', '全部統編', total)}
        ${item('★', 'star', '常用', stars, 'gold')}
        ${care ? item('⚠', 'warn', '需注意', care, 'red') : ''}
        ${dups ? `<button class="nv amber" data-act="dups">${ico('dup')}<span>可能重複</span><i>${dups}</i></button>` : ''}
        ${tags.length ? `<div class="nsec">分類</div>${tags.map(([t, n]) => item(t, 'tag', t, n)).join('')}` : ''}`;
    }
    $('#chips').innerHTML = [
      `<button class="chip ${view.tag ? '' : 'on'}" data-tag="">全部 <i>${total}</i></button>`,
      stars ? `<button class="chip star ${view.tag === '★' ? 'on' : ''}" data-tag="★">★ 常用 <i>${stars}</i></button>` : '',
      care ? `<button class="chip care ${view.tag === '⚠' ? 'on' : ''}" data-tag="⚠">⚠ 需注意 <i>${care}</i></button>` : '',
      dups ? `<button class="chip care" data-act="dups">🧩 可能重複 <i>${dups}</i></button>` : '',
      ...tags.map(([t, n]) => `<button class="chip ${view.tag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)} <i>${n}</i></button>`),
    ].join('');
    const used30 = L.filter((x) => x.lastUsed > now() - 30 * DAY).length;
    const uses = L.reduce((s, x) => s + x.uses, 0);
    const kpi = (tag, icon, label, v, sub, cls) => `<button class="kpi ${cls}" ${tag != null ? `data-tag="${esc(tag)}"` : 'data-act="sortrecent"'}>
      <span class="ki">${ico(icon)}</span><span class="kt"><small>${label}</small><b>${v}</b><em>${sub}</em></span></button>`;
    $('#kpis').innerHTML = total ? [
      kpi('', 'db', '統編總數', total, `${tags.length} 個分類`, 'k1'),
      kpi('★', 'star', '常用', stars, stars ? '永遠排在最前面' : '點 ☆ 設為常用', 'k2'),
      kpi(null, 'clock', '近 30 天使用', used30, `累計複製 ${uses} 次`, 'k3'),
      kpi(care ? '⚠' : '', 'warn', '需注意', care, care ? '歇業／撤銷或檢查碼不符' : '全部正常', care ? 'k4 alert' : 'k4'),
    ].join('') : '';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === listMode));
  }

  function statusBadge(it) {
    if (!T.valid(it.no)) return '<span class="badge warn" title="統編檢查碼不符，可能打錯">檢查碼不符</span>';
    if (T.badStatus(it.status)) return `<span class="badge bad" title="經濟部登記狀態">${esc(it.status)}</span>`;
    if (it.status) return `<span class="badge okb" title="經濟部登記狀態">${esc(it.status.replace('（財政部）', ''))}</span>`;
    return '<span class="badge mute" title="尚未向經濟部資料查詢">未查詢</span>';
  }

  function renderList() {
    if (!$('#list')) return;
    renderNav();
    const total = live().length;
    $('#count').textContent = total ? `共 ${total} 筆統編` : '尚無資料';
    const q = view.q.trim(), list = filtered();
    renderHint(q, list);
    const scope = view.tag === '★' ? '常用' : view.tag === '⚠' ? '需注意' : view.tag;
    $('#rcount').innerHTML = total ? `${scope ? `<b>${esc(scope)}</b>　` : ''}顯示 ${list.length} / ${total} 筆` : '';
    const mode = matchMedia('(max-width: 640px)').matches ? 'card' : listMode; // 手機一律卡片
    $('#list').className = 'list ' + (mode === 'table' ? 'as-table' : 'as-card');
    if (!total) {
      $('#list').innerHTML = `<div class="empty">
        <div class="eico">${ico('db')}</div>
        <div class="big">還沒有任何統編紀錄</div>
        <p>按「＋ 新增統編」輸入號碼，系統會自動檢查並從經濟部資料帶入公司名稱。<br>已經有 Excel 名單？用「匯入」一次加進來。</p>
        <div class="row"><button class="btn primary" data-act="add">＋ 新增第一筆</button><button class="btn" data-act="import">匯入 Excel / CSV</button></div>
      </div>`;
      return;
    }
    if (!list.length) {
      $('#list').innerHTML = `<div class="empty small">找不到「${esc(q || scope)}」的紀錄</div>`;
      return;
    }
    const lq = q.toLowerCase(), qd = T.clean(q);
    const noHtml = (it) => (qd && it.no.includes(qd) ? hl(it.no, qd) : fmtNo(it.no));
    const nameHtml = (it) => (it.name ? hl(it.name, lq && q) : '<em>（未填公司名稱）</em>');
    const starBtn = (it) => `<button class="star-btn ${it.star ? 'on' : ''}" data-act="star" title="${it.star ? '取消常用' : '設為常用（排在最前面）'}">${it.star ? '★' : '☆'}</button>`;
    const acts = `<button class="ib" data-act="copyno" title="複製統編">${ico('copy')}</button>
      <button class="ib" data-act="big" title="大字顯示（給客人或同事看）">${ico('zoom')}</button>
      <button class="ib" data-act="edit" title="編輯">${ico('edit')}</button>`;
    if (mode === 'table') {
      $('#list').innerHTML = `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="c-star"></th><th>統一編號</th><th>公司名稱／發票抬頭</th><th class="c-hide">負責人</th><th>電話／聯絡人</th><th>分類</th><th>狀態</th><th class="r">使用</th><th class="c-act"></th></tr></thead>
        <tbody>${list.map((it) => `<tr class="item ${it.star ? 'starred' : ''}" data-id="${it.id}">
          <td class="c-star">${starBtn(it)}</td>
          <td><button class="no" data-act="copyno" title="點一下複製統編">${noHtml(it)}</button></td>
          <td class="c-name"><button class="nm" data-act="copyname" title="點一下複製抬頭">${nameHtml(it)}</button>${it.addr ? `<div class="addr">${hl(it.addr, q)}</div>` : ''}</td>
          <td class="c-hide">${hl(it.boss, q) || '<span class="mute">—</span>'}</td>
          <td>${it.tel || it.contact ? `${hl(it.tel, q)}${it.tel && it.contact ? '<br>' : ''}${it.contact ? `<span class="mute">${hl(it.contact, q)}</span>` : ''}` : '<span class="mute">—</span>'}</td>
          <td>${it.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join(' ') || '<span class="mute">—</span>'}</td>
          <td>${statusBadge(it)}</td>
          <td class="r used">${it.uses ? `<b>${it.uses}</b> 次<br><span class="mute">${ago(it.lastUsed)}</span>` : '<span class="mute">—</span>'}</td>
          <td class="c-act"><div class="acts">${acts}</div></td>
        </tr>`).join('')}</tbody></table></div>`;
      return;
    }
    $('#list').innerHTML = list.map((it) => {
      const sub = [it.boss && `負責人 ${hl(it.boss, q)}`, it.tel && `☎ ${hl(it.tel, q)}`, it.contact && `聯絡人 ${hl(it.contact, q)}`].filter(Boolean).join('<span class="dot">·</span>');
      return `<article class="item card ${it.star ? 'starred' : ''} ${needsCare(it) ? 'care' : ''}" data-id="${it.id}">
        <div class="ch">
          ${starBtn(it)}
          <button class="no" data-act="copyno" title="點一下複製統編">${noHtml(it)}</button>
          <span class="sp"></span>${statusBadge(it)}
        </div>
        <button class="nm" data-act="copyname" title="點一下複製抬頭">${nameHtml(it)}</button>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
        ${it.addr || it.note ? `<div class="l3">${it.addr ? `<span>📍 ${hl(it.addr, q)}</span>` : ''}${it.note ? `<span class="note">📝 ${hl(it.note, q)}</span>` : ''}</div>` : ''}
        <div class="cf">
          <div class="tags">${it.tags.map((t) => `<span class="badge tag">${esc(t)}</span>`).join('')}</div>
          <span class="used" title="複製次數／最近使用">${it.uses ? `用過 ${it.uses} 次 · ${ago(it.lastUsed)}` : '尚未使用'}</span>
          <div class="acts">${acts}</div>
        </div>
      </article>`;
    }).join('');
  }

  function renderHint(q, list) {
    const el = $('#qhint'), on = $('#online');
    $('[data-act=clearq]').hidden = !view.q;
    if (!q) { el.innerHTML = ''; on.hidden = true; view.online = null; return; }
    const qd = T.clean(q), isNo = qd.length && /^[\d０-９\s-]+$/.test(q);
    if (isNo) {
      const st = T.status(qd);
      const exist = qd.length === 8 && findNo(qd);
      el.innerHTML = `<span class="vs ${st.ok ? 'ok' : qd.length === 8 ? 'bad' : ''}">${st.ok ? '✓' : qd.length === 8 ? '✗' : '…'} ${esc(st.msg)}</span>`
        + (qd.length === 8 && !exist ? ` <button class="btn sm primary" data-act="lookupq">查詢 ${esc(qd)} 的公司資料</button> <button class="btn sm" data-act="addq">直接新增</button>` : '');
      if (qd.length === 8 && !exist && view.online && view.online.q === qd) renderOnline();
      else if (!(view.online && view.online.q === qd)) on.hidden = true;
    } else if (q.length >= 2) {
      el.innerHTML = `${list.length ? `找到 ${list.length} 筆` : '紀錄裡沒有'} <button class="btn sm" data-act="searchq">🌐 到經濟部資料搜尋「${esc(q)}」</button>`;
      if (view.online && view.online.q === q) renderOnline(); else on.hidden = true;
    } else { el.innerHTML = ''; on.hidden = true; }
  }

  function renderOnline() {
    const on = $('#online'), o = view.online;
    if (!o) { on.hidden = true; return; }
    on.hidden = false;
    if (o.loading) { on.innerHTML = '<div class="ol-head">查詢中…</div>'; return; }
    if (o.error) { on.innerHTML = `<div class="ol-head err">線上查詢失敗：${esc(o.error)}（請確認網路連線）</div>`; return; }
    if (!o.rows.length) { on.innerHTML = `<div class="ol-head">經濟部資料查無「${esc(o.q)}」${/^\d{8}$/.test(o.q) ? '（可能是學校、機關、協會等非公司行號，可直接新增後自行填寫名稱）' : ''}</div>`; return; }
    on.innerHTML = `<div class="ol-head">🌐 經濟部登記資料（${o.rows.length} 筆）<button class="x" data-act="closeonline" title="關閉">✕</button></div>`
      + o.rows.slice(0, 30).map((r, i) => {
        const have = findNo(r.no);
        return `<div class="ol-row">
          <div class="ol-main"><b class="mono">${esc(r.no)}</b> <span>${esc(r.name)}</span>
            ${r.status ? `<span class="badge ${T.badStatus(r.status) ? 'bad' : 'okb'}">${esc(r.status)}</span>` : ''}
            <div class="ol-sub">${[r.boss && '負責人 ' + esc(r.boss), r.addr && esc(r.addr)].filter(Boolean).join('　')}</div></div>
          <div class="ol-act">${have ? '<span class="muted">已在紀錄中</span>' : `<button class="btn sm primary" data-act="addonline" data-i="${i}">＋ 加入</button>`}
            <button class="btn sm" data-act="copyonline" data-i="${i}">複製統編</button></div>
        </div>`;
      }).join('');
  }

  async function runOnline(q, fn) {
    view.online = { q, loading: true, rows: [] };
    renderOnline();
    try {
      const rows = await fn();
      if (!view.online || view.online.q !== q) return;
      view.online = { q, rows };
    } catch (e) {
      if (!view.online || view.online.q !== q) return;
      view.online = { q, rows: [], error: e.name === 'AbortError' ? '逾時' : e.message };
    }
    renderOnline();
  }

  /* ---------- 新增／編輯 ---------- */
  function modal(html, cls = '') {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal ' + cls;
    m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }
  function closeModal() { document.querySelectorAll('.modal').forEach((m) => m.remove()); }

  function editForm(it, preset) {
    const isNew = !it;
    const d = it || Object.assign({ no: '', name: '', boss: '', addr: '', tel: '', contact: '', email: '', tags: [], note: '', star: false, status: '' }, preset || {});
    const m = modal(`
      <form class="ed" autocomplete="off">
        <h2>${isNew ? '新增統編' : '編輯統編'}</h2>
        <div class="f no-f">
          <label for="f-no">統一編號 <b class="req">*</b></label>
          <div class="no-row">
            <input id="f-no" name="no" inputmode="numeric" maxlength="12" class="mono big" value="${esc(d.no)}" placeholder="8 碼數字" required>
            <button type="button" class="btn" data-act="fetch">🔍 查詢帶入</button>
          </div>
          <div id="f-st" class="vs"></div>
        </div>
        <div class="f"><label for="f-name">公司名稱／發票抬頭</label><input id="f-name" name="name" value="${esc(d.name)}"></div>
        <div class="grid2">
          <div class="f"><label for="f-boss">負責人</label><input id="f-boss" name="boss" value="${esc(d.boss)}"></div>
          <div class="f"><label for="f-tel">電話</label><input id="f-tel" name="tel" inputmode="tel" value="${esc(d.tel)}"></div>
          <div class="f"><label for="f-contact">聯絡人</label><input id="f-contact" name="contact" value="${esc(d.contact)}"></div>
          <div class="f"><label for="f-email">Email</label><input id="f-email" name="email" type="email" value="${esc(d.email)}"></div>
        </div>
        <div class="f"><label for="f-addr">地址</label><input id="f-addr" name="addr" value="${esc(d.addr)}"></div>
        <div class="f"><label for="f-tags">分類（可多個，用逗號分開）</label><input id="f-tags" name="tags" list="taglist" value="${esc(d.tags.join(', '))}" placeholder="例如：廠商、客戶、月結">
          <datalist id="taglist">${allTags().map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist>
          <div class="tagpick">${allTags().slice(0, 12).map(([t]) => `<button type="button" class="chip sm" data-addtag="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
        <div class="f"><label for="f-note">備註</label><textarea id="f-note" name="note" rows="2">${esc(d.note)}</textarea></div>
        <label class="ck"><input type="checkbox" name="star" ${d.star ? 'checked' : ''}> ★ 設為常用（永遠排在最前面）</label>
        <input type="hidden" name="status" value="${esc(d.status)}">
        <div id="f-status" class="muted small">${d.status ? '登記狀態：' + esc(d.status) : ''}</div>
        <div class="foot">
          ${isNew ? '' : '<button type="button" class="btn danger" data-act="del">刪除</button>'}
          <span class="sp"></span>
          <button type="button" class="btn" data-act="cancel">取消</button>
          <button type="submit" class="btn primary">${isNew ? '新增' : '儲存'}</button>
        </div>
      </form>`);
    const f = $('form', m), noEl = f.no;
    const upd = () => {
      const st = T.status(noEl.value), no = T.clean(noEl.value), dup = no.length === 8 && findNo(no, it && it.id);
      $('#f-st', m).className = 'vs ' + (st.ok ? 'ok' : no.length >= 8 ? 'bad' : '');
      $('#f-st', m).innerHTML = (st.ok ? '✓ ' : no.length >= 8 ? '✗ ' : '') + esc(st.msg)
        + (dup ? ` — <b>這個統編已經在紀錄中（${esc(dup.name || '未命名')}）</b> <a href="#" data-open="${dup.id}">開啟</a>` : '');
    };
    noEl.addEventListener('input', upd);
    upd();
    const fetchIt = async (auto) => {
      const no = T.clean(noEl.value);
      if (!T.valid(no)) { if (!auto) toast('請先輸入正確的 8 碼統編', 'err'); return; }
      const btn = $('[data-act=fetch]', m);
      btn.disabled = true; btn.textContent = '查詢中…';
      try {
        const r = await lookup(no);
        if (!document.body.contains(m)) return;
        if (!r) { toast('經濟部資料查無此統編，請手動填寫名稱', 'err'); return; }
        const changed = [];
        for (const k of ['name', 'boss', 'addr']) {
          if (!r[k]) continue;
          if (!f[k].value.trim() || (!auto && f[k].value.trim() !== r[k] && (k !== 'name' || confirm(`公司名稱要改成「${r.name}」嗎？\n目前：「${f.name.value}」`)))) {
            if (f[k].value.trim() !== r[k]) changed.push(k);
            f[k].value = r[k];
          }
        }
        f.status.value = r.status || '';
        f.dataset.reg = r.name || '';
        $('#f-status', m).innerHTML = r.status ? `登記狀態：<span class="${T.badStatus(r.status) ? 'bad-t' : ''}">${esc(r.status)}</span>（${esc(r.kind)}）` : '';
        f.dataset.checked = '1';
        toast(changed.length ? `已帶入：${r.name}` : '資料已是最新', 'ok');
        if (T.badStatus(r.status)) toast(`注意：此統編登記狀態為「${r.status}」`, 'err');
      } catch (e) {
        toast('線上查詢失敗：' + (e.name === 'AbortError' ? '逾時' : e.message), 'err');
      } finally {
        btn.disabled = false; btn.textContent = '🔍 查詢帶入';
      }
    };
    $('[data-act=fetch]', m).onclick = () => fetchIt(false);
    noEl.addEventListener('input', () => { if (T.clean(noEl.value).length === 8 && T.valid(T.clean(noEl.value)) && !f.name.value.trim()) fetchIt(true); });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act],[data-addtag],[data-open]');
      if (!b) return;
      if (b.dataset.open) { e.preventDefault(); editForm(db.items.find((x) => x.id === b.dataset.open)); return; }
      if (b.dataset.addtag) {
        const tags = toTags(f.tags.value);
        if (!tags.includes(b.dataset.addtag)) tags.push(b.dataset.addtag);
        f.tags.value = tags.join(', ');
        return;
      }
      if (b.dataset.act === 'cancel') closeModal();
      if (b.dataset.act === 'del' && confirm(`確定刪除「${it.no} ${it.name}」？`)) {
        it.deleted = true; it.updatedAt = now();
        save(); closeModal(); renderList(); toast('已刪除');
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const no = T.clean(f.no.value);
      if (no.length !== 8) { toast('統一編號必須是 8 碼數字', 'err'); noEl.focus(); return; }
      const dup = findNo(no, it && it.id);
      if (dup) { toast(`統編 ${no} 已經在紀錄中（${dup.name || '未命名'}）`, 'err'); return; }
      if (!T.valid(no) && !confirm(`統編 ${no} 的檢查碼不符，可能打錯了。\n仍要儲存嗎？`)) return;
      // 雲端以統編當作每一筆的識別：改了統編 = 舊統編標記刪除、新統編另成一筆
      let rec = it;
      if (!it || it.no !== no) {
        const dead = findDead(no);
        rec = dead || fix({ no, createdAt: now() });
        if (it) { Object.assign(rec, { uses: it.uses, lastUsed: it.lastUsed, ut: now() }); it.deleted = true; it.updatedAt = now(); }
        rec.deleted = false;
        if (!dead) db.items.push(rec);
      }
      Object.assign(rec, {
        no, name: f.name.value.trim(), boss: f.boss.value.trim(), addr: f.addr.value.trim(), tel: f.tel.value.trim(),
        contact: f.contact.value.trim(), email: f.email.value.trim(), tags: toTags(f.tags.value), note: f.note.value.trim(),
        star: f.star.checked, status: f.status.value, updatedAt: now(),
      });
      if (f.dataset.checked) { rec.checkedAt = now(); rec.regName = f.dataset.reg || rec.regName; }
      save(); closeModal(); renderList();
      toast(it ? '已儲存' : `已新增 ${no} ${rec.name}`, 'ok');
    });
    setTimeout(() => (isNew && !d.no ? noEl : f.name).focus(), 30);
  }

  /** 統編的條碼（Code 128）或 QR Code，SVG 字串 */
  function codeSvg(no, kind) {
    if (kind === 'qr') {
      const q = qrcode(0, 'M');
      q.addData(no); q.make();
      return q.createSvgTag({ cellSize: 8, margin: 2, alt: 'QR Code ' + no });
    }
    return Barcode.svg(no, { module: 3, h: 96 });
  }
  function bigView(it) {
    const groups = it.no.replace(/(\d{4})(\d{4})/, '$1 $2');
    let kind = localGet('taxid.code') || 'bar';
    const m = modal(`
      <div class="bigv">
        <div class="lbl">統一編號</div>
        <div class="bno mono">${esc(groups)}</div>
        <div class="bname">${esc(it.name || '')}</div>
        ${it.addr ? `<div class="baddr">${esc(it.addr)}</div>` : ''}
        <div class="codebox">
          <div class="seg" role="group" aria-label="條碼種類">
            <button data-kind="bar">條碼</button><button data-kind="qr">QR Code</button><button data-kind="none">不顯示</button>
          </div>
          <div id="bcode" class="bcode"></div>
          <div class="muted small" id="bcap"></div>
        </div>
        <div class="foot center">
          <button class="btn primary" data-act="bcopyno">複製統編</button>
          ${it.name ? '<button class="btn" data-act="bcopyname">複製抬頭</button>' : ''}
          <button class="btn" data-act="bclose">關閉（Esc）</button>
        </div>
      </div>`, 'big');
    const draw = () => {
      m.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
      $('#bcode', m).innerHTML = kind === 'none' ? '' : codeSvg(it.no, kind);
      $('#bcode', m).hidden = kind === 'none';
      $('#bcap', m).textContent = kind === 'bar' ? 'Code 128 條碼：收銀機掃描槍可直接讀取' : kind === 'qr' ? '手機相機或掃描槍可讀取' : '';
    };
    draw();
    m.addEventListener('click', (e) => {
      const k = e.target.closest('[data-kind]');
      if (k) { kind = k.dataset.kind; localSet('taxid.code', kind); draw(); return; }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'bcopyno') copyItem(it, 'no');
      if (a.dataset.act === 'bcopyname') copyItem(it, 'name');
      if (a.dataset.act === 'bclose') closeModal();
    });
  }

  /* ---------- 工具選單：匯出、匯入、備份 ---------- */
  function toolsMenu() {
    const m = modal(`
      <div class="tools">
        <h2>工具</h2>
        <button class="trow" data-act="cloud"><b>☁ Google 雲端同步</b><span>${Cloud.on() ? `已連線：資料存在 Google 試算表，各裝置自動同步（${esc(Cloud.label())}）` : '把資料存到你的 Google 試算表，電腦、手機自動同步'}</span></button>
        <button class="trow" data-act="xlsx"><b>📊 匯出 Excel</b><span>所有統編存成 .xlsx（統編保留開頭的 0）</span></button>
        <button class="trow" data-act="import"><b>📥 匯入 Excel / CSV</b><span>自動找出「統編、名稱、地址、電話…」欄位；重複的統編只補空白欄位</span></button>
        <button class="trow" data-act="weekly"><b>🗓 每週自動檢查歇業</b><span>${Cloud.on() ? '雲端每週一早上查詢所有統編，有公司歇業、解散或改名就寄 Email 通知你' : '需要先連線 Google 雲端同步'}</span></button>
        <button class="trow" data-act="dups"><b>🧩 重複資料檢查</b><span>${(() => { const n = T.findDups(live(), db.dupIgnore).length; return n ? `找到 <b class="bad-t">${n}</b> 組可能重複（名稱、簡稱、統編打錯、同電話地址），可一鍵合併` : '目前沒有發現重複的資料'; })()}</span></button>
        <button class="trow" data-act="refresh"><b>🔄 批次更新公司資料</b><span>向經濟部資料查詢所有統編，補齊空白的名稱／地址並更新登記狀態（歇業會標紅）</span></button>
        <button class="trow" data-act="backup"><b>💾 完整備份（JSON）</b><span>含使用次數、常用標記，可在別台電腦還原</span></button>
        <button class="trow" data-act="restore"><b>♻️ 從備份還原</b><span>選擇先前的 .json 備份檔</span></button>
        <div class="muted small about">統編紀錄系統 v${VERSION}　${DESKTOP ? '資料位置：<span id="dpath">…</span>' : '資料存在這台裝置的瀏覽器裡，換手機或清除瀏覽資料前請先備份。'}<br>公司資料來源：經濟部商工登記公示資料（透過 g0v 公司資料 API）。</div>
        <div class="foot"><span class="sp"></span><button class="btn" data-act="cancel">關閉</button></div>
      </div>`);
    if (DESKTOP) api().then((a) => a && a.data_path()).then((p) => { const el = $('#dpath', m); if (el && p) el.textContent = p; });
    m.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'cancel') return closeModal();
      closeModal();
      if (act === 'xlsx') exportXlsx();
      if (act === 'import') pickFile('.xlsx,.csv,.txt', importFile);
      if (act === 'refresh') refreshAll();
      if (act === 'dups') dupBox();
      if (act === 'weekly') weeklyBox();
      if (act === 'backup') download(new TextEncoder().encode(JSON.stringify({ ...db, cloud: undefined, items: live() }, null, 1)), `統編紀錄備份_${ymd()}.json`, 'application/json');
      if (act === 'cloud') cloudBox();
      if (act === 'restore') pickFile('.json', restore);
    });
  }
  const ymd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  function dateStr(t) { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; }

  function pickFile(accept, fn) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => inp.files[0] && fn(inp.files[0]);
    inp.click();
  }
  async function download(bytes, filename, mime) {
    if (DESKTOP) {
      const a = await api();
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const p = await a.export_file(btoa(bin), filename);
      if (p) toast('已儲存：' + p, 'ok');
      return p;
    }
    const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touch && navigator.canShare) {
      try {
        const file = new File([bytes], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          toast('已輸出 ' + filename, 'ok');
          return filename;
        }
      } catch (e) {
        if (e.name === 'AbortError') return ''; // 使用者取消分享
      }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const el = document.createElement('a');
    el.href = url; el.download = filename;
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('已下載 ' + filename, 'ok');
    return filename;
  }

  function exportRows() {
    const head = ['統一編號', '公司名稱／抬頭', '負責人', '地址', '電話', '聯絡人', 'Email', '分類', '備註', '常用', '使用次數', '最近使用', '登記狀態', '檢查碼'];
    const items = live().sort((a, b) => (b.star - a.star) || a.name.localeCompare(b.name, 'zh-Hant'));
    return [head.map((h) => ({ v: h, s: 1 })), ...items.map((it) => [
      it.no, it.name, it.boss, it.addr, it.tel, it.contact, it.email, it.tags.join('、'), it.note,
      it.star ? '★' : '', it.uses || null, dateStr(it.lastUsed), it.status, T.valid(it.no) ? '正確' : '不符',
    ])];
  }
  function exportXlsx() {
    if (!live().length) return toast('目前沒有資料可以匯出', 'err');
    const bytes = XLSXW.build([{ name: '統編紀錄', cols: [12, 34, 10, 40, 15, 10, 24, 14, 24, 6, 9, 12, 12, 8], rows: exportRows(), freeze: 1 }]);
    return download(bytes, `統編紀錄_${ymd()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const sep = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /** 二維表格 → 統編資料（自動辨識欄位） */
  function rowsToItems(rows) {
    rows = rows.filter((r) => r && r.some((c) => String(c).trim()));
    const KEYS = {
      no: /統一?編號?|統編|tax|vat|^編號$/i, name: /名稱|抬頭|公司|商號|客戶|廠商|name/i, boss: /負責人|代表人/, addr: /地址|住址|address/i,
      tel: /電話|手機|tel|phone/i, contact: /聯絡人|窗口|contact/i, email: /e-?mail|信箱/i, tags: /分類|類別|標籤|群組/, note: /備註|說明|note/i, star: /常用/,
    };
    let headIdx = -1, map = {};
    for (let i = 0; i < Math.min(rows.length, 5) && headIdx < 0; i++) {
      const m = {};
      rows[i].forEach((c, ci) => {
        const s = String(c).trim();
        if (!s || /^\d+$/.test(T.clean(s)) && T.clean(s).length >= 7) return;
        for (const [k, re] of Object.entries(KEYS)) if (!(k in m) && re.test(s)) { m[k] = ci; break; }
      });
      if ('no' in m) { headIdx = i; map = m; }
    }
    if (headIdx < 0) { // 沒有標題列：找最像統編的那一欄，右邊第一個文字欄當名稱
      const cols = Math.max(...rows.map((r) => r.length));
      let best = -1, bestN = 0;
      for (let c = 0; c < cols; c++) {
        const n = rows.filter((r) => T.clean(r[c]).length === 8 || /^\d{6,7}$/.test(String(r[c] || '').trim())).length;
        if (n > bestN) { best = c; bestN = n; }
      }
      if (best < 0) return { items: [], bad: rows.length };
      map.no = best;
      for (let c = 0; c < cols; c++) if (c !== best && rows.some((r) => /[^\d\s-]/.test(r[c] || ''))) { map.name = c; break; }
    }
    const items = [];
    let bad = 0;
    for (const r of rows.slice(headIdx + 1)) {
      let no = T.clean(r[map.no]);
      if (/^\d{6,7}$/.test(no)) no = no.padStart(8, '0'); // Excel 把開頭的 0 吃掉了
      if (no.length !== 8) { if (String(r[map.no] || '').trim() || (map.name != null && String(r[map.name] || '').trim())) bad++; continue; }
      const it = { no };
      for (const k of Object.keys(KEYS)) if (k !== 'no' && map[k] != null) it[k] = String(r[map[k]] == null ? '' : r[map[k]]).trim();
      if ('star' in it) it.star = /★|是|y|1|v|✓/i.test(it.star);
      items.push(it);
    }
    return { items, bad };
  }

  function mergeItems(list) {
    let add = 0, upd = 0;
    for (const raw of list) {
      const ex = findNo(T.clean(raw.no));
      if (ex) {
        let ch = false;
        for (const [k] of FIELDS) {
          if (k === 'no') continue;
          if (k === 'tags') { const t = toTags([...ex.tags, ...toTags(raw.tags)]); if (t.length !== ex.tags.length) { ex.tags = t; ch = true; } continue; }
          if (!ex[k] && raw[k]) { ex[k] = String(raw[k]).trim(); ch = true; }
        }
        if (raw.star && !ex.star) { ex.star = true; ch = true; }
        if (ch) { ex.updatedAt = now(); upd++; }
      } else {
        const rec = fix(Object.assign({}, raw, { id: undefined, createdAt: now() }));
        const dead = findDead(rec.no);
        if (dead) Object.assign(dead, rec, { id: dead.id, deleted: false, updatedAt: now() });
        else db.items.push(rec);
        add++;
      }
    }
    return { add, upd };
  }

  async function importFile(file) {
    try {
      const rows = /\.xlsx$/i.test(file.name) ? await XLSXW.read(await file.arrayBuffer()) : parseCsv(await readText(file));
      const { items, bad } = rowsToItems(rows);
      if (!items.length) return toast('檔案裡找不到 8 碼統編', 'err');
      const r = mergeItems(items);
      save(); renderList();
      const invalid = items.filter((x) => !T.valid(x.no)).length;
      alertBox('匯入完成', `新增 <b>${r.add}</b> 筆，補齊既有資料 <b>${r.upd}</b> 筆${bad ? `，略過格式不對的 ${bad} 列` : ''}。${invalid ? `<br><span class="bad-t">其中 ${invalid} 筆統編檢查碼不符，清單上會標示「檢查碼不符」。</span>` : ''}
        ${items.some((x) => !x.name) ? '<br><br>有些統編沒有公司名稱，可以到「工具 → 批次更新公司資料」自動補齊。' : ''}`);
      return r;
    } catch (e) {
      toast('匯入失敗：' + e.message, 'err');
    }
  }
  async function readText(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('big5').decode(buf); } // Excel 存的 CSV 常是 Big5
  }
  async function restore(file) {
    try {
      const d = JSON.parse(await readText(file));
      if (!d || !Array.isArray(d.items)) throw new Error('不是統編紀錄的備份檔');
      const n = normalize(d);
      n.items = n.items.filter((x) => !x.deleted);
      const cur = live().length;
      const choice = cur ? await ask('還原備份', `備份裡有 ${n.items.length} 筆，目前有 ${cur} 筆。${Cloud.on() ? '（雲端也會一起更新）' : ''}`, [['merge', '合併（保留目前資料）'], ['replace', '整個取代'], ['', '取消']]) : 'replace';
      if (!choice) return;
      const t = now(), keep = new Set(n.items.map((x) => x.no));
      if (choice === 'replace') { // 不在備份裡的標記刪除（雲端才會跟著刪）
        for (const x of live()) if (!keep.has(x.no)) { x.deleted = true; x.updatedAt = t; }
      }
      for (const it of n.items) {
        const ex = db.items.find((x) => x.no === it.no);
        if (!ex) { it.updatedAt = t; db.items.push(it); continue; }
        if (choice === 'replace' || ex.deleted || it.updatedAt > ex.updatedAt) {
          Object.assign(ex, it, { id: ex.id, deleted: false, updatedAt: t, uses: Math.max(ex.uses, it.uses), lastUsed: Math.max(ex.lastUsed, it.lastUsed) });
        }
      }
      save(); renderList();
      toast(`已還原，共 ${live().length} 筆`, 'ok');
    } catch (e) { toast('還原失敗：' + e.message, 'err'); }
  }

  /* ---------- 重複資料檢查與合併 ---------- */
  let dupMemo = { k: '', n: 0 };
  const dupCount = () => { // 資料沒變就不重算（名單大時 O(n²)）
    const k = db.items.length + '|' + db.items.reduce((m, x) => Math.max(m, x.updatedAt), 0) + '|' + db.dupIgnore.length;
    if (dupMemo.k !== k) dupMemo = { k, n: T.findDups(live(), db.dupIgnore).length };
    return dupMemo.n;
  };
  /** 把 drop 合併進 keep：keep 空白的欄位用 drop 補、分類合併、使用次數相加；drop 標記刪除 */
  function mergeInto(keep, drop) {
    const t = now();
    for (const k of ['name', 'boss', 'addr', 'tel', 'contact', 'email']) if (!keep[k] && drop[k]) keep[k] = drop[k];
    if (drop.note && drop.note !== keep.note) keep.note = keep.note ? `${keep.note}\n${drop.note}` : drop.note;
    if (drop.tel && keep.tel && T.clean(drop.tel) !== T.clean(keep.tel) && !keep.note.includes(drop.tel)) keep.note = `${keep.note ? keep.note + '\n' : ''}另一支電話：${drop.tel}`;
    keep.tags = toTags([...keep.tags, ...drop.tags]);
    keep.star = keep.star || drop.star;
    keep.uses += drop.uses; keep.lastUsed = Math.max(keep.lastUsed, drop.lastUsed);
    if (!keep.status && drop.status) { keep.status = drop.status; keep.checkedAt = drop.checkedAt; }
    keep.updatedAt = t; keep.ut = t;
    drop.deleted = true; drop.updatedAt = t;
  }
  function dupBox() {
    const m = modal('<div class="tools dupbox"><h2>🧩 重複資料檢查</h2><div id="duplist"></div><div class="foot"><span class="muted small" id="dupnote"></span><span class="sp"></span><button class="btn" data-d="close">關閉</button></div></div>');
    m.querySelector('.sheet').classList.add('wide');
    const card = (it, side) => `<div class="dside">
        <div class="dno ${T.valid(it.no) ? '' : 'bad-t'}">${esc(it.no)}${T.valid(it.no) ? '' : ' <span class="badge warn">檢查碼不符</span>'}</div>
        <div class="dnm">${esc(it.name || '（未填名稱）')}</div>
        <div class="dmeta">${[it.boss && '負責人 ' + esc(it.boss), it.tel && '☎ ' + esc(it.tel), it.addr && esc(it.addr)].filter(Boolean).join('<br>') || '<span class="mute">沒有其他資料</span>'}</div>
        <div class="dmeta">${statusBadge(it)} ${it.uses ? `用過 ${it.uses} 次` : '尚未使用'}</div>
        <button class="btn sm primary" data-d="keep" data-side="${side}">保留這筆，合併另一筆</button>
      </div>`;
    const draw = () => {
      const list = T.findDups(live(), db.dupIgnore);
      $('#dupnote', m).textContent = db.dupIgnore.length ? `已略過 ${db.dupIgnore.length} 組「不是重複」` : '';
      if (!list.length) { $('#duplist', m).innerHTML = '<div class="empty small">✓ 沒有發現可能重複的資料</div>'; return; }
      $('#duplist', m).innerHTML = `<p class="muted small">共 ${list.length} 組。合併時會保留你選的那筆，另一筆空白欄位的資料、分類、使用次數會併進來，然後刪除另一筆。</p>`
        + list.map((d, i) => `<div class="dpair" data-i="${i}">
          <div class="dwhy">${d.why.map((w) => `<span class="badge ${w.includes('打錯') ? 'warn' : ''}">${esc(w)}</span>`).join(' ')}<span class="sp"></span><button class="btn sm" data-d="ignore">不是重複</button></div>
          <div class="dcols">${card(d.a, 'a')}<div class="dvs">⇄</div>${card(d.b, 'b')}</div>
        </div>`).join('');
      m._list = list;
    };
    draw();
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      if (b.dataset.d === 'close') return closeModal();
      const d = m._list[+b.closest('.dpair').dataset.i];
      if (b.dataset.d === 'ignore') { db.dupIgnore.push(d.key); save(); draw(); renderList(); return; }
      if (b.dataset.d === 'keep') {
        const [keep, drop] = b.dataset.side === 'a' ? [d.a, d.b] : [d.b, d.a];
        if (!confirm(`保留「${keep.no} ${keep.name}」\n合併並刪除「${drop.no} ${drop.name}」？`)) return;
        mergeInto(keep, drop);
        save(); renderList(); draw();
        toast(`已合併到 ${keep.no} ${keep.name}`, 'ok');
      }
    });
  }

  let refreshing = false;
  async function refreshAll() {
    if (refreshing) return;
    const list = live().filter((x) => T.valid(x.no));
    if (!list.length) return toast('沒有可以查詢的統編', 'err');
    refreshing = true;
    let done = 0, filled = 0, bad = 0, miss = 0, fail = 0;
    const box = modal('<div class="tools"><h2>批次更新公司資料</h2><div class="prog"><div id="pbar"></div></div><p id="ptext" class="muted">準備中…</p><div class="foot"><span class="sp"></span><button class="btn" data-act="stop">停止</button></div></div>');
    let stop = false;
    $('[data-act=stop]', box).onclick = () => { stop = true; };
    for (const it of list) {
      if (stop) break;
      $('#ptext', box).textContent = `${done + 1} / ${list.length}　${it.no} ${it.name}`;
      try {
        const r = await lookup(it.no);
        if (r) {
          let ch = false;
          for (const k of ['name', 'boss', 'addr']) if (!it[k] && r[k]) { it[k] = r[k]; ch = true; }
          if (ch) filled++;
          if (r.status && r.status !== it.status) ch = true;
          if (ch) it.updatedAt = now();
          it.status = r.status || it.status;
          it.regName = r.name || it.regName;
          it.checkedAt = now();
          if (T.badStatus(it.status)) bad++;
        } else miss++;
      } catch (e) { fail++; if (fail >= 3 && !done) break; }
      done++;
      $('#pbar', box).style.width = (done / list.length * 100) + '%';
      await new Promise((r) => setTimeout(r, 250)); // 不要一次打太快
    }
    refreshing = false;
    save(); closeModal(); renderList();
    alertBox('批次更新完成', `已查詢 ${done} 筆，補齊 ${filled} 筆資料。${bad ? `<br><span class="bad-t">${bad} 筆登記狀態不是「核准設立」（歇業、解散等），清單上已標紅。</span>` : ''}${miss ? `<br>${miss} 筆查無登記資料（學校、機關、協會等不在經濟部公司資料內）。` : ''}${fail ? `<br><span class="bad-t">${fail} 筆因網路問題查詢失敗。</span>` : ''}`);
  }

  function alertBox(title, html) {
    const m = modal(`<div class="tools"><h2>${esc(title)}</h2><p>${html}</p><div class="foot"><span class="sp"></span><button class="btn primary" data-act="ok">好</button></div></div>`);
    $('[data-act=ok]', m).onclick = closeModal;
    $('[data-act=ok]', m).focus();
  }
  function ask(title, text, opts) {
    return new Promise((res) => {
      const m = modal(`<div class="tools"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="foot"><span class="sp"></span>${opts.map(([v, l], i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>`);
      m.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { closeModal(); res(b.dataset.v); } });
    });
  }

  /* ---------- Google 雲端同步（Apps Script + 試算表，見 cloud/Code.gs） ---------- */
  const Cloud = {
    busy: false, again: false, timer: 0, poll: 0, state: '', err: '',
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
        if (e instanceof TypeError) throw new Error('無法連線（請檢查網路）');
        throw e;
      } finally { clearTimeout(to); }
    },
    wire(it) {
      return { no: it.no, name: it.name, boss: it.boss, addr: it.addr, tel: it.tel, contact: it.contact, email: it.email, tags: it.tags, note: it.note,
        star: it.star, status: it.status, uses: it.uses, lastUsed: it.lastUsed, deleted: it.deleted, createdAt: it.createdAt, at: it.updatedAt,
        st: it.checkedAt, regName: it.regName };
    },
    changes(since) { return db.items.filter((it) => it.updatedAt > since || it.ut > since).map((it) => this.wire(it)); },
    pending() { return db.cloud ? this.changes(db.cloud.pushedAt).length : 0; },
    merge(rows) {
      let ch = false;
      this.newlyBad = [];
      for (const x of rows || []) {
        if (!x || !/^\d{8}$/.test(x.no)) continue;
        // 同一個統編在本機若有兩筆（刪除標記 + 新的），以沒刪除的為準
        const l = db.items.find((i) => i.no === x.no && !i.deleted) || db.items.find((i) => i.no === x.no);
        if (!l) { db.items.push(fix({ ...x, updatedAt: x.at, checkedAt: +x.st || 0 })); ch = true; continue; }
        const uses = Math.max(l.uses, +x.uses || 0), lastUsed = Math.max(l.lastUsed, +x.lastUsed || 0);
        // 登記狀態以檢查時間較新的為準（雲端每週檢查不動「更新時間」）
        const st = +x.st || 0, wasBad = T.badStatus(l.status);
        const stat = st > l.checkedAt ? { status: String(x.status || ''), checkedAt: st, regName: x.regName || l.regName } : { status: l.status, checkedAt: l.checkedAt, regName: l.regName };
        if ((+x.at || 0) > l.updatedAt) {
          Object.assign(l, fix({ ...x, id: l.id, updatedAt: x.at, uses, lastUsed, ut: l.ut, createdAt: x.createdAt || l.createdAt }), stat);
          ch = true;
        } else {
          if (uses !== l.uses || lastUsed !== l.lastUsed) { l.uses = uses; l.lastUsed = lastUsed; ch = true; }
          if (st > l.checkedAt) { Object.assign(l, stat); ch = true; }
        }
        if (!l.deleted && !wasBad && T.badStatus(l.status)) this.newlyBad.push(l);
      }
      // 清掉多餘的刪除標記（同統編已有有效的一筆）
      const liveNos = new Set(live().map((i) => i.no));
      const before = db.items.length;
      db.items = db.items.filter((i) => !(i.deleted && liveNos.has(i.no)));
      return ch || db.items.length !== before;
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
        const r = await this.req({ a: 'sync', since: c.rev, items: this.changes(c.pushedAt) });
        if (db.cloud !== c || !this.on()) return false;
        const full = !c.rev;
        const changed = this.merge(r.items);
        c.rev = r.rev; c.pushedAt = t0; c.lastOk = now();
        if (!full && this.newlyBad.length) {
          const n = this.newlyBad;
          setTimeout(() => toast(`⚠ ${n.length === 1 ? `「${n[0].name || n[0].no}」` : n.length + ' 家公司'}登記狀態變為${n[0].status}，開發票前請確認`, 'err'), 400);
        }
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
    label() {
      const m = { sync: '同步中…', ok: '已同步', err: '離線：' + this.err, auth: '密碼錯誤' };
      return m[this.state] || '尚未同步';
    },
    show(s) {
      this.state = s;
      const map = { sync: ['同步中…', 'sync'], ok: ['已同步', 'ok'], err: ['離線', 'bad'], auth: ['密碼錯誤', 'bad'] };
      const [t, cls] = this.on() ? (map[s] || ['連線中…', 'sync']) : ['未連線', 'off'];
      const tip = !this.on() ? '尚未連線 Google 雲端，資料只存在這台裝置' : s === 'ok' ? '資料存在 Google 試算表　最後同步 ' + new Date(db.cloud.lastOk).toLocaleTimeString('zh-TW', { hour12: false }) : this.err;
      document.querySelectorAll('[data-act=cloudst]').forEach((e) => {
        e.className = 'cloudst ' + cls + (e.classList.contains('m-only') ? ' m-only' : '');
        e.innerHTML = `<span class="dotc"></span><span class="ct"><small>Google 雲端</small>${t}</span>`;
        e.title = tip; e.hidden = false;
      });
      const box = $('#cloudinfo'); if (box) box.innerHTML = cloudInfo();
    },
  };
  let pendingRefresh = false;
  function refresh() {
    const a = document.activeElement;
    if (document.querySelector('.modal') || (a && a.matches && a.matches('.modal input, .modal textarea'))) { pendingRefresh = true; return; }
    pendingRefresh = false;
    renderList();
  }
  new MutationObserver(() => { if (pendingRefresh && !document.querySelector('.modal')) refresh(); }).observe(document.body, { childList: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Cloud.tick(); });
  window.addEventListener('online', () => Cloud.tick());

  async function connectCloud(url, pw) {
    url = url.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) throw new Error('網址格式不對，應該像 https://script.google.com/macros/s/…/exec');
    if (pw.length < 4) throw new Error('密碼至少 4 個字');
    const c = { url, pw, rev: 0, pushedAt: 0, on: true, lastOk: 0, sheet: '' };
    const r = await Cloud.req({ a: 'ping' }, c);
    let mode = 'merge';
    if (r.counts.items > 0 && live().length) {
      mode = await ask('雲端已經有資料', `雲端有 ${r.counts.items} 筆，這台裝置有 ${live().length} 筆。要怎麼處理？`,
        [['merge', '合併（兩邊都保留）'], ['replace', '改用雲端資料'], ['', '取消']]);
      if (!mode) return null;
    }
    if (mode === 'replace') db.items = [];
    db.cloud = c;
    if (r.sheet) c.sheet = r.sheet;
    await flush();
    const ok = await Cloud.sync();
    Cloud.start();
    if (!ok) throw new Error(Cloud.err || '同步失敗');
    return { claimed: r.claimed, mode, cloudHad: r.counts.items };
  }
  function cloudInfo() {
    if (!Cloud.on()) return '';
    const c = db.cloud;
    return `<div class="cst ${Cloud.state === 'ok' ? 'ok' : Cloud.state === 'sync' ? '' : 'bad'}">● ${esc(Cloud.label())}${c.lastOk ? `　<span class="muted">最後同步 ${new Date(c.lastOk).toLocaleString('zh-TW', { hour12: false })}</span>` : ''}</div>`;
  }
  async function openSheet() {
    const url = db.cloud && db.cloud.sheet;
    if (!url) return toast('還不知道試算表網址，請先同步一次', 'err');
    if (DESKTOP) { const a = await api(); if (a) a.open_url(url); } else window.open(url, '_blank', 'noopener');
  }
  function cloudBox() {
    const on = Cloud.on(), c = db.cloud || {};
    const m = modal(on ? `
      <div class="tools">
        <h2>☁ Google 雲端同步</h2>
        <div id="cloudinfo">${cloudInfo()}</div>
        <p class="muted small">資料存在你的 Google 試算表，這台裝置修改後幾秒內會自動上傳；其他裝置每 15 秒檢查一次更新。也可以直接在試算表上修改或新增（要刪除請在「已刪除」欄填「是」）。</p>
        <div class="foot">
          <button class="btn primary" data-c="now">立即同步</button>
          <button class="btn" data-c="sheet">開啟 Google 試算表</button>
          <button class="btn" data-c="weekly">🗓 每週檢查</button>
          <button class="btn" data-c="pw">修改密碼</button>
          <span class="sp"></span>
          <button class="btn danger" data-c="off">中斷連線</button>
          <button class="btn" data-c="close">關閉</button>
        </div>
      </div>` : `
      <form class="tools ed">
        <h2>☁ 連線 Google 雲端</h2>
        <p class="muted small">連線後，資料會存到 Google 試算表，電腦（exe）和手機（網頁版）輸入同一組網址和密碼，就會自動同步。<br>
        第一次連線時輸入的密碼就是之後所有裝置共用的同步密碼（至少 4 個字），請記下來。</p>
        <div class="f"><label for="curl">雲端網址</label><input id="curl" name="url" value="${esc(c.url || window.TAXID_CLOUD_URL || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></div>
        <div class="f"><label for="cpw">同步密碼</label><input id="cpw" name="pw" type="password" autocomplete="current-password" value=""></div>
        <div id="cmsg" class="vs"></div>
        <div class="foot"><span class="sp"></span><button type="button" class="btn" data-c="close">取消</button><button class="btn primary" type="submit">連線並同步</button></div>
      </form>`);
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      const k = b.dataset.c;
      if (k === 'close') return closeModal();
      if (k === 'sheet') return openSheet();
      if (k === 'weekly') return weeklyBox();
      if (k === 'now') {
        b.disabled = true;
        const ok = await Cloud.sync();
        b.disabled = false;
        toast(ok ? '同步完成' : '同步失敗：' + Cloud.err, ok ? 'ok' : 'err');
      }
      if (k === 'pw') {
        const np = prompt('新的同步密碼（至少 4 個字）。\n改完後，其他裝置要重新輸入新密碼才能同步：');
        if (np == null) return;
        if (np.length < 4) return toast('密碼至少 4 個字', 'err');
        try { await Cloud.req({ a: 'setpw', newpw: np }); db.cloud.pw = np; await flush(); toast('密碼已修改', 'ok'); } catch (err) { toast('修改失敗：' + err.message, 'err'); }
      }
      if (k === 'off') {
        if (!confirm('中斷雲端連線？\n這台裝置會保留目前的資料，但之後不會再同步；Google 試算表裡的資料不會被刪除。')) return;
        await Cloud.sync();
        db.cloud = null; await flush(); Cloud.start(); closeModal(); toast('已中斷雲端連線');
      }
    });
    const f = $('form', m);
    if (f) {
      setTimeout(() => (f.url.value ? f.pw : f.url).focus(), 30);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('[type=submit]', f), msg = $('#cmsg', f);
        btn.disabled = true; btn.textContent = '連線中…'; msg.className = 'vs'; msg.textContent = '';
        try {
          const r = await connectCloud(f.url.value, f.pw.value);
          if (!r) { btn.disabled = false; btn.textContent = '連線並同步'; return; }
          closeModal(); renderList();
          alertBox('已連上 Google 雲端', r.claimed ? '這是第一次連線，剛剛輸入的密碼已設為同步密碼。<br>在其他裝置的「工具 → Google 雲端同步」輸入同一組網址和密碼即可同步。'
            : `已同步，目前共 ${live().length} 筆。`);
        } catch (err) {
          msg.className = 'vs bad'; msg.textContent = err.message;
          btn.disabled = false; btn.textContent = '連線並同步';
        }
      });
    }
  }

  /* ---------- 每週自動檢查歇業（雲端 Apps Script 觸發器，見 cloud/Code.gs runCheck_） ---------- */
  function checkSummary(l) {
    if (!l) return '<span class="mute">還沒有檢查過</span>';
    const when = new Date(l.at).toLocaleString('zh-TW', { hour12: false });
    const label = { status: '狀態', name: '改名', gone: '查無資料' };
    return `<div>${esc(when)}${l.manual ? '（手動）' : '（自動）'}　檢查 <b>${l.checked}</b> 筆${l.failed ? `，<span class="bad-t">${l.failed} 筆失敗</span>` : ''}${l.partial ? '（未完成，下次繼續）' : ''}${l.bad ? `，<span class="bad-t">${l.bad} 筆非核准設立</span>` : ''}</div>`
      + (l.changes && l.changes.length ? `<ul class="chg">${l.changes.slice(0, 20).map((c) => `<li><b class="mono">${esc(c.no)}</b> ${esc(c.name)}　<span class="badge ${c.kind === 'status' && T.badStatus(c.to) ? 'bad' : ''}">${label[c.kind]}</span> ${esc(c.from || '—')} → <b>${esc(c.to || '—')}</b></li>`).join('')}</ul>` : '<div class="mute">沒有變動</div>')
      + (l.mailed ? `<div class="mute">已寄通知到 ${esc(l.mailed)}</div>` : l.mailErr ? `<div class="bad-t">寄信失敗：${esc(l.mailErr)}</div>` : '');
  }
  function weeklyBox() {
    if (!Cloud.on()) { toast('請先在「工具 → Google 雲端同步」連線', 'err'); return cloudBox(); }
    const m = modal(`<div class="tools ed weekly"><h2>🗓 每週自動檢查歇業</h2>
      <p class="muted small">由 Google 雲端每週一早上 8 點自動查詢所有統編的經濟部登記狀態。有公司變成歇業、解散、撤銷，或登記名稱改變時，會寄 Email 通知，App 也會標成「需注意」。電腦不用開機。</p>
      <div id="wk" class="wk"><div class="mute">讀取設定中…</div></div>
      <div class="foot"><span class="sp"></span><button class="btn" data-w="close">關閉</button></div></div>`);
    const box = $('#wk', m);
    const show = (r) => {
      box.innerHTML = `
        <label class="switch"><input type="checkbox" id="wkon" ${r.on ? 'checked' : ''}><span class="sl"></span><b>${r.on ? '已開啟：每週一 08:00 自動檢查' : '目前關閉'}</b></label>
        <div class="f"><label for="wkmail">通知 Email（空白＝寄給試算表擁有者${r.owner ? `：${esc(r.owner)}` : ''}）</label>
          <div class="no-row"><input id="wkmail" type="email" value="${esc(r.email || '')}" placeholder="${esc(r.owner || 'name@example.com')}"><button class="btn" data-w="mail">儲存</button></div></div>
        <div class="f"><label>上次檢查</label><div class="lastchk">${checkSummary(r.last)}</div></div>
        <button class="btn primary" data-w="now">立即檢查一次</button>`;
    };
    const fail = (e) => {
      const old = /未知的動作/.test(e.message);
      box.innerHTML = `<div class="callout bad"><b>${old ? '雲端程式還是舊版' : esc(e.message)}</b><br>
        ${old ? '需要先更新 Google 雲端的程式（Apps Script）。' : ''}請在 Apps Script 編輯器選擇 <b>setupWeekly</b> 執行一次，依畫面完成授權（連外查詢、寄信、排程），再回來重新打開這個視窗。</div>`;
    };
    Cloud.req({ a: 'weekly' }).then(show, fail);
    m.addEventListener('change', async (e) => {
      if (e.target.id !== 'wkon') return;
      e.target.disabled = true;
      try { show(await Cloud.req({ a: 'weekly', set: { on: e.target.checked } })); toast(e.target.checked ? '已開啟每週自動檢查' : '已關閉每週自動檢查', 'ok'); } catch (err) { fail(err); }
    });
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      if (b.dataset.w === 'close') return closeModal();
      if (b.dataset.w === 'mail') {
        try { const r = await Cloud.req({ a: 'weekly', set: { email: $('#wkmail', m).value.trim() } }); show(r); toast('通知信箱已儲存', 'ok'); } catch (err) { toast(err.message, 'err'); }
      }
      if (b.dataset.w === 'now') {
        b.disabled = true; b.textContent = `檢查中…（${live().length} 筆，約需 ${Math.max(5, Math.ceil(live().length / 25) * 2)} 秒）`;
        try {
          await Cloud.sync();
          const r = await Cloud.req({ a: 'checknow' });
          await Cloud.sync();
          show(await Cloud.req({ a: 'weekly' }));
          toast(r.changes.length ? `檢查完成：${r.changes.length} 筆有變動${r.mailed ? '，已寄通知' : ''}` : `檢查完成：${r.checked} 筆都沒有變動`, r.changes.length ? 'err' : 'ok');
        } catch (err) { fail(err); }
      }
    });
  }

  /* ---------- 自動更新：網頁版重新載入；桌面版由 exe 下載新版後呼叫 window.__taxidUpdate ---------- */
  const Upd = { pending: null, tick: 0, snooze: 0 };
  let lastInput = 0;
  ['keydown', 'pointerdown', 'input'].forEach((ev) => document.addEventListener(ev, () => { lastInput = now(); }, true));
  const cmpVer = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  };
  /** 正在操作就先不要重開：有對話框、正在編輯欄位、20 秒內有按鍵或點擊 */
  function busyNow() {
    const a = document.activeElement;
    return !!document.querySelector('.modal') || (a && a.matches && a.matches('textarea, input:not(#q), select')) || now() - lastInput < 20000;
  }
  function offerUpdate(v, notes, doIt) {
    if (Upd.pending || now() < Upd.snooze) return;
    Upd.pending = { v, doIt };
    let left = 10;
    const el = $('#upd');
    el.hidden = false;
    const draw = () => {
      const wait = busyNow();
      el.innerHTML = `<span class="ui">🔄</span><span class="ut"><b>新版本 v${esc(v)} 已準備好</b>${notes ? `<small>${esc(notes)}</small>` : ''}
        <small>${wait ? '等你完成目前的操作後自動' : `${left} 秒後自動`}${DESKTOP ? '重新啟動' : '重新載入'}，資料會先儲存</small></span>
        <button class="btn sm primary" data-u="now">立即更新</button><button class="btn sm" data-u="later">稍後</button>`;
      return wait;
    };
    draw();
    clearInterval(Upd.tick);
    Upd.tick = setInterval(() => {
      if (!draw()) left--;
      if (left <= 0) { clearInterval(Upd.tick); runUpdate(); }
    }, 1000);
  }
  async function runUpdate() {
    const u = Upd.pending;
    if (!u) return;
    clearInterval(Upd.tick);
    $('#upd').innerHTML = `<span class="ui">⏳</span><span class="ut"><b>更新到 v${esc(u.v)}…</b><small>正在儲存資料</small></span>`;
    try {
      await flush();
      if (Cloud.on() && Cloud.pending()) await Promise.race([Cloud.sync(), new Promise((r) => setTimeout(r, 8000))]);
    } catch (e) { /* 儲存失敗也繼續，資料仍在本機 */ }
    try { await u.doIt(); } catch (e) {
      Upd.pending = null; $('#upd').hidden = true;
      toast('更新失敗：' + e.message, 'err');
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    if (b.dataset.u === 'now') runUpdate();
    if (b.dataset.u === 'later') { clearInterval(Upd.tick); Upd.pending = null; Upd.snooze = now() + 30 * 60000; $('#upd').hidden = true; }
  });
  async function checkWebUpdate() {
    if (DESKTOP || Upd.pending || location.protocol === 'file:') return;
    try {
      const j = await (await fetch('version.json?t=' + now(), { cache: 'no-store' })).json();
      if (j && j.version && cmpVer(j.version, VERSION) > 0) offerUpdate(j.version, j.notes, () => location.reload());
    } catch (e) { /* 離線就下次再查 */ }
  }
  // 桌面版：exe 下載並驗證好新版後呼叫這裡；確認後由 exe 換檔並重新啟動
  window.__taxidUpdate = (v, notes) => offerUpdate(v, notes, async () => {
    const a = await api();
    const r = a ? await a.apply_update() : '找不到桌面介面';
    if (r !== true) throw new Error(r);
  });

  /* ---------- 事件 ---------- */
  const itemOf = (el) => { const a = el.closest('[data-id]'); return a && db.items.find((x) => x.id === a.dataset.id); };
  document.addEventListener('click', (e) => {
    if (e.target.closest('.modal')) return;
    const b = e.target.closest('[data-act],[data-tag],[data-mode]');
    if (!b) return;
    if (b.dataset.mode) { listMode = b.dataset.mode; localSet('taxid.mode', listMode); renderList(); return; }
    if (b.dataset.tag != null && !b.dataset.act) { view.tag = view.tag === b.dataset.tag && b.dataset.tag ? '' : b.dataset.tag; renderList(); document.body.classList.remove('nav-open'); return; }
    const it = itemOf(b), act = b.dataset.act;
    const q = view.q.trim(), qd = T.clean(q);
    switch (act) {
      case 'add': editForm(null, /^\d{8}$/.test(qd) && /^[\d\s-]+$/.test(q) ? { no: qd } : null); break;
      case 'tools': toolsMenu(); break;
      case 'dups': dupBox(); break;
      case 'cloudst': cloudBox(); break;
      case 'sortrecent': view.sort = 'recent'; localSet('taxid.sort', 'recent'); $('#sort').value = 'recent'; view.tag = ''; renderList(); break;
      case 'import': pickFile('.xlsx,.csv,.txt', importFile); break;
      case 'copyno': copyItem(it, 'no'); break;
      case 'copyname': copyItem(it, 'name'); break;
      case 'star': it.star = !it.star; it.updatedAt = now(); save(); renderList(); break;
      case 'edit': editForm(it); break;
      case 'big': bigView(it); break;
      case 'clearq': view.q = ''; $('#q').value = ''; renderList(); $('#q').focus(); break;
      case 'addq': editForm(null, { no: qd }); break;
      case 'lookupq': runOnline(qd, async () => { const r = await lookup(qd); return r ? [r] : []; }); break;
      case 'searchq': runOnline(q, () => searchName(q)); break;
      case 'closeonline': view.online = null; renderOnline(); break;
      case 'addonline': {
        const r = view.online.rows[+b.dataset.i];
        editForm(null, { no: r.no, name: r.name, boss: r.boss, addr: r.addr, status: r.status });
        break;
      }
      case 'copyonline': {
        const r = view.online.rows[+b.dataset.i];
        copyText(r.no).then((ok) => toast(ok ? `已複製統編：${r.no}` : '無法複製', ok ? 'ok' : 'err'));
        break;
      }
      default:
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { view.q = e.target.value; renderList(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'sort') { view.sort = e.target.value; localSet('taxid.sort', view.sort); renderList(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.querySelector('.modal')) { closeModal(); e.preventDefault(); return; }
      if (view.q) { view.q = ''; $('#q').value = ''; renderList(); }
      return;
    }
    if (document.querySelector('.modal')) return;
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if (e.target.id === 'q' && e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      const first = filtered()[0];
      if (first && view.q.trim()) { e.preventDefault(); copyItem(first, 'no'); }
      if (matchMedia('(pointer: coarse)').matches) e.target.blur(); // 手機：收起鍵盤
      return;
    }
    if ((e.ctrlKey && (e.key === 'f' || e.key === 'k')) || (e.key === '/' && !inField)) { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
    if ((e.altKey && (e.key === 'n' || e.key === 'N')) || (e.ctrlKey && (e.key === 'n' || e.key === 'N'))) { e.preventDefault(); editForm(null); }
  });

  /* ---------- 啟動 ---------- */
  async function start() {
    if (DESKTOP) document.documentElement.classList.add('desktop');
    const topBar = document.querySelector('.top');
    const setHH = () => document.documentElement.style.setProperty('--hh', topBar.getBoundingClientRect().height + 'px');
    setHH();
    if (window.ResizeObserver) new ResizeObserver(setHH).observe(topBar);
    const mq = matchMedia('(max-width: 640px)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => renderList());
    await load();
    render();
    Cloud.start();
    if (!/Mobi|Android|iPhone/i.test(navigator.userAgent)) $('#q').focus();
    if (!DESKTOP && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!DESKTOP) {
      setTimeout(checkWebUpdate, 5000);
      setInterval(checkWebUpdate, 15 * 60000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkWebUpdate(); });
    }
    window.__taxid = { get db() { return db; }, flush, lookup, searchName, rowsToItems, mergeItems, importRows: (rows) => { const r = mergeItems(rowsToItems(rows).items); save(); renderList(); return r; }, exportXlsx, exportRows, editForm, Cloud, connectCloud, live, checkWebUpdate, offerUpdate, VERSION, ready: true };
  }
  start();
})();
