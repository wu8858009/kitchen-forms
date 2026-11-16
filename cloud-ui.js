/* 廚房專用表格系統 — 首頁「雲端同步」統一設定
 * 冰箱、菜品：網址和密碼存在 localStorage 'kitchenforms-cloud'，打開那個系統時由 kitchen-nav.js 用它自己的連線流程完成連線。
 * 員工餐：直接寫進 'kitchenforms-meal'（員工餐網頁版和首頁都讀這個）。
 * 備料交接日誌：用首頁登入的帳號自動同步，不用另外設定。 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = 'kitchenforms-cloud', LSM = 'kitchenforms-meal';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const Q = DESK ? '?desktop=1' : '';
  const SYS = [
    { k: 'fridge', name: '冰箱溫度記錄表', ic: '🌡️', def: () => window.FRIDGE_CLOUD_URL || '', body: (pw) => ({ a: 'ping', pw }) },
    { k: 'dish', name: '菜品銷售紀錄', ic: '🍱', def: () => window.DISH_CLOUD_URL || '', body: (pw) => ({ a: 'ping', pw }) },
    { k: 'meal', name: '員工餐金額總計', ic: '🍚', def: () => window.MEAL_CLOUD_URL || '', body: (pw) => ({ action: 'ping', pw }) },
  ];
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } };
  const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ } };
  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  // 這台裝置目前的設定（首頁統一設定 → 沒有的話看各系統自己的設定）
  function conf(k) {
    if (k === 'meal') { const m = read(LSM); return m && m.pw ? { url: m.url || window.MEAL_CLOUD_URL, pw: m.pw } : null; }
    const c = (read(LS) || {})[k];
    if (c && !c.off) return c;
    const d = (window.__kitchen && window.__kitchen.data || {})[k], own = d && d.cloud;
    return own && own.on && own.url && own.pw ? { url: own.url, pw: own.pw, own: true } : null;
  }
  function status(k) {
    if (k === 'meal') return conf('meal') ? ['ok', '已設定'] : ['', '未設定'];
    const d = (window.__kitchen && window.__kitchen.data || {})[k], own = d && d.cloud, want = (read(LS) || {})[k];
    if (want && want.off) return own && own.on ? ['warn', '下次打開時停用'] : ['', '已停用'];
    if (want && !(own && own.on && own.url === want.url && own.pw === want.pw)) return ['warn', '下次打開這個系統時完成連線'];
    if (own && own.on) {
      const t = own.lastOk ? new Date(own.lastOk) : null;
      return ['ok', t ? `已連線・最後同步 ${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '已連線'];
    }
    return ['', '未連線'];
  }
  async function ping(s, url, pw) {
    const ac = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ac && ac.abort(), 30000);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(s.body(pw)), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ac ? ac.signal : undefined });
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
    const A = window.KitchenAuth, s = A && A.get();
    const prep = !A || !A.url ? ['', '未啟用'] : s && s.token ? ['ok', `用「${s.me && s.me.name}」的帳號自動同步`] : DESK ? ['', '在備料交接日誌的「設定」登入後同步'] : ['warn', '登入首頁後自動同步'];
    $('.adm-b', ov).innerHTML = `<p class="adm-tip">在這裡一次設定所有系統的 Google 雲端同步，各系統不用再分別設定。每個系統有自己的 Google 試算表和密碼（就是當初在各系統設定的那組）。這些設定存在這台裝置；每台手機、平板、電腦第一次使用時都要在這裡設定一次。</p>
      <div class="pp cl-all"><div class="pp-h"><b>🔑 三個系統用同一組密碼？</b></div>
        <div class="add-g"><label>密碼<input id="allpw" type="password" autocomplete="off" placeholder="輸入後按「套用到全部」"></label></div>
        <div class="pp-f"><button data-a="fillall">套用到全部</button></div></div>
      <div class="adm-list" style="margin-top:12px">
      ${SYS.map((x) => {
        const c = conf(x.k) || {}, [cls, txt] = status(x.k);
        return `<form class="pp cl-sys" data-k="${x.k}"><div class="pp-h"><b>${x.ic} ${x.name}</b><span class="cl-st ${cls}">${esc(txt)}</span></div>
          <div class="add-g"><label>密碼<input name="pw" type="password" autocomplete="off" placeholder="${c.pw ? '已設定（不改就留空）' : '這個系統的雲端同步密碼'}"></label></div>
          <details${c.url && c.url !== x.def() ? ' open' : ''}><summary>雲端網址（通常不用改）</summary><input name="url" value="${esc(c.url || x.def())}" spellcheck="false" autocomplete="off"></details>
          <div class="pp-f"><button class="pri">儲存並連線</button>${c.pw ? '<button type="button" data-a="off" class="danger">停用同步</button>' : ''}
            ${x.k !== 'meal' ? `<a class="cl-open" href="${x.k}/index.html${Q}">打開${x.name.replace('紀錄', '').replace('記錄表', '')} →</a>` : ''}</div>
          <p class="cl-msg" hidden></p></form>`;
      }).join('')}
      ${(() => { const d = (window.__kitchen && window.__kitchen.data || {}).sop, on = !!(d && d.cloud); return `<div class="pp cl-sys"><div class="pp-h"><b>📖 廚房 SOP 食譜</b><span class="cl-st ${on ? 'ok' : ''}">${on ? '已連線' : '未連線'}</span></div>
        <p class="adm-tip" style="margin:6px 0 8px">SOP 系統的雲端連線（網址和存取碼）在它自己的設定頁設定，和原本的 SOP 系統一樣。</p>
        <div class="pp-f"><a class="cl-open" style="margin-left:0" href="sop/index.html${Q}#/settings">打開 SOP 設定 →</a></div></div>`; })()}
      <div class="pp cl-sys"><div class="pp-h"><b>📋 備料交接日誌</b><span class="cl-st ${prep[0]}">${esc(prep[1])}</span></div>
        <p class="adm-tip" style="margin:6px 0 0">用首頁登入的帳號同步（要有「備料」權限），不用密碼。</p></div>
      </div>`;
    ov.querySelectorAll('form.cl-sys').forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); save(f); }; });
  }
  async function save(f) {
    const x = SYS.find((s) => s.k === f.dataset.k), old = conf(x.k) || {};
    const url = f.url.value.trim() || x.def(), pw = f.pw.value || old.pw || '';
    const msg = $('.cl-msg', f), btn = $('.pri', f);
    const say = (t, bad) => { msg.textContent = t; msg.hidden = false; msg.classList.toggle('bad', !!bad); };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\/?/.test(url)) return say('網址格式不對，應該像 https://script.google.com/macros/s/…/exec', true);
    if (pw.length < 4) return say('請輸入密碼（至少 4 個字）', true);
    btn.disabled = true; say('連線中…');
    try {
      await ping(x, url, pw);
      if (x.k === 'meal') {
        write(LSM, { url, pw });
        say('✓ 已連線，首頁和員工餐都會用這組設定');
        if (window.__kitchen) window.__kitchen.render(true);
      } else {
        const all = read(LS) || {}; all[x.k] = { url, pw, at: Date.now() }; write(LS, all);
        say(`✓ 密碼正確。打開「${x.name}」時會自動完成連線（第一次可能會問要合併還是改用雲端資料）。`);
      }
      f.pw.value = '';
      setTimeout(draw, 1800);
    } catch (e) { say(e.message, true); }
    btn.disabled = false;
  }
  function onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') { ov.remove(); ov = null; if (window.__kitchen) window.__kitchen.render(); return; }
    if (a === 'fillall') {
      const v = $('#allpw', ov).value;
      if (!v) return toast('請先輸入密碼');
      ov.querySelectorAll('form.cl-sys input[name=pw]').forEach((i) => { i.value = v; });
      toast('已填入三個系統，請按各自的「儲存並連線」');
      return;
    }
    if (a === 'off') {
      const f = b.closest('form'), k = f.dataset.k, x = SYS.find((s) => s.k === k);
      if (!confirm(`停用「${x.name}」在這台裝置的雲端同步？（資料仍保留在這台裝置）`)) return;
      if (k === 'meal') write(LSM, null);
      else { const all = read(LS) || {}; all[k] = { off: true, at: Date.now() }; write(LS, all); }
      toast(k === 'meal' ? '已停用' : `已設定，打開「${x.name}」時停用`); draw();
    }
  }
  window.KitchenCloud = { open };
})();
