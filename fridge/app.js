/* 冰箱溫度記錄表系統 — 每日溫度記錄、超溫處置、月報表、趨勢圖（PWA 與桌面版共用） */
(() => {
  'use strict';
  const VERSION = '1.6.4';
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
  const validYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const spanDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5) + 1;
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const numOrNull = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(/[−－﹣]/g, '-')); return isFinite(n) ? n : null; };
  const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
  const hm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const stamp = () => `${today()} ${hm()}`;
  const deg = (t) => (t == null ? '' : (Math.round(t * 10) / 10).toFixed(1).replace(/\.0$/, '') + '°C');
  const t1 = (t) => (t == null ? '' : (Math.round(t * 10) / 10).toFixed(1));
  const daysInMonth = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  const addM = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

  // ------------------------------------------------------------------ 溫度數字鍵盤（觸控裝置；手機內建數字鍵沒有負號）
  const TOUCH = matchMedia('(pointer: coarse)').matches;
  const IM = TOUCH ? 'none' : 'decimal';
  // iPhone 不理會 inputmode="none" 仍會跳出系統數字鍵（沒有負號），所以觸控裝置把溫度欄設成唯讀，只用 App 鍵盤輸入
  const RO = TOUCH ? ' readonly' : '';
  const KP = {
    el: null, inp: null, start: '', fresh: false,
    build() {
      const k = document.createElement('div');
      k.id = 'kp'; k.hidden = true;
      const lab = { del: '⌫', neg: '−', clr: '清除', next: '下一格' };
      k.innerHTML = `<div class="kp-head"><span id="kplabel"></span><button data-k="hide" aria-label="收起鍵盤">完成 ⌄</button></div>
        <div class="kp-keys">${['7', '8', '9', 'del', '4', '5', '6', 'neg', '1', '2', '3', '.', '0', 'clr', 'next']
          .map((x) => `<button data-k="${x}" class="k-${x === '.' ? 'dot' : x}${/\d/.test(x) ? ' num' : ''}">${lab[x] || x}</button>`).join('')}</div>`;
      // 按鍵用 pointerdown 並取消預設，輸入框才不會失去焦點
      k.addEventListener('pointerdown', (e) => { e.preventDefault(); const b = e.target.closest('[data-k]'); if (b) this.key(b.dataset.k); });
      document.body.append(k);
      this.el = k;
    },
    label(inp) {
      if (inp.matches('[data-t]')) {
        const f = fridgeById(inp.closest('.fcard').dataset.fid), sl = slotById(inp.closest('.srow').dataset.sid);
        return `${f ? f.name : ''}・${sl ? sl.name : ''}`;
      }
      if (inp.id === 'xrt') return '複測溫度';
      return inp.dataset.f === 'lo' ? '下限溫度' : '上限溫度';
    },
    show(inp) {
      if (!this.el) this.build();
      if (this.inp && this.inp !== inp) { this.commit(); this.inp.classList.remove('kp-on'); }
      if (this.inp === inp) return;
      this.inp = inp; this.start = inp.value; this.fresh = true;
      inp.classList.add('kp-on');
      $('#kplabel', this.el).textContent = this.label(inp) + '（°C）';
      $('[data-k=next]', this.el).textContent = inp.matches('[data-t]') ? '下一格' : '完成';
      this.el.hidden = false;
      document.body.classList.add('kp-open');
      document.documentElement.style.setProperty('--kph', this.el.offsetHeight + 'px');
      setTimeout(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    },
    hide() {
      if (this.inp) { this.commit(); this.inp.classList.remove('kp-on'); }
      if (this.el) this.el.hidden = true;
      document.body.classList.remove('kp-open');
      this.inp = null;
    },
    set(v) { this.inp.value = v; this.inp.dispatchEvent(new Event('input', { bubbles: true })); },
    commit() {
      const inp = this.inp;
      if (inp && inp.value !== this.start) { this.start = inp.value; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    },
    key(k) {
      const inp = this.inp; if (!inp) return;
      if (k === 'hide') { this.hide(); return; }
      if (k === 'next') {
        if (!inp.matches('[data-t]') || !document.contains(inp)) { this.hide(); return; }
        const all = $$('[data-t]'), nx = all[all.indexOf(inp) + 1];
        this.commit();
        // 超溫會跳出處置視窗，這時先收起鍵盤
        setTimeout(() => { if ($('.modal')) this.hide(); else if (nx) this.show(nx); else this.hide(); }, 80);
        return;
      }
      const cur = inp.value;
      let v = this.fresh ? '' : cur;
      if (k === 'clr') v = '';
      else if (k === 'del') v = cur.slice(0, -1);
      else if (k === 'neg') v = cur.startsWith('-') ? cur.slice(1) : '-' + cur;
      else if (k === '.') { if (v.includes('.')) return; v = (v === '' || v === '-' ? v + '0' : v) + '.'; }
      else { if (/\.\d$/.test(v) || (!v.includes('.') && v.replace('-', '').length >= 3)) return; v += k; }
      this.fresh = false;
      this.set(v);
    },
  };
  if (TOUCH) {
    // 點溫度欄 → 開 App 鍵盤；點鍵盤以外的地方 → 儲存並收起
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-kp]');
      if (t) { e.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); KP.show(t); }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!KP.inp || (e.target.closest && e.target.closest('#kp, [data-kp], [data-act=sign]'))) return;
      KP.hide();
    }, true);
    window.addEventListener('hashchange', () => KP.hide());
  }

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
        const r = indexedDB.open('fridgetemp', 1);
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
    if (db.me) db.meAct = lastAct;
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
  // 依「食品良好衛生規範準則」：冷藏 7°C 以下、冷凍 -18°C 以下；熱藏 60°C 以上
  // 下限是實務建議：冷藏低於 0°C 食材會結凍，冷凍低於 -25°C 多半是溫控異常
  const TYPES = {
    chill: { n: '冷藏', lo: 0, hi: 7 },
    freeze: { n: '冷凍', lo: -25, hi: -18 },
    hot: { n: '熱藏', lo: 60, hi: null },
    other: { n: '其他', lo: null, hi: null },
  };
  const ACTIONS = ['調整溫控設定', '關緊冰箱門／檢查門封條', '減少開門次數', '食材移至其他冰箱', '報廢受影響食材', '除霜／清潔散熱口', '通知廠商維修', '剛補貨或開門頻繁，稍後複測'];
  const blank = () => ({ ver: 1, shop: '', shopAt: 0, fridges: [], slots: [], slotsAt: 0, staff: [], staffAt: 0, team: { on: false, idle: 0, people: {} }, teamAt: 0, recs: {}, createdAt: Date.now(), seedAt: 0 });
  function seed() {
    const d = blank(), now = Date.now();
    d.seedAt = now; d.slotsAt = now;
    d.fridges = [
      { name: '冷藏冰箱 1', type: 'chill' }, { name: '冷藏冰箱 2', type: 'chill' }, { name: '冷凍冰箱 1', type: 'freeze' },
    ].map((x, i) => ({ id: uid() + i, name: x.name, type: x.type, area: '', lo: TYPES[x.type].lo, hi: TYPES[x.type].hi, off: false, deleted: false, ord: i + 1, at: now }));
    d.slots = [{ id: 's1', name: '早', time: '09:00', deleted: false }, { id: 's2', name: '晚', time: '17:00', deleted: false }];
    return d;
  }
  function normFridge(x, i) {
    const type = TYPES[x.type] ? x.type : 'other';
    return {
      id: String(x.id), name: String(x.name ?? '').trim(), type, area: String(x.area ?? '').trim(),
      lo: numOrNull(x.lo), hi: numOrNull(x.hi), off: !!x.off, deleted: !!x.deleted,
      ord: num(x.ord) || i + 1, at: num(x.at) || 1,
    };
  }
  function normSlots(list) {
    return (Array.isArray(list) ? list : []).filter((s) => s && s.id).map((s) => ({
      id: String(s.id), name: String(s.name || '').trim() || '未命名', time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '', deleted: !!s.deleted,
    }));
  }
  function normRec(e) {
    return {
      t: numOrNull(e.t), ts: String(e.ts || ''), by: String(e.by || ''), act: String(e.act || ''), rt: numOrNull(e.rt),
      x: e.x ? 1 : 0, at: num(e.at) || 1,
    };
  }
  function norm(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.fridges)) throw new Error('不是冰箱溫度記錄表的資料');
    d.ver = 1;
    d.shop = String(d.shop || ''); d.shopAt = num(d.shopAt);
    d.seedAt = num(d.seedAt);
    d.fridges = d.fridges.filter((x) => x && x.id).map(normFridge);
    sortFridges(d);
    d.slots = normSlots(d.slots); d.slotsAt = num(d.slotsAt);
    d.staff = (Array.isArray(d.staff) ? d.staff : []).map((s) => String(s).trim()).filter(Boolean); d.staffAt = num(d.staffAt);
    d.recs = d.recs && typeof d.recs === 'object' ? d.recs : {};
    for (const [k, v] of Object.entries(d.recs)) {
      if (!validYmd(k) || !v || typeof v !== 'object') { delete d.recs[k]; continue; }
      for (const [fid, ss] of Object.entries(v)) {
        if (!ss || typeof ss !== 'object') { delete v[fid]; continue; }
        for (const [sid, e] of Object.entries(ss)) { if (!e) delete ss[sid]; else ss[sid] = normRec(e); }
      }
    }
    if (d.cloud && typeof d.cloud === 'object') {
      const c = d.cloud;
      d.cloud = { url: String(c.url || ''), pw: String(c.pw || ''), rev: num(c.rev), pushedAt: num(c.pushedAt), on: !!c.on, lastOk: num(c.lastOk), sheet: /^https:\/\/docs\.google\.com\//.test(c.sheet || '') ? String(c.sheet) : '' };
    } else delete d.cloud;
    d.team = normTeam(d.team); d.teamAt = num(d.teamAt);
    d.me = String(d.me || ''); d.meOk = String(d.meOk || ''); d.meAct = num(d.meAct);
    return d;
  }
  function sortFridges(d) { d.fridges.sort((a, b) => a.ord - b.ord); }
  const fridgeById = (id) => db.fridges.find((x) => x.id === id);
  const liveFridges = () => db.fridges.filter((x) => !x.deleted);
  const activeFridges = () => db.fridges.filter((x) => !x.deleted && !x.off);
  const liveSlots = () => db.slots.filter((s) => !s.deleted).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
  const slotById = (id) => db.slots.find((s) => s.id === id);
  const now = () => Date.now();
  const recOf = (d, fid, sid) => { const v = db.recs[d]; return v && v[fid] ? v[fid][sid] : undefined; };
  const hasT = (e) => !!e && e.t != null;
  function setRec(d, fid, sid, patch) {
    const v = db.recs[d] || (db.recs[d] = {});
    const f = v[fid] || (v[fid] = {});
    const e = f[sid] || (f[sid] = { t: null, ts: '', by: '', act: '', rt: null, x: 0, at: 0 });
    Object.assign(e, patch, { at: now() });
    return e;
  }
  // 依設備目前的標準範圍重新判斷正常／異常（範圍改了，在範圍內的舊紀錄也要顯示正常）；回傳變動筆數
  function recheckRecs(f) {
    let n = 0;
    const t = now();
    for (const v of Object.values(db.recs)) {
      const ss = v[f.id]; if (!ss) continue;
      for (const e of Object.values(ss)) {
        if (!hasT(e)) continue;
        const x = isBad(f, e.t) ? 1 : 0;
        if (e.x !== x) { e.x = x; e.at = t; n++; }
      }
    }
    return n;
  }
  // 下限、上限填反了（例如冷凍填成 下限 -18、上限 -25）也照「較低～較高」判斷
  function bounds(f) {
    let lo = f.lo, hi = f.hi;
    if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
    return { lo, hi };
  }
  function isBad(f, t) {
    if (t == null || !f) return false;
    const { lo, hi } = bounds(f);
    return (lo != null && t < lo) || (hi != null && t > hi);
  }
  // 把填反的下限／上限對調存回去；回傳是否有改
  function fixSwapped(f) {
    if (f.lo == null || f.hi == null || f.lo <= f.hi) return false;
    [f.lo, f.hi] = [f.hi, f.lo];
    f.at = now();
    return true;
  }
  function rangeText(f) {
    f = bounds(f);
    if (f.lo != null && f.hi != null) return `${f.lo}～${f.hi}°C`;
    if (f.hi != null) return `${f.hi}°C 以下`;
    if (f.lo != null) return `${f.lo}°C 以上`;
    return '未設定';
  }
  const typeName = (f) => (TYPES[f.type] || TYPES.other).n;
  // 區域（例如 車前、車後）：依該區第一台設備的排序決定先後；沒填的歸到「未分區」
  const NO_AREA = '未分區';
  const areaOf = (f) => f.area || NO_AREA;
  const hasAreas = (list = liveFridges()) => list.some((f) => f.area);
  function byArea(list) {
    const m = new Map();
    for (const f of list) { const a = areaOf(f); if (!m.has(a)) m.set(a, []); m.get(a).push(f); }
    return [...m];
  }
  // 這個時段某天有哪些冰箱要記錄（停用的不算；當天已有紀錄的仍顯示）
  function fridgesFor(d) {
    const v = db.recs[d] || {};
    return liveFridges().filter((f) => !f.off || Object.values(v[f.id] || {}).some(hasT));
  }
  function slotsFor(d) {
    const v = db.recs[d] || {};
    const used = new Set(); Object.values(v).forEach((ss) => Object.entries(ss).forEach(([sid, e]) => { if (hasT(e)) used.add(sid); }));
    return db.slots.filter((s) => !s.deleted || used.has(s.id)).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
  }
  const dueSlot = (s, d) => d < today() || (d === today() && s.time && s.time <= hm());
  function dayStats(d) {
    const fs = fridgesFor(d), ss = slotsFor(d);
    let done = 0, due = 0, bad = 0, open = 0, total = 0;
    const missing = [];
    for (const s of ss) {
      for (const f of fs) {
        if (s.deleted && !hasT(recOf(d, f.id, s.id))) continue;
        total++;
        const e = recOf(d, f.id, s.id);
        if (hasT(e)) { done++; if (e.x) { bad++; if (!e.act.trim()) open++; } }
        else if (dueSlot(s, d)) { due++; missing.push([s, f]); }
      }
    }
    return { done, due, bad, open, total, missing };
  }

  // ------------------------------------------------------------------ 員工 PIN 碼與權限分級
  // db.team = { on, idle（閒置幾分鐘自動登出，0＝不登出）, people: { 姓名: { h: PIN 雜湊, r: 'admin' 主管 | 'staff' 員工 } } }
  // 啟用後：記錄前要用 PIN 碼登入（防代簽）；員工只能記錄、修改自己今天／昨天的紀錄；設定頁只有主管能進
  // db.me：這台裝置目前的記錄人；db.meOk：用 PIN 登入的人；db.meAct：最後操作時間（這三個都不同步）
  const IDLE_OPTS = [0, 5, 15, 30, 60];
  function normTeam(t) {
    t = t && typeof t === 'object' ? t : {};
    const people = {};
    for (const [n, p] of Object.entries(t.people && typeof t.people === 'object' ? t.people : {})) {
      if (!String(n).trim() || !p || typeof p !== 'object') continue;
      people[String(n).trim()] = { h: /^[0-9a-f]{64}$/.test(p.h) ? p.h : '', r: p.r === 'admin' ? 'admin' : 'staff' };
    }
    return { on: !!t.on, idle: IDLE_OPTS.includes(+t.idle) ? +t.idle : 0, people };
  }
  const person = (n) => db.team.people[n] || { h: '', r: 'staff' };
  const isAdminName = (n) => !!n && db.staff.includes(n) && person(n).r === 'admin' && !!person(n).h;
  const teamOn = () => db.team.on && db.staff.some(isAdminName);
  const loggedIn = () => !teamOn() || (!!db.me && db.meOk === db.me && db.staff.includes(db.me) && !!person(db.me).h);
  const isAdmin = () => !teamOn() || (loggedIn() && person(db.me).r === 'admin');
  // 回傳不能修改的原因（'' 表示可以；'login' 表示要先登入）
  function lockReason(date, e) {
    if (!teamOn()) return '';
    if (!loggedIn()) return 'login';
    if (isAdmin()) return '';
    if (date < addD(today(), -1)) return '員工只能記錄今天和昨天，較早的紀錄請主管修改';
    if (hasT(e) && e.by && e.by !== db.me) return `這筆是 ${e.by} 記錄的，只能由本人或主管修改`;
    return '';
  }
  async function pinHash(name, pin) {
    if (!(window.crypto && crypto.subtle)) throw new Error('這個瀏覽器不支援 PIN 碼加密，請改用 https 網址開啟');
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fridgetemp|${name}|${pin}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const setTeam = () => { db.teamAt = now(); save(); };
  function logout(msg) { db.me = ''; db.meOk = ''; save(); refresh(); if (msg) toast(msg, 4000); }

  // PIN 數字鍵視窗；verify(pin) 回傳 true＝通過，字串＝錯誤訊息
  function pinPad({ title, sub = '', verify }) {
    return new Promise((res) => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="dlg pindlg" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
        <div class="pindots"></div><div class="pinmsg"></div>
        <div class="pinkeys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map((k) => `<button type="button" data-p="${k}" class="${k === 'ok' ? 'primary' : ''}">${k === 'back' ? '⌫' : k === 'ok' ? '確定' : k}</button>`).join('')}</div>
        <button type="button" class="btn pincancel" data-p="cancel">取消</button>
      </div>`;
      let v = '', busy = false;
      const dots = $('.pindots', m), msg = $('.pinmsg', m), dlg = $('.dlg', m);
      const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, v.length) }, (_, i) => `<i class="${i < v.length ? 'on' : ''}"></i>`).join(''); };
      const close = (r) => { m.remove(); document.removeEventListener('keydown', kd, true); res(r); };
      const press = async (k) => {
        if (busy) return;
        if (k === 'cancel') return close(null);
        if (k === 'back') v = v.slice(0, -1);
        else if (k === 'ok') {
          if (v.length < 4) { msg.textContent = '請輸入 4～6 位數字'; return; }
          busy = true;
          let r;
          try { r = await verify(v); } catch (e) { r = e.message; }
          busy = false;
          if (r === true) return close(v);
          msg.textContent = typeof r === 'string' ? r : 'PIN 碼錯誤';
          dlg.classList.remove('shake'); void dlg.offsetWidth; dlg.classList.add('shake');
          v = '';
        } else if (v.length < 6) { v += k; msg.textContent = ''; }
        draw();
      };
      m.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) press(b.dataset.p); else if (e.target === m) close(null); });
      const kd = (e) => {
        if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back'); else if (e.key === 'Enter') press('ok'); else if (e.key === 'Escape') press('cancel'); else return;
        e.preventDefault(); e.stopPropagation();
      };
      document.addEventListener('keydown', kd, true);
      draw(); document.body.append(m);
    });
  }
  // 登入：點自己的名字 → 輸入 PIN 碼。錯 5 次要等 30 秒
  let pinFails = 0, pinLockUntil = 0;
  function loginDialog({ adminOnly = false } = {}) {
    return new Promise((res) => {
      KP.hide();
      const names = db.staff.filter((n) => person(n).h && (!adminOnly || isAdminName(n)));
      const noPin = db.staff.filter((n) => !person(n).h);
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
        <h3>${adminOnly ? '🔒 主管登入' : '👤 誰在記錄？'}</h3>
        <p class="muted small">${adminOnly ? '請主管點自己的名字並輸入 PIN 碼。' : '點自己的名字，再輸入 PIN 碼登入。'}</p>
        <div class="whogrid">${names.map((n) => `<button type="button" class="who-b" data-n="${esc(n)}"><b>${esc([...n][0])}</b><span>${esc(n)}</span>${isAdminName(n) ? '<small>主管</small>' : ''}</button>`).join('') || '<p class="muted">沒有可以登入的人</p>'}</div>
        ${!adminOnly && noPin.length ? `<p class="muted small">還沒設定 PIN 碼：${noPin.map(esc).join('、')}（請主管到「設定」設定）</p>` : ''}
        <div class="btns"><button type="button" class="btn" data-n="">取消</button></div></div>`;
      m.onclick = async (e) => {
        const b = e.target.closest('[data-n]');
        if (!b && e.target !== m) return;
        m.remove();
        const n = b ? b.dataset.n : '';
        if (!n) return res(false);
        const ok = await pinPad({
          title: `${n}，請輸入 PIN 碼`,
          verify: async (pin) => {
            if (Date.now() < pinLockUntil) return `錯誤太多次，請 ${Math.ceil((pinLockUntil - Date.now()) / 1000)} 秒後再試`;
            if (await pinHash(n, pin) === person(n).h) { pinFails = 0; return true; }
            if (++pinFails >= 5) { pinFails = 0; pinLockUntil = Date.now() + 30000; return '錯誤 5 次，請 30 秒後再試'; }
            return `PIN 碼錯誤（還可以再試 ${5 - pinFails} 次）`;
          },
        });
        if (!ok) return res(false);
        db.me = n; db.meOk = n; lastAct = Date.now(); save();
        toast(`${n} 已登入${isAdminName(n) ? '（主管）' : ''}`);
        refresh(); res(true);
      };
      document.body.append(m);
    });
  }
  async function setPinDialog(n) {
    const p1 = await pinPad({ title: `設定「${n}」的 PIN 碼`, sub: '輸入 4～6 位數字，登入時使用', verify: async () => true });
    if (!p1) return false;
    const p2 = await pinPad({ title: '再輸入一次確認', verify: async (p) => p === p1 || '兩次輸入不一樣，請再輸入一次' });
    if (!p2) return false;
    db.team.people[n] = { ...person(n), h: await pinHash(n, p1) };
    setTeam();
    return true;
  }
  // 閒置自動登出
  let lastAct = Date.now();
  function checkIdle() {
    if (!db || !teamOn() || !db.team.idle || !db.meOk) return false;
    if (Date.now() - lastAct <= db.team.idle * 60000) return false;
    logout(`閒置超過 ${db.team.idle} 分鐘，已自動登出`);
    return true;
  }
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { checkIdle(); lastAct = Date.now(); }, true));
  setInterval(checkIdle, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkIdle(); });

  // ------------------------------------------------------------------ 冰箱 QR Code：掃描後直接打開那台冰箱的記錄
  const PUBLIC_URL = window.FRIDGE_APP_URL || 'https://wu8858009.github.io/fridge-temp/';
  const appUrl = () => (!DESK && location.protocol === 'https:' ? location.origin + location.pathname.replace(/index\.html$/, '') : PUBLIC_URL);
  const qrUrl = (fid) => `${appUrl()}#/q/${fid}`;
  const qrFid = (s) => { const m = /#\/q\/([\w-]+)/.exec(String(s)); return m ? m[1] : ''; };
  let pendingFid = '';
  function openFridge(fid) {
    const d = today();
    if (cur.view !== 'day' || cur.date !== d) { pendingFid = fid; location.hash = '#/day/' + d; return; }
    focusFridge(fid);
  }
  function focusFridge(fid) {
    const f = fridgeById(fid);
    const card = $(`.fcard[data-fid="${fid}"]`);
    if (!f || !card) return toast('找不到這台設備（可能已停用或刪除）', 3500);
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    if (teamOn() && !loggedIn()) { loginDialog().then((ok) => ok && setTimeout(() => focusFridge(fid), 120)); return; }
    // 打開第一個還沒記錄的時段（先找已經到時間的）
    const rows = $$('.srow', card).filter((r) => !r.classList.contains('has'));
    const r = rows.find((x) => $('.pill.miss', x)) || rows[0];
    const inp = r && $('[data-t]:not([data-lock])', r);
    if (!inp) return toast(`${f.name}：今天的時段都記錄好了`);
    setTimeout(() => { if (TOUCH) KP.show(inp); else inp.focus(); }, 400);
  }
  const canScan = () => !DESK && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  async function scanDialog() {
    if (!canScan()) return toast('這台裝置不能用相機掃描');
    try { await loadJs('vendor/jsQR.min.js'); } catch (e) { return toast(e.message); }
    KP.hide();
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="dlg scandlg" role="dialog" aria-modal="true"><h3>📷 掃描冰箱 QR Code</h3>
      <div class="scanbox"><video playsinline muted autoplay></video><i class="scanframe"></i></div>
      <p class="muted" id="scanmsg">把冰箱上的 QR Code 對準框框</p>
      <div class="btns"><button type="button" class="btn" data-k="x">取消</button></div></div>`;
    document.body.append(m);
    const video = $('video', m), cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    let stream = null, raf = 0, done = false;
    const stop = () => { done = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); m.remove(); };
    m.onclick = (e) => { if (e.target.closest('[data-k=x]') || e.target === m) stop(); };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) {
      stop();
      return toast(e.name === 'NotAllowedError' ? '沒有相機權限：請到手機「設定」允許這個 App 使用相機' : '無法開啟相機：' + e.message, 5000);
    }
    if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    video.play().catch(() => {});
    const tick = () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = 480, h = Math.round(video.videoHeight / video.videoWidth * w);
        cv.width = w; cv.height = h;
        cx.drawImage(video, 0, 0, w, h);
        const r = window.jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (r && r.data) {
          const fid = qrFid(r.data), f = fridgeById(fid);
          if (f && !f.deleted) { stop(); if (navigator.vibrate) navigator.vibrate(60); toast(`📷 ${f.name}`); openFridge(fid); return; }
          $('#scanmsg', m).textContent = '這不是這家店的冰箱 QR Code';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // QR Code 標籤頁（列印後貼在冰箱上）
  const qrv = { per: 8 };
  function qrSvg(text) {
    const q = window.qrcode(0, 'M');
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  function qrLabel(f) {
    return `<div class="qrl"><div class="qrl-top">${esc(db.shop || '冰箱溫度記錄表')}</div>
      <div class="qrl-body"><div class="qrl-info"><b>${esc(f.name || '未命名')}</b>
        <span>${f.area ? `📍 ${esc(f.area)}・` : ''}${typeName(f)}</span><span>標準 ${esc(rangeText(f))}</span>
        <small>用 App「📷 掃描冰箱」或手機相機掃描，直接記錄溫度</small></div>
        <div class="qrl-qr">${qrSvg(qrUrl(f.id))}</div></div></div>`;
  }
  function qrPagesHtml(per) {
    const fs = liveFridges().filter((f) => !f.off);
    const list = hasAreas(fs) ? byArea(fs).flatMap(([, l]) => l) : fs;
    const pages = [];
    for (let i = 0; i < list.length; i += per) pages.push(`<article class="qrpage p${per}">${list.slice(i, i + per).map(qrLabel).join('')}</article>`);
    return pages;
  }
  async function viewQr(el) {
    el.innerHTML = '<p class="empty">載入中…</p>';
    try { await loadJs('vendor/qrcode.min.js'); } catch (e) { el.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    if (cur.view !== 'qr') return;
    const pages = qrPagesHtml(qrv.per);
    el.innerHTML = `
      <div class="page-head no-print">
        <button class="btn" data-act="back">◀ 回設定</button><h2>冰箱 QR Code 標籤</h2><div class="sp"></div>
        <button class="btn primary" data-act="print" ${pages.length ? '' : 'disabled'}>🖨 列印 / 存 PDF</button>
      </div>
      <div class="filters no-print"><div class="seg">${[[8, '每頁 8 張（小）'], [4, '每頁 4 張（大）']].map(([k, t]) => `<button class="${qrv.per === k ? 'on' : ''}" data-per="${k}">${t}</button>`).join('')}</div></div>
      <p class="hint no-print">印出來沿虛線剪下，貼在每台冰箱門上。掃描後會直接打開那台冰箱今天的記錄；${teamOn() ? '還沒登入會先要求輸入 PIN 碼。' : '建議用 App 裡的「📷 掃描冰箱」，資料才會記在同一個 App 裡。'}停用的設備不會印出。</p>
      ${pages.length ? `<div class="qrpages">${pages.join('')}</div>` : '<p class="empty">沒有可以列印的設備。</p>'}`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-act],[data-per]'); if (!b) return;
      if (b.dataset.per) { qrv.per = +b.dataset.per; viewQr(el); return; }
      if (b.dataset.act === 'back') location.hash = '#/settings';
      else if (b.dataset.act === 'print') {
        if (!DESK && !IS_MOBILE) return window.print();
        deliverPdf(() => htmlToPdf(qrPagesHtml(qrv.per), fname(`${db.shop ? db.shop + '_' : ''}冰箱QRCode標籤.pdf`)));
      }
    };
  }

  // ------------------------------------------------------------------ 路由
  const cur = { view: '', date: today() };
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    // 掃 QR Code 開進來（#/q/設備ID）：換成今天的每日記錄，再打開那台冰箱
    if (h[0] === 'q') { pendingFid = h[1] || ''; history.replaceState(null, '', '#/day/' + today()); return route(); }
    const v = ['day', 'month', 'chart', 'settings', 'qr'].includes(h[0]) ? h[0] : 'day';
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === (v === 'qr' ? 'settings' : v)));
    $('#tt').hidden = true;
    const el = $('#app');
    el.onclick = el.oninput = el.onchange = el.onkeydown = el.onfocusin = null;
    if (cur.view !== v) el.scrollTop = 0;
    cur.view = v;
    document.body.dataset.view = v;
    if (v === 'month') viewMonth(el, validYm(h[1] || '') ? h[1] : today().slice(0, 7), h[2] || 'all');
    else if (v === 'chart') viewChart(el);
    else if (v === 'settings') viewSettings(el);
    else if (v === 'qr') viewQr(el);
    else viewDay(el, validYmd(h[1] || '') ? h[1] : today());
    updateDot();
    if (v === 'day' && pendingFid) { const f = pendingFid; pendingFid = ''; setTimeout(() => focusFridge(f), 80); }
  }
  function renderShop() {
    $('#shop').textContent = db.shop || '冰箱溫度記錄表';
    document.title = (db.shop ? db.shop + ' · ' : '') + '冰箱溫度記錄表系統';
    try { localStorage.setItem('fridgetemp-shop', db.shop || ''); } catch (e) { /* 無痕模式 */ }
  }
  // 啟動動畫：載入完成後淡出，至少顯示 1.6 秒讓動畫跑完
  function hideSplash() {
    const s = $('#splash'); if (!s) return;
    setTimeout(() => { s.classList.add('out'); setTimeout(() => s.remove(), 700); }, Math.max(0, 1600 - performance.now()));
  }
  // 導覽列紅點：今天已到時間但還沒記錄，或有異常未處置
  function updateDot() {
    if (!db) return;
    const s = dayStats(today());
    const dot = $('#navdot');
    dot.hidden = !(s.due || s.open);
    dot.title = [s.due ? `今天還有 ${s.due} 筆未記錄` : '', s.open ? `${s.open} 筆異常待處置` : ''].filter(Boolean).join('、');
  }
  setInterval(() => { updateDot(); if (cur.view === 'day' && cur.date === today() && !$('#app').contains(document.activeElement)) renderBanner(); }, 60000);

  // ------------------------------------------------------------------ 每日記錄
  const kpi = (l, v, s = '', cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  // 啟用 PIN 碼時，記錄人改成「登入／切換／登出」
  function whoBox() {
    const ok = loggedIn();
    return `<div class="me who${ok ? '' : ' need'}"><span class="who-n">👤 ${ok ? `<b>${esc(db.me)}</b>${isAdminName(db.me) ? '<small class="role">主管</small>' : '<small class="role staff">員工</small>'}` : '<b>尚未登入</b>'}</span>
      <button class="btn${ok ? '' : ' primary'}" data-act="login">${ok ? '切換' : '🔑 登入'}</button>${ok ? '<button class="btn" data-act="logout">登出</button>' : ''}</div>`;
  }
  function staffOptions() {
    const names = [...new Set([...db.staff, ...(db.me ? [db.me] : [])])];
    return names.map((n) => `<option value="${esc(n)}">`).join('');
  }
  function viewDay(el, date) {
    cur.date = date;
    const fs = fridgesFor(date), ss = slotsFor(date);
    const wd = pd(date).getDay();
    const isToday = date === today();
    el.innerHTML = `
      <div class="page-head">
        <div class="datebar">
          <button class="btn icon" data-act="prev" title="前一天">◀</button>
          <input type="date" id="date" value="${date}" max="${today()}">
          <span class="wd${wd % 6 === 0 ? ' we' : ''}">週${WD[wd]}${isToday ? '・今天' : ''}</span>
          <button class="btn icon" data-act="next" title="後一天" ${isToday ? 'disabled' : ''}>▶</button>
          ${isToday ? '' : '<button class="btn" data-act="today">回今天</button>'}
        </div>
        ${teamOn() ? whoBox() : `<label class="me${db.me ? '' : ' need'}">記錄人<input id="me" list="stafflist" value="${esc(db.me)}" placeholder="選擇或輸入姓名" autocomplete="off"></label>
        <datalist id="stafflist">${staffOptions()}</datalist>`}
      </div>
      <div id="banner"></div>
      <div class="kpis" id="daykpi"></div>
      ${!fs.length ? '<p class="empty">還沒有冰箱設備，請到「⚙️ 設定」新增。</p>' : !ss.length ? '<p class="empty">還沒有記錄時段，請到「⚙️ 設定」新增（例如：早 09:00、晚 17:00）。</p>' : `
      ${(hasAreas(fs) ? byArea(fs) : [['', fs]]).map(([area, list]) => `
      ${area ? `<h3 class="areah">📍 ${esc(area)}<small>${list.length} 台</small></h3>` : ''}
      <div class="fridges">${list.map((f) => `
        <section class="fcard t-${f.type}" data-fid="${f.id}">
          <div class="fhead"><span class="ficon">${f.type === 'freeze' ? '❄️' : f.type === 'hot' ? '🔥' : '🧊'}</span>
            <div class="fname"><b>${esc(f.name || '未命名')}</b>${f.off ? '<small class="tag">停用</small>' : ''}<small>${typeName(f)}・標準 ${esc(rangeText(f))}</small></div></div>
          ${ss.map((s) => slotRow(date, f, s)).join('')}
        </section>`).join('')}
      </div>`).join('')}`}
      <p class="hint">輸入溫度會自動儲存並記下記錄人與時間。冷凍溫度記得按「±」或直接打負號（例如 -18）。超出標準會要求填寫異常處置。${canScan() && fs.length ? '<br>冰箱貼上 QR Code（到「⚙️ 設定」列印）後，按右下角「📷 掃描冰箱」就能直接跳到那台。' : ''}</p>
      ${canScan() && fs.length ? '<button class="fab no-print" data-act="scan">📷 掃描冰箱</button>' : ''}`;
    const go = (s) => { location.hash = '#/day/' + s; };
    renderBanner(); renderDayKpi();
    el.onclick = (e) => {
      const lk = e.target.closest('[data-lock]') || (e.target.closest('[data-act=sign]') && $('[data-lock]', e.target.closest('.srow')));
      if (lk) { const r = lk.dataset.lock; if (r === 'login') loginDialog(); else toast(r, 3500); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'login') { loginDialog(); return; }
      if (a === 'logout') { logout('已登出'); return; }
      if (a === 'scan') { scanDialog(); return; }
      if (a === 'act' && !loggedIn()) { loginDialog(); return; }
      if (a === 'prev') go(addD(date, -1));
      else if (a === 'next') { if (!isToday) go(addD(date, 1)); }
      else if (a === 'today') go(today());
      else if (a === 'sign') {
        const inp = $('[data-t]', b.closest('.srow'));
        const v = inp.value.trim();
        inp.value = v.startsWith('-') ? v.slice(1) : '-' + v;
        if (KP.inp === inp) { KP.start = inp.value; KP.fresh = false; }
        if (inp.value === '-') { if (TOUCH) KP.show(inp); else inp.focus(); return; }
        commitTemp(inp, true);
      } else if (a === 'act') {
        const r = b.closest('.srow');
        actionDialog(date, r.closest('.fcard').dataset.fid, r.dataset.sid);
      } else if (a === 'gomiss') {
        const inp = $(`.fcard[data-fid="${b.dataset.fid}"] .srow[data-sid="${b.dataset.sid}"] [data-t]`, el);
        if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
      }
    };
    el.oninput = (e) => {
      const t = e.target;
      if (t.matches('[data-t]')) commitTemp(t, false);
      else if (t.id === 'me') { db.me = t.value.trim(); db.meOk = ''; t.closest('.me').classList.toggle('need', !db.me); save(); }
    };
    el.onchange = (e) => {
      const t = e.target;
      if (t.id === 'date' && validYmd(t.value)) go(t.value > today() ? today() : t.value);
      else if (t.matches('[data-t]')) commitTemp(t, true);
    };
    el.onfocusin = (e) => { if (e.target.matches('[data-t]')) setTimeout(() => e.target.select(), 0); };
    el.onkeydown = (e) => {
      if (!e.target.matches('[data-t]')) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = $$('[data-t]', el);
        const i = all.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1);
        if (all[i]) all[i].focus(); else e.target.blur();
      }
    };
  }
  function slotRow(date, f, s) {
    const e = recOf(date, f.id, s.id);
    const has = hasT(e);
    const st = !has ? (dueSlot(s, date) ? '<span class="pill miss">未記錄</span>' : '<span class="pill">—</span>')
      : e.x ? `<span class="pill bad">異常</span>` : '<span class="pill ok">正常</span>';
    const meta = has ? `${esc(e.by || '未填記錄人')}・${esc(tsText(e.ts, date))}` : '';
    const lock = lockReason(date, e);
    const act = has && e.x ? `<button class="actbox${e.act.trim() ? '' : ' open'}" data-act="act">${e.act.trim() ? `處置：${esc(e.act)}${e.rt != null ? `<br>複測 ${deg(e.rt)}${isBad(f, e.rt) ? '（仍異常）' : ''}` : ''}` : '⚠ 尚未填寫異常處置，點這裡填寫'}</button>` : '';
    return `<div class="srow${has ? ' has' : ''}${has && e.x ? ' x' : ''}${lock ? ' locked' : ''}" data-sid="${s.id}">
      <div class="slot"><b>${esc(s.name)}</b><small>${esc(s.time || '')}</small></div>
      <div class="tin"><button class="btn icon sign" data-act="sign" tabindex="-1" title="正負號">±</button><input data-t type="text" inputmode="${IM}" ${lock ? `readonly data-lock="${esc(lock)}"` : `data-kp${RO}`} autocomplete="off" value="${has ? t1(e.t) : ''}" placeholder="${f.type === 'freeze' ? '-18' : f.type === 'hot' ? '65' : '4'}" aria-label="${esc(f.name)} ${esc(s.name)} 溫度"><span class="unit">°C</span></div>
      <div class="st">${st}</div>
      <div class="meta">${meta}</div>
      ${act}
    </div>`;
  }
  function tsText(ts, date) {
    if (!ts) return '';
    return ts.slice(0, 10) === date ? ts.slice(11) : `補登 ${md(ts.slice(0, 10))} ${ts.slice(11)}`;
  }
  // 解析溫度：接受 -18、－18、−18、18.5
  function parseTemp(s) {
    s = String(s).trim().replace(/[−－﹣]/g, '-').replace(/[。．]/g, '.').replace(/°c?|度/gi, '');
    if (s === '' || s === '-') return { empty: true };
    if (!/^-?\d{1,3}(\.\d*)?$/.test(s)) return { bad: true };
    const t = parseFloat(s);
    if (t < -60 || t > 120) return { bad: true };
    return { t: Math.round(t * 10) / 10 };
  }
  function commitTemp(inp, final) {
    const row = inp.closest('.srow'), card = row.closest('.fcard');
    const date = cur.date, fid = card.dataset.fid, sid = row.dataset.sid;
    const f = fridgeById(fid);
    if (lockReason(date, recOf(date, fid, sid))) return;
    const p = parseTemp(inp.value);
    inp.classList.toggle('warn', !!p.bad);
    if (p.bad) { if (final) toast('溫度格式不對，例如 4、-18、3.5'); return; }
    const e = recOf(date, fid, sid);
    if (p.empty) {
      if (!final && inp.value.trim() === '-') return;
      if (hasT(e)) { setRec(date, fid, sid, { t: null, x: 0 }); save(); }
    } else {
      if (!final && /[.-]$/.test(inp.value.trim())) return;
      if (!hasT(e) || e.t !== p.t) {
        const x = isBad(f, p.t) ? 1 : 0;
        setRec(date, fid, sid, { t: p.t, ts: stamp(), by: db.me || (e && e.by) || '', x });
        save();
      }
      if (final && !db.me) { const m = $('#me'); if (m) m.closest('.me').classList.add('need'); toast('請在上方選擇「記錄人」'); }
    }
    const ne = recOf(date, fid, sid);
    const s = slotById(sid);
    const tmp = document.createElement('div');
    tmp.innerHTML = slotRow(date, f, s);
    const nr = tmp.firstElementChild;
    // 只換掉狀態與說明，保留輸入框（避免游標跳走）
    row.className = nr.className;
    $('.st', row).replaceWith($('.st', nr));
    $('.meta', row).replaceWith($('.meta', nr));
    const oa = $('.actbox', row), na = $('.actbox', nr);
    if (oa) oa.remove(); if (na) row.append(na);
    renderDayKpi(); renderBanner(); updateDot();
    if (final && hasT(ne) && ne.x && !ne.act.trim()) setTimeout(() => actionDialog(date, fid, sid), 50);
  }
  function renderDayKpi() {
    const box = $('#daykpi'); if (!box) return;
    const s = dayStats(cur.date);
    box.innerHTML = kpi('已記錄', `${s.done}<small> / ${s.total}</small>`, s.total ? `完成 ${Math.round(s.done / s.total * 100)}%` : '', 'main')
      + kpi('未記錄', s.due, '已到時間', s.due ? 'warnk' : '')
      + kpi('異常', s.bad, s.bad ? `待處置 ${s.open}` : '全部正常', s.bad ? 'badk' : '');
  }
  function renderBanner() {
    const box = $('#banner'); if (!box) return;
    const s = dayStats(cur.date);
    const parts = [];
    if (s.missing.length && cur.date === today()) {
      const by = new Map();
      s.missing.forEach(([sl, f]) => { if (!by.has(sl.id)) by.set(sl.id, [sl, []]); by.get(sl.id)[1].push(f); });
      for (const [sl, list] of by.values()) {
        parts.push(`<div class="banner warn">⏰ <b>${esc(sl.name)}（${esc(sl.time)}）</b>還有 ${list.length} 台未記錄：${list.map((f) => `<button class="lnk" data-act="gomiss" data-fid="${f.id}" data-sid="${sl.id}">${esc(f.name)}</button>`).join('、')}</div>`);
      }
    }
    if (s.open) parts.push(`<div class="banner bad">⚠ 有 ${s.open} 筆超溫紀錄尚未填寫處置</div>`);
    box.innerHTML = parts.join('');
  }

  // 異常處置對話框
  function actionDialog(date, fid, sid) {
    const f = fridgeById(fid), s = slotById(sid), e = recOf(date, fid, sid);
    if (!f || !hasT(e)) return;
    $$('.modal').forEach((m) => m.remove());
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<form class="dlg wide" role="dialog" aria-modal="true">
      <h3 class="xh">⚠ 溫度異常</h3>
      <p><b>${esc(f.name)}</b>・${md(date)} ${esc(s ? s.name : '')}：<b class="xv">${deg(e.t)}</b>，標準為 ${esc(rangeText(f))}。請記錄處理方式。</p>
      <div class="chips">${ACTIONS.map((a) => `<button type="button" class="chip" data-chip="${esc(a)}">${esc(a)}</button>`).join('')}</div>
      <label class="fl">處置說明<textarea id="xact" rows="3" placeholder="例如：調低溫控並移出部分食材，30 分鐘後複測">${esc(e.act)}</textarea></label>
      <label class="fl">複測溫度（°C，可空白）<input id="xrt" type="text" inputmode="${IM}" data-kp${RO} value="${e.rt != null ? t1(e.rt) : ''}" placeholder="${f.type === 'freeze' ? '-18' : '5'}" autocomplete="off"></label>
      <div class="btns"><button class="btn primary" type="submit">儲存處置</button><button class="btn" type="button" data-k="later">稍後再填</button></div>
    </form>`;
    const close = () => { m.remove(); if (cur.view === 'day') refresh(); };
    m.onclick = (ev) => {
      const c = ev.target.closest('[data-chip]');
      if (c) {
        const ta = $('#xact', m), v = ta.value.trim();
        if (!v.includes(c.dataset.chip)) ta.value = v ? v + '、' + c.dataset.chip : c.dataset.chip;
        c.classList.add('on'); ta.focus(); return;
      }
      if (ev.target.closest('[data-k=later]') || ev.target === m) close();
    };
    $('form', m).onsubmit = (ev) => {
      ev.preventDefault();
      const act = $('#xact', m).value.trim();
      const rtS = $('#xrt', m).value.trim();
      let rt = null;
      if (rtS) { const p = parseTemp(rtS); if (p.bad) { $('#xrt', m).classList.add('warn'); return toast('複測溫度格式不對'); } rt = p.t ?? null; }
      if (!act) { $('#xact', m).classList.add('warn'); return toast('請填寫處置說明，或按「稍後再填」'); }
      setRec(date, fid, sid, { act, rt });
      save(); close(); toast('已儲存異常處置');
    };
    m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
    document.body.append(m);
    $('#xact', m).focus();
  }

  // ------------------------------------------------------------------ 月報表（列印 / PDF / Excel）
  function monthData(ym, fid) {
    const n = daysInMonth(ym), t = today();
    const days = Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`);
    const v = (d) => db.recs[d] || {};
    let fs = liveFridges().filter((f) => !f.off || days.some((d) => Object.values(v(d)[f.id] || {}).some(hasT)));
    if (fid.startsWith('area:')) fs = fs.filter((f) => areaOf(f) === fid.slice(5));
    else if (fid !== 'all') fs = fs.filter((f) => f.id === fid);
    const used = new Set();
    days.forEach((d) => Object.values(v(d)).forEach((ss) => Object.entries(ss).forEach(([sid, e]) => { if (hasT(e)) used.add(sid); })));
    const ss = db.slots.filter((s) => !s.deleted || used.has(s.id)).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
    return {
      ym, days, slots: ss,
      sheets: fs.map((f) => {
        let done = 0, due = 0, bad = 0, sum = 0, mn = Infinity, mx = -Infinity;
        const rows = days.map((d) => {
          const cells = ss.map((s) => {
            const e = recOf(d, f.id, s.id);
            if (hasT(e)) { done++; sum += e.t; mn = Math.min(mn, e.t); mx = Math.max(mx, e.t); if (e.x) bad++; }
            if (d <= t && !s.deleted) due++;
            return { s, e: hasT(e) ? e : null };
          });
          const acts = cells.filter((c) => c.e && c.e.x).map((c) => `${c.s.name}：${c.e.act.trim() || '（未填處置）'}${c.e.rt != null ? `，複測 ${deg(c.e.rt)}` : ''}`);
          return { d, cells, acts };
        });
        return { f, rows, done, due, bad, avg: done ? sum / done : null, mn: done ? mn : null, mx: done ? mx : null };
      }),
    };
  }
  function sheetHtml(M, S) {
    const f = S.f, [y, m] = M.ym.split('-');
    const name = db.shop || '';
    return `<article class="sheet">
      <header class="sh-head">
        <h2>${esc(name)}${name ? ' ' : ''}冰箱溫度記錄表</h2>
        <div class="sh-info"><span>設備：<b>${esc(f.name)}</b>（${typeName(f)}）</span><span>標準溫度：<b>${esc(rangeText(f))}</b></span><span><b>${y}</b> 年 <b>${+m}</b> 月</span></div>
      </header>
      <table class="sh-tbl">
        <thead>
          <tr><th rowspan="2" class="c">日期</th><th rowspan="2" class="c">星期</th>${M.slots.map((s) => `<th colspan="2" class="c">${esc(s.name)}${s.time ? `<small> ${esc(s.time)}</small>` : ''}</th>`).join('')}</tr>
          <tr>${M.slots.map(() => '<th class="c">溫度</th><th class="c">記錄人</th>').join('')}</tr>
        </thead>
        <tbody>${S.rows.map((r) => {
          const wd = pd(r.d).getDay();
          return `<tr class="${wd % 6 === 0 ? 'we' : ''}"><td class="c">${+r.d.slice(8)}</td><td class="c">${WD[wd]}</td>${r.cells.map((c) => c.e
            ? `<td class="c t${c.e.x ? ' x' : ''}">${t1(c.e.t)}</td><td class="c by">${esc(c.e.by)}${c.e.ts && c.e.ts.slice(0, 10) !== r.d ? '<small>補</small>' : ''}</td>`
            : '<td class="c t"></td><td class="c by"></td>').join('')}</tr>`;
        }).join('')}</tbody>
      </table>
    </article>`;
  }
  // 區域合併頁：同一區的設備放在同一張 A4（日期 × 設備 × 時段）
  function areaGroups(M) {
    const m = new Map();
    for (const S of M.sheets) { const a = areaOf(S.f); if (!m.has(a)) m.set(a, []); m.get(a).push(S); }
    return [...m].map(([area, Ss]) => {
      const rows = M.days.map((d, i) => {
        const by = M.slots.map((s, j) => { const e = Ss.map((S) => S.rows[i].cells[j].e).find((x) => x && x.by); return e ? e.by : ''; });
        const late = M.slots.map((s, j) => Ss.some((S) => { const e = S.rows[i].cells[j].e; return e && e.ts && e.ts.slice(0, 10) !== d; }));
        const acts = [];
        Ss.forEach((S) => S.rows[i].acts.forEach((a) => acts.push(`${S.f.name} ${a}`)));
        return { d, by, late, acts };
      });
      const sum = (k) => Ss.reduce((n, S) => n + S[k], 0);
      return { area, Ss, rows, done: sum('done'), due: sum('due'), bad: sum('bad') };
    });
  }
  function areaSheetHtml(M, G) {
    const [y, m] = M.ym.split('-');
    const name = db.shop || '';
    const nT = G.Ss.length * M.slots.length;
    const dense = nT + M.slots.length > 12 ? ' dense' : '';
    return `<article class="sheet">
      <header class="sh-head">
        <h2>${esc(name)}${name ? ' ' : ''}冰箱溫度記錄表</h2>
        <div class="sh-info"><span>區域：<b>${esc(G.area)}</b>（${G.Ss.length} 台）</span><span><b>${y}</b> 年 <b>${+m}</b> 月</span></div>
      </header>
      <table class="sh-tbl${dense}">
        <thead>
          <tr><th rowspan="2" class="c">日期</th><th rowspan="2" class="c">星期</th>${G.Ss.map((S) => `<th colspan="${M.slots.length}" class="c">${esc(S.f.name)}</th>`).join('')}<th colspan="${M.slots.length}" class="c">記錄人</th></tr>
          <tr>${G.Ss.map(() => M.slots.map((s) => `<th class="c">${esc(s.name)}</th>`).join('')).join('')}${M.slots.map((s) => `<th class="c">${esc(s.name)}</th>`).join('')}</tr>
        </thead>
        <tbody>${G.rows.map((r, i) => {
          const wd = pd(r.d).getDay();
          return `<tr class="${wd % 6 === 0 ? 'we' : ''}"><td class="c">${+r.d.slice(8)}</td><td class="c">${WD[wd]}</td>${G.Ss.map((S) => S.rows[i].cells.map((c) => (c.e
            ? `<td class="c t${c.e.x ? ' x' : ''}">${t1(c.e.t)}</td>` : '<td class="c t"></td>')).join('')).join('')}${r.by.map((b, j) => `<td class="c by">${esc(b)}${r.late[j] ? '<small>補</small>' : ''}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
      </table>
    </article>`;
  }
  // 有設定區域、且不是只看單一設備時，每個區域印成一頁
  const areaMode = (fid) => hasAreas() && !fridgeById(fid);
  function viewMonth(el, ym, fid) {
    fid = decodeURIComponent(fid);
    if (fid.startsWith('area:') ? !liveFridges().some((f) => areaOf(f) === fid.slice(5)) : fid !== 'all' && !fridgeById(fid)) fid = 'all';
    const M = monthData(ym, fid);
    const fs = liveFridges();
    const AM = areaMode(fid);
    const pages = AM ? areaGroups(M).map((G) => areaSheetHtml(M, G)) : M.sheets.map((S) => sheetHtml(M, S));
    const go = (y, f) => { location.hash = `#/month/${y}/${encodeURIComponent(f)}`; };
    el.innerHTML = `
      <div class="page-head no-print">
        <div class="datebar">
          <button class="btn icon" data-act="prev" title="上個月">◀</button>
          <input type="month" id="ym" value="${ym}">
          <button class="btn icon" data-act="next" title="下個月">▶</button>
        </div>
        <div class="sp"></div>
        <button class="btn" data-act="xlsx" ${M.sheets.length ? '' : 'disabled'}>⬇ 匯出 Excel</button>
        <button class="btn primary" data-act="print" ${M.sheets.length ? '' : 'disabled'}>🖨 列印 / 存 PDF</button>
      </div>
      <div class="filters no-print"><div class="seg">${[['all', hasAreas() ? '全部區域' : '全部設備'], ...(hasAreas() ? byArea(fs).map(([a]) => ['area:' + a, '📍 ' + a]) : []), ...fs.map((f) => [f.id, f.name || '未命名'])].map(([k, t]) => `<button class="${fid === k ? 'on' : ''}" data-fid="${esc(k)}">${esc(t)}</button>`).join('')}</div></div>
      <p class="hint no-print">${AM ? '每個區域一頁 A4（同區的設備放在同一張）' : '每台設備一頁 A4'}，共 ${pages.length} 頁。列印時選「另存為 PDF」即可存成 PDF 檔。${hasAreas() ? '' : '<br>想把設備分區（例如車前、車後）每區印一張，請到「⚙️ 設定」填寫設備的「區域」。'}</p>
      ${pages.length ? `<div class="sheets">${pages.join('')}</div>` : '<p class="empty">沒有設備可以顯示。</p>'}`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-act],[data-fid]'); if (!b) return;
      if (b.dataset.fid) return go(ym, b.dataset.fid);
      const a = b.dataset.act;
      if (a === 'prev') go(addM(ym, -1), fid);
      else if (a === 'next') go(addM(ym, 1), fid);
      else if (a === 'print') doPrint(M, fid);
      else if (a === 'xlsx') exportXlsx(M, AM);
    };
    el.onchange = (e) => { if (e.target.id === 'ym' && validYm(e.target.value)) go(e.target.value, fid); };
  }

  // 列印：電腦瀏覽器用 window.print()；手機（iPhone 主畫面 App 不支援列印）與桌面版改成產生 A4 PDF 檔
  const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const loadedJs = {};
  const loadJs = (src) => loadedJs[src] || (loadedJs[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete loadedJs[src]; rej(new Error('無法載入 PDF 元件，請確認網路後再試')); };
    document.head.append(s);
  }));
  let pdfBusy = false;
  function doPrint(M, fid) {
    if (!DESK && !IS_MOBILE) return window.print();
    deliverPdf(() => buildPdf(M, fid));
  }
  // 產生 PDF 後：桌面版另存新檔；手機用分享選單（列印、存檔、傳 LINE）
  async function deliverPdf(build) {
    if (pdfBusy) return;
    pdfBusy = true;
    toast('正在產生 PDF…', 60000);
    let file;
    try { file = await build(); } catch (e) { toast('產生 PDF 失敗：' + (e && e.message || e), 5000); return; } finally { pdfBusy = false; }
    toast('PDF 已產生', 1500);
    if (DESK) return saveFile(new Uint8Array(await file.arrayBuffer()), file.name, 'application/pdf');
    const canShare = (() => { try { return !!navigator.canShare && navigator.canShare({ files: [file] }); } catch (e) { return false; } })();
    // 產生 PDF 需要一點時間，iOS 會認為已不是使用者點的，所以請使用者再點一次
    const k = await choose(`PDF 已準備好（${file.name}）。${canShare ? '按「分享／列印」後，在分享選單選「列印」就能用印表機列印，也可以存到「檔案」或傳 LINE。' : ''}`,
      canShare ? [['share', '分享／列印'], ['open', '開啟 PDF'], ['', '關閉']] : [['open', '開啟 PDF'], ['', '關閉']]);
    const url = URL.createObjectURL(file);
    if (k === 'share') {
      try { await navigator.share({ files: [file], title: file.name }); } catch (e) { if (e.name !== 'AbortError') window.open(url, '_blank'); }
    } else if (k === 'open') {
      const w = window.open(url, '_blank');
      if (!w) { const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove(); }
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  // 每個頁面元素各自截圖成一頁 A4（內容寬 190mm ≈ 718px，與列印版面相同）
  // 報表滿版：找出放得下 A4（718×1047）的最大字級，再把資料列拉高撐滿整頁
  const PW = 718, PH = 1047;
  function fitSheet(sh) {
    sh.classList.add('fit');
    const tbl = sh.querySelector('.sh-tbl'), rows = [...sh.querySelectorAll('.sh-tbl tbody tr')];
    sh.style.setProperty('--rh', 0);
    const fits = (pf) => { sh.style.setProperty('--pf', pf); return tbl.scrollWidth <= PW + 0.5 && sh.offsetHeight <= PH; };
    let lo = 6, hi = 26;
    if (!fits(lo)) hi = lo;
    else for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    let pf = Math.floor(lo * 100) / 100;
    while (pf > 6 && !fits(pf)) pf -= 0.1;
    const extra = PH - sh.offsetHeight;
    if (extra > 2 && rows.length) {
      let rh = Math.floor((rows[0].offsetHeight + extra / rows.length) * 10) / 10;
      sh.style.setProperty('--rh', rh);
      while (rh > 0 && sh.scrollHeight > PH) sh.style.setProperty('--rh', rh -= 0.5);
    }
    sh.style.height = PH + 'px';
  }
  async function htmlToPdf(pages, name) {
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
        if (sh.classList.contains('sheet')) fitSheet(sh);
        const cv = await window.html2canvas(sh, { scale: 2, backgroundColor: '#ffffff', windowWidth: 800 });
        let w = cw, h = cv.height / cv.width * cw;
        if (h > chh) { w *= chh / h; h = chh; } // 太長就等比縮小放進一頁
        if (i++) pdf.addPage();
        pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', MG + (cw - w) / 2, MG, w, h);
      }
      return new File([pdf.output('blob')], name, { type: 'application/pdf' });
    } finally { host.remove(); }
  }
  function buildPdf(M, fid) {
    const AM = areaMode(fid);
    const pages = AM ? areaGroups(M).map((G) => areaSheetHtml(M, G)) : M.sheets.map((S) => sheetHtml(M, S));
    const area = fid.startsWith('area:') ? '_' + fid.slice(5) : fridgeById(fid) ? '_' + fridgeById(fid).name : '';
    return htmlToPdf(pages, fname(`${db.shop ? db.shop + '_' : ''}冰箱溫度記錄表_${M.ym.replace('-', '')}${area}.pdf`));
  }

  // ------------------------------------------------------------------ 匯出 Excel
  function xlsxSheets(M, AM) {
    const B = 1, T = 5, TX = 6, RX = 7, H = 8;
    const shop = db.shop || '';
    const out = AM ? areaGroups(M).map((G) => {
      const head1 = [{ v: '日期', s: B }, { v: '星期', s: B }];
      G.Ss.forEach((S) => M.slots.forEach((s) => head1.push({ v: `${S.f.name} ${s.name}`, s: B })));
      M.slots.forEach((s) => head1.push({ v: `${s.name}記錄人`, s: B }));
      head1.push({ v: '異常處置', s: B });
      const rows = [
        [{ v: `${shop}${shop ? ' ' : ''}冰箱溫度記錄表`, s: H }],
        ['區域', G.area, '月份', `${M.ym.slice(0, 4)} 年 ${+M.ym.slice(5)} 月`, '匯出時間', new Date().toLocaleString('zh-TW', { hour12: false })],
        ['標準溫度', G.Ss.map((S) => `${S.f.name}：${rangeText(S.f)}`).join('；')],
        [],
        head1,
        ...G.rows.map((r, i) => {
          const row = [r.d, '週' + WD[pd(r.d).getDay()]];
          G.Ss.forEach((S) => S.rows[i].cells.forEach((c) => row.push(c.e ? { v: c.e.t, s: c.e.x ? TX : T } : null)));
          r.by.forEach((b) => row.push(b || null));
          row.push(r.acts.length ? { v: r.acts.join('；'), s: RX } : null);
          return row;
        }),
        [],
        ['記錄筆數', G.done, '異常次數', G.bad],
      ];
      return { name: G.area, rows, cols: [12, 6, ...G.Ss.flatMap(() => M.slots.map(() => 12)), ...M.slots.map(() => 10), 50], freeze: 5 };
    }) : M.sheets.map((S) => {
      const f = S.f;
      const head1 = [{ v: '日期', s: B }, { v: '星期', s: B }];
      M.slots.forEach((s) => { head1.push({ v: `${s.name}溫度`, s: B }, { v: `${s.name}記錄人`, s: B }, { v: `${s.name}時間`, s: B }); });
      head1.push({ v: '異常處置', s: B });
      const rows = [
        [{ v: `${shop}${shop ? ' ' : ''}冰箱溫度記錄表`, s: H }],
        ['設備', f.name, '類型', typeName(f), '標準溫度', rangeText(f)],
        ['月份', `${M.ym.slice(0, 4)} 年 ${+M.ym.slice(5)} 月`, '匯出時間', new Date().toLocaleString('zh-TW', { hour12: false })],
        [],
        head1,
        ...S.rows.map((r) => {
          const row = [r.d, '週' + WD[pd(r.d).getDay()]];
          r.cells.forEach((c) => { row.push(c.e ? { v: c.e.t, s: c.e.x ? TX : T } : null, c.e ? c.e.by : null, c.e ? c.e.ts : null); });
          row.push(r.acts.length ? { v: r.acts.join('；'), s: RX } : null);
          return row;
        }),
        [],
        [{ v: '統計', s: B }],
        ['記錄筆數', S.done, '異常次數', S.bad],
        ['平均', S.avg == null ? null : { v: Math.round(S.avg * 10) / 10, s: T }, '最低', S.mn == null ? null : { v: S.mn, s: T }, '最高', S.mx == null ? null : { v: S.mx, s: T }],
      ];
      return { name: f.name || '設備', rows, cols: [12, 6, ...M.slots.flatMap(() => [9, 10, 17]), 50], freeze: 5 };
    });
    const xs = [];
    M.sheets.forEach((S) => S.rows.forEach((r) => r.cells.forEach((c) => { if (c.e && c.e.x) xs.push([r.d, c.s.name, S.f.name, { v: c.e.t, s: TX }, rangeText(S.f), c.e.by, c.e.ts, c.e.act || '（未填）', c.e.rt == null ? null : { v: c.e.rt, s: isBad(S.f, c.e.rt) ? TX : T }]); })));
    out.push({ name: '異常處置紀錄', rows: [['日期', '時段', '設備', '溫度', '標準', '記錄人', '記錄時間', '處置', '複測溫度'].map((v) => ({ v, s: B })), ...xs], cols: [12, 8, 16, 8, 14, 10, 17, 50, 10], freeze: 1 });
    return out;
  }
  const fname = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
  async function exportXlsx(M, AM) {
    const bytes = XLSXW.build(xlsxSheets(M, AM));
    const name = fname(`${db.shop ? db.shop + '_' : ''}冰箱溫度記錄表_${M.ym.replace('-', '')}.xlsx`);
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

  // ------------------------------------------------------------------ 溫度趨勢（每台設備一張折線圖）
  const PRESETS = [['7', '近7天'], ['14', '近14天'], ['30', '近30天'], ['90', '近90天'], ['month', '本月'], ['lmonth', '上月'], ['custom', '自訂']];
  const ch = { preset: '14', from: '', to: '', only: '' };
  function chartRange(p) {
    const t = today(), d = pd(t);
    if (p === 'month') return [t.slice(0, 8) + '01', t];
    if (p === 'lmonth') return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
    if (p === 'custom') return [ch.from || addD(t, -13), ch.to || t];
    return [addD(t, -(+p - 1)), t];
  }
  function chartData(f, from, to) {
    const pts = [];
    const ss = db.slots.slice().sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
    let due = 0;
    for (let d = from, n = 0; d <= to && n < 800; d = addD(d, 1), n++) {
      const v = (db.recs[d] || {})[f.id] || {};
      for (const s of ss) {
        const e = v[s.id];
        if (!s.deleted && d <= today() && !f.off) due++;
        if (!hasT(e)) continue;
        const tm = s.time || '12:00';
        pts.push({ d, s, e, x: n + (+tm.slice(0, 2) * 60 + +tm.slice(3, 5)) / 1440 });
      }
    }
    const ts = pts.map((p) => p.e.t);
    return {
      pts, due, n: spanDays(from, to),
      avg: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null,
      mn: ts.length ? Math.min(...ts) : null, mx: ts.length ? Math.max(...ts) : null,
      bad: pts.filter((p) => p.e.x).length,
    };
  }
  function viewChart(el) {
    if (!ch.from) { const [f, t] = chartRange(ch.preset); ch.from = f; ch.to = t; }
    const [from, to] = chartRange(ch.preset);
    const fs = liveFridges().filter((f) => !ch.only || f.id === ch.only);
    el.innerHTML = `
      <div class="page-head"><h2>溫度趨勢</h2></div>
      <div class="filters">
        <div class="seg">${PRESETS.map(([k, t]) => `<button class="${ch.preset === k ? 'on' : ''}" data-preset="${k}">${t}</button>`).join('')}</div>
        <div class="range"><input type="date" id="from" value="${from}" max="${today()}"> ～ <input type="date" id="to" value="${to}" max="${today()}"><span class="muted">共 ${spanDays(from, to)} 天</span></div>
        <select id="only"><option value="">全部設備</option>${liveFridges().map((f) => `<option value="${f.id}" ${ch.only === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      </div>
      ${fs.length ? `<div class="charts${fs.length === 1 ? ' one' : ''}">${fs.map((f) => {
        const C = chartData(f, from, to);
        return `<section class="card ccard" data-fid="${f.id}">
          <div class="card-head"><h3>${esc(f.name)}</h3><small class="muted">${typeName(f)}・標準 ${esc(rangeText(f))}</small></div>
          <div class="cstats">
            <span>平均 <b>${C.avg == null ? '—' : deg(C.avg)}</b></span><span>最低 <b>${C.mn == null ? '—' : deg(C.mn)}</b></span><span>最高 <b>${C.mx == null ? '—' : deg(C.mx)}</b></span>
            <span>異常 <b class="${C.bad ? 'xv' : ''}">${C.bad}</b> 次</span><span>完成率 <b>${C.due ? Math.round(Math.min(C.pts.length, C.due) / C.due * 100) + '%' : '—'}</b></span>
          </div>
          <div class="chart" data-chart="${f.id}">${C.pts.length ? '' : '<p class="empty">這段期間沒有紀錄</p>'}</div>
        </section>`;
      }).join('')}</div>` : '<p class="empty">沒有設備。</p>'}`;
    drawCharts(from, to);
    el.onclick = (e) => {
      const p = e.target.closest('[data-preset]');
      if (p) {
        ch.preset = p.dataset.preset;
        if (ch.preset !== 'custom') { const [f, t] = chartRange(ch.preset); ch.from = f; ch.to = t; }
        viewChart(el);
      }
    };
    el.onchange = (e) => {
      const t = e.target;
      if (t.id === 'only') { ch.only = t.value; viewChart(el); }
      else if ((t.id === 'from' || t.id === 'to') && validYmd(t.value)) {
        if (ch.preset !== 'custom') { const [f, tt] = chartRange(ch.preset); ch.from = f; ch.to = tt; }
        ch.preset = 'custom'; ch[t.id] = t.value;
        if (ch.from > ch.to) { if (t.id === 'from') ch.to = ch.from; else ch.from = ch.to; }
        viewChart(el);
      }
    };
  }
  let lastCharts = null;
  function drawCharts(from, to) {
    lastCharts = [from, to];
    $$('[data-chart]').forEach((box) => {
      const f = fridgeById(box.dataset.chart);
      const C = chartData(f, from, to);
      if (C.pts.length) drawLine(box, f, C, from);
    });
  }
  const NS = 'http://www.w3.org/2000/svg';
  function drawLine(box, f, C, from) {
    f = { ...f, ...bounds(f) };
    const W = Math.max(280, box.clientWidth), H = W < 520 ? 190 : 230;
    const m = { l: 40, r: 10, t: 12, b: 26 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const vals = C.pts.map((p) => p.e.t);
    if (f.lo != null) vals.push(f.lo);
    if (f.hi != null) vals.push(f.hi);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(4, hi - lo);
    lo = Math.floor(lo - span * 0.15); hi = Math.ceil(hi + span * 0.15);
    const step = [1, 2, 5, 10, 20, 25, 50].find((s) => (hi - lo) / s <= 6) || 50;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const X = (x) => m.l + (x / C.n) * pw, Y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="${NS}" role="img" aria-label="${esc(f.name)} 溫度趨勢">`;
    // 合格範圍底色
    const bandTop = f.hi != null ? Y(Math.min(hi, f.hi)) : m.t, bandBot = f.lo != null ? Y(Math.max(lo, f.lo)) : m.t + ph;
    if (f.lo != null || f.hi != null) s += `<rect class="band" x="${m.l}" y="${bandTop}" width="${pw}" height="${Math.max(0, bandBot - bandTop)}"/>`;
    for (let v = lo; v <= hi + 1e-9; v += step) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : 'grid'}"/><text x="${m.l - 6}" y="${Y(v) + 4}" class="yl">${v}°</text>`;
    if (f.hi != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(f.hi)}" y2="${Y(f.hi)}" class="limit"/>`;
    if (f.lo != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(f.lo)}" y2="${Y(f.lo)}" class="limit"/>`;
    const every = Math.max(1, Math.ceil(C.n / Math.max(1, Math.floor(pw / 46))));
    for (let i = 0; i < C.n; i += every) s += `<text x="${X(i + 0.5)}" y="${H - 8}" class="xl">${md(addD(from, i))}</text>`;
    // 折線（相隔超過 2 天沒有紀錄就斷開）
    let d = '', prev = null;
    for (const p of C.pts) { d += `${prev && p.x - prev.x <= 2 ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.e.t).toFixed(1)}`; prev = p; }
    s += `<path class="line" d="${d}"/>`;
    const r = C.pts.length > 120 ? 2 : 3.2;
    C.pts.forEach((p, i) => { s += `<circle class="pt${p.e.x ? ' x' : ''}" data-i="${i}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.e.t).toFixed(1)}" r="${p.e.x ? r + 1.6 : r}"/>`; });
    s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></svg>`;
    box.innerHTML = s;
    const svg = $('svg', box);
    const move = (ev) => {
      const rc = svg.getBoundingClientRect();
      const mx = (ev.clientX - rc.left) * (W / rc.width);
      let best = null, bd = Infinity;
      C.pts.forEach((p, i) => { const dd = Math.abs(X(p.x) - mx); if (dd < bd) { bd = dd; best = i; } });
      $$('.pt.hl', box).forEach((x) => x.classList.remove('hl'));
      if (best == null || bd > 30) return hideTip();
      const p = C.pts[best];
      $(`.pt[data-i="${best}"]`, box).classList.add('hl');
      showTip(ev, `<b>${md(p.d)}（週${WD[pd(p.d).getDay()]}）${esc(p.s.name)}</b><br>溫度 <b>${deg(p.e.t)}</b>${p.e.x ? '（異常）' : ''}<br>記錄人 ${esc(p.e.by || '—')}${p.e.x ? `<br>處置：${esc(p.e.act || '未填')}` : ''}`);
    };
    svg.onmousemove = move;
    svg.onmouseleave = () => { hideTip(); $$('.pt.hl', box).forEach((x) => x.classList.remove('hl')); };
    svg.onclick = move;
  }
  let rsz;
  window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (cur.view === 'chart' && lastCharts) drawCharts(...lastCharts); }, 150); });
  function showTip(e, html) {
    const t = $('#tt'); t.innerHTML = html; t.hidden = false;
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14, yy = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, yy) + 'px';
  }
  function hideTip() { $('#tt').hidden = true; }

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
      const out = { fridges: [], recs: [], conf: {} };
      for (const f of db.fridges) if (f.at > since) out.fridges.push(f);
      for (const [d, v] of Object.entries(db.recs)) {
        for (const [fid, ss] of Object.entries(v)) {
          for (const [sid, e] of Object.entries(ss)) if (e.at > since) out.recs.push({ d, fid, sid, ...e });
        }
      }
      if (db.shopAt > since) out.conf.shop = { v: db.shop, at: db.shopAt };
      if (db.slotsAt > since) out.conf.slots = { v: db.slots, at: db.slotsAt };
      if (db.staffAt > since) out.conf.staff = { v: db.staff, at: db.staffAt };
      if (db.teamAt > since) out.conf.team = { v: db.team, at: db.teamAt };
      return out;
    },
    pending() {
      const c = this.changes(db.cloud.pushedAt);
      return c.fridges.length + c.recs.length + Object.keys(c.conf).length;
    },
    merge(r) {
      let ch = false;
      for (const x of r.fridges || []) {
        if (!x || !x.id) continue;
        const l = fridgeById(x.id);
        if (!l) { db.fridges.push(normFridge(x, db.fridges.length)); ch = true; } else if (num(x.at) > l.at) { Object.assign(l, normFridge(x, 0)); ch = true; }
      }
      if (ch) sortFridges(db);
      for (const x of r.recs || []) {
        if (!x || !validYmd(x.d) || !x.fid || !x.sid) continue;
        const l = recOf(x.d, x.fid, x.sid);
        if (!l || num(x.at) > l.at) {
          const v = db.recs[x.d] || (db.recs[x.d] = {});
          (v[x.fid] || (v[x.fid] = {}))[x.sid] = normRec(x);
          ch = true;
        }
      }
      const c = r.conf || {};
      if (c.shop && num(c.shop.at) > db.shopAt) { db.shop = String(c.shop.v || ''); db.shopAt = num(c.shop.at); renderShop(); ch = true; }
      if (c.slots && num(c.slots.at) > db.slotsAt) { db.slots = normSlots(c.slots.v); db.slotsAt = num(c.slots.at); ch = true; }
      if (c.staff && num(c.staff.at) > db.staffAt) { db.staff = (c.staff.v || []).map(String).filter(Boolean); db.staffAt = num(c.staff.at); ch = true; }
      if (c.team && num(c.team.at) > db.teamAt) { db.team = normTeam(c.team.v); db.teamAt = num(c.team.at); ch = true; }
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
    if ((a && $('#app').contains(a) && a.matches('input, textarea, select')) || $('.modal')) { pendingRefresh = true; return; }
    pendingRefresh = false;
    const box = $('#app'), y = box.scrollTop;
    route();
    box.scrollTop = y;
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRefresh) refresh(); }, 80));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { Cloud.tick(); updateDot(); } });
  window.addEventListener('online', () => Cloud.tick());

  function choose(msg, opts) {
    return new Promise((res) => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="btns col">${opts.map(([k, t], i) => `<button class="btn${i ? '' : ' primary'}" data-k="${k}">${esc(t)}</button>`).join('')}</div></div>`;
      m.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b || e.target === m) { m.remove(); res(b ? b.dataset.k : null); } };
      document.body.append(m);
      $('.btn', m).focus();
    });
  }
  const anyRecs = () => Object.values(db.recs).some((v) => Object.values(v).some((ss) => Object.values(ss).some(hasT)));
  const isPristine = () => !anyRecs() && db.fridges.every((f) => f.at <= db.seedAt) && db.slotsAt <= db.seedAt && !db.staffAt && !db.teamAt && !db.shopAt;
  async function connectCloud(url, pw) {
    url = url.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\/?/.test(url)) throw new Error('網址格式不對，應該像 https://script.google.com/macros/s/…/exec');
    if (pw.length < 4) throw new Error('密碼至少 4 個字');
    const c = { url, pw, rev: 0, pushedAt: 0, on: true, lastOk: 0 };
    const r = await Cloud.req({ a: 'ping' }, c);
    let mode = 'merge';
    if (r.counts.fridges > 0) {
      if (isPristine()) mode = 'replace';
      else {
        mode = await choose(`雲端已經有資料（設備 ${r.counts.fridges} 台、溫度紀錄 ${r.counts.recs} 筆），這台裝置也有資料。要怎麼處理？`,
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
    return { claimed: r.claimed, mode, cloudHad: r.counts.fridges > 0 };
  }
  function cloudInfo() {
    const c = db.cloud;
    if (!Cloud.on()) return '';
    const st = Cloud.state === 'ok' ? `<span class="dl up">● 已同步</span>` : Cloud.state === 'sync' ? '同步中…' : `<span class="dl down">● ${esc(Cloud.err || '尚未同步')}</span>`;
    return `${st}${c.lastOk ? `・最後同步 ${new Date(c.lastOk).toLocaleString('zh-TW', { hour12: false })}` : ''}`;
  }

  // ------------------------------------------------------------------ 設定
  function teamCard() {
    const T = db.team;
    return `<section class="card" id="teamcard">
        <div class="card-head"><h3>👥 員工 PIN 碼與權限</h3></div>
        <p class="hint pad">啟用後，記錄前要點自己的名字並輸入 PIN 碼登入，紀錄會記下是誰量的，防止代簽。<br>「員工」只能記錄，以及修改自己今天和昨天的溫度；「主管」可以修改所有紀錄和進入設定。至少要有一位設好 PIN 碼的主管才能啟用。</p>
        ${db.staff.length ? `<div class="tbl-wrap"><table class="ttable"><thead><tr><th>姓名</th><th>權限</th><th>PIN 碼</th></tr></thead><tbody>
          ${db.staff.map((n) => { const P = person(n); return `<tr data-n="${esc(n)}"><td><b>${esc(n)}</b>${db.meOk === n ? ' <small class="muted">（目前登入）</small>' : ''}</td>
            <td><select data-role aria-label="${esc(n)} 的權限"><option value="staff" ${P.r === 'admin' ? '' : 'selected'}>員工</option><option value="admin" ${P.r === 'admin' ? 'selected' : ''}>主管</option></select></td>
            <td class="pinc"><span class="pill ${P.h ? 'ok' : 'miss'}">${P.h ? '已設定' : '未設定'}</span><button class="btn mini" data-act="setpin">${P.h ? '重設' : '設定'}</button>${P.h ? '<button class="btn mini danger" data-act="clrpin">清除</button>' : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted pad">請先在上方「記錄人名單」輸入員工姓名。</p>'}
        <div class="teamopts pad">
          <label class="chk big"><input type="checkbox" id="teamon" ${T.on ? 'checked' : ''}> 啟用 PIN 碼登入與權限分級</label>
          <label class="idle">閒置自動登出 <select id="teamidle">${IDLE_OPTS.map((m) => `<option value="${m}" ${T.idle === m ? 'selected' : ''}>${m ? m + ' 分鐘' : '不自動登出'}</option>`).join('')}</select></label>
        </div>
        ${T.on && !teamOn() ? '<p class="pad xv">⚠ 已勾選啟用，但還沒有設好 PIN 碼的主管，所以目前不會生效。</p>' : T.on ? `<p class="pad dl up">● 已啟用${db.meOk ? `・目前登入：${esc(db.meOk)}` : ''}</p>` : ''}
        <p class="muted pad small">PIN 碼只存加密後的雜湊值，會同步到其他裝置。這是防止代簽的現場管理功能，不是資訊安全防護。</p>
      </section>`;
  }
  function viewSettings(el) {
    const c = db.cloud || {};
    const on = Cloud.on();
    const list = liveFridges();
    const slots = liveSlots();
    const nDays = Object.keys(db.recs).filter((d) => Object.values(db.recs[d]).some((ss) => Object.values(ss).some(hasT))).length;
    // 啟用權限分級後，設定只有主管能進
    if (!isAdmin()) {
      el.innerHTML = `<div class="page-head"><h2>設定</h2></div>
        <section class="card lockcard"><div class="lockic">🔒</div><h3>設定需要主管權限</h3>
          <p class="muted">${loggedIn() ? `目前登入：${esc(db.me)}（員工）。` : '目前沒有人登入。'}請主管登入後，再修改設備、時段、名單與雲端設定。</p>
          <button class="btn primary" data-act="adminlogin">🔑 主管登入</button></section>
        <p class="muted center">冰箱溫度記錄表系統 v${VERSION}${DESK ? '（桌面版）' : ''}</p>`;
      el.onclick = (e) => { if (e.target.closest('[data-act=adminlogin]')) loginDialog({ adminOnly: true }); };
      return;
    }
    el.innerHTML = `
      <div class="page-head"><h2>設定</h2></div>
      <section class="card form">
        <label>店名（顯示在標題、記錄表與匯出檔名）<input id="shopname" value="${esc(db.shop)}" placeholder="例如：碧潭餐廳"></label>
      </section>
      <section class="card">
        <div class="card-head"><h3>冰箱設備</h3><div class="sp"></div><button class="btn" data-act="qrlabels" ${list.length ? '' : 'disabled'}>🏷 列印 QR Code 標籤</button><button class="btn primary" data-act="addf">＋ 新增設備</button></div>
        <p class="hint pad">選類型會帶入標準範圍（冷藏 0～7°C、冷凍 -25～-18°C、熱藏 60°C 以上；上限依法規，下限為防止結凍或溫控異常的建議值），也可以自己改上下限；空白表示不限。暫時不用的設備勾「停用」。<br>「區域」填一樣的設備（例如 車前、車後）會在每日記錄分組顯示，月報表每個區域印成一張。</p>
        <datalist id="arealist">${[...new Set(['車前', '車後', ...list.map((f) => f.area).filter(Boolean)])].map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
        ${list.length ? `<div class="tbl-wrap"><table class="ftable"><thead><tr><th class="mv">排序</th><th>名稱</th><th>區域</th><th>類型</th><th class="r">下限 °C</th><th class="r">上限 °C</th><th class="c">停用</th><th></th></tr></thead><tbody>
        ${list.map((f, i) => `<tr data-id="${f.id}" class="${f.off ? 'off' : ''}">
          <td class="mv"><button class="btn icon sm" data-act="up" ${i ? '' : 'disabled'} title="上移">▲</button><button class="btn icon sm" data-act="down" ${i < list.length - 1 ? '' : 'disabled'} title="下移">▼</button></td>
          <td class="f-name"><input data-f="name" value="${esc(f.name)}" placeholder="設備名稱" aria-label="設備名稱"></td>
          <td class="f-area"><label><span>區域</span><input data-f="area" list="arealist" value="${esc(f.area)}" placeholder="例如 車前" aria-label="區域"></label></td>
          <td class="f-type"><select data-f="type" aria-label="類型">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${t.n}</option>`).join('')}</select></td>
          <td class="r f-lo"><label><span>下限</span><input data-f="lo" type="text" inputmode="${IM}" data-kp${RO} value="${f.lo ?? ''}" placeholder="不限"></label></td>
          <td class="r f-hi"><label><span>上限</span><input data-f="hi" type="text" inputmode="${IM}" data-kp${RO} value="${f.hi ?? ''}" placeholder="不限"></label></td>
          <td class="c f-off"><label><input type="checkbox" data-f="off" ${f.off ? 'checked' : ''}><span>停用</span></label></td>
          <td class="f-del"><button class="btn icon sm danger" data-act="delf" title="刪除">✕</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">尚無設備</p>'}
      </section>
      <div class="two">
        <section class="card">
          <div class="card-head"><h3>記錄時段</h3><div class="sp"></div><button class="btn" data-act="adds" ${slots.length >= 6 ? 'disabled' : ''}>＋ 新增時段</button></div>
          <p class="hint pad">到了時間還沒記錄，「每日記錄」會出現提醒。</p>
          <div class="slots pad">${slots.map((s) => `<div class="slotrow" data-sid="${s.id}"><input data-s="name" value="${esc(s.name)}" placeholder="名稱" aria-label="時段名稱"><input data-s="time" type="time" value="${esc(s.time)}" aria-label="時間"><button class="btn icon sm danger" data-act="dels" title="刪除時段">✕</button></div>`).join('') || '<p class="muted">沒有時段</p>'}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>記錄人名單</h3></div>
          <p class="hint pad">一行一位，記錄時可直接選。</p>
          <div class="pad"><textarea id="staff" rows="5" placeholder="王小明&#10;李小華">${esc(db.staff.join('\n'))}</textarea></div>
        </section>
      </div>
      ${teamCard()}
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
          <p class="muted pad">連上 Google 試算表後，資料會存在雲端，多台手機和電腦可以共用同一份記錄表。</p>
          <div class="form pad cloudform">
            <label>雲端網址<input id="curl" value="${esc(c.url || window.FRIDGE_CLOUD_URL || '')}" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false" autocomplete="off"></label>
            <label>同步密碼<input id="cpw" type="password" autocomplete="current-password" placeholder="至少 4 個字"></label>
            <button class="btn primary" data-act="connect">連線</button>
          </div>
          <p class="muted pad">第一台連線時輸入的密碼會成為雲端密碼，其他裝置請輸入同一組密碼。</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h3>資料備份</h3></div>
        <p class="muted pad">目前有 ${list.length} 台設備、${nDays} 天的溫度紀錄。
          ${DESK ? '<br>本機資料檔：<code id="dpath">…</code>（每天自動保留一份備份）' : on ? '' : '<br>資料存在這個瀏覽器裡，換手機或清除瀏覽資料前請先匯出備份。'}</p>
        <div class="btns pad"><button class="btn" data-act="backup">⬇ 匯出備份（JSON）</button>
          <label class="btn">⬆ 從備份還原<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>試用與清除</h3></div>
        <div class="btns pad">
          <button class="btn" data-act="demo" ${on ? 'disabled title="連線雲端時不能產生示範資料"' : ''}>產生近 60 天示範紀錄</button>
          <button class="btn danger" data-act="clearrecs">清除所有溫度紀錄</button>
          <button class="btn danger" data-act="reset" ${on ? 'disabled title="請先中斷雲端連線"' : ''}>全部重設</button>
        </div>
        <p class="muted pad">示範資料只會填入沒有紀錄的時段，不會覆蓋已輸入的溫度。</p>
      </section>
      <p class="muted center">冰箱溫度記錄表系統 v${VERSION}${DESK ? '（桌面版）' : ''}・快捷鍵 Alt+1～4 切換頁面</p>`;
    if (DESK) api().then((x) => x.data_path()).then((p) => { const e = $('#dpath'); if (e) e.textContent = p; });

    const slotsChanged = () => { db.slotsAt = now(); save(); updateDot(); };
    el.oninput = (e) => {
      const t = e.target;
      if (t.id === 'shopname') { db.shop = t.value.trim(); db.shopAt = now(); renderShop(); save(); return; }
      if (t.dataset.s) {
        const s = slotById(t.closest('.slotrow').dataset.sid);
        if (t.dataset.s === 'name') s.name = t.value.trim() || '未命名'; else s.time = t.value;
        slotsChanged(); return;
      }
      const f = t.dataset.f; if (!f) return;
      const tr = t.closest('tr'), x = fridgeById(tr.dataset.id);
      let swapped = false;
      if (f === 'name') x.name = t.value.trim();
      else if (f === 'area') x.area = t.value.trim();
      else if (f === 'lo' || f === 'hi') {
        const p = parseTemp(t.value); t.classList.toggle('warn', !!p.bad); if (p.bad) return;
        x[f] = p.empty ? null : p.t;
        if (fixSwapped(x)) {
          $('[data-f=lo]', tr).value = x.lo; $('[data-f=hi]', tr).value = x.hi;
          swapped = true;
        }
      }
      else if (f === 'off') { x.off = t.checked; tr.classList.toggle('off', x.off); }
      else if (f === 'type') {
        x.type = t.value;
        const T = TYPES[x.type];
        if (x.type !== 'other') { x.lo = T.lo; x.hi = T.hi; $('[data-f=lo]', tr).value = x.lo ?? ''; $('[data-f=hi]', tr).value = x.hi ?? ''; }
      }
      x.at = now();
      if (f === 'lo' || f === 'hi' || f === 'type') {
        const n = recheckRecs(x);
        const msg = [swapped ? '下限比上限高，已自動對調（下限填較低的溫度，例如冷凍 下限 -25、上限 -18）' : '', n ? `已依新範圍重新判斷 ${n} 筆紀錄` : ''].filter(Boolean).join('；');
        if (msg) toast(msg, swapped ? 6000 : 2600);
      }
      save();
    };
    el.onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'cpw') { e.preventDefault(); $('[data-act=connect]', el).click(); } };
    el.onchange = async (e) => {
      const t = e.target;
      if (t.dataset.f === 'name' && !t.value.trim()) { t.classList.add('warn'); toast('設備名稱不能空白'); }
      if (t.id === 'staff') {
        db.staff = [...new Set(t.value.split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean))];
        db.staffAt = now(); save(); toast('已儲存記錄人名單'); viewSettings(el);
        return;
      }
      if (t.id === 'teamon') {
        if (t.checked && !db.staff.some(isAdminName)) { t.checked = false; toast('請先把至少一位設為「主管」並設定 PIN 碼', 4500); return; }
        db.team.on = t.checked; setTeam();
        if (t.checked && !isAdmin()) { viewSettings(el); toast('已啟用，請主管用 PIN 碼登入'); loginDialog({ adminOnly: true }); return; }
        toast(t.checked ? '已啟用 PIN 碼登入與權限分級' : '已關閉 PIN 碼登入'); viewSettings(el);
        return;
      }
      if (t.id === 'teamidle') { db.team.idle = +t.value; setTeam(); toast(+t.value ? `閒置 ${t.value} 分鐘會自動登出` : '不會自動登出'); return; }
      if (t.dataset.role != null && t.closest('tr[data-n]')) {
        const n = t.closest('tr').dataset.n;
        db.team.people[n] = { ...person(n), r: t.value };
        setTeam();
        if (db.team.on && !db.staff.some(isAdminName)) toast('⚠ 目前沒有設好 PIN 碼的主管，PIN 碼登入暫時不會生效', 5000);
        viewSettings(el);
        return;
      }
      if (t.id !== 'restore' || !t.files[0]) return;
      try {
        const d = norm(JSON.parse(await t.files[0].text()));
        const n = Object.keys(d.recs).length;
        if (!confirm(`還原這份備份？\n設備 ${d.fridges.filter((x) => !x.deleted).length} 台、紀錄 ${n} 天。\n\n${Cloud.on() ? '備份內容會覆蓋雲端上相同日期、時段、設備的資料。' : '目前的資料會被完全取代。'}`)) return;
        if (Cloud.on()) {
          const tt = now();
          d.fridges.forEach((x) => { x.at = tt; });
          for (const v of Object.values(d.recs)) for (const ss of Object.values(v)) for (const r of Object.values(ss)) r.at = tt;
          d.slotsAt = tt; d.staffAt = tt; d.teamAt = tt; if (d.shop) d.shopAt = tt;
          d.cloud = db.cloud;
        } else delete d.cloud;
        d.me = db.me; d.meOk = db.meOk;
        db = d; await flush(); renderShop(); viewSettings(el); toast('已還原備份');
        Cloud.schedule(200);
      } catch (err) { alert('無法讀取備份：' + err.message); } finally { t.value = ''; }
    };
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'setpin' || a === 'clrpin') {
        const n = b.closest('tr').dataset.n;
        if (a === 'clrpin') {
          if (!confirm(`清除「${n}」的 PIN 碼？\n清除後在重新設定之前，他不能登入記錄。`)) return;
          db.team.people[n] = { ...person(n), h: '' }; setTeam(); toast(`已清除 ${n} 的 PIN 碼`);
        } else {
          try { if (!(await setPinDialog(n))) return; } catch (err) { alert(err.message); return; }
          toast(`已設定 ${n} 的 PIN 碼`);
        }
        viewSettings(el);
        return;
      }
      if (a === 'qrlabels') { location.hash = '#/qr'; return; }
      if (a === 'addf') {
        const last = list[list.length - 1];
        const type = last ? last.type : 'chill';
        const ord = Math.max(0, ...db.fridges.map((x) => x.ord)) + 1;
        const f = { id: uid(), name: '', type, area: last ? last.area : '', lo: TYPES[type].lo, hi: TYPES[type].hi, off: false, deleted: false, ord, at: now() };
        db.fridges.push(f); save(); viewSettings(el);
        const inp = $(`tr[data-id="${f.id}"] [data-f=name]`, el); inp.scrollIntoView({ block: 'center' }); inp.focus();
      } else if (a === 'up' || a === 'down') {
        const tr = b.closest('tr'), x = fridgeById(tr.dataset.id);
        const i = list.indexOf(x), j = a === 'up' ? i - 1 : i + 1;
        if (!list[j]) return;
        const o = list[j], tt = now();
        [x.ord, o.ord] = [o.ord, x.ord];
        if (x.ord === o.ord) x.ord += a === 'up' ? -0.5 : 0.5;
        x.at = o.at = tt;
        sortFridges(db); save(); viewSettings(el);
      } else if (a === 'delf') {
        const x = fridgeById(b.closest('tr').dataset.id);
        const used = Object.values(db.recs).some((v) => v[x.id] && Object.values(v[x.id]).some(hasT));
        if (!confirm(`刪除「${x.name || '未命名'}」？${used ? '\n\n這台設備已有溫度紀錄，刪除後月報表就不會再列出它。\n（只是暫時不用的話，勾「停用」就好）' : ''}`)) return;
        x.deleted = true; x.at = now(); save(); viewSettings(el);
      } else if (a === 'adds') {
        db.slots.push({ id: 's' + uid(), name: '新時段', time: '12:00', deleted: false });
        slotsChanged(); viewSettings(el);
        const r = $$('.slotrow [data-s=name]', el).pop(); if (r) { r.focus(); r.select(); }
      } else if (a === 'dels') {
        const s = slotById(b.closest('.slotrow').dataset.sid);
        if (!confirm(`刪除時段「${s.name}」？\n已記錄的溫度會保留在月報表中。`)) return;
        s.deleted = true; slotsChanged(); viewSettings(el);
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
        const copy = { ...db }; delete copy.cloud; delete copy.me; delete copy.meOk; delete copy.meAct;
        await saveFile(JSON.stringify(copy, null, 1), fname(`${db.shop ? db.shop + '_' : ''}冰箱溫度備份_${today().replace(/-/g, '')}.json`), 'application/json');
      } else if (a === 'demo') {
        if (Cloud.on()) return toast('連線雲端時不能產生示範資料');
        if (!activeFridges().length || !liveSlots().length) return toast('請先建立設備與時段');
        if (!confirm('在近 60 天沒有紀錄的時段填入隨機的示範溫度？（之後可用「清除所有溫度紀錄」移除）')) return;
        const n = demoData(60); save(); viewSettings(el); toast(`已產生 ${n} 筆示範紀錄`);
      } else if (a === 'clearrecs') {
        if (!nDays) return toast('沒有溫度紀錄');
        if (prompt(`將刪除全部 ${nDays} 天的溫度紀錄${Cloud.on() ? '（雲端也會一起清除）' : ''}，無法復原。\n確定請輸入「清除」：`) !== '清除') return;
        if (Cloud.on()) {
          const tt = now();
          for (const v of Object.values(db.recs)) for (const ss of Object.values(v)) for (const r of Object.values(ss)) if (hasT(r) || r.act) Object.assign(r, { t: null, act: '', rt: null, x: 0, at: tt });
        } else db.recs = {};
        save(); viewSettings(el); updateDot(); toast('已清除溫度紀錄');
      } else if (a === 'reset') {
        if (Cloud.on()) return toast('請先中斷雲端連線');
        if (prompt('將刪除全部設備、時段與溫度紀錄並恢復預設值，無法復原。\n確定請輸入「重設」：') !== '重設') return;
        const keep = db.cloud;
        db = seed(); if (keep) db.cloud = keep;
        save(); renderShop(); viewSettings(el); updateDot(); toast('已重設');
      }
    };
  }
  function demoData(nDays) {
    const fs = activeFridges(), ss = liveSlots();
    const staff = db.staff.length ? db.staff : ['王小明', '李小華', '陳美玲'];
    let n = 0;
    const tt = now();
    for (let i = nDays - 1; i >= 0; i--) {
      const d = addD(today(), -i);
      for (const s of ss) {
        if (!dueSlot(s, d)) continue;
        if (Math.random() < 0.03) continue; // 偶爾漏記
        const by = staff[Math.floor(Math.random() * staff.length)];
        for (const f of fs) {
          if (hasT(recOf(d, f.id, s.id))) continue;
          const base = f.type === 'freeze' ? -20 : f.type === 'hot' ? 68 : f.hi != null ? f.hi - 3.5 : 4;
          let t = Math.round((base + (Math.random() - 0.5) * 3) * 10) / 10;
          const spike = Math.random() < 0.03;
          if (spike) t = Math.round(((f.hi != null ? f.hi : base) + 1 + Math.random() * 3) * 10) / 10;
          const x = isBad(f, t) ? 1 : 0;
          const v = db.recs[d] || (db.recs[d] = {});
          (v[f.id] || (v[f.id] = {}))[s.id] = {
            t, ts: `${d} ${s.time || '12:00'}`.replace(/(\d\d):(\d\d)$/, (m0, h, mm) => `${h}:${pad(Math.min(59, +mm + Math.floor(Math.random() * 20)))}`),
            by, act: x ? ACTIONS[Math.floor(Math.random() * 4)] : '', rt: x ? Math.round((base + 0.5) * 10) / 10 : null, x, at: tt,
          };
          n++;
        }
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ 啟動
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      location.hash = '#/' + ['day', 'month', 'chart', 'settings'][+e.key - 1];
    }
  });
  window.addEventListener('hashchange', route);

  // v1.3.0：舊資料裡沒有下限、上限仍是預設值的冷藏／冷凍設備，補上預設下限（只做一次，之後可自行清空）
  function addLowerBounds() {
    if (db.loMig) return;
    let n = 0;
    for (const f of db.fridges) {
      const T = TYPES[f.type];
      if ((f.type === 'chill' || f.type === 'freeze') && f.lo == null && f.hi === T.hi) { f.lo = T.lo; f.at = now(); n++; }
    }
    db.loMig = 1;
    save();
    if (n) setTimeout(() => toast(`已為 ${n} 台冷藏／冷凍設備加上預設下限（冷藏 0°C、冷凍 -25°C）`, 4500), 600);
  }

  async function start() {
    let raw = null;
    try { raw = await loadRaw(); } catch (e) { console.error(e); }
    try { db = raw ? norm(JSON.parse(raw)) : null; } catch (e) {
      alert('資料讀取失敗：' + e.message + '\n將以預設設備啟動（原資料不會被覆蓋，直到你修改）。');
      db = seed();
    }
    if (!db) { db = seed(); await flush(); }
    // 關掉 App 超過閒置時間再打開，也要重新登入
    lastAct = db.meAct || Date.now();
    const idleOut = !!(teamOn() && db.team.idle && db.meOk && Date.now() - lastAct > db.team.idle * 60000);
    if (idleOut) { db.me = ''; db.meOk = ''; }
    lastAct = Date.now();
    addLowerBounds();
    const sw = db.fridges.filter((f) => !f.deleted && fixSwapped(f)).length;
    if (sw) { save(); setTimeout(() => toast(`有 ${sw} 台設備的下限、上限填反了，已自動對調`, 5000), 900); }
    if (db.fridges.reduce((n, f) => n + recheckRecs(f), 0)) save();
    renderShop();
    route();
    hideSplash();
    if (idleOut) setTimeout(() => toast('超過閒置時間，請重新登入'), 1700);
    setStatus('');
    Cloud.start();
    if (!DESK && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  // 測試用
  window.__fridge = { get db() { return db; }, flush, Cloud, connectCloud, demoData, monthData, xlsxSheets, buildXlsx: (M) => b64(XLSXW.build(xlsxSheets(M))), dayStats, parseTemp, buildPdf, VERSION };
  start();
})();
