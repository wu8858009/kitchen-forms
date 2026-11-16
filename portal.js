/* 廚房專用表格系統 — 首頁儀表板：冰箱溫度、備料交接、菜品銷售、員工餐四個系統的入口與今日重點 */
(() => {
  'use strict';
  const VERSION = '1.7.0';
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
  // SOP 系統把資料直接存成物件（不是文字）
  const parse = (t) => { if (t && typeof t === 'object') return t; try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  const mealConf = () => { try { return JSON.parse(localStorage.getItem(LS_MEAL)) || {}; } catch (e) { return {}; } };

  // ------------------------------------------------------------------ 讀取各系統的資料
  // 冰箱、菜品、備料都在這台裝置，馬上就讀得到；員工餐在 Google 雲端，比較慢，所以另外在背景讀（見 fetchMeal）
  async function loadLocal() {
    if (DESK) {
      const r = parse(await (await api()).dash()) || {};
      return { fridge: parse(r.fridge), dish: parse(r.dish), prep: parse(r.prep), sop: parse(r.sop), meal: parse(r.meal), mealInfo: r.meal_info || {} };
    }
    const [f, d, p, so] = await Promise.all([idbGet('fridgetemp'), idbGet('dishsales'), idbGet('kitchenprep'), idbGet('kitchen-sop')]);
    return { fridge: parse(f), dish: parse(d), prep: parse(p), sop: parse(so) };
  }
  // 員工餐：上次從雲端算好的摘要先顯示，背景更新完再換上
  const LS_MEALC = 'kitchenforms-meal-cache';
  const mealCache = () => { try { return JSON.parse(localStorage.getItem(LS_MEALC)) || null; } catch (e) { return null; } };
  const meal = { s: null, at: 0, error: '', loading: false, fetched: 0 };
  { const c = mealCache(); if (c && c.s) { meal.s = c.s; meal.at = c.at || 0; } }
  async function fetchMeal(force) {
    const mc = mealConf();
    if (DESK || !mc.pw || meal.loading) return;
    if (!force && Date.now() - meal.fetched < 15 * 1000) return; // 15 秒內不重複抓
    meal.loading = true;
    if (!meal.s) paintMeal(); // 已經有數字就不顯示「更新中」，背景默默更新
    const before = JSON.stringify([meal.s, meal.error]);
    const ac = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ac && ac.abort(), 20000);
    try {
      const res = await fetch(mc.url || window.MEAL_CLOUD_URL, { method: 'POST', body: JSON.stringify({ action: 'load', pw: mc.pw }), signal: ac ? ac.signal : undefined });
      const j = await res.json();
      if (j.ok) {
        meal.s = mealSummary(j.data, new Date()); meal.at = Date.now(); meal.error = '';
        try { localStorage.setItem(LS_MEALC, JSON.stringify({ s: meal.s, at: meal.at })); } catch (e) { /* 空間不足就算了 */ }
      } else meal.error = j.error || '讀取失敗';
    } catch (e) { meal.error = e && e.name === 'AbortError' ? '雲端回應太慢，稍後再按「更新」' : '連不上雲端（' + (e.message || e) + '）'; }
    clearTimeout(to);
    meal.loading = false; meal.fetched = Date.now();
    if (JSON.stringify([meal.s, meal.error]) !== before || !$('.card.meal .kpis')) paintMeal(); // 數字有變才重畫
  }
  function paintMeal() {
    const el = $('.card.meal');
    if (!el) return;
    el.outerHTML = mealCard(meal.s, { error: meal.error, loading: meal.loading && !meal.s, at: meal.at, pw: !!mealConf().pw });
    cardsHtml = ''; // 首頁下次比對時重新記錄
    if (window.__kitchen.summary) window.__kitchen.summary.meal = meal.s;
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
  /** 本期初一／十六拜拜菜預扣 → [預扣總額, 其中已叫貨的金額]（用員工餐網頁版的農曆資料；沒載入就不扣） */
  function mealReserve(d, sI, eI) {
    const M = window.M;
    if (!M || !M.isBaibai) return [0, 0];
    const D = M.D, s = D.parse(sI), e = D.parse(eI), today = D.today();
    const ings = d.ingredients || [], recs = d.records || [];
    const names = new Set(M.BAIBAI_ITEMS.map((x) => x[0]));
    const last = {};
    [...ings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id)).forEach((r) => { last[r.name] = r.price; });
    const prevBB = (x) => { let p = D.add(x, -1); for (let k = 0; k < 20; k++) { if (M.isBaibai(p)) break; p = D.add(p, -1); } return p; };
    const bought = (x) => {
      const lo = D.iso(prevBB(x)), hi = D.iso(x);
      if (recs.some((r) => lo < (r.date || '') && (r.date || '') <= hi && String(r.note || '').includes('拜拜'))) return names;
      return new Set(ings.filter((r) => names.has(r.name) && !r.price_only && lo < r.date && r.date <= hi).map((r) => r.name));
    };
    let total = 0, paid = 0, prev = prevBB(s);
    for (let x = s; x < D.add(e, 20); x = D.add(x, 1)) {
      if (!M.isBaibai(x)) continue;
      const lo = D.iso(prev), hi = D.iso(x);
      const inwin = (v) => lo < v && v <= hi && sI <= v && v < eI;
      let ap = ings.filter((r) => names.has(r.name) && !r.price_only && inwin(r.date)).reduce((a, r) => a + (+r.amount || 0), 0);
      ap += recs.filter((r) => String(r.note || '').includes('拜拜') && inwin(r.date || '')).reduce((a, r) => a + (+r.amount || 0), 0);
      let due = 0;
      if (today <= x && x < e) { const b = bought(x); for (const [n, q] of M.BAIBAI_ITEMS) if (!b.has(n)) due += (last[n] || 0) * q; }
      if (ap || due) { paid += ap; total += ap + due; }
      prev = x;
    }
    return [total, paid];
  }
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
    const [reserve, paid] = mealReserve(d, sI, eI);
    const used = recs.reduce((a, r) => a + (+r.amount || 0), 0) - paid;
    const today = ymd(now);
    const todayAmt = recs.filter((r) => r.date === today).reduce((a, r) => a + (+r.amount || 0), 0);
    const last = recs.map((r) => r.date).sort().pop();
    const eDisp = new Date(e); eDisp.setDate(eDisp.getDate() - 1);
    const daysLeft = Math.round((e - new Date(y, m, now.getDate())) / 864e5);
    return { budget, used, reserve, remain: budget - used - reserve, pct: (used + reserve) / budget, warn: (st.warn_pct || 80) / 100, danger: (st.danger_pct || 90) / 100,
      range: `${s.getMonth() + 1}/${s.getDate()} – ${eDisp.getMonth() + 1}/${eDisp.getDate()}`, todayAmt, last, daysLeft };
  }
  function mealCard(s, info) {
    let body;
    const btns = [`<a class="btn" href="meal/index.html${Q}" data-mod="meal">開啟</a>`, `<a class="btn sub" href="meal/index.html${Q}#report" data-mod="meal">報表</a>`];
    if (DESK) {
      btns.push('<button class="btn sub" data-act="meal-open">電腦版程式</button>');
      btns.push('<button class="btn sub" data-act="meal-pick">程式位置…</button>');
    }
    if (!s) {
      if (DESK) body = info.exe ? '<p class="note">找不到員工餐電腦版的資料檔（meal_data.json）。按「開啟」可直接使用網頁版（資料在 Google 試算表，跟電腦版同一份）。</p>'
        : '<p class="note">按「開啟」使用員工餐網頁版（資料在 Google 試算表，跟電腦版同一份）。要開電腦版程式，請按「程式位置…」選擇「碧水堂員工餐.exe」。</p>';
      else body = info.loading ? '<p class="note">☁️ 正在讀取雲端資料…</p>' : info.error ? `<p class="note bad">${esc(info.error)}</p>`
        : '<p class="note">按「開啟」，第一次輸入電腦版「雲端同步」的密碼，就能在這裡記帳、看本期預算（資料跟電腦版同一份）。</p>';
    } else {
      const lvl = s.remain < 0 || s.pct >= s.danger ? 'bad' : s.pct >= s.warn ? 'warn' : '';
      body = `<div class="kpis">
          <div class="kpi ${lvl || 'ok'}"><div class="l">本期剩餘</div><div class="v">${money(s.remain)}</div></div>
          <div class="kpi"><div class="l">本期已用</div><div class="v">${money(s.used)}</div></div>
          <div class="kpi"><div class="l">今日</div><div class="v">${money(s.todayAmt)}</div></div>
        </div>
        <div class="bar ${lvl}"><i style="width:${Math.min(100, s.pct * 100).toFixed(1)}%"></i></div>
        <p class="note">結算週期 ${s.range}（還有 ${s.daysLeft} 天）・預算 ${money(s.budget)}${s.reserve ? '・拜拜預扣 ' + money(s.reserve) : ''}・已用 ${(s.pct * 100).toFixed(0)}%${s.last ? '・最後記帳 ' + s.last.slice(5).replace('-', '/') : ''}</p>`;
    }
    if (s && !DESK) {
      const t = info.at ? new Date(info.at) : null;
      body += info.loading ? '<p class="note">☁️ 正在更新雲端資料…</p>'
        : info.error ? `<p class="note bad">${esc(info.error)}${t ? `（目前顯示 ${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())} 的資料）` : ''}</p>` : '';
    }
    if (DESK && info.exe) body += `<p class="note">程式：<code>${esc(info.exe)}</code></p>`;
    return card('meal', '🍚', '員工餐金額總計', '餐費記帳・食材單價・叫貨・排班・菜單・食譜', body, btns.join(''));
  }

  // ------------------------------------------------------------------ 備料交接日誌
  function prepSummary(db, now) {
    if (!db || !Array.isArray(db.items)) return null;
    const d = ymd(now), wd = String(now.getDay());
    const L = (db.logs || {})[d] || { q: {} };
    const hol = L.hol != null ? L.hol : now.getDay() === 0 || now.getDay() === 6;
    const sts = (db.stations || []).filter((s) => !s.deleted).sort((a, b) => a.ord - b.ord);
    let total = 0, done = 0;
    const per = sts.map((s) => {
      let t = 0, n = 0;
      db.items.forEach((it) => {
        if (it.deleted || it.st !== s.id || (it.days && !it.days.includes(wd))) return;
        t++; if (L.q[it.id] && String(L.q[it.id].v || '').trim()) n++;
      });
      total += t; done += n;
      return { name: s.name || db.items.filter((it) => !it.deleted && it.st === s.id).slice(0, 2).map((it) => it.name).join('・'), t, n };
    });
    const notes = Object.values(L.shift || L.notes || {}).filter((x) => String(x).trim()).length;
    return { total, done, per, hol, sign: (L.sign || '').trim(), notes };
  }
  function prepCard(s) {
    let body;
    if (!s) body = '<p class="note">紙本「碧水堂廚房交接表」的電子版：時程、站區分配、交接事項、預估銷售量，可列印 A4 交接表。點「開啟」開始使用。</p>';
    else body = `<div class="kpis">
          <div class="kpi ${s.done >= s.total && s.total ? 'ok' : 'warn'}"><div class="l">今日備料完成</div><div class="v">${s.done}<small> / ${s.total}</small></div></div>
          <div class="kpi"><div class="l">份量</div><div class="v">${s.hol ? '假日' : '平日'}</div></div>
          <div class="kpi ${s.sign ? 'ok' : ''}"><div class="l">主管簽名</div><div class="v">${s.sign ? esc(s.sign) : '<small>未簽</small>'}</div></div>
        </div>
        <div class="chips">${s.per.filter((p) => p.t).map((p) => `<span class="chip ${p.n >= p.t ? 'ok' : p.n ? 'warn' : ''}">${esc(p.name)}　${p.n}/${p.t}</span>`).join('')}</div>
        ${s.notes ? `<p class="note">今天有 ${s.notes} 個時段寫了交接</p>` : ''}`;
    return card('prep', '📋', '備料交接日誌', '時程・站區分配・預估銷售量・列印交接表', body,
      `<a class="btn" href="prep/index.html${Q}#/day" data-mod="prep">開啟</a><a class="btn sub" href="prep/index.html${Q}#/sheet" data-mod="prep">列印</a>`);
  }

  // ------------------------------------------------------------------ 廚房 SOP 食譜
  function sopSummary(db, now) {
    if (!db || !Array.isArray(db.recipes)) return null;
    const live = (a) => (a || []).filter((x) => x && !x.deleted);
    const recipes = live(db.recipes), sops = live(db.sops);
    const sc = (db.settings || {}).schedule || {}, day = now.getDay();
    const ids = new Set(recipes.map((r) => r.id));
    const items = ((sc.days || {})[day] || []).filter((x) => !x.recipeId || ids.has(x.recipeId));
    const done = new Set((sc.done || {})[ymd(now)] || []);
    const cats = new Set(recipes.map((r) => r.category).filter(Boolean)).size;
    return { recipes: recipes.length, sops: sops.length, cats, sched: items.length, schedDone: items.filter((x) => done.has(x.id)).length,
      next: items.filter((x) => !done.has(x.id)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')).slice(0, 3).map((x) => {
        const r = x.recipeId && recipes.find((y) => y.id === x.recipeId);
        return (x.time ? x.time + ' ' : '') + (r ? r.name : x.text || '');
      }), cloud: !!db.cloud };
  }
  function sopCard(s) {
    let body;
    if (!s) body = '<p class="note">食譜、倍數換算、SOP 主資料、備料單、行程、小抄、標籤、盤點訂貨。點「開啟」開始使用（跟原本的廚房 SOP 系統一模一樣）。</p>';
    else body = `<div class="kpis">
          <div class="kpi"><div class="l">食譜</div><div class="v">${s.recipes}<small> 道</small></div></div>
          <div class="kpi"><div class="l">SOP 主資料</div><div class="v">${s.sops}<small> 份</small></div></div>
          <div class="kpi ${s.sched && s.schedDone >= s.sched ? 'ok' : s.sched ? 'warn' : ''}"><div class="l">今日行程</div><div class="v">${s.schedDone}<small> / ${s.sched}</small></div></div>
        </div>
        ${s.next.length ? `<div class="chips">${s.next.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        ${s.cats ? `<p class="note">${s.cats} 個分類${s.cloud ? '・已連線 Google 雲端' : ''}</p>` : ''}`;
    return card('sop', '📖', '廚房 SOP 食譜', '食譜倍數・SOP・備料單・行程・小抄・標籤・盤點', body,
      `<a class="btn" href="sop/index.html${Q}" data-mod="sop">開啟</a><a class="btn sub" href="sop/index.html${Q}#/sched" data-mod="sop">行程</a><a class="btn sub" href="sop/index.html${Q}#/inv" data-mod="sop">盤點</a>`);
  }

  function card(cls, ic, title, sub, body, foot) {
    return `<article class="card ${cls}"><div class="card-h"><div class="ic">${ic}</div><h2>${title}<small>${sub}</small></h2></div>
      <div class="card-b">${body}</div><div class="card-f">${foot}</div></article>`;
  }

  // ------------------------------------------------------------------ 人員權限
  const AUTH = window.KitchenAuth, AUI = window.KitchenAuthUI;
  function paintWho() {
    const b = $('#who'); if (!b) return;
    const s = AUTH.get();
    b.classList.toggle('on', AUTH.on && !!(s && s.me));
    if (s && s.me) { const t = `<span class="i">👤</span><span class="t n">${esc(s.me.name)}</span>`; if (b.innerHTML !== t) b.innerHTML = t; }
    // 雲端同步設定：管理者（沒啟用權限管理時，或桌面版，大家都可以）
    $('#cloudbtn').classList.toggle('on', !AUTH.on || AUTH.isAdmin());
  }
  $('#who').addEventListener('click', () => AUI.openMenu());
  $('#cloudbtn').addEventListener('click', () => window.KitchenCloud.open());
  AUI.onChange = () => render();
  try { const n = sessionStorage.getItem('kitchenforms-notice'); if (n) { sessionStorage.removeItem('kitchenforms-notice'); setTimeout(() => toast(n, 4500), 600); } } catch (e) { /* */ }

  // ------------------------------------------------------------------ 畫面
  let last = null, snap = '', cardsHtml = '', footHtml = '', changedAt = null;
  // ------------------------------------------------------------------ 背景同步
  // 有權限、有開雲端同步的系統，放在看不到的小框架裡執行：它們會自己跟雲端同步（冰箱、菜品每 15 秒，備料每 10 秒），
  // 存到這台裝置；首頁每 10 秒看資料有沒有變，有變就更新數字。別台（例如管理者）改了資料，不用重新打開就會出現。
  const BG = {};
  function bgFrames(d) {
    if (DESK || !location.protocol.startsWith('http')) return;
    const s = AUTH.get();
    const want = {
      fridge: AUTH.can('fridge') && !!(d.fridge && d.fridge.cloud && d.fridge.cloud.on),
      dish: AUTH.can('dish') && !!(d.dish && d.dish.cloud && d.dish.cloud.on),
      prep: AUTH.can('prep') && !!AUTH.url && !!(s && s.token),
      sop: AUTH.can('sop') && !!(d.sop && d.sop.cloud),
    };
    for (const [m, on] of Object.entries(want)) {
      if (on && !BG[m]) {
        const f = document.createElement('iframe');
        f.src = `${m}/index.html?bg=1`; f.className = 'bg-sync'; f.tabIndex = -1;
        f.setAttribute('aria-hidden', 'true'); f.title = '背景同步';
        document.body.append(f); BG[m] = f;
      } else if (!on && BG[m]) { BG[m].remove(); delete BG[m]; }
    }
  }
  // 只比資料本身（不比同步時間），沒變就不重畫
  const snapOf = (d) => [d.fridge, d.dish, d.prep, d.sop].map((x) => (x ? JSON.stringify(x, (k, v) => (k === 'cloud' || k === '_sync' || k === 'sync' || k === 'meAct' ? undefined : v)) : '-')).join('|');
  // 每 3 秒看這台裝置的資料（原始文字沒變就不解析，很省電）；有變就更新首頁
  let lastRaw = '';
  async function watchLocal() {
    if (document.hidden || $('.adm, .auth-screen, .modal-bg')) return;
    try {
      if (DESK) { const d = await loadLocal(); if (snapOf(d) !== snap) render(); }
      else {
        const raw = await Promise.all([idbGet('fridgetemp'), idbGet('dishsales'), idbGet('kitchenprep'), idbGet('kitchen-sop')]);
        const key = raw.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : x || '')).join('\u0001');
        if (key !== lastRaw) {
          lastRaw = key;
          const d = { fridge: parse(raw[0]), dish: parse(raw[1]), prep: parse(raw[2]), sop: parse(raw[3]) };
          if (snapOf(d) !== snap) render();
        }
      }
    } catch (e) { /* */ }
    if (AUTH.can('meal')) fetchMeal();
  }
  setInterval(watchLocal, DESK ? 10 * 1000 : 3 * 1000);
  // 背景的系統每 5 秒問一次雲端有沒有新資料（只問版本，很快）
  setInterval(() => {
    if (document.hidden) return;
    for (const [m, f] of Object.entries(BG)) {
      try {
        const w = f.contentWindow;
        if (m === 'fridge' && w.__fridge && w.__fridge.Cloud) w.__fridge.Cloud.tick();
        if (m === 'dish' && w.__dish && w.__dish.Cloud) w.__dish.Cloud.tick();
        if (m === 'prep' && w.__prep && w.__prep.poll) w.__prep.poll();
      } catch (e) { /* 框架還在載入 */ }
    }
  }, 5000);
  async function render(force) {
    const now = new Date();
    const todayT = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}（${WD[now.getDay()]}）`;
    if ($('#today').textContent !== todayT) $('#today').textContent = todayT;
    if (AUTH.on) { await AUI.ensure(); if (force) AUI.refresh(); }
    paintWho();
    let d;
    try { d = await loadLocal(); } catch (e) { d = {}; }
    last = d;
    const fs = fridgeSummary(d.fridge, now), ds = dishSummary(d.dish, now), ps = prepSummary(d.prep, now), ss = sopSummary(d.sop, now);
    const ms = DESK ? mealSummary(d.meal, now) : meal.s;
    const mi = DESK ? (d.mealInfo || {}) : { error: meal.error, loading: !meal.s && (meal.loading || (!meal.fetched && !!mealConf().pw)), at: meal.at, pw: !!mealConf().pw };
    const shop = (fs && fs.shop) || (ds && ds.shop) || '';
    const shopT = shop ? `${shop}・廚房表格` : '廚房專用表格系統';
    if ($('#shop').textContent !== shopT) $('#shop').textContent = shopT;
    // 只顯示這個人有權限的系統
    const cards = [['fridge', () => fridgeCard(fs)], ['prep', () => prepCard(ps)], ['dish', () => dishCard(ds)], ['meal', () => mealCard(ms, mi)], ['sop', () => sopCard(ss)]].filter(([m]) => AUTH.can(m));
    const html = cards.map(([, f]) => f()).join('')
      || `<div class="no-perm">🔒 你目前沒有任何系統的權限。<br>請管理者在「人員與權限」幫你勾選可以使用的系統。</div>`;
    // 只有內容真的變了才重畫（沒改資料就不會閃一下）
    if (html !== cardsHtml || !$('#cards .card, #cards .no-perm')) { $('#cards').innerHTML = html; cardsHtml = html; changedAt = now; }
    if (!changedAt) changedAt = now;
    const footT = `廚房專用表格系統 v${VERSION}${DESK ? '（桌面版）' : ''}・資料更新於 ${pad(changedAt.getHours())}:${pad(changedAt.getMinutes())}`
      + (DESK ? '<br>冰箱、菜品的資料與原本的單獨程式共用同一份（%APPDATA%），雲端同步設定也沿用；員工餐的資料在 Google 試算表，跟電腦版同一份。'
        : '<br>冰箱、菜品的資料存在這台裝置，並可各自在設定頁連線 Google 雲端同步；員工餐的資料在 Google 試算表，跟電腦版同一份。');
    if (footHtml !== footT) { $('#foot').innerHTML = footT; footHtml = footT; }
    window.__kitchen.summary = { fridge: fs, dish: ds, meal: ms, prep: ps, sop: ss };
    if (AUTH.can('meal')) fetchMeal(force);
    snap = snapOf(d);
    bgFrames(d);
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'meal-open') {
      const r = await (await api()).open_meal();
      if (r === true) toast('已開啟員工餐程式'); else toast(r || '無法開啟', 4000);
    }
    if (a === 'meal-pick') {
      const r = await (await api()).pick_meal();
      if (r) { toast('已設定：' + r); render(true); }
    }
  });
  $('#refresh').addEventListener('click', () => { render(true).then(() => toast('已更新')); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); render(); }
    if (e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) { e.preventDefault(); const m = ({ 1: 'fridge', 2: 'dish', 3: 'meal', 4: 'prep', 5: 'sop' })[e.key]; if (AUTH.can(m)) location.href = m + `/index.html${Q}`; else toast('你沒有這個系統的權限'); }
  });
  // 從各系統回到首頁、或切回這個視窗時更新數字
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  setInterval(() => { if (!document.hidden) render(); }, 5 * 60 * 1000);


  // ------------------------------------------------------------------ 自動更新：發現網站有新版就存好資料、重新載入
  // （手機主畫面的 App 常常不會真的重新開啟，所以切回來時自己檢查一次）
  let updAt = 0;
  async function checkUpdate() {
    if (DESK || !location.protocol.startsWith('http') || Date.now() - updAt < 60 * 1000) return;
    updAt = Date.now();
    try {
      const mine = (([...document.scripts].map((x) => x.src).find((x) => /portal\.js\?v=\d+/.test(x)) || '').match(/\?v=(\d+)/) || [])[1];
      const html = await (await fetch((location.pathname.endsWith('/') ? location.pathname + 'index.html' : location.pathname) + '?u=' + Date.now(), { cache: 'no-store' })).text();
      const live = (html.match(/portal\.js\?v=(\d+)/) || [])[1];
      if (mine && live && +live > +mine) {
        toast('有新版，更新中…', 3000);
        
        setTimeout(() => location.reload(), 600);
      }
    } catch (e) { /* 沒網路就算了 */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  setTimeout(checkUpdate, 4000);

  window.__kitchen = { render, get data() { return last; }, VERSION };
  render();
  if (!DESK && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
