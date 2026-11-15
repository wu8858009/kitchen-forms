/* 員工餐金額總計 — 網頁版主程式：側欄導覽、頁面切換、頂部時鐘、狀態列、快捷鍵、啟動與雲端同步 */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const DESK = new URLSearchParams(location.search).has('desktop');
  M.DESK = DESK;

  const NAV = [
    ['dashboard', '📊', '儀表板', 'Dashboard'],
    ['records', '🧾', '費用記錄', 'Records'],
    ['ingredients', '🥬', '食材單價', 'Ingredients'],
    ['order', '🛒', '叫貨計算', 'Order'],
    ['schedule', '🗓', '排班人數', 'Schedule'],
    ['menu', '🍱', '菜單排程', 'Menu'],
    ['lunar', '🏮', '農民曆', 'Lunar'],
    ['recipebook', '📖', '食譜庫', 'Recipes'],
    ['report', '📈', '歷期報表', 'Reports'],
    ['settings', '⚙', '系統設定', 'Settings'],
  ];
  const TITLES = {
    dashboard: '儀表板  /  Dashboard', records: '費用記錄  /  Records', ingredients: '食材單價  /  Ingredients',
    order: '叫貨計算  /  Order', schedule: '排班人數  /  Schedule', menu: '菜單排程  /  Menu',
    lunar: '農民曆  /  Lunar Calendar', recipebook: '食譜庫  /  Recipes', report: '歷期報表  /  Reports', settings: '系統設定  /  Settings',
  };
  M.active = 'dashboard';
  const stale = new Set();

  // ════════════════════════════════════════════════════════════ 共用計算（同電腦版）
  M.currentPeriodRecords = () => {
    const [s, e] = M.getPeriod(D.today()), si = D.iso(s), ei = D.iso(e);
    return M.data.records.filter((r) => si <= r.date && r.date < ei);
  };
  /** 指定週期開始日當時生效的預算 */
  M.getPeriodBudget = (s) => {
    const pb = M.settings().period_budgets || {};
    const si = D.iso(s);
    const ks = Object.keys(pb).filter((k) => k <= si).sort();
    return ks.length ? Number(pb[ks[ks.length - 1]]) : M.cfg.budget;
  };
  /** 品名 → [最近單位, 最近單價] */
  M.ingLast = () => {
    const last = {};
    for (const r of [...M.data.ingredients].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)))
      last[r.name] = [r.unit || '', r.price];
    return last;
  };
  M.sortByDateId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

  // ════════════════════════════════════════════════════════════ 頁面
  const pagesEl = document.getElementById('pages');
  M.pages = M.pages || {};
  const built = new Set();
  const ensureBuilt = (pid) => {
    if (built.has(pid)) return false;
    const p = M.pages[pid];
    const el = h('section.page#page-' + pid);
    pagesEl.appendChild(el);
    p.el = el;
    built.add(pid);
    p.build(el);
    return true;
  };
  M.ensureBuilt = ensureBuilt;
  M.showPage = (pid) => {
    if (ensureBuilt(pid)) stale.add(pid);
    const prev = M.active;
    if (prev && M.pages[prev] && M.pages[prev].el) M.pages[prev].el.classList.remove('on');
    M.active = pid;
    M.pages[pid].el.classList.add('on');
    for (const it of navEl.children) it.classList.toggle('on', it.dataset.pid === pid);
    document.getElementById('title').textContent = TITLES[pid] || '';
    if (stale.has(pid) || M.pages[pid].alwaysRefresh) { stale.delete(pid); M.pages[pid].refresh && M.pages[pid].refresh(); }
    if (M.pages[pid].onShow) M.pages[pid].onShow();
    document.body.classList.remove('nav-open');
    try { sessionStorage.setItem('mealtracker-page', pid); } catch (e) { /* 略過 */ }
  };
  /** 從導覽列 / 快捷鍵切頁：進食材單價 → 自動開新增貨單；進費用記錄 → 自動開新增餐費記錄 */
  M.navTo = (pid) => {
    if (M.active === pid) { document.body.classList.remove('nav-open'); return; }
    M.showPage(pid);
    const cfg = M.settings();
    if (pid === 'ingredients' && cfg.nav_open_slip !== false) setTimeout(() => M.addSlip(), 80);
    else if (pid === 'records' && cfg.nav_open_record !== false) setTimeout(() => M.addRecord(), 80);
  };
  /** 資料變動後：目前頁面立刻重畫，其他頁面切過去時再重畫 */
  M.refreshAll = () => {
    for (const pid of Object.keys(M.pages)) if (built.has(pid)) stale.add(pid);
    if (built.has(M.active)) { stale.delete(M.active); M.pages[M.active].refresh && M.pages[M.active].refresh(); }
    M.refreshSidebar();
    M.updateStatusInfo();
  };
  M.refreshPage = (pid) => {
    if (!built.has(pid)) return;
    if (M.active === pid) M.pages[pid].refresh && M.pages[pid].refresh(); else stale.add(pid);
  };

  // ════════════════════════════════════════════════════════════ 側欄
  const navEl = document.getElementById('nav');
  M.navOrder = NAV.map((n) => n[0]);
  const buildNav = () => {
    ui.clear(navEl);
    const saved = (M.settings().nav_order || []).filter((p) => NAV.some((n) => n[0] === p));
    M.navOrder = [...saved, ...NAV.map((n) => n[0]).filter((p) => !saved.includes(p))];
    for (const pid of M.navOrder) {
      const [, icon, label, sub] = NAV.find((n) => n[0] === pid);
      const it = h('div.nav-it' + (pid === M.active ? '.on' : ''), { 'data-pid': pid, title: `${label}（拖曳可調整順序）` },
        h('span.ic', icon), h('div', h('b', label), h('small', sub)));
      navEl.appendChild(it);
    }
  };
  // 點一下 → 切頁；按住拖曳 → 調整順序（放開時存到設定）
  (() => {
    let drag = null;
    navEl.addEventListener('pointerdown', (e) => {
      const it = e.target.closest('.nav-it');
      if (!it || e.button !== 0) return;
      drag = { it, y: e.clientY, moved: false, id: e.pointerId };
    });
    navEl.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientY - drag.y) < 6) return;
      if (!drag.moved) { drag.moved = true; drag.it.classList.add('dragging'); try { navEl.setPointerCapture(e.pointerId); } catch (err) { /* 略過 */ } }
      const others = [...navEl.children].filter((x) => x !== drag.it);
      let before = null;
      for (const o of others) { const r = o.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = o; break; } }
      if (before) { if (drag.it.nextSibling !== before) navEl.insertBefore(drag.it, before); }
      else if (navEl.lastChild !== drag.it) navEl.appendChild(drag.it);
    });
    const end = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag; drag = null;
      if (d.moved) {
        d.it.classList.remove('dragging');
        M.navOrder = [...navEl.children].map((x) => x.dataset.pid);
        (M.data.settings = M.data.settings || {}).nav_order = [...M.navOrder];
        M.save();
      } else if (e && e.type === 'pointerup') M.navTo(d.it.dataset.pid);
    };
    navEl.addEventListener('pointerup', end);
    navEl.addEventListener('pointercancel', () => { if (drag) { drag.it.classList.remove('dragging'); drag = null; } });
  })();
  document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

  /** 側欄每月預算：預算 − 本期已用 − 還沒叫貨的初一／十六拜拜菜預扣 */
  M.refreshSidebar = () => {
    const [s, e] = M.getPeriod(D.today());
    const budget = M.getPeriodBudget(s);
    let used = M.currentPeriodRecords().reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const [reserved, , paid] = M.baibaiReserve(s, e);
    used -= paid;
    const remain = budget - used - reserved;
    const b = document.getElementById('sb-budget');
    b.textContent = `NT$ ${M.money(remain)}`;
    b.classList.toggle('neg', remain < 0);
    const rsv = document.getElementById('sb-rsv');
    rsv.hidden = !reserved;
    rsv.textContent = reserved ? `原 ${M.money(budget)} − 拜拜預扣 ${M.money(reserved)}` : '';
    const sd = M.cfg.settle, ed = sd > 1 ? sd - 1 : '月末';
    document.getElementById('sb-period').textContent = `結算：每月${ed}  新期：${sd}日`;
  };
  M.updateStatusInfo = () => {
    const sd = M.cfg.settle, ed = sd > 1 ? sd - 1 : '月末';
    const cloud = M.cloud ? M.cloud.statusText() : '';
    document.getElementById('sb-info').textContent =
      (cloud ? cloud + '  |  ' : '') + `F1 快捷鍵  |  Budget NT$${M.money(M.cfg.budget)} / ${sd}→${ed}  |  PRO 網頁版 v${M.VERSION}`;
    if (M.pages.settings && M.pages.settings.cloudLabel) M.pages.settings.cloudLabel();
  };
  const tick = () => {
    const n = new Date();
    const [s, e] = M.getPeriod(D.today());
    document.getElementById('clock').textContent =
      `${n.getFullYear()}-${M.pad(n.getMonth() + 1)}-${M.pad(n.getDate())}  ${M.pad(n.getHours())}:${M.pad(n.getMinutes())}:${M.pad(n.getSeconds())}    本期 ${M.periodLabel(s, e)}`;
  };

  // ════════════════════════════════════════════════════════════ 快捷鍵（同電腦版）
  const perPage = (acts) => () => { const f = acts[M.active]; if (f) f(); };
  const shortcutTable = () => {
    const pg = (pid) => M.pages[pid] || {};
    return [
      ['全域', [
        ['Ctrl+1 ～ Ctrl+9、Ctrl+0', '切換頁面（依側欄由上到下的順序）', null],
        ['Ctrl+N', '新增貨單', ['n', () => M.addSlip()]],
        ['Ctrl+M', '新增餐費記錄', ['m', () => M.addRecord()]],
        ['Ctrl+F', '搜尋（費用記錄 / 食材單價 / 食譜庫）', ['f', () => scSearch()]],
        ['Ctrl+E', '匯出 CSV（費用記錄 / 食材單價 / 叫貨計算 / 歷期報表）', ['e', perPage({
          records: () => pg('records').exportCsv(), ingredients: () => pg('ingredients').exportCsv(),
          order: () => pg('order').exportCsv(), report: () => pg('report').exportAll() })]],
        ['Ctrl+Shift+C', '複製叫貨單（叫貨計算 / 農民曆）', ['C', perPage({ order: () => pg('order').copy(), lunar: () => pg('lunar').copy() }), true]],
        ['Ctrl+S', '儲存（系統設定頁 = 儲存設定）', ['s', () => { if (M.active === 'settings') pg('settings').save(); else { M.save(); ui.status('資料已儲存'); } }]],
        ['Ctrl+B', '立即備份資料（下載 JSON）', ['b', () => M.backupData()]],
        ['F5', '重新整理全部資料', null],
        ['F1', '顯示這份快捷鍵說明', null],
      ]],
      ['週 / 月切換（排班人數 / 菜單排程 / 農民曆）', [
        ['Alt+←', '上一週 / 上個月', null], ['Alt+→', '下一週 / 下個月', null],
        ['Alt+Home', '回到本週 / 本月（儀表板 = 回到本期）', null],
      ]],
      ['清單（費用記錄 / 食材單價 / 歷期報表明細）', [['Enter', '編輯選取的項目', null], ['Delete', '刪除選取的項目', null]]],
      ['對話框', [['Enter', '下一欄 / 確認', null], ['Ctrl+Enter', '貨單直接儲存', null], ['Esc', '取消、關閉視窗', null]]],
    ];
  };
  const scSearch = () => {
    const pid = ['ingredients', 'recipebook'].includes(M.active) ? M.active : 'records';
    if (M.active !== pid) M.showPage(pid);
    const ent = M.pages[pid].searchInput;
    if (ent) { ent.focus(); ent.select(); }
  };
  M.showShortcuts = () => {
    const body = h('div');
    for (const [grp, rows] of shortcutTable()) {
      body.appendChild(h('div.sc-grp', grp));
      for (const [k, d] of rows) body.appendChild(h('div.sc-row', h('kbd', k), h('span', d)));
    }
    const m = ui.modal({ title: '⌨  鍵盤快捷鍵', width: 600, body, clickOut: true, buttons: [{ text: '關閉 (Esc)', kind: 'muted', onclick: () => m.close() }] });
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); if (!ui.modalOpen()) M.showShortcuts(); else if (ui.topModal()) ui.topModal().close(); return; }
    if (ui.modalOpen()) return;                       // 對話框開著 → 不觸發主畫面快捷鍵
    if (e.key === 'F5') { e.preventDefault(); M.refreshAll(); if (M.cloud.enabled) M.cloud.request(false); ui.status('已重新整理'); return; }
    if (e.altKey && !e.ctrlKey && ['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {
      const p = M.pages[M.active];
      if (e.key === 'Home' && M.active === 'dashboard') { e.preventDefault(); p.gotoCurrent(); return; }
      if (p && p.shift) { e.preventDefault(); if (e.key === 'Home') p.home(); else p.shift(e.key === 'ArrowLeft' ? -1 : 1); }
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (/^[0-9]$/.test(e.key) && !e.shiftKey) {
      e.preventDefault();
      const k = (+e.key + 9) % 10;
      if (k < M.navOrder.length) M.navTo(M.navOrder[k]);
      return;
    }
    const key = e.key.length === 1 ? e.key : '';
    for (const [, rows] of shortcutTable()) for (const [, , b] of rows) {
      if (!b) continue;
      const [k, fn, shift] = b;
      if (shift ? (e.shiftKey && key.toUpperCase() === k) : (!e.shiftKey && key.toLowerCase() === k)) {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if (typing && ['b', 'C', 'e'].includes(k) === false && k !== 'n' && k !== 'm' && k !== 's' && k !== 'f') return;
        e.preventDefault(); fn(); return;
      }
    }
  });

  // ════════════════════════════════════════════════════════════ 備份 / 匯入 JSON
  M.backupData = () => {
    const n = new Date();
    const ts = `${n.getFullYear()}${M.pad(n.getMonth() + 1)}${M.pad(n.getDate())}_${M.pad(n.getHours())}${M.pad(n.getMinutes())}${M.pad(n.getSeconds())}`;
    ui.download(`meal_data_backup_${ts}.json`, JSON.stringify(M.data, null, 2), 'application/json');
    ui.status(`備份完成：meal_data_backup_${ts}.json`);
  };

  // ════════════════════════════════════════════════════════════ 雲端
  M.cloud = new M.Cloud();
  M.cloud.onStatus = () => M.updateStatusInfo();
  M.cloud.onApply = () => {
    M.refreshAll();
    for (const pid of ['schedule', 'menu']) if (M.pages[pid] && M.pages[pid].reload) M.pages[pid].reload();
    ui.status('已載入其他電腦／試算表的最新修改');
  };
  setInterval(() => M.cloud.pump(), 500);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) M.flush();
    else if (M.cloud.enabled) M.cloud.nextPoll = 0;           // 切回來 → 馬上檢查雲端有沒有更新
  });
  window.addEventListener('pagehide', () => { M.idbPut('data', M.data); });
  window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (M.pages[p] && !ui.modalOpen()) M.showPage(p); });
  window.__meal = { flush: () => M.flush(), get data() { return M.data; }, M };

  /** 第一次使用 / 密碼錯誤：輸入雲端同步密碼 */
  M.cloudDialog = (reason) => new Promise((res) => {
    const url = ui.input(M.cloud.cfg.url || window.MEAL_CLOUD_URL || '', { class: 'mono' });
    const pw = ui.input(M.cloud.cfg.pw || '', { type: 'password', autocomplete: 'current-password' });
    const show = h('input', { type: 'checkbox', onchange: () => { pw.type = show.checked ? 'text' : 'password'; } });
    const body = h('div',
      h('p.sub', { style: { whiteSpace: 'pre-line', margin: '4px 0 0' } }, reason ||
        '網頁版的資料存在你的 Google 試算表，跟電腦版「系統設定 → 雲端同步」是同一份。\n請輸入電腦版使用的同步密碼（只存在這台裝置）。'),
      ui.field('雲端網址', url), ui.field('同步密碼', pw),
      h('label.chk', { style: { marginTop: '8px' } }, show, '顯示密碼'));
    let done = false;
    const go = () => {
      if (!pw.value.trim()) { ui.warn('雲端同步', '請輸入同步密碼。'); return; }
      if (!url.value.trim().startsWith('https://script.google.com/') && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url.value.trim())) {
        ui.error('雲端同步', '請填 Apps Script 網頁應用程式網址（https://script.google.com/…/exec）。'); return;
      }
      done = true; m.close();
      M.cloud.configure(url.value.trim(), pw.value.trim());
      res(true);
    };
    const m = ui.modal({
      title: '☁  連線雲端資料', accent: 'var(--accent2)', width: 520, body, clickOut: false,
      buttons: [{ text: '先不連線', kind: 'muted', onclick: () => { done = true; m.close(); res(false); } }, { text: '連線並同步', kind: 'blue', onclick: go }],
      onClose: () => { if (!done) res(false); },
    });
    ui.enterChain([url, pw], go);
    setTimeout(() => (M.cloud.cfg.pw ? url : pw).focus(), 40);
  });

  /** 啟動時跟雲端同步（最多等 25 秒；太慢就先用這台裝置的資料，背景繼續） */
  const bootSync = async () => {
    const msg = document.getElementById('sp-msg');
    msg.textContent = '同步雲端資料…';
    const p = M.cloud.request(false);
    await Promise.race([p, new Promise((r) => setTimeout(r, 25000))]);
    if (M.cloud.state === 'error' && /密碼錯誤/.test(M.cloud.message)) return 'auth';
    return M.cloud.state;
  };

  const boot = async () => {
    const msg = document.getElementById('sp-msg');
    msg.textContent = '讀取資料…';
    const local = await M.idbGet('data');
    if (local && typeof local === 'object') Object.assign(M.data, local);
    M.ensureDefaults();
    M.applySettings(M.settings());
    await M.cloud.loadBase();
    let state = M.cloud.enabled ? await bootSync() : 'off';
    const splash = document.getElementById('splash');
    // 畫面
    buildNav();
    let start = 'dashboard';
    try { const s = sessionStorage.getItem('mealtracker-page'); if (s && M.pages[s]) start = s; } catch (e) { /* 略過 */ }
    const hp = location.hash.replace('#', '');
    if (M.pages[hp]) start = hp;
    M.showPage(start);
    M.refreshAll();
    tick(); setInterval(tick, 1000);
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 400);
    // 第一次使用（沒設定密碼）或密碼錯誤 → 請使用者輸入
    if (state === 'off' || state === 'auth') {
      const ok = await M.cloudDialog(state === 'auth' ? '雲端回應「密碼錯誤」，請重新輸入電腦版使用的同步密碼。' : null);
      if (ok) {
        ui.status('正在連線雲端…');
        await M.cloud.request(false);
        if (M.cloud.state === 'ok') { M.refreshAll(); for (const pid of ['schedule', 'menu']) if (M.pages[pid] && M.pages[pid].reload) M.pages[pid].reload(); ui.status('雲端資料已載入'); }
        else ui.error('雲端同步', M.cloud.statusText());
        state = M.cloud.state;
      }
    }
    if (state === 'offline') ui.status('目前離線：先使用這台裝置上次的資料，連上網路會自動同步');
    // 依設定自動開新增貨單 / 新增餐費記錄（兩個都勾 → 先貨單、再餐費記錄）
    const cfg = M.settings();
    if (!ui.modalOpen()) {
      if (cfg.startup_open_slip !== false && (cfg.startup_open_slip ?? true)) await M.addSlip();
      if (cfg.startup_open_record) await M.addRecord();
    }
  };
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !DESK) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot().catch((e) => { console.error(e); document.getElementById('sp-msg').textContent = '啟動失敗：' + (e.message || e); });
})();
