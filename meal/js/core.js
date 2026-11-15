/* 員工餐金額總計 — 網頁版核心：日期 / 週期 / 農曆 / 國定假日 / 資料存取 / 雲端同步
 * 所有計算規則與電腦版 meal_tracker_pro.py、cloud_sync.py 相同。 */
(() => {
  'use strict';
  const M = (window.M = window.M || {});
  M.VERSION = '2026.11.15.1';

  // ════════════════════════════════════════════════════════════ 日期（一律用 UTC 午夜表示「某一天」）
  const DAY = 864e5;
  const D = {
    make: (y, m, d) => new Date(Date.UTC(y, m - 1, d)),
    today() { const n = new Date(); return D.make(n.getFullYear(), n.getMonth() + 1, n.getDate()); },
    parse(s) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
      if (!m) return null;
      const d = D.make(+m[1], +m[2], +m[3]);
      return D.iso(d) === m[0] ? d : null;
    },
    iso: (d) => d.toISOString().slice(0, 10),
    add: (d, n) => new Date(d.getTime() + n * DAY),
    diff: (a, b) => Math.round((a - b) / DAY),          // a − b（天）
    wd: (d) => (d.getUTCDay() + 6) % 7,                  // 週一 = 0 … 週日 = 6
    y: (d) => d.getUTCFullYear(), m: (d) => d.getUTCMonth() + 1, d: (d) => d.getUTCDate(),
    monday(d) { return D.add(d, -D.wd(d)); },
    fmt(d, sep = '/') { return `${D.y(d)}${sep}${pad(D.m(d))}${sep}${pad(D.d(d))}`; },
    md: (d) => `${pad(D.m(d))}/${pad(D.d(d))}`,
    daysInMonth: (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
  const pad = (n) => String(n).padStart(2, '0');
  M.D = D; M.pad = pad;

  // ════════════════════════════════════════════════════════════ 數字顯示
  /** 最多 2 位小數、去除多餘的 0（58.0 → 58）；comma = 千分位 */
  M.num = (x, comma = false) => {
    x = Number(x) || 0;
    const t = comma ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : x.toFixed(2);
    return t.replace(/0+$/, '').replace(/\.$/, '');
  };
  /** 整數 + 千分位（Python 的 f"{x:,.0f}"） */
  M.money = (x) => Math.round(Number(x) || 0).toLocaleString('en-US');
  M.pct = (x, n = 1) => (Number(x) || 0).toFixed(n);

  // ════════════════════════════════════════════════════════════ 設定 / 結算週期
  M.cfg = { budget: 13000, settle: 26 };
  M.applySettings = (s = {}) => {
    M.cfg.budget = Math.max(1, parseInt(s.budget ?? 13000, 10) || 13000);
    M.cfg.settle = Math.max(1, Math.min(28, parseInt(s.settle_day ?? 26, 10) || 26));
  };
  M.getPeriod = (d) => {
    const sd = M.cfg.settle, y = D.y(d), m = D.m(d);
    if (D.d(d) >= sd) return [D.make(y, m, sd), D.make(y, m + 1, sd)];
    return [D.make(y, m - 1, sd), D.make(y, m, sd)];
  };
  M.periodLabel = (s, e) => `${D.fmt(s)} – ${D.fmt(D.add(e, -1))}`;
  M.periodKey = (s, e) => `${D.iso(s)}~${D.iso(e)}`;

  // ════════════════════════════════════════════════════════════ 農曆（內建 1900～2049 年資料表）
  const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  ];
  const LUNAR_BASE = D.make(1900, 1, 31);
  const LUNAR_MONTHS = '正二三四五六七八九十冬臘';
  const LUNAR_DIGITS = '一二三四五六七八九十';
  M.BAIBAI_DAYS = [1, 16];
  M.BAIBAI_ITEMS = [['烤雞', 1, '支'], ['紅燒肉', 1, '斤'], ['炸鱸魚', 1, '支']];

  const leapMonth = (y) => LUNAR_INFO[y - 1900] & 0xf;
  const monthDays = (y, m) => (LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29);
  const leapDays = (y) => (leapMonth(y) ? (LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29) : 0);
  const yearDaysCache = {};
  const yearDays = (y) => {
    if (yearDaysCache[y] == null) {
      let s = 0;
      for (let m = 1; m <= 12; m++) s += monthDays(y, m);
      yearDaysCache[y] = s + leapDays(y);
    }
    return yearDaysCache[y];
  };
  const lunarCache = new Map();
  /** 國曆 → [年, 月, 日, 是否閏月]；超出範圍 null */
  M.lunarDate = (d) => {
    const k = d.getTime();
    if (lunarCache.has(k)) return lunarCache.get(k);
    let off = D.diff(d, LUNAR_BASE), res = null;
    if (off >= 0) {
      let y = 1900;
      while (y < 1900 + LUNAR_INFO.length && off >= yearDays(y)) { off -= yearDays(y); y++; }
      if (y < 1900 + LUNAR_INFO.length) {
        const leap = leapMonth(y);
        for (let m = 1; m <= 12; m++) {
          let n = monthDays(y, m);
          if (off < n) { res = [y, m, off + 1, false]; break; }
          off -= n;
          if (m === leap) {
            n = leapDays(y);
            if (off < n) { res = [y, m, off + 1, true]; break; }
            off -= n;
          }
        }
      }
    }
    lunarCache.set(k, res);
    return res;
  };
  M.lunarDayName = (day) => {
    if (day <= 10) return '初' + LUNAR_DIGITS[day - 1];
    if (day < 20) return '十' + LUNAR_DIGITS[day - 11];
    if (day === 20) return '二十';
    if (day < 30) return '廿' + LUNAR_DIGITS[day - 21];
    return '三十';
  };
  M.lunarMonthName = (m, leap = false) => (leap ? '閏' : '') + LUNAR_MONTHS[m - 1] + '月';
  M.lunarLabel = (d) => { const lu = M.lunarDate(d); return lu ? M.lunarMonthName(lu[1], lu[3]) + M.lunarDayName(lu[2]) : ''; };
  M.isBaibai = (d) => { const lu = M.lunarDate(d); return !!lu && M.BAIBAI_DAYS.includes(lu[2]); };
  M.nextBaibaiDays = (start, n) => {
    const out = []; let d = start;
    while (out.length < n && M.lunarDate(d)) { if (M.isBaibai(d)) out.push(d); d = D.add(d, 1); }
    return out;
  };
  M.lunarToSolar = (ly, lm, ld) => {
    if (!(ly >= 1900 && ly < 1900 + LUNAR_INFO.length)) return null;
    let off = 0;
    for (let y = 1900; y < ly; y++) off += yearDays(y);
    const leap = leapMonth(ly);
    for (let m = 1; m < lm; m++) { off += monthDays(ly, m); if (m === leap) off += leapDays(ly); }
    return D.add(LUNAR_BASE, off + ld - 1);
  };

  // ════════════════════════════════════════════════════════════ 國定假日 / 連續假期
  const qingming = (y) => { const yy = y % 100; return D.make(y, 4, Math.floor(yy * 0.2422 + 4.81) - Math.floor(yy / 4)); };
  const holCache = {};
  /** 國曆 y 年的放假日：Map(iso → 名稱)（含補假；不含一般週末） */
  M.twHolidays = (y) => {
    if (holCache[y]) return holCache[y];
    const out = new Map();
    const fixed = [[1, 1, '元旦'], [2, 28, '和平紀念日'], [10, 10, '國慶日']];
    if (y >= 2025) fixed.push([5, 1, '勞動節'], [9, 28, '教師節'], [10, 25, '光復節'], [12, 25, '行憲紀念日']);
    const days = fixed.map(([m, d, n]) => [D.make(y, m, d), n]);
    const qm = qingming(y); let kid = D.make(y, 4, 4);
    if (kid.getTime() === qm.getTime()) kid = D.wd(kid) === 3 ? D.add(kid, 1) : D.add(kid, -1);
    days.push([kid, '兒童節'], [qm, '清明節']);
    for (const [lm, ld, n] of [[5, 5, '端午節'], [8, 15, '中秋節']]) { const s = M.lunarToSolar(y, lm, ld); if (s) days.push([s, n]); }
    const has = (d) => out.has(D.iso(d));
    const put = (d, name, step) => { while (has(d) || D.wd(d) >= 5) d = D.add(d, step); out.set(D.iso(d), name); };
    for (const [d, n] of days) if (D.wd(d) < 5 && !has(d)) out.set(D.iso(d), n);
    for (const [d, n] of days) {
      if (D.wd(d) === 5) put(D.add(d, -1), n + '補假', -1);
      else if (D.wd(d) === 6) put(D.add(d, 1), n + '補假', 1);
    }
    for (const ly of [y - 1, y]) {
      const ny = M.lunarToSolar(ly + 1, 1, 1);
      if (!ny) continue;
      const spring = [[D.add(ny, -1), '除夕'], ...[0, 1, 2].map((k) => [D.add(ny, k), '春節' + ['初一', '初二', '初三'][k]])];
      if (ly + 1 >= 2026) spring.unshift([D.add(ny, -2), '小年夜']);
      let extra = spring.filter(([d]) => D.wd(d) >= 5).length;
      for (const [d, n] of spring) if (D.y(d) === y) out.set(D.iso(d), n);
      let d = D.add(ny, 2);
      while (extra) {
        d = D.add(d, 1);
        if (D.wd(d) < 5 && !has(d)) { extra--; if (D.y(d) === y) out.set(D.iso(d), '春節補假'); }
      }
    }
    holCache[y] = out;
    return out;
  };
  M.holidayName = (d) => M.twHolidays(D.y(d)).get(D.iso(d)) || '';
  M.isDayOff = (d) => D.wd(d) >= 5 || M.twHolidays(D.y(d)).has(D.iso(d));
  M.longHolidays = (start, end) => {
    let s = start;
    while (M.isDayOff(D.add(s, -1))) s = D.add(s, -1);
    const out = []; let d = s, run = [];
    while (d <= end || run.length) {
      if (M.isDayOff(d)) run.push(d);
      else {
        if (run.length >= 3) {
          const names = run.map(M.holidayName).filter(Boolean);
          if (names.length) {
            let base = names[0].replace('補假', '');
            if (base.startsWith('春節') || base === '除夕' || base === '小年夜') base = '春節';
            out.push({ start: run[0], end: run[run.length - 1], days: run.length, name: base });
          }
        }
        run = [];
      }
      d = D.add(d, 1);
    }
    return out;
  };

  // ════════════════════════════════════════════════════════════ 資料：與電腦版 meal_data.json 相同結構
  M.data = { records: [] };
  M.ensureDefaults = () => {
    const d = M.data;
    if (!Array.isArray(d.records)) d.records = [];
    if (!Array.isArray(d.ingredients)) d.ingredients = [];
    if (!d.order_plan || typeof d.order_plan !== 'object') d.order_plan = { people: 0 };
    const op = d.order_plan;
    if (!Array.isArray(op.hidden)) op.hidden = [];
    if (!op.mode) op.mode = 'day';
    if (!Array.isArray(op.week)) op.week = [0, 0, 0, 0, 0, 0, 0];
    if (!op.manual || typeof op.manual !== 'object') op.manual = {};
    if (!d.recipes || typeof d.recipes !== 'object') d.recipes = {};
    if (!d.recipe_book || typeof d.recipe_book !== 'object') d.recipe_book = {};
    for (const wk of Object.values(d.menu || {}))
      for (const day of wk.days || [])
        for (const meal of ['breakfast', 'dinner'])
          for (const dish of (day[meal] && day[meal].dishes) || []) delete dish.recipe_loading;
  };
  M.settings = () => M.data.settings || {};
  M.newId = (() => { let last = 0; return () => { let t = Date.now(); if (t <= last) t = last + 1; last = t; return t; }; })();

  // IndexedDB（每台裝置自己的快取；資料本體在雲端試算表）
  const IDB = 'mealtracker';
  let idbP = null;
  const idb = () => idbP || (idbP = new Promise((res, rej) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  M.idbGet = async (k) => {
    try {
      const db = await idb();
      return await new Promise((res) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result); q.onerror = () => res(undefined);
      });
    } catch (e) { return undefined; }
  };
  M.idbPut = async (k, v) => {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, k);
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    } catch (e) { console.warn('IndexedDB 寫入失敗', e); }
  };

  let writeT = null;
  /** 存檔：先寫這台裝置的快取，再通知雲端同步（1.5 秒後上傳，連續存檔只傳一次） */
  M.save = () => {
    clearTimeout(writeT);
    writeT = setTimeout(() => M.idbPut('data', M.data), 200);
    if (M.cloud && M.cloud.enabled) M.cloud.markDirty();
  };
  M.flush = async () => {
    clearTimeout(writeT);
    await M.idbPut('data', M.data);
    if (M.cloud) await M.cloud.flush();
  };

  // ════════════════════════════════════════════════════════════ 雲端同步（同 cloud_sync.py）
  const MISSING = Symbol('missing');
  const TABLE_RULES = {
    records: { s: ['date', 'note', 'period'], n: ['id', 'amount'], opt: ['slip_id'] },
    ingredients: { s: ['date', 'slip_no', 'supplier', 'name', 'unit', 'category'], n: ['id', 'qty', 'price', 'amount'],
      opt: ['slip_id', 'people', 'price_only'] },
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  M.clone = clone;
  /** 轉成雲端存回來會長的樣子（深拷貝） */
  M.normalize = (data) => {
    const out = clone(data || {});
    for (const [key, rule] of Object.entries(TABLE_RULES)) {
      const rows = out[key];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
        for (const f of rule.s) r[f] = r[f] == null ? '' : String(r[f]);
        for (const f of rule.n) if (r[f] == null || r[f] === '') r[f] = 0;
        for (const f of rule.opt) { const v = r[f]; if (v == null || v === '' || v === false || v === 0) delete r[f]; }
      }
    }
    return out;
  };
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const eq = (a, b) => {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
      if (typeof a === 'boolean' && typeof b === 'number') return +a === b;      // Python：True == 1
      if (typeof b === 'boolean' && typeof a === 'number') return a === +b;
      return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !eq(a[k], b[k])) return false;
    return true;
  };
  M.eq = eq;
  const idlist = (x) => Array.isArray(x) && x.every((e) => isObj(e) && 'id' in e);
  /** 三方合併：b = 共同基準，l = 本機，r = 雲端；回傳 MISSING = 刪除 */
  const merge3 = (b, l, r) => {
    if (eq(l, r)) return l;
    if (eq(l, b)) return r;
    if (eq(r, b)) return l;
    if (l === MISSING) return r;
    if (r === MISSING) return l;
    if (isObj(l) && isObj(r)) {
      const bd = isObj(b) ? b : {};
      const out = {};
      for (const k of [...Object.keys(r), ...Object.keys(l).filter((k) => !(k in r))]) {
        const v = merge3(k in bd ? bd[k] : MISSING, k in l ? l[k] : MISSING, k in r ? r[k] : MISSING);
        if (v !== MISSING) out[k] = v;
      }
      return out;
    }
    if (idlist(l) && idlist(r)) {
      const bm = new Map(idlist(b) ? b.map((e) => [e.id, e]) : []);
      const lm = new Map(l.map((e) => [e.id, e]));
      const rm = new Map(r.map((e) => [e.id, e]));
      const out = [];
      for (const e of r) {
        const v = merge3(bm.has(e.id) ? bm.get(e.id) : MISSING, lm.has(e.id) ? lm.get(e.id) : MISSING, e);
        if (v !== MISSING) out.push(v);
      }
      for (const e of l) {
        if (!rm.has(e.id)) {
          const v = merge3(bm.has(e.id) ? bm.get(e.id) : MISSING, e, MISSING);
          if (v !== MISSING) out.push(v);
        }
      }
      return out;
    }
    return l;
  };
  M.merge3 = (b, l, r) => { const v = merge3(b, l, r); return v === MISSING ? {} : v; };

  class CloudError extends Error {}
  class OfflineError extends Error {}
  M.CloudError = CloudError; M.OfflineError = OfflineError;

  const LS_CFG = 'kitchenforms-meal';     // 跟廚房專用表格系統首頁共用（同網域）
  const deviceName = () => {
    let d = '';
    try { d = localStorage.getItem('mealtracker-device') || ''; } catch (e) { /* 無痕模式 */ }
    if (!d) {
      d = '網頁版-' + Math.random().toString(36).slice(2, 6);
      try { localStorage.setItem('mealtracker-device', d); } catch (e) { /* 略過 */ }
    }
    return d;
  };

  class Cloud {
    constructor() {
      this.POLL_MS = 30000; this.DEBOUNCE_MS = 1500;
      this.cfg = Cloud.readCfg();
      this.base = { rev: -1, url: '', data: {} };
      this.state = 'off'; this.message = ''; this.lastOk = null;
      this.busy = false; this.again = false; this.due = null; this.nextPoll = Date.now() + this.POLL_MS;
      this.pending = null; this.onApply = null; this.onStatus = null; this.remoteApp = null;
    }
    static readCfg() {
      try { const c = JSON.parse(localStorage.getItem(LS_CFG)) || {}; return { url: c.url || window.MEAL_CLOUD_URL || '', pw: c.pw || '' }; }
      catch (e) { return { url: window.MEAL_CLOUD_URL || '', pw: '' }; }
    }
    get enabled() { return !!(this.cfg.url && this.cfg.pw); }
    async loadBase() {
      const b = await M.idbGet('base');
      if (b && b.url === this.cfg.url) this.base = b;
    }
    configure(url, pw) {
      url = String(url || '').trim();
      if (url !== this.cfg.url) { this.base = { rev: -1, url, data: {} }; M.idbPut('base', this.base); }
      this.cfg = { url, pw };
      try {
        if (pw) localStorage.setItem(LS_CFG, JSON.stringify({ url, pw }));
        else localStorage.removeItem(LS_CFG);
      } catch (e) { /* 無痕模式 */ }
      if (!this.enabled) { this.state = 'off'; this.message = ''; }
    }
    async call(payload, timeout = 90000) {
      const body = JSON.stringify(Object.assign({}, payload, { pw: this.cfg.pw, device: deviceName() }));
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      let text;
      try {
        const res = await fetch(this.cfg.url, { method: 'POST', body, signal: ctl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        text = await res.text();
      } catch (e) {
        throw new OfflineError(e.name === 'AbortError' ? '連線逾時' : (e.message || String(e)));
      } finally { clearTimeout(t); }
      let res;
      try { res = JSON.parse(text); } catch (e) { throw new CloudError('雲端回應格式不對（網址是否為 Apps Script 網頁應用程式的 /exec 網址？）'); }
      if (!res.ok && !res.conflict) { const err = new CloudError(res.error || '雲端回應錯誤'); err.auth = !!res.auth; throw err; }
      return res;
    }
    async syncOnce(local, ping) {
      local = M.normalize(local);
      const baseData = this.base.data || {};
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!ping) ping = await this.call({ action: 'ping' }, 30000);
        let rev = ping.rev; let remote;
        this.remoteApp = ping.app || null;
        if (rev === this.base.rev) remote = baseData;
        else { const res = await this.call({ action: 'load' }); rev = res.rev; remote = M.normalize(res.data || {}); }
        // 這台裝置第一次連線、本機又沒有資料 → 直接採用雲端的資料（不把空白預設值蓋上去）
        const fresh = this.base.rev === -1 && !(local.records || []).length && !(local.ingredients || []).length;
        const merged = fresh ? clone(remote) : M.merge3(baseData, local, remote);
        const changed = {}, deleted = [];
        for (const k of Object.keys(merged)) if (!(k in remote) || !eq(remote[k], merged[k])) changed[k] = merged[k];
        for (const k of Object.keys(remote)) if (!(k in merged)) deleted.push(k);
        if (Object.keys(changed).length || deleted.length) {
          const res = await this.call({ action: 'save', base_rev: rev, data: changed, deleted });
          if (res.conflict) { ping = null; continue; }
          rev = res.rev;
        }
        this.base = { rev, url: this.cfg.url, data: clone(merged) };
        await M.idbPut('base', this.base);
        return eq(merged, local) ? null : merged;
      }
      throw new CloudError('雲端一直有其他電腦在更新，稍後會再試');
    }
    hasChanges(snap, rev) { return rev !== this.base.rev || !eq(snap, this.base.data || {}); }
    /** 要求同步；quiet = 定時檢查：只問版本號，本機和雲端都沒變動就什麼都不做 */
    async request(quiet = false) {
      if (!this.enabled) return;
      if (this.busy) { if (!quiet) this.again = true; return; }
      this.busy = true;
      const snap = M.normalize(M.data);
      if (!quiet) this.setState('syncing');
      try {
        let ping = null;
        if (quiet) {
          ping = await this.call({ action: 'ping' }, 30000);
          this.remoteApp = ping.app || null;
          if (!this.hasChanges(snap, ping.rev)) { if (this.state !== 'ok') this.setState('ok'); return; }
          this.setState('syncing');
        }
        const merged = await this.syncOnce(snap, ping);
        this.lastOk = Date.now();
        this.setState('ok');
        if (merged) this.apply(snap, merged);
      } catch (e) {
        if (e instanceof OfflineError) this.setState('offline', e.message);
        else this.setState('error', e.message || String(e));
        this.due = null;
      } finally {
        this.busy = false;
        if (this.again) { this.again = false; this.due = Date.now(); }
      }
    }
    apply(snap, merged) {
      if (M.ui && M.ui.modalOpen()) { this.pending = [snap, merged]; return; }   // 對話框開著 → 關掉後再套用
      const cur = M.normalize(M.data);
      if (!eq(cur, snap)) { merged = M.merge3(snap, cur, merged); this.due = Date.now(); }
      if (eq(merged, cur)) return;
      for (const k of Object.keys(M.data)) delete M.data[k];
      Object.assign(M.data, merged);
      M.ensureDefaults();
      M.applySettings(M.settings());
      M.idbPut('data', M.data);
      if (this.onApply) this.onApply();
    }
    setState(s, msg = '') { this.state = s; this.message = msg; if (this.onStatus) this.onStatus(); }
    markDirty() { this.due = Date.now() + this.DEBOUNCE_MS; if (this.onStatus) this.onStatus(); }
    pump() {
      if (this.pending && !(M.ui && M.ui.modalOpen())) { const [s, m] = this.pending; this.pending = null; this.apply(s, m); }
      if (!this.enabled) return;
      const now = Date.now();
      const due = this.due !== null && now >= this.due;
      if (due || now >= this.nextPoll) {
        this.due = null;
        this.nextPoll = now + this.POLL_MS;
        this.request(!due);
      }
    }
    async flush(maxMs = 15000) {
      if (!this.enabled || (this.due === null && !this.busy)) return;
      const end = Date.now() + maxMs;
      while (this.busy && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      if (this.due !== null) { this.due = null; await this.request(false); }
    }
    async changePassword(oldPw, newPw) {
      const saved = this.cfg.pw;
      this.cfg.pw = oldPw;
      try { await this.call({ action: 'setpw', new_pw: newPw }, 30000); }
      catch (e) { this.cfg.pw = saved; throw e; }
      this.configure(this.cfg.url, newPw);
    }
    statusText() {
      if (!this.enabled) return '';
      if (this.due !== null || this.state === 'syncing') return '☁ 同步中…';
      if (this.state === 'ok') {
        if (!this.lastOk) return '☁ 已同步';
        const t = new Date(this.lastOk);
        return `☁ 已同步 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
      }
      if (this.state === 'offline') return '☁ 離線（資料先存這台裝置，連上網路會自動補傳）';
      if (this.state === 'error') return `☁ 同步錯誤：${this.message}`;
      return '☁ 等待同步';
    }
  }
  M.Cloud = Cloud;
})();
