/* 廚房專用表格系統 — 首頁「雲端同步」統一設定（管理者）
 * 管理者在這裡設定一次各系統的雲端網址和密碼，就會「分發」到權限後端：
 * 其他人登入首頁後自動拿到自己有權限的系統的設定（KitchenAuth.applyCloud），不用再輸入密碼。
 * 冰箱、菜品、SOP：存在 localStorage 'kitchenforms-cloud'，打開（或首頁背景執行）時由 kitchen-nav.js 用各系統自己的連線流程連上。
 * 員工餐：直接寫進 'kitchenforms-meal'。備料交接日誌：用登入的帳號自動同步。 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = 'kitchenforms-cloud', LSM = 'kitchenforms-meal';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const Q = DESK ? '?desktop=1' : '';
  // sec：密碼欄位的名稱（SOP 叫 key）；body：驗證用的請求（SOP 用 rev，不會把密碼「認領」掉）
  const SYS = [
    { k: 'fridge', name: '冰箱溫度記錄表', ic: '🌡️', sec: 'pw', def: () => window.FRIDGE_CLOUD_URL || '', body: (v) => ({ a: 'ping', pw: v }) },
    { k: 'dish', name: '菜品銷售紀錄', ic: '🍱', sec: 'pw', def: () => window.DISH_CLOUD_URL || '', body: (v) => ({ a: 'ping', pw: v }) },
    { k: 'meal', name: '員工餐金額總計', ic: '🍚', sec: 'pw', def: () => window.MEAL_CLOUD_URL || '', body: (v) => ({ action: 'ping', pw: v }) },
    { k: 'sop', name: '廚房 SOP 食譜', ic: '📖', sec: 'key', def: () => window.KSOP_CLOUD_URL || '', body: (v) => ({ a: 'rev', key: v }) },
    // 設備管家：用「從最新版本之後的變動」來驗證密碼（不會下載資料）
    { k: 'equip', name: '設備管家', ic: '🔧', sec: 'key', def: () => 'https://script.google.com/macros/s/AKfycbynVKxKgyH9yTlBgcXxyK99KZpRyQ5YgbZ_fiJzjLZvOIfYNOn5LnGfXWXj7OflrFlw1w/exec', body: (v) => ({ action: 'sync', key: v, since: 9e15, changes: [] }) },
    // 水電瓦斯抄表：同步密碼（抄表雲端的 /auth/kitchen；第一次由抄表管理員在這裡設定）
    { k: 'energy', name: '碧潭水電瓦斯抄表', ic: '⚡', sec: 'pw', def: () => 'https://script.google.com/macros/s/AKfycbxose_ffHC10iY2WAxhVVsEIkq-xcSRUu1eHumBms9K_Dq7Nl3m9v-uwCsunXRuVfSj/exec',
      body: (v) => ({ m: 'POST', p: '/auth/kitchen', t: '', b: { key: v } }), verify: energyVerify },
  ];
  // 抄表同步密碼：對了就好；還沒設定、或要改密碼時，用這台裝置上抄表「管理員」的登入來設定
  // （抄表跟首頁在同一個網站，它登入後的權杖存在 localStorage 'bitan_cloud_token'）
  async function energyVerify(x, url, v, f) {
    const post = (b) => fetch(url, { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'text/plain;charset=utf-8' } }).then((r) => r.json());
    let j;
    try { j = await post(x.body(v)); } catch (e) { throw new Error('無法連線（請檢查網路或網址）'); }
    if (j.s >= 200 && j.s < 300) return;
    const msg = (j.b && j.b.message) || '';
    if (j.s !== 409 && !/同步密碼錯誤$|帳號已被刪除/.test(msg)) throw new Error(msg || '雲端錯誤');
    const tok = (() => { try { return localStorage.getItem('bitan_cloud_token'); } catch (e) { return null; } })();
    const first = j.s === 409;
    const need = '請先按下面的「打開 →」，用抄表的「管理員」帳號登入一次，再回來按「儲存」';
    if (!tok) throw new Error(first ? '抄表還沒有設定同步密碼。第一次設定：' + need : msg + '（要改成新的同步密碼：' + need + '）');
    if (!first && !confirm('抄表已經設定過同步密碼，要改成這個新的嗎？（其他裝置會跟著改用新密碼）')) throw new Error('沒有變更');
    const who = f.euser ? f.euser.value.trim() : '';
    const s = await post({ m: 'POST', p: '/auth/kitchen-key', t: tok, b: { key: v, username: who } });
    if (s.s === 401 || s.s === 403) throw new Error('這台裝置的抄表登入不是管理員（或已過期）。' + need);
    if (!(s.s >= 200 && s.s < 300)) throw new Error((s.b && s.b.message) || '設定失敗');
    j = await post(x.body(v));
    if (!(j.s >= 200 && j.s < 300)) throw new Error((j.b && j.b.message) || '設定失敗');
  }
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } };
  const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ } };
  const A = () => window.KitchenAuth;
  const data = (k) => (window.__kitchen && window.__kitchen.data || {})[k];
  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  // 這台裝置目前的設定（首頁設定 → 沒有的話看各系統自己連線時的設定）
  function conf(k) {
    const x = SYS.find((s) => s.k === k);
    if (k === 'meal') { const m = read(LSM); return m && m.pw ? { url: m.url || window.MEAL_CLOUD_URL, pw: m.pw } : null; }
    const c = (read(LS) || {})[k];
    if (c && !c.off && c[x.sec]) return c;
    const own = (data(k) || {}).cloud;
    if (k === 'sop') return own && own.url && own.key ? { url: own.url, key: own.key, own: true } : null;
    if (k === 'equip') { const g = read('sg_sync'); return g && g.enabled && g.url && g.key ? { url: g.url, key: g.key, own: true } : null; }
    if (k === 'energy') return null;
    return own && own.on && own.url && own.pw ? { url: own.url, pw: own.pw, own: true } : null;
  }
  function status(k) {
    if (k === 'meal') return conf('meal') ? ['ok', '已設定'] : ['', '未設定'];
    if (k === 'energy') { const w = (read(LS) || {}).energy; return w && w.off ? ['', '已停用'] : w && w.pw ? ['ok', '打開時自動登入'] : ['', '未設定']; }
    const g = k === 'equip' ? read('sg_sync') : null;
    const own = k === 'equip' ? (g && g.enabled ? g : null) : (data(k) || {}).cloud, want = (read(LS) || {})[k];
    const on = k === 'sop' || k === 'equip' ? !!(own && own.url) : !!(own && own.on);
    if (want && want.off) return on ? ['warn', '下次打開時停用'] : ['', '已停用'];
    if (want && !(on && own.url === want.url && (k === 'sop' || k === 'equip' ? own.key === want.key : own.pw === want.pw))) return ['warn', '打開這個系統時會自動連線'];
    if (on) {
      const ts = k === 'sop' ? (data(k).sync || {}).at : k === 'equip' ? 0 : own.lastOk, t = ts ? new Date(ts) : null;
      return ['ok', t ? `已連線・最後同步 ${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '已連線'];
    }
    return ['', '未連線'];
  }
  // 分發狀態（權限後端存的那一份）
  const shared = () => { const s = A() && A().get(); return (s && s.cloud) || {}; };
  const canShare = () => !!(A() && A().on && A().isAdmin());
  async function ping(x, url, v) {
    const ac = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ac && ac.abort(), 30000);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(x.body(v)), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ac ? ac.signal : undefined });
      const t = await res.text();
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('雲端回應格式不對（網址正確嗎？）'); }
      if (!j.ok) throw new Error(j.err || j.error || '密碼不對或雲端錯誤');
      return j;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('連線逾時，請再試一次');
      if (e instanceof TypeError) throw new Error('無法連線（請檢查網路或網址）');
      throw e;
    } finally { clearTimeout(to); }
  }
  // 存到權限後端，所有有權限的人自動拿到
  async function share(k, cfg) {
    const s = A().get();
    const r = await A().call('cloud_set', { token: s.token, mod: k, cfg });
    if (!r.ok) throw new Error(r.error || '分發失敗');
    s.cloud = r.cloud; A().set(s);
  }

  let ov = null;
  function open() {
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.className = 'adm';
    ov.innerHTML = `<header class="adm-h"><button class="ghost" data-a="close">← 返回</button><h2>☁️ Google 雲端同步</h2><span class="sp"></span></header><div class="adm-b"></div>`;
    document.body.append(ov);
    ov.addEventListener('click', onClick);
    draw();
  }
  function draw() {
    const s = A() && A().get(), sh = shared(), admin = canShare();
    const prep = !A() || !A().url ? ['', '未啟用'] : s && s.token ? ['ok', `用「${s.me && s.me.name}」的帳號自動同步`] : DESK ? ['', '在備料交接日誌的「設定」登入後同步'] : ['warn', '登入首頁後自動同步'];
    const missing = SYS.filter((x) => conf(x.k) && !(sh[x.k] && sh[x.k].url === conf(x.k).url && sh[x.k][x.sec] === conf(x.k)[x.sec] && sh[x.k].user === conf(x.k).user));
    $('.adm-b', ov).innerHTML = `<p class="adm-tip">${admin
      ? '在這裡設定一次各系統的雲端網址和密碼，就會<b>自動分發給所有有權限的人</b>：他們登入首頁後，手機、平板、電腦都會自動連上，不用再輸入任何密碼。'
      : '在這裡設定這台裝置各系統的 Google 雲端同步。若管理者已經分發設定，登入後會自動連上，不用自己輸入。'}</p>
      ${admin && missing.length ? `<div class="pp cl-all"><div class="pp-h"><b>📤 這台已連線、但還沒分發的系統：${missing.map((x) => x.ic + ' ' + esc(x.name)).join('、')}</b></div>
        <div class="pp-f" style="margin-top:8px"><button class="pri" data-a="shareall">一鍵分發給所有人</button></div></div>` : ''}
      <div class="pp cl-all"><div class="pp-h"><b>🔑 冰箱、菜品、員工餐用同一組密碼？</b></div>
        <div class="add-g"><label>密碼<input id="allpw" type="password" autocomplete="off" placeholder="輸入後按「套用到全部」"></label></div>
        <div class="pp-f"><button data-a="fillall">套用到全部</button></div></div>
      <div class="adm-list" style="margin-top:12px">
      ${SYS.map((x) => {
        const c = conf(x.k) || {}, [cls, txt] = status(x.k), sx = sh[x.k];
        return `<form class="pp cl-sys" data-k="${x.k}"><div class="pp-h"><b>${x.ic} ${x.name}</b><span class="cl-st ${cls}">${esc(txt)}</span>${sx ? `<span class="cl-st ok" title="${esc((sx.by || '') + ' 分發')}">📤 已分發</span>` : ''}</div>
          <div class="add-g"><label>${x.k === 'sop' ? '存取密碼' : x.k === 'equip' ? '同步密碼' : '密碼'}<input name="pw" type="password" autocomplete="off" placeholder="${c[x.sec] ? '已設定（不改就留空）' : '這個系統的雲端同步密碼'}"></label></div>
          <details${c.url && c.url !== x.def() ? ' open' : ''}><summary>雲端網址（通常不用改）</summary><input name="url" value="${esc(c.url || x.def())}" spellcheck="false" autocomplete="off">${x.k === 'energy' ? '<label class="cl-sub">設定密碼時，大家要用哪個抄表帳號（留空＝設定的管理員自己）<input name="euser" spellcheck="false" autocomplete="off" placeholder="抄表帳號"></label>' : ''}</details>
          <div class="pp-f"><button class="pri">${admin ? '儲存並分發' : '儲存並連線'}</button>${c[x.sec] ? '<button type="button" data-a="off" class="danger">停用同步</button>' : ''}
            ${admin && sx ? '<button type="button" data-a="unshare">取消分發</button>' : ''}
            ${x.k !== 'meal' ? `<a class="cl-open" href="${x.k}/index.html${Q}">打開 →</a>` : ''}</div>
          <p class="cl-msg" hidden></p></form>`;
      }).join('')}
      <div class="pp cl-sys"><div class="pp-h"><b>📋 備料交接日誌</b><span class="cl-st ${prep[0]}">${esc(prep[1])}</span></div>
        <p class="adm-tip" style="margin:6px 0 0">用首頁登入的帳號同步（要有「備料」權限），不用密碼。</p></div>
      </div>`;
    ov.querySelectorAll('form.cl-sys').forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); save(f); }; });
  }
  async function save(f) {
    const x = SYS.find((s) => s.k === f.dataset.k), old = conf(x.k) || {};
    const url = f.url.value.trim() || x.def(), v = f.pw.value || old[x.sec] || '';
    const msg = $('.cl-msg', f), btn = $('.pri', f);
    const say = (t, bad) => { msg.textContent = t; msg.hidden = false; msg.classList.toggle('bad', !!bad); };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\/?/.test(url)) return say('網址格式不對，應該像 https://script.google.com/macros/s/…/exec', true);
    const minL = x.k === 'equip' || x.k === 'energy' ? 6 : 4;
    if (v.length < minL) return say(`請輸入密碼（至少 ${minL} 個字）`, true);
    btn.disabled = true; say('連線中…');
    try {
      if (x.verify) await x.verify(x, url, v, f); else await ping(x, url, v);
      const cfg = { url, [x.sec]: v };
      if (x.k === 'meal') { write(LSM, cfg); if (window.__kitchen) window.__kitchen.render(true); }
      else { const all = read(LS) || {}; all[x.k] = { ...cfg, at: Date.now() }; write(LS, all); }
      let msgT = x.k === 'meal' ? '✓ 已連線' : x.k === 'energy' ? `✓ 同步密碼正確，打開「${x.name}」時會自動登入` : `✓ 密碼正確，打開「${x.name}」時會自動連線`;
      if (canShare()) { await share(x.k, cfg); msgT += '，並已分發給所有有權限的人'; }
      say(msgT);
      f.pw.value = '';
      setTimeout(draw, 1800);
    } catch (e) { say(e.message, true); }
    btn.disabled = false;
  }
  async function onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') { ov.remove(); ov = null; if (window.__kitchen) window.__kitchen.render(); return; }
    if (a === 'fillall') {
      const v = $('#allpw', ov).value;
      if (!v) return toast('請先輸入密碼');
      ov.querySelectorAll('form.cl-sys:not([data-k=sop]):not([data-k=equip]):not([data-k=energy]) input[name=pw]').forEach((i) => { i.value = v; });
      toast('已填入冰箱、菜品、員工餐，請按各自的「儲存」');
      return;
    }
    if (a === 'shareall') {
      b.disabled = true;
      let n = 0;
      try {
        for (const x of SYS) { const c = conf(x.k); if (c && c.url && c[x.sec]) { await share(x.k, { url: c.url, [x.sec]: c[x.sec] }); n++; } }
        toast(`已分發 ${n} 個系統的雲端設定給所有有權限的人`, 4000);
      } catch (err) { toast(err.message, 4000); }
      draw(); return;
    }
    const f = b.closest('form'); if (!f) return;
    const k = f.dataset.k, x = SYS.find((s) => s.k === k);
    if (a === 'unshare') {
      if (!confirm(`取消分發「${x.name}」的雲端設定？（已經連上的裝置不受影響；之後新的裝置要自己輸入密碼）`)) return;
      try { await share(k, null); toast('已取消分發'); } catch (err) { toast(err.message, 4000); }
      draw(); return;
    }
    if (a === 'off') {
      if (!confirm(k === 'energy' ? `這台裝置打開「${x.name}」時不再自動登入？` : `停用「${x.name}」在這台裝置的雲端同步？（資料仍保留在這台裝置）`)) return;
      if (k === 'meal') write(LSM, null);
      else { const all = read(LS) || {}; all[k] = { off: true, at: Date.now() }; write(LS, all); }
      toast(k === 'meal' ? '已停用' : `已設定，打開「${x.name}」時停用`); draw();
    }
  }
  window.KitchenCloud = { open };
})();
