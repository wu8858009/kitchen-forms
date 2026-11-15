/* 廚房專用表格系統 — 首頁儀表板：冰箱溫度、菜品銷售、員工餐三個系統的入口與今日重點 */
(() => {
  'use strict';
  const VERSION = '1.0.0';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const Q = DESK ? '?desktop=1' : '';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const money = (n) => Math.round(n).toLocaleString('zh-TW');
  const WD = '日一二三四五六';
  const LS_MEAL = 'kitchenforms-meal';

  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  function api() {
    return new Promise((res) => {
      const ok = () => window.pywebview && window.pywebview.api && window.pywebview.api.dash;
      if (ok()) return res(window.pywebview.api);
      const iv = setInterval(() => { if (ok()) { clearInterval(iv); res(window.pywebview.api); } }, 50);
    });
  }
  // 冰箱、菜品網頁版把資料存在同網域的 IndexedDB（資料庫名稱 fridgetemp / dishsales，kv['db']）
  function idbGet(name) {
    return new Promise((res) => {
      let r;
      try { r = indexedDB.open(name, 1); } catch (e) { return res(null); }
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => res(null);
      r.onsuccess = () => {
        const d = r.result;
        try {
          const q = d.transaction('kv').objectStore('kv').get('db');
          q.onsuccess = () => { d.close(); res(q.result || null); };
          q.onerror = () => { d.close(); res(null); };
        } catch (e) { d.close(); res(null); }
      };
    });
  }
  const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  const mealConf = () => { try { return JSON.parse(localStorage.getItem(LS_MEAL)) || {}; } catch (e) { return {}; } };

  // ------------------------------------------------------------------ 讀取三個系統的資料
  async function loadAll() {
    if (DESK) {
      const r = parse(await (await api()).dash()) || {};
      return { fridge: parse(r.fridge), dish: parse(r.dish), meal: parse(r.meal), mealInfo: r.meal_info || {} };
    }
    const [f, d] = await Promise.all([idbGet('fridgetemp'), idbGet('dishsales')]);
    let meal = null; const mealInfo = {};
    const mc = mealConf();
    if (mc.pw) {
      try {
        const res = await fetch(mc.url || window.MEAL_CLOUD_URL, { method: 'POST', body: JSON.stringify({ action: 'load', pw: mc.pw }) });
        const j = await res.json();
        if (j.ok) meal = j.data; else mealInfo.error = j.error || '讀取失敗';
      } catch (e) { mealInfo.error = '連不上雲端（' + (e.message || e) + '）'; }
    }
    return { fridge: parse(f), dish: parse(d), meal, mealInfo };
  }

  // ------------------------------------------------------------------ 冰箱溫度
  function fridgeSummary(db, now) {
    if (!db || !Array.isArray(db.fridges)) return null;
    const today = ymd(now);
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const fr = db.fridges.filter((f) => !f.deleted && !f.off);
    const slots = (db.slots || []).filter((s) => !s.deleted);
    const recs = (db.recs || {})[today] || {};
    let done = 0, bad = 0, noAct = 0, due = 0, dueDone = 0;
    const per = slots.map((s) => {
      let n = 0;
      fr.forEach((f) => {
        const e = recs[f.id] && recs[f.id][s.id];
        if (e && e.t != null) {
          n++;
          if (e.x) { bad++; if (!String(e.act || '').trim()) noAct++; }
        }
      });
      done += n;
      const isDue = !s.time || s.time <= hm;
      if (isDue) { due += fr.length; dueDone += n; }
      return { name: s.name, time: s.time, n, total: fr.length, isDue };
    });
    return { shop: db.shop, count: fr.length, total: fr.length * slots.length, done, bad, noAct, missing: due - dueDone, per };
  }
  function fridgeCard(s) {
    let body;
    if (!s) body = '<p class="note">這台裝置還沒有冰箱溫度資料，點「開啟」開始使用（可在設定頁連線 Google 雲端取回資料）。</p>';
    else {
      const chips = s.per.map((p) => {
        const cls = p.n >= p.total ? 'ok' : p.isDue ? 'warn' : '';
        return `<span class="chip ${cls}">${esc(p.name)}${p.time ? ' ' + esc(p.time) : ''}　${p.n}/${p.total}</span>`;
      }).join('');
      body = `<div class="kpis">
          <div class="kpi ${s.done >= s.total && s.total ? 'ok' : ''}"><div class="l">今日已記錄</div><div class="v">${s.done}<small> / ${s.total}</small></div></div>
          <div class="kpi ${s.missing ? 'warn' : 'ok'}"><div class="l">已到時間未記錄</div><div class="v">${s.missing}</div></div>
          <div class="kpi ${s.bad ? 'bad' : 'ok'}"><div class="l">超溫異常</div><div class="v">${s.bad}</div></div>
        </div>
        <div class="chips">${chips}</div>
        ${s.noAct ? `<p class="note bad">⚠ 有 ${s.noAct} 筆異常還沒填處置</p>` : ''}
        <p class="note">共 ${s.count} 台設備</p>`;
    }
    return card('fridge', '🌡️', '冰箱溫度記錄表', '每日記錄・超溫警示・月報表', body,
      `<a class="btn" href="fridge/index.html${Q}#/day" data-mod="fridge">開啟</a><a class="btn sub" href="fridge/index.html${Q}#/month" data-mod="fridge">月報表</a>`);
  }

  // ------------------------------------------------------------------ 菜品銷售
  function dishSummary(db, now) {
    if (!db || !db.sales) return null;
    const sum = (day) => {
      const it = (db.sales[day] && db.sales[day].items) || {};
      let amt = 0, q = 0, kinds = 0;
      Object.values(it).forEach((e) => { if (e && e.q > 0) { amt += e.q * (e.p || 0); q += e.q; kinds++; } });
      return { amt, q, kinds };
    };
    const today = ymd(now);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const mon = today.slice(0, 7);
    let mAmt = 0, mDays = 0;
    Object.keys(db.sales).forEach((k) => { if (k.startsWith(mon)) { const s = sum(k); if (s.q) { mAmt += s.amt; mDays++; } } });
    return { shop: db.shop, t: sum(today), y: sum(ymd(y)), mAmt, mDays, month: +mon.slice(5) };
  }
  function dishCard(s) {
    let body;
    if (!s) body = '<p class="note">這台裝置還沒有菜品銷售資料，點「開啟」開始使用（可在設定頁連線 Google 雲端取回資料）。</p>';
    else body = `<div class="kpis">
          <div class="kpi"><div class="l">今日銷售額</div><div class="v">${money(s.t.amt)}</div></div>
          <div class="kpi"><div class="l">今日份數</div><div class="v">${s.t.q}<small> 份</small></div></div>
          <div class="kpi"><div class="l">${s.month} 月累計</div><div class="v">${money(s.mAmt)}</div></div>
        </div>
        <p class="note">今日 ${s.t.kinds} 道菜有銷量・昨日 ${money(s.y.amt)} 元（${s.y.q} 份）・本月 ${s.mDays} 天有記錄</p>`;
    return card('dish', '🍱', '菜品銷售紀錄', '每日銷量・菜單價格・統計報表', body,
      `<a class="btn" href="dish/index.html${Q}#/day" data-mod="dish">開啟</a><a class="btn sub" href="dish/index.html${Q}#/report" data-mod="dish">報表</a>`);
  }

  // ------------------------------------------------------------------ 員工餐（與電腦版 meal_tracker_pro.py 的週期、預算算法相同）
  function mealSummary(d, now) {
    if (!d || !Array.isArray(d.records)) return null;
    const st = d.settings || {};
    const sd = Math.max(1, Math.min(28, parseInt(st.settle_day, 10) || 26));
    const y = now.getFullYear(), m = now.getMonth();
    const s = now.getDate() >= sd ? new Date(y, m, sd) : new Date(y, m - 1, sd);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, sd);
    const sI = ymd(s), eI = ymd(e);
    const pb = st.period_budgets || {};
    let budget = Math.max(1, parseInt(st.budget, 10) || 13000);
    const ks = Object.keys(pb).filter((k) => k <= sI).sort();
    if (ks.length) budget = +pb[ks[ks.length - 1]] || budget;
    const recs = d.records.filter((r) => r.date >= sI && r.date < eI);
    const used = recs.reduce((a, r) => a + (+r.amount || 0), 0);
    const today = ymd(now);
    const todayAmt = recs.filter((r) => r.date === today).reduce((a, r) => a + (+r.amount || 0), 0);
    const last = recs.map((r) => r.date).sort().pop();
    const eDisp = new Date(e); eDisp.setDate(eDisp.getDate() - 1);
    const daysLeft = Math.round((e - new Date(y, m, now.getDate())) / 864e5);
    return { budget, used, remain: budget - used, pct: used / budget, warn: (st.warn_pct || 80) / 100, danger: (st.danger_pct || 90) / 100,
      range: `${s.getMonth() + 1}/${s.getDate()} – ${eDisp.getMonth() + 1}/${eDisp.getDate()}`, todayAmt, last, daysLeft };
  }
  function mealCard(s, info) {
    let body;
    const btns = [];
    if (DESK) {
      btns.push('<button class="btn" data-act="meal-open">開啟員工餐程式</button>');
      btns.push('<button class="btn sub" data-act="meal-pick">程式位置…</button>');
    } else btns.push(`<button class="btn" data-act="meal-cloud">${mealConf().pw ? '雲端連線設定' : '連線雲端資料'}</button>`);
    if (!s) {
      if (DESK) body = info.exe ? '<p class="note">找不到員工餐的資料檔（meal_data.json）。</p>'
        : '<p class="note">還沒設定員工餐程式的位置。請按「程式位置…」選擇「碧水堂員工餐.exe」。</p>';
      else body = info.error ? `<p class="note bad">${esc(info.error)}</p>`
        : '<p class="note">員工餐記帳請用電腦版。輸入雲端同步密碼後，這裡會顯示本期預算使用狀況。</p>';
    } else {
      const lvl = s.remain < 0 || s.pct >= s.danger ? 'bad' : s.pct >= s.warn ? 'warn' : '';
      body = `<div class="kpis">
          <div class="kpi ${lvl || 'ok'}"><div class="l">本期剩餘</div><div class="v">${money(s.remain)}</div></div>
          <div class="kpi"><div class="l">本期已用</div><div class="v">${money(s.used)}</div></div>
          <div class="kpi"><div class="l">今日</div><div class="v">${money(s.todayAmt)}</div></div>
        </div>
        <div class="bar ${lvl}"><i style="width:${Math.min(100, s.pct * 100).toFixed(1)}%"></i></div>
        <p class="note">結算週期 ${s.range}（還有 ${s.daysLeft} 天）・預算 ${money(s.budget)}・已用 ${(s.pct * 100).toFixed(0)}%${s.last ? '・最後記帳 ' + s.last.slice(5).replace('-', '/') : ''}<br>剩餘未扣初一／十六拜拜菜預扣，以員工餐程式顯示為準。</p>`;
    }
    if (DESK && info.exe) body += `<p class="note">程式：<code>${esc(info.exe)}</code></p>`;
    return card('meal', '🍚', '員工餐金額總計', '餐費記帳・食材單價・本期預算', body, btns.join(''));
  }

  function card(cls, ic, title, sub, body, foot) {
    return `<article class="card ${cls}"><div class="card-h"><div class="ic">${ic}</div><h2>${title}<small>${sub}</small></h2></div>
      <div class="card-b">${body}</div><div class="card-f">${foot}</div></article>`;
  }

  // ------------------------------------------------------------------ 畫面
  let last = null;
  async function render() {
    const now = new Date();
    $('#today').textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}（${WD[now.getDay()]}）`;
    let d;
    try { d = await loadAll(); } catch (e) { d = { mealInfo: { error: String(e.message || e) } }; }
    last = d;
    const fs = fridgeSummary(d.fridge, now), ds = dishSummary(d.dish, now), ms = mealSummary(d.meal, now);
    const shop = (fs && fs.shop) || (ds && ds.shop) || '';
    $('#shop').textContent = shop ? `${shop}・廚房表格` : '廚房專用表格系統';
    $('#cards').innerHTML = fridgeCard(fs) + dishCard(ds) + mealCard(ms, d.mealInfo || {});
    $('#foot').innerHTML = `廚房專用表格系統 v${VERSION}${DESK ? '（桌面版）' : ''}・更新於 ${pad(now.getHours())}:${pad(now.getMinutes())}`
      + (DESK ? '<br>冰箱、菜品的資料與原本的單獨程式共用同一份（%APPDATA%），雲端同步設定也沿用。' : '<br>冰箱、菜品的資料存在這台裝置，並可各自在設定頁連線 Google 雲端同步。');
    window.__kitchen.summary = { fridge: fs, dish: ds, meal: ms };
  }

  function mealCloudDialog() {
    const mc = mealConf();
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal"><h3>員工餐雲端資料</h3>
      <p class="note">輸入員工餐電腦版「雲端同步」用的密碼，首頁就能顯示本期預算（只讀取，不會修改資料）。密碼只存在這台裝置。</p>
      <label>雲端網址</label><input id="mu" value="${esc(mc.url || window.MEAL_CLOUD_URL || '')}" autocomplete="off">
      <label>同步密碼</label><input id="mp" type="password" value="${esc(mc.pw || '')}" autocomplete="current-password">
      <div class="row">${mc.pw ? '<button type="button" class="sec" data-x="off">取消連線</button>' : ''}<button type="button" class="sec" data-x="close">關閉</button><button class="pri">儲存</button></div></form>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => {
      if (e.target === bg || e.target.dataset.x === 'close') close();
      if (e.target.dataset.x === 'off') { localStorage.removeItem(LS_MEAL); close(); render(); }
    });
    bg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = $('#mu', bg).value.trim(), pw = $('#mp', bg).value;
      if (!pw) return toast('請輸入密碼');
      try { localStorage.setItem(LS_MEAL, JSON.stringify({ url, pw })); } catch (err) { /* 無痕模式 */ }
      close(); toast('讀取中…'); render();
    });
    $('#mp', bg).focus();
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'meal-cloud') mealCloudDialog();
    if (a === 'meal-open') {
      const r = await (await api()).open_meal();
      if (r === true) toast('已開啟員工餐程式'); else toast(r || '無法開啟', 4000);
    }
    if (a === 'meal-pick') {
      const r = await (await api()).pick_meal();
      if (r) { toast('已設定：' + r); render(); }
    }
  });
  $('#refresh').addEventListener('click', () => { render().then(() => toast('已更新')); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); render(); }
    if (e.altKey && ['1', '2'].includes(e.key)) { e.preventDefault(); location.href = (e.key === '1' ? 'fridge' : 'dish') + `/index.html${Q}`; }
    if (e.altKey && e.key === '3' && DESK) { e.preventDefault(); api().then((x) => x.open_meal()); }
  });
  // 從各系統回到首頁、或切回這個視窗時更新數字
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  setInterval(() => { if (!document.hidden) render(); }, 5 * 60 * 1000);

  window.__kitchen = { render, get data() { return last; }, VERSION };
  render();
  if (!DESK && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
