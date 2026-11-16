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
  const MODS = { fridge: '冰箱溫度記錄表', prep: '備料交接日誌', dish: '菜品銷售紀錄', meal: '員工餐金額總計' };

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
  window.KitchenAuth = { get on() { return !!url && !DESK; }, url, MODS, get, set, clear, can, isAdmin, call, dev };
})();
