/* 廚房專用表格系統 — 首頁的登入畫面、帳號選單、權限管理 */
(() => {
  'use strict';
  const A = window.KitchenAuth;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE = { admin: '管理者', staff: '員工' };
  const ICON = { fridge: '🌡️', prep: '📋', dish: '🍱', meal: '🍚' };
  const SHORT = { fridge: '冰箱', prep: '備料', dish: '菜品', meal: '員工餐' };
  let onChange = () => {};
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ 登入畫面
  let screen = null, pending = null;
  // 同時被叫好幾次（例如切回 App）時共用同一個登入畫面
  function showLogin() {
    if (pending) return pending;
    return (pending = new Promise((done) => {
      if (screen) screen.remove();
      screen = document.createElement('div');
      screen.className = 'auth-screen';
      screen.innerHTML = `<div class="auth-box"><img src="icons/icon-192.png" alt="" class="auth-logo"><h1>廚房專用表格系統</h1><div class="auth-body"><p class="auth-msg">連線中…</p></div></div>`;
      document.body.append(screen);
      const body = $('.auth-body', screen);
      const finish = (r) => {
        A.set({ token: r.token, me: r.me, at: Date.now() });
        screen.remove(); screen = null;
        toast(`歡迎，${r.me.name}`);
        done(r.me);
      };
      async function load() {
        body.innerHTML = '<p class="auth-msg">連線中…</p>';
        let st;
        try { st = await A.call('status'); } catch (e) {
          body.innerHTML = `<p class="auth-err">${esc(e.message)}</p><button class="auth-btn" data-x="retry">重新連線</button>`;
          $('[data-x=retry]', body).onclick = load; return;
        }
        if (!st.ok) { body.innerHTML = `<p class="auth-err">${esc(st.error || '讀取失敗')}</p><button class="auth-btn" data-x="retry">重新連線</button>`; $('[data-x=retry]', body).onclick = load; return; }
        if (!st.setup) setup(); else login(st.names || []);
      }
      // 第一次：建立管理者
      function setup() {
        body.innerHTML = `<p class="auth-sub">第一次使用：先建立一位<b>管理者</b>。<br>之後由管理者新增人員、設定每個人能開哪些系統。</p>
          <form class="auth-form"><label>你的名字</label><input name="n" autocomplete="off" maxlength="20" placeholder="例：店長">
          <label>PIN 碼（4～8 位數字）</label><input name="p" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password">
          <label>再輸入一次 PIN</label><input name="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password">
          <p class="auth-err" hidden></p><button class="auth-btn">建立管理者並登入</button></form>`;
        const f = $('form', body), err = $('.auth-err', body);
        f.onsubmit = async (e) => {
          e.preventDefault();
          const n = f.n.value.trim(), p = f.p.value, p2 = f.p2.value;
          const bad = !n ? '請輸入名字' : !/^\d{4,8}$/.test(p) ? 'PIN 要 4～8 位數字' : p !== p2 ? '兩次輸入的 PIN 不一樣' : '';
          if (bad) { err.textContent = bad; err.hidden = false; return; }
          f.querySelector('button').disabled = true;
          try {
            const r = await A.call('setup', { name: n, pin: p, dev: A.dev() });
            if (r.ok) return finish(r);
            err.textContent = r.error; err.hidden = false;
          } catch (x) { err.textContent = x.message; err.hidden = false; }
          f.querySelector('button').disabled = false;
        };
        f.n.focus();
      }
      // 選名字 → 輸入 PIN
      function login(names) {
        let who = (A.get() || {}).last || '';
        if (!names.includes(who)) who = names.length === 1 ? names[0] : '';
        let pin = '';
        const draw = () => {
          body.innerHTML = `<p class="auth-sub">${who ? '輸入 PIN 碼' : '請選擇你的名字'}</p>
            <div class="auth-names">${names.map((n) => `<button class="auth-name${n === who ? ' on' : ''}" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
            ${who ? `<div class="auth-dots">${Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
            <p class="auth-err" hidden></p>
            <div class="auth-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button data-d="del" aria-label="刪除">⌫</button><button data-d="0">0</button><button data-d="ok" class="ok" aria-label="登入">登入</button></div>` : ''}`;
        };
        draw();
        const submit = async () => {
          if (pin.length < 4) return;
          const err = $('.auth-err', body), p = pin;
          $$pad(true);
          try {
            const r = await A.call('login', { name: who, pin: p, dev: A.dev() });
            if (r.ok) { const s = A.get() || {}; s.last = who; A.set(s); return finish(r); }
            pin = ''; draw(); const e2 = $('.auth-err', body); e2.textContent = r.error; e2.hidden = false; shake();
          } catch (x) { err.textContent = x.message; err.hidden = false; $$pad(false); }
        };
        const $$pad = (dis) => body.querySelectorAll('.auth-pad button').forEach((b) => { b.disabled = dis; });
        const shake = () => { const d = $('.auth-dots', body); if (d) { d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); } };
        body.onclick = (e) => {
          const nb = e.target.closest('[data-n]');
          if (nb) { who = nb.dataset.n; pin = ''; draw(); return; }
          const k = e.target.closest('[data-d]');
          if (!k || k.disabled) return;
          const d = k.dataset.d;
          if (d === 'del') pin = pin.slice(0, -1);
          else if (d === 'ok') return submit();
          else if (pin.length < 8) pin += d;
          const dots = $('.auth-dots', body);
          if (dots) dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
        };
        screen.onkeydown = (e) => {
          if (!who) return;
          if (/^\d$/.test(e.key) && pin.length < 8) pin += e.key;
          else if (e.key === 'Backspace') pin = pin.slice(0, -1);
          else if (e.key === 'Enter') return submit();
          else return;
          const dots = $('.auth-dots', body);
          if (dots) dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
        };
        screen.tabIndex = -1; screen.focus();
      }
      load();
    }).then((me) => { pending = null; return me; }));
  }

  // 背景確認權限有沒有被改（被停用、刪除就回到登入畫面）
  let lastCheck = 0;
  async function refresh(force) {
    const s = A.get();
    if (!A.on || !s || !s.token) return;
    if (!force && Date.now() - lastCheck < 60 * 1000) return;
    lastCheck = Date.now();
    let r;
    try { r = await A.call('me', { token: s.token }); } catch (e) { return; } // 沒網路：沿用這台裝置記得的權限
    if (r.ok) {
      const changed = JSON.stringify(r.me) !== JSON.stringify(s.me);
      s.me = r.me; s.at = Date.now(); A.set(s);
      if (changed) { toast('你的權限已更新'); onChange(); }
    } else if (r.code === 'auth') {
      A.set({ last: s.me && s.me.name });
      toast(r.error || '請重新登入', 4000);
      await showLogin(); onChange();
    }
  }
  async function ensure() {
    if (!A.on) return null;
    const s = A.get();
    if (s && s.token && s.me) { refresh(); return s.me; }
    const me = await showLogin();
    lastCheck = Date.now();
    return me;
  }

  // ------------------------------------------------------------------ 帳號選單
  function modal(html) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal">${html}</div>`;
    document.body.append(bg);
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x=close]')) bg.remove(); });
    return bg;
  }
  function openMenu() {
    const s = A.get(); if (!s || !s.me) return;
    const me = s.me;
    const bg = modal(`<h3>👤 ${esc(me.name)}<span class="role-tag ${me.role}">${ROLE[me.role]}</span></h3>
      <p class="am-perm">${Object.keys(A.MODS).map((m) => `<span class="${me.perms[m] ? 'y' : 'n'}">${ICON[m]} ${SHORT[m]}</span>`).join('')}</p>
      <div class="am-list">
        ${me.role === 'admin' ? '<button data-a="admin">👥 人員與權限管理</button>' : ''}
        <button data-a="pin">🔑 修改我的 PIN</button>
        <button data-a="out" class="danger">⏻ 登出（換人使用）</button>
      </div><div class="row"><button class="sec" data-x="close">關閉</button></div>`);
    bg.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      bg.remove();
      if (a.dataset.a === 'admin') openAdmin();
      if (a.dataset.a === 'pin') changePin();
      if (a.dataset.a === 'out') {
        if (!confirm('登出這台裝置？')) return;
        A.call('logout', { token: s.token }).catch(() => {});
        A.set({ last: me.name });
        await showLogin(); onChange();
      }
    });
  }
  function changePin() {
    const s = A.get();
    const bg = modal(`<h3>🔑 修改我的 PIN</h3><form>
      <label>原本的 PIN</label><input name="o" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password">
      <label>新的 PIN（4～8 位數字）</label><input name="p" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">
      <label>再輸入一次新的 PIN</label><input name="p2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">
      <p class="auth-err" hidden></p>
      <div class="row"><button type="button" class="sec" data-x="close">取消</button><button class="pri">儲存</button></div></form>`);
    const f = $('form', bg), err = $('.auth-err', bg);
    f.o.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const bad = !/^\d{4,8}$/.test(f.p.value) ? '新的 PIN 要 4～8 位數字' : f.p.value !== f.p2.value ? '兩次輸入的新 PIN 不一樣' : '';
      if (bad) { err.textContent = bad; err.hidden = false; return; }
      try {
        const r = await A.call('pin', { token: s.token, old: f.o.value, pin: f.p.value });
        if (r.ok) { bg.remove(); toast('PIN 已修改（其他裝置要用新 PIN 重新登入）', 4000); }
        else { err.textContent = r.error; err.hidden = false; }
      } catch (x) { err.textContent = x.message; err.hidden = false; }
    };
  }

  // ------------------------------------------------------------------ 權限管理（管理者）
  let adm = null;
  async function openAdmin() {
    if (adm) adm.remove();
    adm = document.createElement('div');
    adm.className = 'adm';
    adm.innerHTML = `<header class="adm-h"><button class="ghost" data-a="close">← 返回</button><h2>👥 人員與權限</h2><span class="sp"></span></header>
      <div class="adm-b"><p class="auth-msg">讀取中…</p></div>`;
    document.body.append(adm);
    adm.addEventListener('click', onAdmClick);
    adm.addEventListener('change', onAdmChange);
    await loadAdmin();
  }
  let people = [], sheetUrl = '';
  async function loadAdmin() {
    const b = $('.adm-b', adm);
    try {
      const r = await A.call('list', { token: A.get().token });
      if (!r.ok) { if (r.code === 'auth') { adm.remove(); adm = null; refresh(true); return; } throw new Error(r.error); }
      people = r.people; sheetUrl = r.sheet || '';
    } catch (e) { b.innerHTML = `<p class="auth-err">${esc(e.message)}</p><button class="auth-btn" data-a="reload">重新讀取</button>`; return; }
    drawAdmin();
  }
  const permBoxes = (p, dis) => Object.keys(A.MODS).map((m) => `<label class="sw${p.perms[m] ? ' on' : ''}${dis ? ' dis' : ''}"><input type="checkbox" data-m="${m}" ${p.perms[m] ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${ICON[m]} ${SHORT[m]}</span></label>`).join('');
  function drawAdmin() {
    const me = A.get().me.name;
    const b = $('.adm-b', adm);
    b.innerHTML = `<p class="adm-tip">勾選每個人能開哪些系統。管理者可以開全部、也能管理人員。改了會馬上存到 Google 試算表，對方的手機下次打開首頁時就會更新。</p>
      <div class="adm-list">${people.map((p) => `<div class="pp${p.off ? ' off' : ''}" data-p="${esc(p.name)}">
        <div class="pp-h"><b>${esc(p.name)}</b>${p.name === me ? '<span class="me-tag">我</span>' : ''}${p.off ? '<span class="off-tag">已停用</span>' : ''}
          <div class="seg"><button data-a="role" data-v="staff" class="${p.role === 'staff' ? 'on' : ''}">員工</button><button data-a="role" data-v="admin" class="${p.role === 'admin' ? 'on' : ''}">管理者</button></div></div>
        <div class="pp-perm">${permBoxes(p, p.role === 'admin')}</div>
        <div class="pp-f"><button data-a="ren">✎ 改名</button><button data-a="pin">🔑 重設 PIN</button>
          <button data-a="off">${p.off ? '▶ 恢復使用' : '⏸ 停用'}</button><button data-a="del" class="danger">✕ 刪除</button></div></div>`).join('')}</div>
      <form class="pp add"><div class="pp-h"><b>＋ 新增人員</b></div>
        <div class="add-g"><label>名字<input name="n" maxlength="20" autocomplete="off" placeholder="例：小明"></label>
          <label>PIN（4～8 位數字）<input name="p" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></label></div>
        <div class="pp-perm">${permBoxes({ perms: { fridge: true, prep: true, dish: false, meal: false } }, false)}</div>
        <label class="sw adm-role"><input type="checkbox" name="admin"><span>設為管理者（可以開全部系統、管理人員）</span></label>
        <div class="pp-f"><button class="pri">新增</button></div></form>
      ${sheetUrl ? `<p class="adm-tip">也可以直接在 <a href="${esc(sheetUrl)}" target="_blank" rel="noopener">Google 試算表</a> 修改權限（填「是」或留空）。刪掉「登入裝置」分頁的某一列，那台裝置就會被登出。</p>` : ''}`;
    $('form.add', b).onsubmit = addPerson;
  }
  async function save(p, extra) {
    const body = Object.assign({ old: p.name, name: p.name, role: p.role, perms: p.perms, off: p.off }, extra || {});
    try {
      const r = await A.call('save', { token: A.get().token, p: body });
      if (!r.ok) { toast(r.error, 4000); return loadAdmin(); }
      Object.assign(p, r.p);
      if (body.old === A.get().me.name) refresh(true);
      drawAdmin(); toast('已儲存');
    } catch (e) { toast(e.message, 4000); loadAdmin(); }
  }
  const askPin = (title) => {
    const p = prompt(title + '\n（4～8 位數字）');
    if (p == null) return null;
    if (!/^\d{4,8}$/.test(p.trim())) { alert('PIN 要 4～8 位數字'); return null; }
    return p.trim();
  };
  async function onAdmClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') { adm.remove(); adm = null; onChange(); return; }
    if (a === 'reload') return loadAdmin();
    const box = b.closest('[data-p]'); if (!box) return;
    const p = people.find((x) => x.name === box.dataset.p); if (!p) return;
    if (a === 'role') { if (p.role === b.dataset.v) return; p.role = b.dataset.v; return save(p); }
    if (a === 'off') { if (!p.off && !confirm(`停用「${p.name}」？他的裝置會馬上被登出。`)) return; p.off = !p.off; return save(p); }
    if (a === 'pin') { const pin = askPin(`幫「${p.name}」設定新的 PIN`); if (pin) save(p, { pin }); return; }
    if (a === 'ren') {
      const n = prompt('新的名字', p.name);
      if (!n || !n.trim() || n.trim() === p.name) return;
      return save(p, { name: n.trim() });
    }
    if (a === 'del') {
      if (!confirm(`刪除「${p.name}」？他的裝置會被登出，之後不能再登入。`)) return;
      try {
        const r = await A.call('del', { token: A.get().token, name: p.name });
        if (!r.ok) toast(r.error, 4000); else toast('已刪除');
      } catch (x) { toast(x.message, 4000); }
      loadAdmin();
    }
  }
  function onAdmChange(e) {
    const t = e.target;
    const sw = t.closest('.sw'); if (sw) sw.classList.toggle('on', t.checked);
    if (!t.dataset.m) return;
    const box = t.closest('[data-p]'); if (!box) return;
    const p = people.find((x) => x.name === box.dataset.p); if (!p) return;
    p.perms = Object.assign({}, p.perms, { [t.dataset.m]: t.checked });
    save(p);
  }
  async function addPerson(e) {
    e.preventDefault();
    const f = e.target, n = f.n.value.trim(), pin = f.p.value.trim();
    if (!n) return toast('請輸入名字');
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN 要 4～8 位數字');
    const perms = {};
    f.querySelectorAll('[data-m]').forEach((c) => { perms[c.dataset.m] = c.checked; });
    f.querySelector('.pri').disabled = true;
    try {
      const r = await A.call('save', { token: A.get().token, p: { name: n, pin, role: f.admin.checked ? 'admin' : 'staff', perms } });
      if (!r.ok) { toast(r.error, 4000); f.querySelector('.pri').disabled = false; return; }
      toast(`已新增「${n}」`);
    } catch (x) { toast(x.message, 4000); f.querySelector('.pri').disabled = false; return; }
    loadAdmin();
  }

  window.KitchenAuthUI = { ensure, refresh, openMenu, openAdmin, showLogin, set onChange(f) { onChange = f; } };
})();
