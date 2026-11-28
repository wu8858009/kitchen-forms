/* 公里及油資紀錄系統 — 網頁版與桌面版共用（桌面版網址帶 ?desktop=1，資料改存 %APPDATA%\MileageFuel） */
(function () {
  'use strict';
  const VERSION = '1.3.0';
  const M = window.Mileage;
  const LS_KEY = 'mileage.db';
  const DESKTOP = new URLSearchParams(location.search).has('desktop');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => M.ymd(new Date());
  const money = (n) => Math.round(+n || 0).toLocaleString('zh-TW');
  const kmTxt = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('zh-TW');
  const md = (d) => { const p = String(d).split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : d; };
  const WD = '日一二三四五六';
  const wd = (d) => WD[M.parse(d).getDay()];
  const KINDS = ['places', 'km', 'staff', 'trips', 'fuel', 'park', 'conf'];

  let db = blank();
  const view = { sid: '', pk: '', tab: 'trips', qdate: '' };

  function blank() {
    return { app: 'MileageFuel', v: 1, places: [], km: {}, staff: [], trips: [], fuel: [], park: [],
      conf: { rate: 4, cut: 25, title: '油資/停車費補貼請領表', company: '', rules: M.RULES, at: 1 }, me: '', cloud: null };
  }
  function seed(d) {
    if (!d.places.length) d.places = M.SEED_PLACES.map(([id, name, short, addr], i) => ({ id, name, short, addr, ord: i, deleted: false, at: 1 }));
    if (!Object.keys(d.km).length) M.SEED_KM.forEach(([a, b, v]) => { d.km[`${a}>${b}`] = { v, at: 1 }; });
    return d;
  }
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
    seed(db);
  }
  const S = (v) => String(v == null ? '' : v).trim();
  const fixers = {
    places: (x) => ({ id: S(x.id) || uid(), name: S(x.name), short: S(x.short) || S(x.name), addr: S(x.addr), ord: +x.ord || 0, deleted: !!x.deleted, at: +x.at || now() }),
    staff: (x) => ({ id: S(x.id) || uid(), name: S(x.name), plate: S(x.plate).toUpperCase(), dept: S(x.dept), ord: +x.ord || 0, deleted: !!x.deleted, at: +x.at || now() }),
    trips: (x) => ({ id: S(x.id) || uid(), sid: S(x.sid), date: S(x.date), from: S(x.from), to: S(x.to), fromId: S(x.fromId), toId: S(x.toId),
      km: M.round2(M.num(x.km)), note: S(x.note), grp: S(x.grp), ord: +x.ord || 0, deleted: !!x.deleted, at: +x.at || now() }),
    fuel: (x) => ({ id: S(x.id) || uid(), sid: S(x.sid), date: S(x.date), inv: S(x.inv).toUpperCase(), liters: M.round2(M.num(x.liters)), amount: Math.round(M.num(x.amount)), note: S(x.note), deleted: !!x.deleted, at: +x.at || now() }),
    park: (x) => ({ id: S(x.id) || uid(), sid: S(x.sid), date: S(x.date), inv: S(x.inv).toUpperCase(), place: S(x.place), amount: Math.round(M.num(x.amount)), note: S(x.note), deleted: !!x.deleted, at: +x.at || now() }),
  };
  function normalize(d) {
    const out = blank();
    for (const k of ['places', 'staff', 'trips', 'fuel', 'park']) out[k] = (Array.isArray(d && d[k]) ? d[k] : []).filter((x) => x && typeof x === 'object').map(fixers[k]);
    if (d && d.km && typeof d.km === 'object') for (const [k, v] of Object.entries(d.km)) if (/^[^>]+>[^>]+$/.test(k) && v) out.km[k] = { v: v.v === '' || v.v == null ? null : +v.v, at: +v.at || 1 };
    if (d && d.conf) out.conf = fixConf(d.conf);
    out.me = S(d && d.me);
    const c = d && d.cloud;
    if (c && c.url && c.pw) out.cloud = { url: String(c.url), pw: String(c.pw), rev: +c.rev || 0, pushedAt: +c.pushedAt || 0, on: c.on !== false, lastOk: +c.lastOk || 0, sheet: c.sheet || '' };
    return out;
  }
  function fixConf(c) {
    return { rate: c.rate === '' || c.rate == null ? 4 : M.num(c.rate), cut: Math.max(1, Math.min(28, Math.round(M.num(c.cut)) || 25)),
      title: S(c.title) || '油資/停車費補貼請領表', company: S(c.company), rules: c.rules == null ? M.RULES : String(c.rules), at: +c.at || 1 };
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

  /* ---------- 資料查詢 ---------- */
  const live = (arr) => arr.filter((x) => !x.deleted);
  const places = () => live(db.places).sort((a, b) => (a.id === 'hq' ? -1 : b.id === 'hq' ? 1 : a.ord - b.ord));
  const placeById = (id) => db.places.find((p) => p.id === id);
  const staffList = () => live(db.staff).sort((a, b) => a.ord - b.ord || a.name.localeCompare(b.name, 'zh-Hant'));
  const staffById = (id) => db.staff.find((s) => s.id === id);
  const curStaff = () => staffById(view.sid);
  const cut = () => db.conf.cut;
  const curPeriod = () => M.period(view.pk, cut());
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ord || 0) - (b.ord || 0));
  function recs(kind, sid, pk) {
    const p = M.period(pk, cut());
    return live(db[kind]).filter((r) => r.sid === sid && M.inPeriod(r.date, p)).sort(byDate);
  }
  function claim(sid, pk) {
    const trips = recs('trips', sid, pk), fuel = recs('fuel', sid, pk), park = recs('park', sid, pk);
    return { staff: staffById(sid), pk, p: M.period(pk, cut()), trips, fuel, park, t: M.totals(trips, fuel, park, db.conf.rate) };
  }
  function kmOf(a, b) { return M.kmBetween(db.km, a, b); }
  function setKm(a, b, v) {
    const key = `${a}>${b}`;
    db.km[key] = { v: v === '' || v == null ? null : M.round2(M.num(v)), at: now() };
  }
  function placeShort(id, fallback) { const p = placeById(id); return p ? p.short || p.name : fallback || ''; }

  /* ---------- 小工具 ---------- */
  let toastTimer = 0;
  function toast(msg, kind, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    el.className = 'toast ' + (kind || '');
    el.hidden = false;
    if (action) $('button', el).onclick = () => { el.hidden = true; action.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2600);
  }
  function modal(html, cls = '') {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="mbox ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    m.addEventListener('mousedown', (e) => { if (e.target === m) m.dataset.down = '1'; });
    m.addEventListener('click', (e) => { if (e.target === m && m.dataset.down) closeModal(); delete m.dataset.down; });
    document.body.appendChild(m);
    return m;
  }
  function closeModal() { $$('.modal').forEach((m) => m.remove()); }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('.modal')) { closeModal(); return; }
    if (e.altKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); location.hash = '#/' + NAV[+e.key - 1][0]; }
  });
  function ask(title, text, opts) {
    return new Promise((res) => {
      const m = modal(`<div class="dlg"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="foot"><span class="sp"></span>${opts.map(([v, l], i) => `<button class="btn ${i === 0 ? 'primary' : ''} ${v === 'del' ? 'danger' : ''}" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>`);
      m.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { closeModal(); res(b.dataset.v); } });
    });
  }
  function alertBox(title, html) {
    const m = modal(`<div class="dlg"><h2>${esc(title)}</h2><div class="pbody">${html}</div><div class="foot"><span class="sp"></span><button class="btn primary" data-v="ok">好</button></div></div>`);
    $('[data-v=ok]', m).onclick = closeModal;
  }
  function download(bytes, name, mime) {
    const blob = new Blob([bytes], { type: mime });
    if (DESKTOP) {
      return blobB64(blob).then(async (b64) => {
        const a = await api();
        const p = a ? await a.export_file(b64, name) : '';
        if (p) toast('已儲存：' + p, 'ok');
        return p;
      });
    }
    const file = typeof File === 'function' ? new File([blob], name, { type: mime }) : null;
    if (matchMedia('(pointer: coarse)').matches && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).catch(() => {});
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return Promise.resolve(name);
  }
  function blobB64(blob) {
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  }

  /* ---------- 版面 ---------- */
  const IC = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    log: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    claim: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h7M9 17h5"/>',
    table: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16.5C12 14 9 9 15.5 7.5"/><path d="M12 21h9M3 3h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M4.2 7.4l2.2 1.3M17.6 15.3l2.2 1.3M4.2 16.6l2.2-1.3M17.6 8.7l2.2-1.3"/>',
  };
  const NAV = [['home', '總覽'], ['log', '紀錄'], ['claim', '請領表'], ['table', '公里對照表'], ['settings', '設定']];
  const icon = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;
  const NAV_GROUP = { home: '工作區', table: '管理' };
  function renderNav(cur) {
    const a = (k, l, i) => `<a href="#/${k}" class="${cur === k ? 'on' : ''}" title="${l}（Alt+${i + 1}）">${icon(k)}<span>${l}</span><kbd>Alt ${i + 1}</kbd></a>`;
    $('#sidenav').innerHTML = NAV.map(([k, l], i) => (NAV_GROUP[k] ? `<div class="sgrp">${NAV_GROUP[k]}</div>` : '') + a(k, l, i)).join('');
    $('#botnav').innerHTML = NAV.map(([k, l], i) => a(k, l, i)).join('');
  }
  /** 側欄使用者卡片、頁首日期與結算倒數 */
  function chrome() {
    const s = staffById(view.sid), pk = M.periodOf(today(), cut()), p = M.period(pk, cut());
    const left = Math.round((M.parse(p.to) - M.parse(today())) / 864e5);
    const su = $('#sideuser');
    if (su) {
      if (s && !s.deleted) {
        const t = claim(s.id, pk).t;
        su.innerHTML = `<span class="av">${esc(s.name.slice(-2))}</span><span class="un"><b>${esc(s.name)}</b><small>${esc(s.plate || '未填車牌')}</small></span>
          <span class="um"><small>本期補貼</small><b class="mono">$${money(t.total)}</b></span>`;
        su.hidden = false;
      } else su.hidden = true;
    }
    const h = $('#hdrinfo');
    if (h) {
      const d = new Date();
      h.innerHTML = `<span class="hchip"><svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>${d.getFullYear()}/${M.pad(d.getMonth() + 1)}/${M.pad(d.getDate())}（${WD[d.getDay()]}）</span>
        <span class="hchip ${left <= 3 ? 'hot' : ''}" title="本期 ${esc(M.periodLabel(pk, cut()))}，${db.conf.cut} 日結算">⏱ ${left <= 0 ? '今天結算' : `距結算 ${left} 天`}</span>`;
    }
    decorate();
  }
  /** 卡片標題開頭的表情符號 → 圓角圖示徽章 */
  function decorate() {
    $$('#app .ch h3').forEach((h) => {
      if (h.querySelector('.hi') || !h.firstChild || h.firstChild.nodeType !== 3) return;
      const m = h.firstChild.textContent.match(/^(\p{Extended_Pictographic}\uFE0F?)\s*/u);
      if (!m) return;
      h.firstChild.textContent = h.firstChild.textContent.slice(m[0].length);
      h.insertAdjacentHTML('afterbegin', `<i class="hi">${m[1]}</i>`);
    });
  }
  function staffPicker() {
    const list = staffList();
    if (!list.length) return '';
    return `<label class="picker"><span>員工</span><select data-pick="sid">${list.map((s) => `<option value="${esc(s.id)}" ${s.id === view.sid ? 'selected' : ''}>${esc(s.name)}${s.plate ? `（${esc(s.plate)}）` : ''}</option>`).join('')}</select></label>`;
  }
  function periodPicker() {
    return `<div class="pp"><button class="btn ghost sq" data-act="pprev" title="上一期">‹</button>
      <div class="ppl"><b>${esc(view.pk.replace('-', ' 年 '))} 月期</b><small>${esc(M.periodLabel(view.pk, cut()))}${view.pk === M.periodOf(today(), cut()) ? ' · 本期' : ''}</small></div>
      <button class="btn ghost sq" data-act="pnext" title="下一期">›</button></div>`;
  }
  function setTitle(crumb, title) {
    $('#crumb').textContent = crumb;
    $('#ptitle').textContent = title;
    document.title = `${title}｜公里及油資紀錄系統`;
  }

  /* ---------- 路由 ---------- */
  function route() {
    const parts = (location.hash || '#/home').slice(2).split('/');
    const page = NAV.some(([k]) => k === parts[0]) ? parts[0] : 'home';
    if (page === 'log' && ['trips', 'fuel', 'park'].includes(parts[1])) view.tab = parts[1];
    renderNav(page);
    $('#app').dataset.page = page;
    ({ home: renderHome, log: renderLog, claim: renderClaim, table: renderTable, settings: renderSettings })[page]();
    chrome();
    $('#app').scrollTop = 0;
  }
  window.addEventListener('hashchange', route);
  if (DESKTOP) document.addEventListener('click', async (e) => { // 電腦版：外部連結（Google 地圖）用預設瀏覽器開
    const a = e.target.closest('a[target=_blank]');
    if (!a) return;
    e.preventDefault();
    const x = await api(); if (x) x.open_url(a.href);
  });
  function rerender() {
    const a = document.activeElement;
    if ($('.modal') || (a && a.matches && a.matches('#app input, #app textarea, #app select') && a.dataset.keep !== undefined)) { pendingRefresh = true; return; }
    pendingRefresh = false;
    const page = $('#app').dataset.page || 'home';
    const st = $('#app').scrollTop;
    ({ home: renderHome, log: renderLog, claim: renderClaim, table: renderTable, settings: renderSettings })[page]();
    chrome();
    $('#app').scrollTop = st;
  }
  let pendingRefresh = false;
  new MutationObserver(() => { if (pendingRefresh && !$('.modal')) rerender(); }).observe(document.body, { childList: true });

  document.addEventListener('change', (e) => {
    const p = e.target.closest('[data-pick]');
    if (!p) return;
    if (p.dataset.pick === 'sid') { view.sid = p.value; localSet('mileage.sid', p.value); rerender(); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const k = b.dataset.act, id = b.dataset.id;
    if (k === 'pprev' || k === 'pnext') { view.pk = M.shiftPeriod(view.pk, k === 'pprev' ? -1 : 1); return rerender(); }
    if (k === 'pnow') { view.pk = M.periodOf(today(), cut()); return rerender(); }
    if (k === 'add-trip') return tripBox(null, b.dataset.date);
    if (k === 'add-fuel') return fuelBox(null);
    if (k === 'add-park') return parkBox(null);
    if (k === 'edit-trip') return editTripBox(db.trips.find((x) => x.id === id));
    if (k === 'edit-fuel') return fuelBox(db.fuel.find((x) => x.id === id));
    if (k === 'edit-park') return parkBox(db.park.find((x) => x.id === id));
    if (k === 'del-grp') return delGroup(id);
    if (k === 'quick') return quickTrip(b.dataset.pid);
    if (k === 'cloudst') return cloudBox();
    if (k === 'x-claim') return exportClaim(view.sid, view.pk);
    if (k === 'x-all') return exportAll(view.pk);
    if (k === 'print') return printClaim();
  });

  /* ---------- 第一次使用：新增員工 ---------- */
  function needStaff() {
    if (staffList().length) return '';
    return `<section class="card hero">
      <h2>👋 歡迎使用公里及油資紀錄系統</h2>
      <p>先建立申請人（員工）資料，就能開始記錄公出路線、加油與停車費，月底一鍵產生「油資/停車費補貼請領表」。</p>
      <form class="row-form" id="firstStaff">
        <div class="f"><label>姓名</label><input name="name" required placeholder="例如：王小明" autocomplete="name"></div>
        <div class="f"><label>車牌號碼</label><input name="plate" placeholder="例如：ABC-1234" autocapitalize="characters"></div>
        <button class="btn primary">建立並開始使用</button>
      </form>
      <p class="muted small">已經有舊的請領表 Excel？建立後到「設定 → 匯入舊請領表」可以把資料帶進來。有雲端同步的話，到「設定 → Google 雲端同步」連線即可取回全部資料。</p>
    </section>`;
  }
  function bindFirstStaff() {
    const f = $('#firstStaff');
    if (!f) return;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const s = fixers.staff({ name: f.name.value, plate: f.plate.value, ord: db.staff.length });
      if (!s.name) return;
      db.staff.push(s); db.me = s.id; view.sid = s.id; localSet('mileage.sid', s.id);
      save(); toast('已建立：' + s.name, 'ok'); rerender();
    });
  }

  /* ---------- 總覽 ---------- */
  function renderHome() {
    setTitle('公出補貼 ／ 總覽', '總覽');
    const first = needStaff();
    if (first) { $('#app').innerHTML = first; bindFirstStaff(); return; }
    const c = claim(view.sid, view.pk);
    const t = c.t, s = c.staff;
    view.qdate = view.qdate || today();
    const pls = places().filter((p) => p.id !== 'hq');
    const hist = [];
    for (let i = 5; i >= 0; i--) { const k = M.shiftPeriod(view.pk, -i); hist.push({ k, t: claim(view.sid, k).t }); }
    const mx = Math.max(1, ...hist.map((h) => h.t.total));
    const recent = [...c.trips.map((r) => ({ ...r, k: 'trip' })), ...c.fuel.map((r) => ({ ...r, k: 'fuel' })), ...c.park.map((r) => ({ ...r, k: 'park' }))]
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.at - a.at)).slice(0, 8);
    const coverage = t.kmPay ? Math.round((t.fuelAmt / t.kmPay) * 100) : 0;
    const pt = claim(view.sid, M.shiftPeriod(view.pk, -1)).t;
    $('#app').innerHTML = `
      <div class="toolbar">${staffPicker()}${periodPicker()}<span class="sp"></span>
        <a class="btn d-only" href="#/claim">${icon('claim')}查看請領表</a></div>
      <section class="kpis">
        <div class="kpi main"><div class="kh"><small>本期補貼金額</small>${delta(t.total, pt.total)}</div><b class="mono">$${money(t.total)}</b>
          <span>里程 ${kmTxt(t.km)} km × $${db.conf.rate} ＋ 停車 $${money(t.parkAmt)}</span>
          <div class="kbar"><i style="width:${t.total ? Math.round((t.kmPay / t.total) * 100) : 0}%"></i></div>
          <span class="kleg"><em class="d1"></em>里程補貼 $${money(t.kmPay)}<em class="d2"></em>停車 $${money(t.parkAmt)}</span></div>
        ${kpi('k1', '🛣', '公出里程', `${kmTxt(t.km)}<i>km</i>`, `${t.days} 天 · ${t.trips} 段`, delta(t.km, pt.km))}
        ${kpi('k2', '💵', '里程補貼', `$${money(t.kmPay)}`, `每公里 $${db.conf.rate}`, delta(t.kmPay, pt.kmPay))}
        ${kpi('k3', '🅿', '停車費', `$${money(t.parkAmt)}`, `${c.park.length} 筆`, delta(t.parkAmt, pt.parkAmt))}
        ${kpi('k4' + (t.kmPay && t.fuelAmt < t.kmPay ? ' warn' : ''), '⛽', '加油發票', `$${money(t.fuelAmt)}`, `${c.fuel.length} 張 · ${kmTxt(t.liters)} L${t.kmPay ? ` · 涵蓋 ${coverage}%` : ''}`, '')}
      </section>
      <div class="grid2">
        <section class="card">
          <div class="ch"><h3>🚗 快速記錄公出</h3>
            <label class="qd">日期 <input type="date" id="qdate" data-keep value="${esc(view.qdate)}"></label></div>
          <p class="muted small">點目的地＝從總公司出發、當天回總公司（來回兩趟）。一天跑兩個以上地點請按「自訂路線」。</p>
          <div class="chips">${pls.map((p) => {
            const a = kmOf('hq', p.id), b = kmOf(p.id, 'hq');
            const ok = a != null && b != null;
            return `<button class="chip ${ok ? '' : 'dim'}" data-act="quick" data-pid="${esc(p.id)}" ${ok ? '' : 'title="對照表沒有這個地點的公里數"'}><b>${esc(p.short || p.name)}</b><small>${ok ? `來回 ${kmTxt(a + b)} km` : '未設定'}</small></button>`;
          }).join('')}</div>
          <div class="acts">
            <button class="btn primary" data-act="add-trip">＋ 自訂路線</button>
            <button class="btn" data-act="add-fuel">⛽ 加油發票</button>
            <button class="btn" data-act="add-park">🅿 停車費</button>
          </div>
        </section>
        <section class="card">
          <div class="ch"><h3>📈 近 6 期補貼</h3><small class="muted">${esc(s ? s.name : '')}</small></div>
          <div class="bars">${hist.map((h) => `<div class="bar ${h.k === view.pk ? 'on' : ''}" title="${esc(h.k)}：$${money(h.t.total)}（${kmTxt(h.t.km)} km）">
            <span class="bv mono">${h.t.total ? '$' + money(h.t.total) : ''}</span>
            <span class="bf" style="height:${Math.max(2, (h.t.total / mx) * 100)}%"></span>
            <span class="bl">${+h.k.slice(5)}月</span></div>`).join('')}</div>
        </section>
      </div>
      <section class="card">
        <div class="ch"><h3>🕘 本期最近紀錄</h3><a class="lnk" href="#/log">全部紀錄 ›</a></div>
        ${recent.length ? `<ul class="rlist">${recent.map((r) => r.k === 'trip'
          ? `<li data-act="edit-trip" data-id="${esc(r.id)}"><span class="tag t1">公出</span><span class="d">${md(r.date)}（${wd(r.date)}）</span><span class="x">${esc(r.from)} → ${esc(r.to)}</span><b class="mono">${kmTxt(r.km)} km</b></li>`
          : r.k === 'fuel'
            ? `<li data-act="edit-fuel" data-id="${esc(r.id)}"><span class="tag t2">加油</span><span class="d">${md(r.date)}（${wd(r.date)}）</span><span class="x">${esc(r.inv || '（無發票號碼）')} · ${kmTxt(r.liters)} L</span><b class="mono">$${money(r.amount)}</b></li>`
            : `<li data-act="edit-park" data-id="${esc(r.id)}"><span class="tag t3">停車</span><span class="d">${md(r.date)}（${wd(r.date)}）</span><span class="x">${esc(r.place || '')}</span><b class="mono">$${money(r.amount)}</b></li>`).join('')}</ul>`
          : `<p class="empty">這一期還沒有紀錄。點上面的目的地就能快速新增。</p>`}
      </section>`;
    $('#qdate').addEventListener('change', (e) => { view.qdate = e.target.value || today(); });
  }
  function kpi(cls, ic, label, value, sub, d) {
    return `<div class="kpi ${cls}"><div class="kh"><span class="kic">${ic}</span><small>${label}</small>${d}</div><b class="mono">${value}</b><span>${sub}</span></div>`;
  }
  /** 與上一期比較 */
  function delta(a, b) {
    if (!b && !a) return '';
    if (!b) return '<em class="dl up">新</em>';
    const r = Math.round(((a - b) / b) * 100);
    return `<em class="dl ${r > 0 ? 'up' : r < 0 ? 'down' : ''}" title="與上一期比較">${r > 0 ? '▲' : r < 0 ? '▼' : '＝'} ${Math.abs(r)}%</em>`;
  }
  function quickTrip(pid) {
    const s = curStaff();
    if (!s) return;
    const p = placeById(pid);
    const a = kmOf('hq', pid), b = kmOf(pid, 'hq');
    if (a == null || b == null) { toast('對照表沒有「' + p.name + '」的公里數，請用自訂路線或先到公里對照表設定', 'err'); return tripBox(null, view.qdate, [pid]); }
    const date = ($('#qdate') && $('#qdate').value) || today();
    const grp = uid(), t = now();
    const hq = placeShort('hq', '總公司');
    const add = [
      fixers.trips({ sid: s.id, date, from: hq, to: p.short || p.name, fromId: 'hq', toId: pid, km: a, grp, ord: 0, at: t }),
      fixers.trips({ sid: s.id, date, from: p.short || p.name, to: hq, fromId: pid, toId: 'hq', km: b, grp, ord: 1, at: t }),
    ];
    db.trips.push(...add);
    jumpTo(date);
    save(); rerender();
    toast(`已新增 ${md(date)} ${hq} ⇄ ${p.short || p.name}　${kmTxt(a + b)} km`, 'ok', { label: '復原', fn: () => { add.forEach((x) => { x.deleted = true; x.at = now(); }); save(); rerender(); toast('已復原'); } });
  }
  /** 新增的日期不在目前顯示的期別時，切換過去 */
  function jumpTo(date) { const k = M.periodOf(date, cut()); if (k !== view.pk) view.pk = k; }

  /* ---------- 紀錄 ---------- */
  function renderLog() {
    setTitle('公出補貼 ／ 紀錄', '紀錄');
    const first = needStaff();
    if (first) { $('#app').innerHTML = first; bindFirstStaff(); return; }
    const c = claim(view.sid, view.pk);
    const tab = view.tab;
    const tabs = [['trips', '🚗 公出路線', `${kmTxt(c.t.km)} km`], ['fuel', '⛽ 加油', `$${money(c.t.fuelAmt)}`], ['park', '🅿 停車', `$${money(c.t.parkAmt)}`]];
    let body = '';
    if (tab === 'trips') {
      const days = {};
      c.trips.forEach((r) => { (days[r.date] = days[r.date] || []).push(r); });
      body = Object.keys(days).length ? Object.keys(days).sort().reverse().map((d) => {
        const rs = days[d], sum = rs.reduce((s, r) => s + r.km, 0);
        const grps = {};
        rs.forEach((r) => { (grps[r.grp || r.id] = grps[r.grp || r.id] || []).push(r); });
        return `<div class="day"><div class="dh"><b>${md(d)}</b><span>星期${wd(d)}</span><span class="sp"></span><b class="mono">${kmTxt(sum)} km</b>
            <button class="btn ghost sm" data-act="add-trip" data-date="${esc(d)}" title="這天再加一段路線">＋</button></div>
          ${Object.entries(grps).map(([g, legs]) => `<div class="grp">
            ${legs.map((r) => `<div class="leg" data-act="edit-trip" data-id="${esc(r.id)}"><span class="fr">${esc(r.from)}</span><span class="ar">→</span><span class="to">${esc(r.to)}</span>${r.note ? `<small class="nt">${esc(r.note)}</small>` : ''}<span class="sp"></span><b class="mono">${kmTxt(r.km)}</b><small>km</small></div>`).join('')}
            ${legs.length > 1 ? `<button class="lnk del" data-act="del-grp" data-id="${esc(g)}">刪除整條路線</button>` : ''}</div>`).join('')}
        </div>`;
      }).join('') : '<p class="empty">這一期還沒有公出紀錄。</p>';
    } else if (tab === 'fuel') {
      body = c.fuel.length ? `<table class="tbl"><thead><tr><th>加油日</th><th>發票號碼</th><th class="n">公升</th><th class="n">金額</th><th>備註</th></tr></thead><tbody>
        ${c.fuel.slice().reverse().map((r) => `<tr data-act="edit-fuel" data-id="${esc(r.id)}"><td>${md(r.date)}（${wd(r.date)}）</td><td class="mono">${esc(r.inv)}</td><td class="n mono">${kmTxt(r.liters)}</td><td class="n mono">$${money(r.amount)}</td><td>${esc(r.note)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2">合計 ${c.fuel.length} 張</td><td class="n mono">${kmTxt(c.t.liters)}</td><td class="n mono">$${money(c.t.fuelAmt)}</td><td></td></tr></tfoot></table>` : '<p class="empty">這一期還沒有加油發票。</p>';
    } else {
      body = c.park.length ? `<table class="tbl"><thead><tr><th>停車日</th><th>發票號碼</th><th>停車地點</th><th class="n">停車費</th><th>備註</th></tr></thead><tbody>
        ${c.park.slice().reverse().map((r) => `<tr data-act="edit-park" data-id="${esc(r.id)}"><td>${md(r.date)}（${wd(r.date)}）</td><td class="mono">${esc(r.inv)}</td><td>${esc(r.place)}</td><td class="n mono">$${money(r.amount)}</td><td>${esc(r.note)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="3">合計 ${c.park.length} 筆</td><td class="n mono">$${money(c.t.parkAmt)}</td><td></td></tr></tfoot></table>` : '<p class="empty">這一期還沒有停車費。</p>';
    }
    $('#app').innerHTML = `
      <div class="toolbar">${staffPicker()}${periodPicker()}<span class="sp"></span>
        <button class="btn primary" data-act="add-${tab === 'trips' ? 'trip' : tab}">＋ 新增${tab === 'trips' ? '路線' : tab === 'fuel' ? '加油' : '停車'}</button></div>
      <nav class="tabs">${tabs.map(([k, l, v]) => `<a href="#/log/${k}" class="${tab === k ? 'on' : ''}">${l}<small class="mono">${v}</small></a>`).join('')}</nav>
      <section class="card">${body}</section>`;
  }

  /* ---------- 新增路線（可多個地點） ---------- */
  function placeOptions(sel) {
    return places().map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('') + '<option value="__other">其他地點（手動輸入）…</option>';
  }
  function tripBox(_, date, preStops) {
    const s = curStaff();
    if (!s) return;
    const st = { date: date || view.qdate || today(), start: 'hq', stops: (preStops || []).map((id) => ({ id, name: '' })), back: true, kms: {}, note: '' };
    const m = modal(`<form class="ed" id="tripf"><h2>🚗 新增公出路線</h2>
      <div class="frow"><div class="f"><label>公出日期</label><input type="date" name="date" value="${esc(st.date)}" required></div>
        <div class="f"><label>申請人</label><input value="${esc(s.name)}" disabled></div></div>
      <div class="f"><label>出發點</label><select name="start">${placeOptions('hq')}</select></div>
      <div class="f"><label>依序前往的地點</label><div id="stops" class="stops"></div>
        <div class="addstop"><select id="addsel"><option value="">＋ 加入地點…</option>${placeOptions('').replace(/ selected/g, '')}</select></div></div>
      <label class="chk"><input type="checkbox" name="back" checked> 最後回到出發點</label>
      <div class="f"><label>路線與公里數（單趟，可修改）</label><div id="legs" class="legs"></div></div>
      <div class="f"><label>備註</label><input name="note" placeholder="例如：施工、會勘、送料"></div>
      <div class="foot"><label class="chk sm"><input type="checkbox" name="savekm" checked> 對照表沒有的公里數，記到對照表</label><span class="sp"></span>
        <button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`, 'wide');
    const f = $('#tripf', m);
    const otherName = async (sel) => {
      const n = prompt('地點名稱（例如：客戶工地、材料行）：');
      if (!n || !n.trim()) { sel.value = ''; return null; }
      return { id: '', name: n.trim() };
    };
    const nameOf = (x) => (x.id ? placeShort(x.id) : x.name);
    const seq = () => {
      const start = f.start.value === '__other' ? (st.startOther || { id: '', name: '出發點' }) : { id: f.start.value, name: '' };
      const arr = [start, ...st.stops];
      if (f.back.checked && st.stops.length) arr.push(start);
      return arr;
    };
    const legKey = (a, b) => `${a.id || a.name}>${b.id || b.name}`;
    function draw() {
      $('#stops', m).innerHTML = st.stops.length ? st.stops.map((x, i) => `<span class="stop"><b>${i + 1}</b>${esc(nameOf(x))}<button type="button" data-rm="${i}" title="移除">×</button></span>`).join('')
        : '<span class="muted small">還沒有地點，請從下面選擇</span>';
      const arr = seq();
      let sum = 0, miss = 0;
      const rows = [];
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i], k = legKey(a, b);
        const tab = a.id && b.id ? kmOf(a.id, b.id) : null;
        const v = k in st.kms ? st.kms[k] : tab;
        if (v == null || v === '') miss++; else sum += +v;
        rows.push(`<div class="lg"><span>${esc(nameOf(a))}</span><span class="ar">→</span><span>${esc(nameOf(b))}</span><span class="sp"></span>
          <input type="number" inputmode="decimal" step="0.1" min="0" data-k="${esc(k)}" value="${v == null ? '' : v}" class="${v == null || v === '' ? 'need' : ''}" placeholder="?"><small>km</small>
          ${tab == null ? '<small class="warnt">對照表無</small>' : ''}</div>`);
      }
      $('#legs', m).innerHTML = rows.length ? rows.join('') + `<div class="lsum">共 ${rows.length} 段　<b class="mono">${kmTxt(sum)} km</b>　補貼 <b class="mono">$${money(sum * db.conf.rate)}</b>${miss ? `　<span class="warnt">${miss} 段未填公里數</span>` : ''}</div>`
        : '<span class="muted small">加入地點後會自動帶出公里數</span>';
    }
    $('#addsel', m).addEventListener('change', async (e) => {
      const v = e.target.value;
      if (!v) return;
      const x = v === '__other' ? await otherName(e.target) : { id: v, name: '' };
      if (x) st.stops.push(x);
      e.target.value = '';
      draw();
    });
    f.start.addEventListener('change', async () => {
      if (f.start.value === '__other') { const x = await otherName(f.start); if (x) st.startOther = x; else f.start.value = 'hq'; }
      draw();
    });
    f.back.addEventListener('change', draw);
    m.addEventListener('input', (e) => { if (e.target.dataset.k) { st.kms[e.target.dataset.k] = e.target.value; e.target.classList.toggle('need', e.target.value === ''); } });
    m.addEventListener('change', (e) => { if (e.target.dataset.k) draw(); });
    m.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rm]');
      if (r) { st.stops.splice(+r.dataset.rm, 1); draw(); }
      if (e.target.closest('[data-c=close]')) closeModal();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const arr = seq();
      if (arr.length < 2) return toast('請至少加入一個地點', 'err');
      const legsOut = [];
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1], b = arr[i], k = legKey(a, b);
        const tab = a.id && b.id ? kmOf(a.id, b.id) : null;
        const v = k in st.kms ? st.kms[k] : tab;
        if (v === '' || v == null || !isFinite(+v)) return toast(`請填「${nameOf(a)} → ${nameOf(b)}」的公里數`, 'err');
        legsOut.push({ a, b, km: +v, tab });
      }
      const grp = uid(), t = now(), date = f.date.value;
      legsOut.forEach((l, i) => {
        db.trips.push(fixers.trips({ sid: s.id, date, from: nameOf(l.a), to: nameOf(l.b), fromId: l.a.id, toId: l.b.id, km: l.km, note: f.note.value, grp, ord: i, at: t }));
        if (f.savekm.checked && l.a.id && l.b.id && l.tab == null) setKm(l.a.id, l.b.id, l.km);
      });
      view.qdate = date; jumpTo(date);
      save(); closeModal(); rerender();
      toast(`已新增 ${md(date)} 路線 ${legsOut.length} 段，共 ${kmTxt(legsOut.reduce((x, l) => x + l.km, 0))} km`, 'ok');
    });
    draw();
  }
  function editTripBox(r) {
    if (!r) return;
    const names = places().map((p) => p.short || p.name);
    const m = modal(`<form class="ed"><h2>✏ 修改公出紀錄</h2>
      <datalist id="plist">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="frow"><div class="f"><label>公出日期</label><input type="date" name="date" value="${esc(r.date)}" required></div>
        <div class="f"><label>里程數（km）</label><input type="number" inputmode="decimal" step="0.1" min="0" name="km" value="${r.km}" required></div></div>
      <div class="frow"><div class="f"><label>出發點</label><input name="from" list="plist" value="${esc(r.from)}" required></div>
        <div class="f"><label>目的地</label><input name="to" list="plist" value="${esc(r.to)}" required></div></div>
      <div class="f"><label>備註</label><input name="note" value="${esc(r.note)}"></div>
      <div class="foot"><button type="button" class="btn danger" data-c="del">刪除</button><span class="sp"></span>
        <button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`);
    const f = $('form', m);
    const idOf = (n) => { const p = places().find((x) => x.short === n || x.name === n); return p ? p.id : ''; };
    const auto = () => { const a = idOf(f.from.value.trim()), b = idOf(f.to.value.trim()); const v = a && b ? kmOf(a, b) : null; if (v != null) f.km.value = v; };
    f.from.addEventListener('change', auto); f.to.addEventListener('change', auto);
    m.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      if (c.dataset.c === 'close') closeModal();
      if (c.dataset.c === 'del') {
        if (await ask('刪除這筆公出紀錄？', `${md(r.date)} ${r.from} → ${r.to}（${kmTxt(r.km)} km）`, [['del', '刪除'], ['', '取消']]) !== 'del') return;
        r.deleted = true; r.at = now(); save(); rerender(); toast('已刪除');
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      Object.assign(r, { date: f.date.value, km: M.round2(M.num(f.km.value)), from: f.from.value.trim(), to: f.to.value.trim(), fromId: idOf(f.from.value.trim()), toId: idOf(f.to.value.trim()), note: f.note.value.trim(), at: now() });
      jumpTo(r.date); save(); closeModal(); rerender(); toast('已儲存', 'ok');
    });
  }
  async function delGroup(g) {
    const legs = live(db.trips).filter((r) => r.grp === g);
    if (!legs.length) return;
    const sum = legs.reduce((s, r) => s + r.km, 0);
    if (await ask('刪除整條路線？', `${md(legs[0].date)}　${legs.map((r) => r.from).concat(legs[legs.length - 1].to).join(' → ')}（${kmTxt(sum)} km）`, [['del', '刪除'], ['', '取消']]) !== 'del') return;
    const t = now();
    legs.forEach((r) => { r.deleted = true; r.at = t; });
    save(); rerender(); toast('已刪除路線');
  }

  /* ---------- 加油 / 停車 ---------- */
  const invFix = (s) => {
    s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[A-Z]{2}\d{8}$/.test(s) ? s.slice(0, 2) + '-' + s.slice(2) : String(s);
  };
  function fuelBox(r) {
    const s = curStaff();
    if (!s) return;
    const isNew = !r;
    r = r || { date: view.qdate || today(), inv: '', liters: '', amount: '', note: '' };
    const m = modal(`<form class="ed"><h2>⛽ ${isNew ? '新增' : '修改'}加油發票</h2>
      <div class="frow"><div class="f"><label>加油日</label><input type="date" name="date" value="${esc(r.date)}" required></div>
        <div class="f"><label>發票號碼</label><input name="inv" value="${esc(r.inv)}" placeholder="AB-12345678" autocapitalize="characters" autocomplete="off"></div></div>
      <div class="frow"><div class="f"><label>加油公升</label><input type="number" inputmode="decimal" step="0.01" min="0" name="liters" value="${r.liters === '' ? '' : r.liters}"></div>
        <div class="f"><label>加油金額（元）</label><input type="number" inputmode="numeric" step="1" min="0" name="amount" value="${r.amount === '' ? '' : r.amount}" required></div></div>
      <div class="f"><label>備註</label><input name="note" value="${esc(r.note)}"></div>
      <div class="foot">${isNew ? '' : '<button type="button" class="btn danger" data-c="del">刪除</button>'}<span class="sp"></span>
        <button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`);
    recBox(m, r, isNew, 'fuel', (f) => ({ date: f.date.value, inv: invFix(f.inv.value), liters: M.round2(M.num(f.liters.value)), amount: Math.round(M.num(f.amount.value)), note: f.note.value.trim() }),
      `${md(r.date)} 加油 $${money(r.amount)}`);
  }
  function parkBox(r) {
    const s = curStaff();
    if (!s) return;
    const isNew = !r;
    r = r || { date: view.qdate || today(), inv: '', place: '', amount: '', note: '' };
    const names = places().map((p) => p.name);
    const m = modal(`<form class="ed"><h2>🅿 ${isNew ? '新增' : '修改'}停車費</h2>
      <datalist id="pklist">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="frow"><div class="f"><label>停車日</label><input type="date" name="date" value="${esc(r.date)}" required></div>
        <div class="f"><label>發票號碼</label><input name="inv" value="${esc(r.inv)}" placeholder="AB-12345678" autocapitalize="characters" autocomplete="off"></div></div>
      <div class="frow"><div class="f"><label>停車地點</label><input name="place" list="pklist" value="${esc(r.place)}"></div>
        <div class="f"><label>停車費（元）</label><input type="number" inputmode="numeric" step="1" min="0" name="amount" value="${r.amount === '' ? '' : r.amount}" required></div></div>
      <div class="f"><label>備註</label><input name="note" value="${esc(r.note)}"></div>
      <div class="foot">${isNew ? '' : '<button type="button" class="btn danger" data-c="del">刪除</button>'}<span class="sp"></span>
        <button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`);
    recBox(m, r, isNew, 'park', (f) => ({ date: f.date.value, inv: invFix(f.inv.value), place: f.place.value.trim(), amount: Math.round(M.num(f.amount.value)), note: f.note.value.trim() }),
      `${md(r.date)} 停車 $${money(r.amount)}`);
  }
  function recBox(m, r, isNew, kind, read, label) {
    const f = $('form', m);
    setTimeout(() => (isNew ? f.inv : f.amount).focus(), 40);
    f.inv.addEventListener('blur', () => { f.inv.value = invFix(f.inv.value); });
    m.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      if (c.dataset.c === 'close') closeModal();
      if (c.dataset.c === 'del') {
        if (await ask('刪除這筆紀錄？', label, [['del', '刪除'], ['', '取消']]) !== 'del') return;
        r.deleted = true; r.at = now(); save(); rerender(); toast('已刪除');
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = read(f);
      if (v.inv && live(db[kind]).some((x) => x !== r && x.inv === v.inv)) toast('提醒：發票號碼 ' + v.inv + ' 已經登記過', 'err');
      if (isNew) db[kind].push(fixers[kind]({ ...v, sid: view.sid, at: now() }));
      else Object.assign(r, v, { at: now() });
      view.qdate = v.date; jumpTo(v.date);
      save(); closeModal(); rerender();
      toast(isNew ? '已新增' : '已儲存', 'ok');
    });
  }

  /* ---------- 請領表 ---------- */
  function layout(c) {
    // 依原始紙本：左側加油(至少 15 列)＋停車(至少 10 列)，右側公出(與左側同高)
    let nF = Math.max(15, c.fuel.length), nP = Math.max(10, c.park.length);
    const cap = () => nF + 2 + nP;
    if (c.trips.length > cap()) nP += c.trips.length - cap();
    return { nF, nP, rows: cap() };
  }
  function tripRows(trips) {
    let last = '';
    return trips.map((r) => { const show = r.date !== last; last = r.date; return { ...r, showDate: show }; });
  }
  function claimHtml(c) {
    const L = layout(c), s = c.staff || {}, t = c.t, rate = db.conf.rate;
    const tr = tripRows(c.trips);
    const cell = (v, cls = '') => `<td class="${cls}">${v == null ? '' : v}</td>`;
    const left = [];
    for (let i = 0; i < L.nF; i++) { const f = c.fuel[i]; left.push(f ? ['d', md(f.date), esc(f.inv), f.liters ? kmTxt(f.liters) : '', money(f.amount)] : ['d', '', '', '', '']); }
    left.push(['s', '', '', '小計', money(t.fuelAmt)]);
    left.push(['h', '停車日', '發票號碼', '停車地點', '停車費']);
    for (let i = 0; i < L.nP; i++) { const p = c.park[i]; left.push(p ? ['d', md(p.date), esc(p.inv), esc(p.place), money(p.amount)] : ['d', '', '', '', '']); }
    const body = left.map((l, i) => {
      const r = tr[i];
      const lc = l[0] === 'h' ? 'th' : l[0] === 's' ? 'sub' : '';
      return `<tr>${cell(l[1], lc)}${cell(l[2], lc + ' mono')}${cell(l[3], lc)}${cell(l[4], lc + ' n')}
        ${r ? `${cell(r.showDate ? md(r.date) : '')}${cell(esc(r.from))}${cell(esc(r.to))}${cell(kmTxt(r.km), 'n')}${cell(esc(r.note), 'sm')}` : cell('') + cell('') + cell('') + cell('') + cell('')}</tr>`;
    }).join('');
    return `<div class="sheet" id="sheet">
      <h1>${esc(db.conf.title)}</h1>
      <div class="sh-meta"><span>申請人：<b>${esc(s.name || '')}</b></span><span>請領期間：${esc(c.p.from.replace(/-/g, '/'))} ～ ${esc(c.p.to.replace(/-/g, '/'))}</span><span>車牌號碼：<b>${esc(s.plate || '')}</b></span></div>
      <table class="sh">
        <colgroup><col style="width:9%"><col style="width:14%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:15%"><col style="width:14%"><col style="width:7%"><col style="width:11%"></colgroup>
        <thead><tr><th>加油日</th><th>發票號碼</th><th>加油公升</th><th>加油金額</th><th>公出日期</th><th>出發點/里程數</th><th>目的地/里程數</th><th>里程數</th><th>備註</th></tr></thead>
        <tbody>${body.replace('<tr>', '<tr class="first">')}</tbody>
        <tfoot>
          <tr><td></td><td></td><td>小計</td><td class="n">${money(t.parkAmt)}</td><td></td><td></td><td>里程數小計</td><td class="n b">${kmTxt(t.km)}</td><td></td></tr>
          <tr><td></td><td>油資總計</td><td></td><td class="n">${money(t.fuelAmt)}</td><td></td><td colspan="2">里程數×$${rate}＝公司補貼金額</td><td class="n b">${money(t.kmPay)}</td><td></td></tr>
          <tr><td></td><td>停車費總計</td><td></td><td class="n">${money(t.parkAmt)}</td><td></td><td colspan="2">補貼金額（里程×${rate}＋停車費）</td><td class="n b big">${money(t.total)}</td><td></td></tr>
          <tr class="sign"><td colspan="5"></td><td colspan="4">請領人親簽：</td></tr>
        </tfoot>
      </table></div>`;
  }
  function renderClaim() {
    setTitle('公出補貼 ／ 請領表', '油資/停車費補貼請領表');
    const first = needStaff();
    if (first) { $('#app').innerHTML = first; bindFirstStaff(); return; }
    const allMode = view.sid === '__all';
    const list = staffList();
    const sel = `<label class="picker"><span>員工</span><select data-pick="sid">${list.map((s) => `<option value="${esc(s.id)}" ${s.id === view.sid ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__all" ${allMode ? 'selected' : ''}>👥 全部員工彙總</option></select></label>`;
    if (allMode) {
      const rows = list.map((s) => ({ s, t: claim(s.id, view.pk).t }));
      const sum = rows.reduce((a, r) => { for (const k of ['km', 'kmPay', 'parkAmt', 'total', 'fuelAmt', 'days']) a[k] = (a[k] || 0) + r.t[k]; return a; }, {});
      $('#app').innerHTML = `<div class="toolbar">${sel}${periodPicker()}<span class="sp"></span>
          <button class="btn primary" data-act="x-all">⬇ 匯出全部請領表（Excel）</button></div>
        <section class="card"><div class="ch"><h3>👥 ${esc(view.pk)} 期　全部員工彙總</h3><small class="muted">${esc(M.periodLabel(view.pk, cut()))}，${db.conf.cut} 日結算，下月 15 日匯款</small></div>
        <table class="tbl"><thead><tr><th>員工</th><th>車牌</th><th class="n">出勤天數</th><th class="n">里程</th><th class="n">里程補貼</th><th class="n">停車費</th><th class="n">補貼合計</th><th class="n">加油發票</th></tr></thead>
        <tbody>${rows.map(({ s, t }) => `<tr data-sid="${esc(s.id)}"><td><b>${esc(s.name)}</b></td><td class="mono">${esc(s.plate)}</td><td class="n mono">${t.days}</td><td class="n mono">${kmTxt(t.km)} km</td><td class="n mono">$${money(t.kmPay)}</td><td class="n mono">$${money(t.parkAmt)}</td><td class="n mono"><b>$${money(t.total)}</b></td><td class="n mono ${t.kmPay && t.fuelAmt < t.kmPay ? 'warnt' : ''}">$${money(t.fuelAmt)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">合計 ${rows.length} 人</td><td class="n mono">${sum.days || 0}</td><td class="n mono">${kmTxt(sum.km)} km</td><td class="n mono">$${money(sum.kmPay)}</td><td class="n mono">$${money(sum.parkAmt)}</td><td class="n mono"><b>$${money(sum.total)}</b></td><td class="n mono">$${money(sum.fuelAmt)}</td></tr></tfoot></table>
        <p class="muted small">點員工可看該員的請領表。加油發票金額低於里程補貼時以橘色標示，方便檢查發票是否附齊。</p></section>`;
      $$('#app tr[data-sid]').forEach((tr) => tr.addEventListener('click', () => { view.sid = tr.dataset.sid; rerender(); }));
      return;
    }
    const c = claim(view.sid, view.pk);
    const payM = +view.pk.slice(5) % 12 + 1;
    $('#app').innerHTML = `<div class="toolbar">${sel}${periodPicker()}<span class="sp"></span>
        <button class="btn" data-act="print">🖨 列印</button>
        <button class="btn primary" data-act="x-claim">⬇ 匯出 Excel</button></div>
      <section class="cstrip">
        <div><small>申請人</small><b>${esc(c.staff ? c.staff.name : '')}</b><span class="mono">${esc(c.staff ? c.staff.plate : '')}</span></div>
        <div><small>里程數小計</small><b class="mono">${kmTxt(c.t.km)} km</b><span>${c.t.days} 天 · ${c.t.trips} 段</span></div>
        <div><small>停車費</small><b class="mono">$${money(c.t.parkAmt)}</b><span>${c.park.length} 筆</span></div>
        <div class="tot"><small>補貼金額合計</small><b class="mono">$${money(c.t.total)}</b><span>預計 ${payM} 月 15 日匯入薪轉帳戶</span></div>
      </section>
      <div class="sheetwrap">${claimHtml(c)}</div>
      <p class="muted small center">格式比照原本的「油資/停車費補貼請領表」。匯出的 Excel 含公式，可再修改；列印時只會印出表格。</p>`;
    fitSheet();
  }
  /** 手機上把 A4 表格縮小到螢幕寬度 */
  function fitSheet() {
    const w = $('.sheetwrap'), s = $('#sheet');
    if (!w || !s) return;
    s.style.transform = ''; s.style.marginBottom = '';
    const k = Math.min(1, (w.clientWidth - 20) / s.offsetWidth);
    if (k < 1) { s.style.transformOrigin = 'top left'; s.style.transform = `scale(${k})`; s.style.marginBottom = `${-(1 - k) * s.offsetHeight}px`; }
  }
  window.addEventListener('resize', () => { clearTimeout(fitSheet.t); fitSheet.t = setTimeout(fitSheet, 120); });
  function printClaim() {
    if (!$('#sheet')) return;
    try { window.print(); } catch (e) { toast('這個裝置無法直接列印，請改用匯出 Excel', 'err'); }
  }

  /* ---------- Excel ---------- */
  const serial = (d) => { const [y, m, dd] = d.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 864e5); };
  function claimSheet(c) {
    const L = layout(c), s = c.staff || {}, rate = db.conf.rate;
    const tr = tripRows(c.trips);
    const rows = [];
    const E = (st) => ({ v: null, s: st });
    rows.push([{ v: db.conf.title, s: 5 }]);
    rows.push([{ v: `申請人：${s.name || ''}`, s: 11 }, null, null, { v: `請領期間：${c.p.from.replace(/-/g, '/')} ～ ${c.p.to.replace(/-/g, '/')}`, s: 11 }, null, null, { v: `車牌號碼：${s.plate || ''}`, s: 11 }]);
    rows.push(['加油日', '發票號碼', '加油公升', '加油金額', '公出日期', '出發點/里程數', '目的地/里程數', '里程數', '備註'].map((v) => ({ v, s: 9 })));
    const r0 = 4, fuelSub = r0 + L.nF, parkHead = fuelSub + 1, parkSub = parkHead + L.nP + 1;
    for (let i = 0; i < L.rows; i++) {
      const rn = r0 + i, row = [];
      if (rn < fuelSub) {
        const f = c.fuel[i];
        row.push(f ? { v: serial(f.date), s: 8 } : E(6), f ? { v: f.inv, s: 6 } : E(6), f && f.liters ? { v: f.liters, s: 10 } : E(6), f ? { v: f.amount, s: 7 } : E(7));
      } else if (rn === fuelSub) {
        row.push(E(6), E(6), { v: '小計', s: 9 }, { v: M.totals([], c.fuel, []).fuelAmt, f: `SUM(D${r0}:D${fuelSub - 1})`, s: 12 });
      } else if (rn === parkHead) {
        row.push(...['停車日', '發票號碼', '停車地點', '停車費'].map((v) => ({ v, s: 9 })));
      } else {
        const p = c.park[rn - parkHead - 1];
        row.push(p ? { v: serial(p.date), s: 8 } : E(6), p ? { v: p.inv, s: 6 } : E(6), p ? { v: p.place, s: 6 } : E(6), p ? { v: p.amount, s: 7 } : E(7));
      }
      const t = tr[i];
      row.push(t && t.showDate ? { v: serial(t.date), s: 8 } : E(6), t ? { v: t.from, s: 6 } : E(6), t ? { v: t.to, s: 6 } : E(6), t ? { v: t.km, s: 6 } : E(6), t && t.note ? { v: t.note, s: 13 } : E(6));
      rows.push(row);
    }
    const tt = c.t, lastTrip = parkSub - 1;
    rows.push([E(6), E(6), { v: '小計', s: 9 }, { v: tt.parkAmt, f: `SUM(D${parkHead + 1}:D${parkSub - 1})`, s: 12 }, null, null, { v: '里程數小計', s: 9 }, { v: tt.km, f: `SUM(H${r0}:H${lastTrip})`, s: 12 }]);
    rows.push([null, { v: '油資總計', s: 9 }, null, { v: tt.fuelAmt, f: `D${fuelSub}`, s: 12 }, null, { v: `里程數*$${rate}=公司補貼金額`, s: 14 }, null, { v: tt.kmPay, f: `ROUND(H${parkSub}*${rate},0)`, s: 12 }]);
    rows.push([null, { v: '停車費總計', s: 9 }, null, { v: tt.parkAmt, f: `D${parkSub}`, s: 12 }, null, { v: `補貼金額(里程*${rate}+停車費)`, s: 14 }, null, { v: tt.total, f: `H${parkSub + 1}+D${parkSub}`, s: 12 }]);
    rows.push([null, null, null, null, null, { v: '請領人親簽：', s: 14 }]);
    return {
      name: `${s.name || '請領表'} ${c.pk}`,
      cols: [9.5, 14, 10, 10, 10, 17.5, 15, 8.5, 12],
      rows, heights: { all: 22.5, 1: 33 }, print: { pages: 1 },
      merges: ['A1:I1', 'A2:C2', 'D2:F2', 'G2:I2'],
    };
  }
  function xlsxName(n) { return n.replace(/[\\/:*?"<>|]/g, '_'); }
  function buildClaimXlsx(sid, pk) { return XLSXW.build([claimSheet(claim(sid, pk))]); }
  function exportClaim(sid, pk) {
    const c = claim(sid, pk);
    if (!c.staff) return;
    return download(XLSXW.build([claimSheet(c)]), xlsxName(`${pk.replace('-', '')}油資請領表(${c.staff.name}).xlsx`), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  function buildAllXlsx(pk) {
    const list = staffList();
    const sumRows = [[{ v: `${db.conf.title}　${pk} 期彙總（${M.periodLabel(pk, cut())}）`, s: 11 }],
      ['員工', '車牌', '出勤天數', '里程(km)', '里程補貼', '停車費', '補貼合計', '加油發票金額'].map((v) => ({ v, s: 9 }))];
    let tot = { km: 0, kmPay: 0, parkAmt: 0, total: 0, fuelAmt: 0, days: 0 };
    const sheets = [];
    list.forEach((s) => {
      const c = claim(s.id, pk), t = c.t;
      for (const k in tot) tot[k] += t[k];
      sumRows.push([{ v: s.name, s: 6 }, { v: s.plate, s: 6 }, { v: t.days, s: 7 }, { v: t.km, s: 10 }, { v: t.kmPay, s: 7 }, { v: t.parkAmt, s: 7 }, { v: t.total, s: 12 }, { v: t.fuelAmt, s: 7 }]);
      if (c.trips.length || c.fuel.length || c.park.length) sheets.push(claimSheet(c));
    });
    sumRows.push([{ v: '合計', s: 9 }, { v: `${list.length} 人`, s: 9 }, { v: tot.days, s: 12 }, { v: M.round2(tot.km), s: 12 }, { v: tot.kmPay, s: 12 }, { v: tot.parkAmt, s: 12 }, { v: tot.total, s: 12 }, { v: tot.fuelAmt, s: 12 }]);
    return XLSXW.build([{ name: '彙總', cols: [12, 12, 10, 11, 11, 10, 12, 13], rows: sumRows, heights: { all: 21 }, merges: ['A1:H1'] }, ...sheets]);
  }
  function exportAll(pk) {
    return download(buildAllXlsx(pk), xlsxName(`${pk.replace('-', '')}油資請領表(全部員工).xlsx`), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /* ---------- 公里對照表 ---------- */
  function renderTable() {
    setTitle('公出補貼 ／ 公里對照表', '公里數對照表');
    const pl = places();
    const hq = pl.find((p) => p.id === 'hq');
    const others = pl.filter((p) => p.id !== 'hq');
    const mxKm = Math.max(1, ...Object.values(db.km).map((x) => +x.v || 0));
    $('#app').innerHTML = `
      <section class="card rules"><div class="ch"><h3>📋 補助規定</h3><button class="btn ghost sm" id="editRules">修改</button></div>
        <div class="rtxt">${esc(db.conf.rules).replace(/\n/g, '<br>')}</div>
        <div class="muted small">每公里補助 <b>$${db.conf.rate}</b>　·　每月 <b>${db.conf.cut}</b> 日結算（可在「設定」修改）</div></section>
      <section class="card"><div class="ch"><h3>🏢 ${esc(hq ? hq.name : '總公司')} → 各地點（單趟公里）</h3><button class="btn primary sm" id="addPlace">＋ 新增地點</button></div>
        <div class="plist">${others.map((p) => {
          const a = kmOf('hq', p.id);
          return `<div class="pl"><div class="pn"><b>${esc(p.name)}</b><small>${esc(p.addr || '（未填地址）')}</small></div>
            <input type="number" inputmode="decimal" step="0.1" min="0" data-km="hq>${esc(p.id)}" value="${a == null ? '' : a}" placeholder="?" data-keep><small>km</small>
            <a class="btn ghost sm" target="_blank" rel="noopener" href="${mapUrl(hq, p)}" title="用 Google 地圖查路線距離">🗺</a>
            <button class="btn ghost sm" data-ep="${esc(p.id)}" title="修改地點">✏</button></div>`;
        }).join('')}</div>
        <p class="muted small">直接修改數字就會儲存。🗺 可開 Google 地圖查兩地的行車距離。</p></section>
      <section class="card"><div class="ch"><h3>🔀 當日施工地點兩處以上：地點間單趟公里</h3><small class="muted">列＝出發點，欄＝目的地</small></div>
        <div class="mxwrap"><table class="mx"><thead><tr><th>地點／單趟哩程</th>${others.map((p) => `<th>${esc(p.short || p.name)}</th>`).join('')}</tr></thead>
        <tbody>${others.map((a) => `<tr><th>${esc(a.short || a.name)}</th>${others.map((b) => {
          if (a.id === b.id) return '<td class="self">—</td>';
          const own = db.km[`${a.id}>${b.id}`], v = own && own.v != null ? own.v : null, rev = kmOf(b.id, a.id);
          const hv = v == null ? rev : v;
          return `<td style="--h:${hv == null ? 0 : Math.min(1, hv / mxKm).toFixed(2)}"><input type="number" inputmode="decimal" step="0.1" min="0" data-km="${esc(a.id)}>${esc(b.id)}" value="${v == null ? '' : v}" placeholder="${rev == null ? '' : rev}" title="${v == null && rev != null ? '未填，使用反方向的 ' + rev + ' km' : ''}" data-keep></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted small">空白的格子會自動使用反方向的公里數（淡色數字）。兩邊都空白時，新增路線會要求手動輸入。</p></section>`;
    $$('#app [data-km]').forEach((i) => i.addEventListener('change', () => {
      const [a, b] = i.dataset.km.split('>');
      setKm(a, b, i.value);
      save(); toast(`已更新 ${placeShort(a)} → ${placeShort(b)}：${i.value === '' ? '清除' : i.value + ' km'}`, 'ok');
    }));
    $('#addPlace').onclick = () => placeBox(null);
    $$('#app [data-ep]').forEach((b) => (b.onclick = () => placeBox(placeById(b.dataset.ep))));
    $('#editRules').onclick = () => {
      const m = modal(`<form class="ed"><h2>📋 修改補助規定</h2><div class="f"><textarea name="r" rows="8">${esc(db.conf.rules)}</textarea></div>
        <div class="foot"><button type="button" class="btn" data-c="reset">還原預設</button><span class="sp"></span><button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`);
      const f = $('form', m);
      m.addEventListener('click', (e) => { const c = e.target.closest('[data-c]'); if (!c) return; if (c.dataset.c === 'close') closeModal(); if (c.dataset.c === 'reset') f.r.value = M.RULES; });
      f.addEventListener('submit', (e) => { e.preventDefault(); db.conf.rules = f.r.value; db.conf.at = now(); save(); closeModal(); rerender(); });
    };
  }
  function mapUrl(a, b) {
    const q = (p) => encodeURIComponent(p ? p.addr || p.name : '');
    return `https://www.google.com/maps/dir/?api=1&origin=${q(a)}&destination=${q(b)}&travelmode=driving`;
  }
  function placeBox(p) {
    const isNew = !p;
    p = p || { name: '', short: '', addr: '' };
    const m = modal(`<form class="ed"><h2>📍 ${isNew ? '新增' : '修改'}地點</h2>
      <div class="frow"><div class="f"><label>地點名稱</label><input name="name" value="${esc(p.name)}" required placeholder="例如：八里水灣"></div>
        <div class="f"><label>簡稱（請領表上顯示）</label><input name="short" value="${esc(p.short)}" placeholder="例如：八里"></div></div>
      <div class="f"><label>地址</label><input name="addr" value="${esc(p.addr)}" placeholder="用來在 Google 地圖查距離"></div>
      ${isNew ? '<div class="f"><label>總公司到這裡的單趟公里數</label><input type="number" inputmode="decimal" step="0.1" min="0" name="km"></div>' : ''}
      <div class="foot">${!isNew && p.id !== 'hq' ? '<button type="button" class="btn danger" data-c="del">刪除地點</button>' : ''}<span class="sp"></span>
        <button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`);
    const f = $('form', m);
    m.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      if (c.dataset.c === 'close') closeModal();
      if (c.dataset.c === 'del') {
        if (await ask('刪除地點？', `「${p.name}」會從對照表移除，已記錄的公出紀錄不受影響。`, [['del', '刪除'], ['', '取消']]) !== 'del') return;
        p.deleted = true; p.at = now(); save(); rerender(); toast('已刪除地點');
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = { name: f.name.value.trim(), short: f.short.value.trim() || f.name.value.trim(), addr: f.addr.value.trim() };
      if (isNew) {
        const np = fixers.places({ ...v, ord: db.places.length, at: now() });
        db.places.push(np);
        if (f.km.value !== '') setKm('hq', np.id, f.km.value);
      } else Object.assign(p, v, { at: now() });
      save(); closeModal(); rerender(); toast('已儲存', 'ok');
    });
  }

  /* ---------- 設定 ---------- */
  function renderSettings() {
    setTitle('公出補貼 ／ 設定', '設定');
    const list = staffList();
    const c = db.cloud;
    $('#app').innerHTML = `
      <section class="card"><div class="ch"><h3>👤 員工（申請人）</h3><button class="btn primary sm" id="addStaff">＋ 新增員工</button></div>
        ${list.length ? `<table class="tbl"><thead><tr><th>姓名</th><th>車牌號碼</th><th>部門</th><th>本機使用者</th><th></th></tr></thead><tbody>
        ${list.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td class="mono">${esc(s.plate)}</td><td>${esc(s.dept)}</td>
          <td><label class="chk"><input type="radio" name="me" value="${esc(s.id)}" ${db.me === s.id ? 'checked' : ''}> 這台裝置是我</label></td>
          <td class="r"><button class="btn ghost sm" data-es="${esc(s.id)}">修改</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">還沒有員工</p>'}
        <p class="muted small">「本機使用者」決定這台電腦／手機打開時預設顯示誰的紀錄（不會同步到其他裝置）。</p></section>
      <section class="card"><div class="ch"><h3>💰 補助設定</h3></div>
        <form class="row-form" id="confF">
          <div class="f"><label>每公里補助（元）</label><input type="number" step="0.1" min="0" name="rate" value="${db.conf.rate}"></div>
          <div class="f"><label>每月結算日</label><input type="number" min="1" max="28" name="cut" value="${db.conf.cut}"></div>
          <div class="f grow"><label>請領表標題</label><input name="title" value="${esc(db.conf.title)}"></div>
          <button class="btn primary">儲存</button></form>
        <p class="muted small">結算日 ${db.conf.cut} 日 ＝ 每期從上個月 ${db.conf.cut + 1} 日到本月 ${db.conf.cut} 日。修改後所有員工、所有裝置一起套用。</p></section>
      <section class="card"><div class="ch"><h3>☁ Google 雲端同步</h3></div>
        <div class="cloudrow"><div>${c ? `<b>已連線</b>　<span class="muted">${esc(Cloud.label())}${c.lastOk ? '，最後同步 ' + new Date(c.lastOk).toLocaleString('zh-TW', { hour12: false }) : ''}</span>` : '<b>未連線</b>　<span class="muted">資料只存在這台裝置</span>'}</div>
          <button class="btn ${c ? '' : 'primary'}" data-act="cloudst">${c ? '同步設定' : '連線 Google 雲端'}</button></div>
        <p class="muted small">連線後，所有員工的手機、電腦共用同一份資料，存在 Google 試算表，也可以直接在試算表上查看。</p></section>
      <section class="card"><div class="ch"><h3>🗂 資料</h3></div>
        <div class="acts">
          <button class="btn" id="impOld">📥 匯入舊請領表（Excel）</button>
          <button class="btn" id="bak">💾 下載備份（JSON）</button>
          <button class="btn" id="rst">♻ 從備份還原</button>
          <input type="file" id="fileIn" hidden>
        </div>
        <p class="muted small">匯入舊請領表：選擇像「202509油資請領表(姓名).xlsx」這樣的檔案，會讀出申請人、車牌、加油、公出、停車紀錄。重複的紀錄不會匯入兩次。</p></section>
      <p class="muted small center">公里及油資紀錄系統 v${VERSION}${DESKTOP ? '　·　電腦版' : '　·　網頁版'}　·　Alt+1～5 切換頁面</p>`;
    $('#addStaff').onclick = () => staffBox(null);
    $$('#app [data-es]').forEach((b) => (b.onclick = () => staffBox(staffById(b.dataset.es))));
    $$('#app input[name=me]').forEach((r) => r.addEventListener('change', () => { db.me = r.value; view.sid = r.value; localSet('mileage.sid', r.value); flush(); toast('已設定本機使用者', 'ok'); }));
    $('#confF').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      db.conf = fixConf({ ...db.conf, rate: f.rate.value, cut: f.cut.value, title: f.title.value, at: now() });
      view.pk = M.periodOf(today(), cut());
      save(); rerender(); toast('已儲存補助設定', 'ok');
    });
    const fi = $('#fileIn');
    $('#impOld').onclick = () => { fi.accept = '.xlsx'; fi.dataset.k = 'old'; fi.click(); };
    $('#rst').onclick = () => { fi.accept = '.json,application/json'; fi.dataset.k = 'json'; fi.click(); };
    $('#bak').onclick = () => {
      const d = JSON.parse(JSON.stringify(db)); d.cloud = null; d.me = '';
      download(new TextEncoder().encode(JSON.stringify(d, null, 1)), `公里及油資紀錄_備份_${today()}.json`, 'application/json');
    };
    fi.onchange = async () => {
      const file = fi.files[0];
      fi.value = '';
      if (!file) return;
      try {
        if (fi.dataset.k === 'old') await importOld(await file.arrayBuffer(), file.name);
        else await restoreJson(await file.text());
      } catch (err) { toast('讀取失敗：' + err.message, 'err'); }
    };
  }
  function staffBox(s) {
    const isNew = !s;
    s = s || { name: '', plate: '', dept: '' };
    const m = modal(`<form class="ed"><h2>👤 ${isNew ? '新增' : '修改'}員工</h2>
      <div class="frow"><div class="f"><label>姓名</label><input name="name" value="${esc(s.name)}" required></div>
        <div class="f"><label>車牌號碼</label><input name="plate" value="${esc(s.plate)}" autocapitalize="characters"></div></div>
      <div class="f"><label>部門（選填）</label><input name="dept" value="${esc(s.dept)}"></div>
      <div class="foot">${isNew ? '' : '<button type="button" class="btn danger" data-c="del">刪除員工</button>'}<span class="sp"></span>
        <button type="button" class="btn" data-c="close">取消</button><button class="btn primary">儲存</button></div></form>`);
    const f = $('form', m);
    m.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      if (c.dataset.c === 'close') closeModal();
      if (c.dataset.c === 'del') {
        const n = ['trips', 'fuel', 'park'].reduce((a, k) => a + live(db[k]).filter((r) => r.sid === s.id).length, 0);
        if (await ask('刪除員工？', `「${s.name}」${n ? `有 ${n} 筆紀錄，刪除後紀錄仍保留在資料中，但不會再顯示。` : ''}`, [['del', '刪除'], ['', '取消']]) !== 'del') return;
        s.deleted = true; s.at = now();
        if (view.sid === s.id) view.sid = (staffList()[0] || {}).id || '';
        save(); rerender(); toast('已刪除員工');
      }
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = { name: f.name.value.trim(), plate: f.plate.value.trim().toUpperCase(), dept: f.dept.value.trim() };
      if (isNew) {
        const ns = fixers.staff({ ...v, ord: db.staff.length, at: now() });
        db.staff.push(ns);
        if (!view.sid || view.sid === '__all') view.sid = ns.id;
        if (!db.me) db.me = ns.id;
      } else Object.assign(s, v, { at: now() });
      save(); closeModal(); rerender(); toast('已儲存', 'ok');
    });
  }
  async function restoreJson(text) {
    const n = normalize(JSON.parse(text));
    if (!n.staff.length && !n.trips.length) throw new Error('不是這個系統的備份檔');
    const mode = await ask('從備份還原', `備份裡有 ${live(n.staff).length} 位員工、${live(n.trips).length} 筆公出、${live(n.fuel).length} 筆加油、${live(n.park).length} 筆停車。`, [['merge', '合併（以較新的為準）'], ['replace', '整個取代'], ['', '取消']]);
    if (!mode) return;
    if (mode === 'replace') {
      const keep = { me: db.me, cloud: db.cloud };
      const t = now();
      // 雲端已連線時，原本的紀錄要留下刪除標記，其他裝置才會一起刪除
      for (const k of ['places', 'staff', 'trips', 'fuel', 'park']) { const ids = new Set(n[k].map((x) => x.id)); db[k].forEach((x) => { if (!ids.has(x.id)) { x.deleted = true; x.at = t; } }); }
      mergeAll(n, true);
      Object.assign(db, keep);
    } else mergeAll(n, false);
    seed(db);
    if (!staffById(view.sid) || staffById(view.sid).deleted) view.sid = (staffList()[0] || {}).id || '';
    save(); rerender(); toast('已還原備份', 'ok');
  }
  /** 合併另一份資料；force=true 時對方一律蓋過（並更新時間，雲端才會同步出去） */
  function mergeAll(n, force) {
    const t = now();
    for (const k of ['places', 'staff', 'trips', 'fuel', 'park']) {
      for (const x of n[k]) {
        const l = db[k].find((y) => y.id === x.id);
        if (!l) db[k].push(force ? { ...x, at: Math.max(x.at, t) } : x);
        else if (force || x.at > l.at) Object.assign(l, x, force ? { at: Math.max(x.at, t) } : {});
      }
    }
    for (const [k, v] of Object.entries(n.km)) { const l = db.km[k]; if (!l || force || v.at > l.at) db.km[k] = force ? { ...v, at: Math.max(v.at, t) } : v; }
    if (force || n.conf.at > db.conf.at) db.conf = force ? { ...n.conf, at: t } : n.conf;
  }

  /* ---------- 匯入舊請領表 ---------- */
  const fromSerial = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (/^\d{4,5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return `${d.getUTCFullYear()}-${M.pad(d.getUTCMonth() + 1)}-${M.pad(d.getUTCDate())}`; }
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    return m ? `${m[1]}-${M.pad(+m[2])}-${M.pad(+m[3])}` : '';
  };
  /** 解析舊請領表（第一個工作表）→ { name, plate, fuel, trips, park } */
  function parseOld(rows) {
    const cell = (r, c) => String((rows[r] || [])[c] || '').trim();
    let name = '', plate = '', head = -1;
    rows.forEach((row, r) => row.forEach((v, c) => {
      const s = String(v || '');
      const mm = s.match(/申請人[:：]\s*(.+)/); if (mm) name = mm[1].trim();
      const pm = s.match(/車牌號碼[:：]\s*(.+)/); if (pm) plate = pm[1].trim().toUpperCase();
      if (head < 0 && s.trim() === '加油日' && c === 0) head = r;
    }));
    if (head < 0) throw new Error('找不到「加油日」表頭，這不像油資請領表');
    const fuel = [], park = [], trips = [];
    let zone = 'fuel', lastDate = '';
    for (let r = head + 1; r < rows.length; r++) {
      const A = cell(r, 0), B = cell(r, 1), C = cell(r, 2), D = cell(r, 3);
      if (A === '停車日') { zone = 'park'; continue; }
      if (C === '小計' || /總計|請領人/.test(B + cell(r, 5))) { if (zone === 'park' && C === '小計') zone = 'end'; else if (zone === 'fuel') zone = 'gap'; }
      else if (zone === 'fuel' && (A || B) && M.num(D)) fuel.push({ date: fromSerial(A) || lastDate, inv: B, liters: M.num(C), amount: M.num(D) });
      else if (zone === 'park' && (A || B) && M.num(D)) park.push({ date: fromSerial(A), inv: B, place: C, amount: M.num(D) });
      const E = cell(r, 4), F = cell(r, 5), G = cell(r, 6), H = cell(r, 7), I = cell(r, 8);
      if (E) lastDate = fromSerial(E) || lastDate;
      if (F && G && M.num(H) && !/小計|補貼|里程數/.test(F + G) && lastDate) trips.push({ date: lastDate, from: F, to: G, km: M.num(H), note: I });
    }
    return { name, plate, fuel, trips, park };
  }
  async function importOld(buf, fname) {
    const rows = await XLSXW.read(buf);
    const o = parseOld(rows);
    if (!o.fuel.length && !o.trips.length && !o.park.length) throw new Error('檔案裡沒有可匯入的紀錄');
    let s = staffList().find((x) => x.name === o.name) || (o.plate && staffList().find((x) => x.plate === o.plate));
    const r = await ask('匯入舊請領表', `${fname}\n申請人：${o.name || '（未填）'}　車牌：${o.plate || '（未填）'}\n加油 ${o.fuel.length} 筆、公出 ${o.trips.length} 段、停車 ${o.park.length} 筆。\n${s ? `會匯入到員工「${s.name}」。` : `會新增員工「${o.name || '未命名'}」。`}`, [['ok', '匯入'], ['', '取消']]);
    if (r !== 'ok') return;
    if (!s) { s = fixers.staff({ name: o.name || '未命名', plate: o.plate, ord: db.staff.length, at: now() }); db.staff.push(s); }
    else if (!s.plate && o.plate) { s.plate = o.plate; s.at = now(); }
    const res = importParsed(s.id, o);
    view.sid = s.id;
    const d = o.trips[0] || o.fuel[0] || o.park[0];
    if (d && d.date) view.pk = M.periodOf(d.date, cut());
    save(); rerender();
    alertBox('匯入完成', `新增加油 ${res.fuel} 筆、公出 ${res.trips} 段、停車 ${res.park} 筆${res.skip ? `；${res.skip} 筆已存在，略過` : ''}。`);
    return res;
  }
  function importParsed(sid, o) {
    const res = { fuel: 0, trips: 0, park: 0, skip: 0 }, t = now();
    const idOf = (n) => { const p = places().find((x) => x.short === n || x.name === n || x.name.startsWith(n)); return p ? p.id : ''; };
    const same = (k, x, keys) => live(db[k]).some((y) => y.sid === sid && keys.every((kk) => String(y[kk]) === String(x[kk])));
    o.fuel.forEach((x) => { const v = fixers.fuel({ ...x, sid, at: t }); if (same('fuel', v, ['date', 'inv', 'amount'])) res.skip++; else { db.fuel.push(v); res.fuel++; } });
    o.park.forEach((x) => { const v = fixers.park({ ...x, sid, at: t }); if (same('park', v, ['date', 'inv', 'amount'])) res.skip++; else { db.park.push(v); res.park++; } });
    const grpOf = {};
    const cnt = {};
    o.trips.forEach((x) => {
      const g = grpOf[x.date] = grpOf[x.date] || uid();
      cnt[x.date] = (cnt[x.date] || 0) + 1;
      const v = fixers.trips({ ...x, sid, fromId: idOf(x.from), toId: idOf(x.to), grp: g, ord: cnt[x.date] - 1, at: t });
      // 同一天同路線可能來回多次，用「第幾段」一起比對
      const dupN = live(db.trips).filter((y) => y.sid === sid && y.date === v.date && y.from === v.from && y.to === v.to && y.km === v.km).length;
      const mineN = o.trips.slice(0, o.trips.indexOf(x) + 1).filter((y) => y.date === x.date && y.from === x.from && y.to === x.to && M.num(y.km) === v.km).length;
      if (dupN >= mineN) res.skip++; else { db.trips.push(v); res.trips++; }
    });
    return res;
  }

  /* ---------- Google 雲端同步（Apps Script + 試算表，見 cloud/Code.gs） ---------- */
  function wire(kind, x) {
    if (kind === 'km') return x;
    const sn = (sid) => { const s = staffById(sid); return s ? s.name : ''; };
    if (kind === 'trips' || kind === 'fuel' || kind === 'park') return { ...x, staffName: sn(x.sid) };
    return x;
  }
  function allRows(kind) {
    if (kind === 'km') return Object.entries(db.km).map(([id, v]) => { const [a, b] = id.split('>'); return { id, from: a, to: b, fromName: placeShort(a, a), toName: placeShort(b, b), v: v.v, at: v.at }; });
    if (kind === 'conf') return [{ id: 'conf', ...db.conf }];
    return db[kind];
  }
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
    changes(since) {
      const out = {};
      let n = 0;
      for (const k of KINDS) {
        const rows = allRows(k).filter((x) => (+x.at || 0) > since).map((x) => wire(k, x));
        if (rows.length) { out[k] = rows; n += rows.length; }
      }
      out.n = n;
      return out;
    },
    pending() { return db.cloud ? this.changes(db.cloud.pushedAt).n : 0; },
    merge(data) {
      let ch = false;
      for (const k of KINDS) {
        for (const x of (data && data[k]) || []) {
          if (!x || !x.id) continue;
          const at = +x.at || 0;
          if (k === 'km') {
            const l = db.km[x.id];
            if (!l || at > l.at) { db.km[x.id] = { v: x.v === '' || x.v == null ? null : +x.v, at }; ch = true; }
          } else if (k === 'conf') {
            if (at > db.conf.at) { db.conf = fixConf(x); ch = true; }
          } else {
            const y = { ...x };
            if ((k === 'trips' || k === 'fuel' || k === 'park') && !y.sid && y.staffName) { const s = staffList().find((z) => z.name === y.staffName); if (s) y.sid = s.id; }
            const l = db[k].find((z) => z.id === x.id);
            if (!l) { db[k].push(fixers[k](y)); ch = true; } else if (at > l.at) { Object.assign(l, fixers[k](y)); ch = true; }
          }
        }
      }
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
        const ch = this.changes(c.pushedAt);
        delete ch.n;
        const r = await this.req({ a: 'sync', since: c.rev, changes: ch });
        if (db.cloud !== c || !this.on()) return false;
        const changed = this.merge(r.data);
        c.rev = r.rev; c.pushedAt = t0; c.lastOk = now();
        if (r.sheet) c.sheet = r.sheet;
        if (!staffById(view.sid) && view.sid !== '__all') view.sid = (staffById(db.me) && db.me) || (staffList()[0] || {}).id || '';
        await flush();
        this.err = ''; this.show('ok');
        if (changed) rerender();
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
      $$('.cloudst').forEach((e) => {
        e.className = 'cloudst ' + cls + (e.classList.contains('m-only') ? ' m-only' : '');
        e.innerHTML = `<span class="dotc"></span><span class="ct"><small>Google 雲端</small>${t}</span>`;
        e.title = tip;
      });
      const box = $('#cloudinfo'); if (box) box.innerHTML = cloudInfo();
    },
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Cloud.tick(); });
  window.addEventListener('online', () => Cloud.tick());

  /** 只有預設對照表、沒有任何自己的資料 */
  const pristine = () => !db.staff.length && !db.trips.length && !db.fuel.length && !db.park.length;
  async function connectCloud(url, pw) {
    url = url.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) throw new Error('網址格式不對，應該像 https://script.google.com/macros/s/…/exec');
    if (pw.length < 4) throw new Error('密碼至少 4 個字');
    const c = { url, pw, rev: 0, pushedAt: 0, on: true, lastOk: 0, sheet: '' };
    const r = await Cloud.req({ a: 'ping' }, c);
    let mode = 'merge';
    const cloudN = r.counts ? r.counts.staff + r.counts.trips + r.counts.fuel + r.counts.park : 0;
    if (cloudN > 0 && !pristine()) {
      mode = await ask('雲端已經有資料', `雲端有 ${r.counts.staff} 位員工、${r.counts.trips} 筆公出；這台裝置有 ${live(db.staff).length} 位員工、${live(db.trips).length} 筆公出。要怎麼處理？`,
        [['merge', '合併（兩邊都保留）'], ['replace', '改用雲端資料'], ['', '取消']]);
      if (!mode) return null;
    }
    if (mode === 'replace' || (cloudN > 0 && pristine())) { const keep = { cloud: null }; db = Object.assign(seed(blank()), keep); }
    db.cloud = c;
    if (r.sheet) c.sheet = r.sheet;
    await flush();
    const ok = await Cloud.sync();
    Cloud.start();
    if (!ok) throw new Error(Cloud.err || '同步失敗');
    if (!staffById(db.me)) db.me = '';
    return { claimed: r.claimed, mode, cloudHad: cloudN };
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
      <div class="dlg">
        <h2>☁ Google 雲端同步</h2>
        <div id="cloudinfo">${cloudInfo()}</div>
        <p class="muted small">資料存在 Google 試算表，這台裝置修改後幾秒內會自動上傳；其他裝置每 15 秒檢查一次更新。也可以直接在試算表上查看或修改（要刪除請在「已刪除」欄填「是」）。</p>
        <div class="foot wrap">
          <button class="btn primary" data-c="now">立即同步</button>
          <button class="btn" data-c="sheet">開啟 Google 試算表</button>
          <button class="btn" data-c="pw">修改密碼</button>
          <span class="sp"></span>
          <button class="btn danger" data-c="off">中斷連線</button>
          <button class="btn" data-c="close">關閉</button>
        </div>
      </div>` : `
      <form class="ed">
        <h2>☁ 連線 Google 雲端</h2>
        <p class="muted small">連線後，資料會存到 Google 試算表，每位員工的手機（網頁版）和電腦（exe）輸入同一組網址和密碼，就會自動同步。<br>
        第一次連線時輸入的密碼就是之後所有裝置共用的同步密碼（至少 4 個字），請記下來告訴同事。</p>
        <div class="f"><label for="curl">雲端網址</label><input id="curl" name="url" value="${esc(c.url || window.MILEAGE_CLOUD_URL || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></div>
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
        db.cloud = null; await flush(); Cloud.start(); closeModal(); rerender(); toast('已中斷雲端連線');
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
          closeModal(); rerender();
          alertBox('已連上 Google 雲端', r.claimed ? '這是第一次連線，剛剛輸入的密碼已設為同步密碼。<br>其他員工在「設定 → Google 雲端同步」輸入同一組網址和密碼即可同步。'
            : `已同步，目前共 ${live(db.staff).length} 位員工、${live(db.trips).length} 筆公出紀錄。${staffById(db.me) ? '' : '<br>請到「設定」勾選「這台裝置是我」。'}`);
        } catch (err) {
          msg.className = 'vs bad'; msg.textContent = err.message;
          btn.disabled = false; btn.textContent = '連線並同步';
        }
      });
    }
  }

  /* ---------- 自動更新：網頁版重新載入；電腦版由 exe 下載新版後呼叫 window.__mfUpdate ---------- */
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
    return !!$('.modal') || (a && a.matches && a.matches('textarea, input, select')) || now() - lastInput < 20000;
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
  // 電腦版：exe 下載並驗證好新版後呼叫這裡；確認後由 exe 換檔並重新啟動
  window.__mfUpdate = (v, notes) => offerUpdate(v, notes, async () => {
    const a = await api();
    const r = a ? await a.apply_update() : '找不到桌面介面';
    if (r !== true) throw new Error(r);
  });

  /* ---------- 示範資料（測試用） ---------- */
  function demo() {
    const s = fixers.staff({ name: '測試員工', plate: 'TST-0001', ord: db.staff.length });
    db.staff.push(s); view.sid = s.id; if (!db.me) db.me = s.id;
    const pk = M.periodOf(today(), cut()), p = M.period(pk, cut());
    const d0 = M.parse(p.from);
    const day = (n) => { const d = new Date(d0); d.setDate(d.getDate() + n); return M.ymd(d); };
    const t = now();
    [[1, 'p_bali'], [2, 'p_bitan'], [5, 'p_rongdi']].forEach(([n, pid]) => {
      const g = uid(), pl = placeById(pid);
      db.trips.push(fixers.trips({ sid: s.id, date: day(n), from: '新莊', to: pl.short, fromId: 'hq', toId: pid, km: kmOf('hq', pid), grp: g, ord: 0, at: t }),
        fixers.trips({ sid: s.id, date: day(n), from: pl.short, to: '新莊', fromId: pid, toId: 'hq', km: kmOf(pid, 'hq'), grp: g, ord: 1, at: t }));
    });
    db.fuel.push(fixers.fuel({ sid: s.id, date: day(0), inv: 'QT-54520836', liters: 5.27, amount: 144, at: t }));
    db.park.push(fixers.park({ sid: s.id, date: day(2), inv: 'AB-00000001', place: '碧潭風景區', amount: 60, at: t }));
    view.pk = pk;
    save(); rerender();
    return s.id;
  }

  /* ---------- 啟動 ---------- */
  async function init() {
    const t0 = now();
    if (DESKTOP) document.documentElement.classList.add('desktop');
    await load();
    setTimeout(() => { const sp = $('#splash'); if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 600); } }, Math.max(0, 1300 - (now() - t0)));
    view.pk = M.periodOf(today(), cut());
    const want = localGet('mileage.sid');
    view.sid = (staffById(db.me) && !staffById(db.me).deleted && db.me) || (want && staffById(want) && want) || (staffList()[0] || {}).id || '';
    route();
    Cloud.show(Cloud.state);
    Cloud.start();
    if (!DESKTOP && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!DESKTOP) {
      setTimeout(checkWebUpdate, 5000);
      setInterval(checkWebUpdate, 15 * 60000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkWebUpdate(); });
    }
    window.__mf.ready = true;
  }
  window.__mf = { get db() { return db; }, view, flush, demo, claim, claimSheet, buildClaimXlsx, buildAllXlsx, parseOld, importOld, importParsed, Cloud, connectCloud, exportClaim, exportAll, checkWebUpdate, offerUpdate, VERSION, ready: false };
  init();
})();
