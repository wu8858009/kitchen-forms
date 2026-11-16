/* 廚房專用表格系統 — 人員權限（首頁和每個系統頁面共用）
 * 人員、PIN、權限存在 Google 試算表「廚房專用表格系統 人員權限」，由 Apps Script 驗證 PIN。
 * 這台裝置只存登入後拿到的 Token 和自己的權限（localStorage 'kitchenforms-auth'），一直保持登入直到登出。
 * 桌面版（?desktop=1）不檢查權限。 */
(() => {
  'use strict';
  // Apps Script 網址；空白＝還沒啟用權限管理（大家都能開所有系統）
  const PROD_URL = 'https://script.google.com/macros/s/AKfycbytsxvL-uHb-jNoOr3WLubOBHI8bPk0uRePgJqtcomNihGKcrkfodF21ITbKxnLR00czw/exec';
  const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  let url = PROD_URL;
  if (LOCAL) { try { const o = localStorage.getItem('kitchenforms-auth-url'); if (o != null) url = o; } catch (e) { /* 測試用 */ } }
  const DESK = new URLSearchParams(location.search).has('desktop');
  const LS = 'kitchenforms-auth';
  const MODS = { fridge: '冰箱溫度記錄表', prep: '備料交接日誌', dish: '菜品銷售紀錄', meal: '員工餐金額總計', sop: '廚房SOP食譜', equip: '設備管家' };

  const get = () => { try { return JSON.parse(localStorage.getItem(LS)) || null; } catch (e) { return null; } };
  const set = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)); } catch (e) { /* 空間不足 */ } };
  const clear = () => { try { localStorage.removeItem(LS); } catch (e) { /* */ } };
  const isAdmin = () => { const s = get(); return !!(s && s.me && s.me.role === 'admin'); };
  function can(mod) {
    if (!url || DESK) return true;
    const s = get();
    if (!s || !s.token || !s.me) return false;
    return s.me.role === 'admin' || !!(s.me.perms || {})[mod];
  }
  function dev() {
    const u = navigator.userAgent;
    const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Macintosh/.test(u) ? 'Mac' : '其他';
    const app = window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone ? '主畫面 App' : '瀏覽器';
    return `${os}・${app}`;
  }
  // 呼叫雲端；連不上時丟出錯誤（訊息是中文）
  async function call(action, data) {
    const ac = window.AbortController ? new AbortController() : null;
    const t = setTimeout(() => ac && ac.abort(), 20000);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action }, data || {})), signal: ac ? ac.signal : undefined });
      return await res.json();
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? '雲端回應太慢，請再試一次' : '連不上雲端，請確認網路');
    } finally { clearTimeout(t); }
  }
  // ------------------------------------------------------------------ 管理者分發的雲端連線
  // 冰箱、菜品、SOP：寫進 'kitchenforms-cloud'，打開（或首頁背景執行）那個系統時用它自己的連線流程連上
  // 員工餐：直接寫進 'kitchenforms-meal'（首頁和員工餐都讀這個）
  function applyCloud(c) {
    if (!c || typeof c !== 'object') return false;
    let all = {}, ch = false;
    try { all = JSON.parse(localStorage.getItem('kitchenforms-cloud')) || {}; } catch (e) { all = {}; }
    for (const m of ['fridge', 'dish', 'sop', 'equip']) {
      const x = c[m]; if (!x || !x.url) continue;
      const cur = all[m] || {};
      const kk = m === 'sop' || m === 'equip';
      const same = cur.url === x.url && (kk ? cur.key === x.key : cur.pw === x.pw) && !cur.off;
      if (same || (cur.off && (cur.at || 0) > (x.at || 0))) continue; // 這台自己後來停用的就不蓋掉
      all[m] = kk ? { url: x.url, key: x.key, at: x.at, from: 'admin' } : { url: x.url, pw: x.pw, at: x.at, from: 'admin' };
      ch = true;
    }
    if (ch) { try { localStorage.setItem('kitchenforms-cloud', JSON.stringify(all)); } catch (e) { /* */ } }
    const ml = c.meal;
    if (ml && ml.url && ml.pw) {
      let cur = {}; try { cur = JSON.parse(localStorage.getItem('kitchenforms-meal')) || {}; } catch (e) { cur = {}; }
      if (cur.url !== ml.url || cur.pw !== ml.pw) { try { localStorage.setItem('kitchenforms-meal', JSON.stringify({ url: ml.url, pw: ml.pw })); } catch (e) { /* */ } ch = true; }
    }
    const s = get();
    if (s && s.token) { const k = JSON.stringify(c); if (JSON.stringify(s.cloud || {}) !== k) { s.cloud = c; set(s); } }
    return ch;
  }

  // ------------------------------------------------------------------ 即時檢查權限
  // 畫面開著時每 15 秒、切回 App 時馬上跟雲端確認一次：權限改了、被停用或刪除，馬上套用（首頁和各系統頁面都會）
  const subs = [];
  let busy = false, timer = 0;
  async function check() {
    if (!url || DESK || busy) return;
    const s = get();
    if (!s || !s.token) return;
    busy = true;
    try {
      const r = await call('me', { token: s.token });
      const cur = get();
      if (!cur || cur.token !== s.token) return; // 這段時間換人登入了
      if (r.ok) {
        const changed = JSON.stringify(r.me) !== JSON.stringify(cur.me);
        cur.me = r.me; cur.at = Date.now(); set(cur);
        const cch = applyCloud(r.cloud);
        if (changed) subs.forEach((f) => f('perm'));
        else if (cch) subs.forEach((f) => f('cloud'));
      } else if (r.code === 'auth') {
        set({ last: cur.me && cur.me.name });
        subs.forEach((f) => f('out', r.error || '請重新登入'));
      }
    } catch (e) { /* 沒網路：沿用這台裝置記得的權限 */ } finally { busy = false; }
  }
  function watch(f) {
    subs.push(f);
    if (timer || !url || DESK) return;
    timer = setInterval(() => { if (!document.hidden) check(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    window.addEventListener('online', check);
    window.addEventListener('pageshow', (e) => { if (e.persisted) check(); });
    // 同一台裝置的其他分頁登出、換人
    window.addEventListener('storage', (e) => { if (e.key === LS) subs.forEach((g) => g('storage')); });
    setTimeout(check, 1200);
  }
  window.KitchenAuth = { get on() { return !!url && !DESK; }, url, MODS, get, set, clear, can, isAdmin, call, dev, check, watch, applyCloud };
})();
