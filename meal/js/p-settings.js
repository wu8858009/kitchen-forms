/* 頁面：系統設定 */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).settings = P;
  let els = {};

  const card = (title, color, ...kids) => h('div.card', h('div.card-h', { style: { '--c': `var(--${color})` } }, h('h3', title)), h('div.card-b', ...kids));
  const sep = () => h('div.sep');
  const chk = (checked, text, hint) => {
    const c = h('input', { type: 'checkbox', checked: !!checked });
    return [c, h('div.opt-row', h('label.chk', c, text), hint ? h('span.set-hint', hint) : null)];
  };
  const range = (min, max, val, color) => {
    const r = h('input', { type: 'range', min, max, value: val });
    const b = h('b', { style: { color } }, val);
    r.addEventListener('input', () => { b.textContent = r.value; });
    return [r, h('div.range-wrap', r, b, h('span.sub', '%'))];
  };

  P.build = (el) => {
    const wrap = h('div.set-wrap');
    el.appendChild(h('div.scroll', wrap));
    wrap.appendChild(h('div.set-hdr', h('h2', '系統設定'), h('small', 'Settings'), ui.btn('↺  還原預設', 'muted', () => reset()), ui.btn('💾  儲存設定', 'blue', () => P.save())));
    // 1. 預算
    const budget = ui.input('', { style: { width: '140px', fontFamily: 'var(--mono)', fontSize: '15px' }, inputmode: 'numeric' });
    const [warn, warnW] = range(50, 95, 80, 'var(--warning)');
    const [danger, dangerW] = range(60, 100, 90, 'var(--danger)');
    wrap.appendChild(card('預算設定', 'accent2', h('div.set-grid', h('span.lbl', '每期總預算（NT$）'), budget, sep(),
      h('span.lbl', '警示門檻（%）'), warnW, sep(), h('span.lbl', '危險門檻（%）'), dangerW)));
    // 2. 週期
    const settle = h('input', { type: 'number', min: 1, max: 28, style: { width: '80px', fontFamily: 'var(--mono)', fontSize: '15px' } });
    const prev = h('div', { style: { color: 'var(--accent)', fontSize: '12px', marginTop: '6px' } });
    const upd = () => { const sd = parseInt(settle.value, 10) || 26; prev.textContent = `  ↳  每月 ${sd} 日起算，到次月 ${sd > 1 ? sd - 1 : 28} 日結算`; };
    settle.addEventListener('input', upd);
    wrap.appendChild(card('結算週期設定', 'purple', h('div.set-grid', h('span.lbl', '每月結算起始日'), h('div', settle, h('span.sub', { style: { marginLeft: '8px' } }, '日  （1–28）')), h('div.full', prev))));
    // 3. 輸入行為
    const [cont, contW] = chk(false, '連續輸入模式', '（新增記錄後不關閉視窗，可連續輸入下一筆）');
    const [oSlip, oSlipW] = chk(true, '開啟時自動開「新增貨單」', '（網頁開啟後直接跳出新增貨單視窗）');
    const [oRec, oRecW] = chk(false, '開啟時自動開「新增餐費記錄」', '（兩個都勾：先開貨單，關閉後再開餐費記錄）');
    const [nSlip, nSlipW] = chk(true, '進入「食材單價」自動開「新增貨單」', '（點導覽列切到該頁時跳出）');
    const [nRec, nRecW] = chk(true, '進入「費用記錄」自動開「新增餐費記錄」', '（點導覽列切到該頁時跳出）');
    wrap.appendChild(card('輸入行為', 'accent', contW, h('div', { style: { height: '1px', background: 'var(--border)', margin: '10px 0' } }), oSlipW, oRecW, nSlipW, nRecW));
    // 4. 自動查詢食譜
    const [rcp, rcpW] = chk(false, '啟用：菜單排程 / 食譜庫輸入新菜名時，自動查「愛料理」帶入建議食材');
    rcp.addEventListener('change', () => { (M.data.settings = M.data.settings || {}).recipe_lookup_enabled = rcp.checked; M.save(); });
    wrap.appendChild(card('自動查詢食譜食材（選用）', 'purple', rcpW, h('div', { style: { height: '1px', background: 'var(--border)', margin: '10px 0' } }),
      h('div.set-hint', '免金鑰、免費，搜尋 icook.tw（愛料理）取用第一筆搜尋結果的食譜（網頁版由雲端程式代為查詢）；\n'
        + '菜單排程帶入的食材會標橘字，食譜庫則會連配料數量、步驟、封面都一起帶入，請自行核對是否符合你的做法；\n'
        + '沒勾啟用，菜單排程／食譜庫功能照常運作，只是不會自動查詢建議內容。')));
    // 5. 資料管理
    const importF = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: () => { const f = importF.files[0]; importF.value = ''; if (f) importJson(f); } });
    wrap.appendChild(card('資料管理', 'warning', h('div.set-grid',
      h('span.lbl', '資料存放位置'), h('div.set-hint', '你的 Google 試算表（跟電腦版同一份）；這台裝置另外保留一份快取，離線時也能使用。'), sep(),
      h('span.lbl', '手動備份'), h('div', ui.btn('💾  立即備份（下載 JSON）', 'muted', () => M.backupData())), sep(),
      h('span.lbl', '匯入外部 JSON'), h('div', ui.btn('📥  匯入資料', 'muted', () => importF.click()), importF), sep(),
      h('span.lbl', { style: { color: 'var(--danger)', fontWeight: 700 } }, '清除所有記錄'), h('div', ui.btn('⚠  清除全部資料', 'red', () => clearAll())))));
    // 6. 雲端同步
    const url = ui.input('', { style: { fontFamily: 'var(--mono)', fontSize: '12px', width: '100%' } });
    const pw = ui.input('', { type: 'password', style: { width: '240px', fontFamily: 'var(--mono)' }, autocomplete: 'current-password' });
    const show = h('input', { type: 'checkbox', onchange: () => { pw.type = show.checked ? 'text' : 'password'; } });
    const state = h('span', { style: { color: 'var(--accent)', fontSize: '12px' } });
    wrap.appendChild(card('雲端同步（Google 試算表）', 'accent2', h('div.set-grid',
      h('span.lbl', '雲端網址'), url, h('span.lbl', { style: { marginTop: '8px' } }, '同步密碼'),
      h('div.opt-row', { style: { marginTop: '8px' } }, pw, h('label.chk', show, '顯示密碼')),
      h('div.full.opt-row', { style: { marginTop: '10px' } }, ui.btn('☁  連線並同步', 'blue', () => connect()), ui.btn('🔑  修改密碼', 'muted', () => changePw()),
        ui.btn('取消連線', 'muted', () => disconnect()), state),
      h('div.full.set-hint', { style: { marginTop: '8px' } }, '網址：Apps Script「部署 → 網頁應用程式」的 …/exec 網址（跟電腦版相同）。密碼：跟電腦版同一組，只存在這台裝置。\n'
        + '修改會先存在這台裝置，再自動上傳；沒網路時照常使用，連上後自動補傳。別台電腦的修改每 30 秒自動抓回來合併。'))));
    // 7. 關於
    wrap.appendChild(card('關於本系統', 'accent', h('b', { style: { fontSize: '16px' } }, `企業員工餐費管理系統  PRO Edition   網頁版 v${M.VERSION}`),
      h('div.sub', { style: { margin: '4px 0 2px' } }, '結算週期可自訂  ·  月曆日期選擇  ·  歷期查閱  ·  與電腦版共用 Google 試算表資料'),
      h('div', { style: { color: 'var(--muted)', fontSize: '11px', fontFamily: 'var(--mono)' } }, `資料：Google 試算表  ·  裝置：${navigator.userAgent.includes('Mobile') ? '手機' : '電腦'}瀏覽器`)));
    els = { budget, warn, danger, settle, upd, cont, oSlip, oRec, nSlip, nRec, rcp, url, pw, state, warnW, dangerW };
  };
  const setRange = (r, v) => { r.value = v; r.dispatchEvent(new Event('input')); };
  P.refresh = () => {
    if (!els.budget) return;
    const c = M.settings();
    els.budget.value = String(c.budget ?? M.cfg.budget);
    setRange(els.warn, c.warn_pct ?? 80); setRange(els.danger, c.danger_pct ?? 90);
    els.settle.value = c.settle_day ?? M.cfg.settle; els.upd();
    els.cont.checked = !!c.continuous_input;
    els.oSlip.checked = c.startup_open_slip ?? true; els.oRec.checked = !!c.startup_open_record;
    els.nSlip.checked = c.nav_open_slip ?? true; els.nRec.checked = c.nav_open_record ?? true;
    els.rcp.checked = !!c.recipe_lookup_enabled;
    if (document.activeElement !== els.url) els.url.value = M.cloud.cfg.url || window.MEAL_CLOUD_URL || '';
    if (document.activeElement !== els.pw) els.pw.value = M.cloud.cfg.pw || '';
    P.cloudLabel();
  };
  P.cloudLabel = () => { if (els.state) els.state.textContent = '目前狀態：' + (M.cloud.statusText() || '未連線（資料只存在這台裝置）'); };

  P.save = async () => {
    const budget = parseInt(String(els.budget.value).replace(/,/g, '').trim(), 10);
    if (!(budget > 0) || String(budget) !== String(els.budget.value).replace(/,/g, '').trim()) { await ui.error('格式錯誤', '預算金額必須為正整數。'); return; }
    const warn = parseInt(els.warn.value, 10), danger = parseInt(els.danger.value, 10), settle = Number(els.settle.value);
    if (!Number.isInteger(settle)) { await ui.error('格式錯誤', '警示門檻、危險門檻、結算起始日都必須填整數。'); return; }
    if (warn >= danger) { await ui.warn('設定錯誤', '警示門檻必須低於危險門檻。'); return; }
    if (!(settle >= 1 && settle <= 28)) { await ui.error('格式錯誤', '結算起始日必須在 1–28 之間。'); return; }
    const old = M.settings();
    const oldBudget = old.budget ?? M.cfg.budget;
    const pb = Object.assign({}, old.period_budgets || {});
    if (budget !== oldBudget) {
      if (!Object.keys(pb).length) pb['0000-01-01'] = oldBudget;     // 錨定舊預算到最早起始
      pb[D.iso(M.getPeriod(D.today())[0])] = budget;               // 新預算從本週期起生效
    }
    M.data.settings = Object.assign({}, old, {
      budget, warn_pct: warn, danger_pct: danger, settle_day: settle, period_budgets: pb,
      continuous_input: els.cont.checked, startup_open_slip: els.oSlip.checked, startup_open_record: els.oRec.checked,
      nav_open_slip: els.nSlip.checked, nav_open_record: els.nRec.checked, recipe_lookup_enabled: els.rcp.checked, nav_order: [...M.navOrder],
    });
    M.applySettings(M.data.settings);
    // 結算日改了 → 每筆記錄存的「週期」跟著重算
    for (const r of M.data.records) { const d = D.parse(r.date); if (d) { const [s, e] = M.getPeriod(d); r.period = M.periodKey(s, e); } }
    M.save();
    M.resumeLookup();
    M.refreshAll();
    ui.status(`設定已套用：預算 NT$${M.money(budget)}  /  結算日 每月 ${settle} 日`);
    await ui.info('儲存成功', '設定已儲存並立即生效。');
  };
  const reset = async () => {
    if (!(await ui.ask('還原預設', '確定要將所有設定還原為預設值？'))) return;
    els.budget.value = '13000'; setRange(els.warn, 80); setRange(els.danger, 90); els.settle.value = 26; els.upd();
    els.cont.checked = false; els.oSlip.checked = true; els.oRec.checked = false; els.nSlip.checked = true; els.nRec.checked = true;
    ui.status('已還原預設值（尚未儲存）');
  };
  const importJson = async (f) => {
    try {
      const imp = JSON.parse(await f.text());
      if (!imp || !Array.isArray(imp.records)) { await ui.error('格式錯誤', '所選檔案不含有效的 records 資料。'); return; }
      if (!(await ui.ask('確認匯入', `將匯入 ${imp.records.length} 筆記錄，與現有資料合併（不重複）。\n確定繼續？`))) return;
      const ids = new Set(M.data.records.map((r) => r.id));
      let added = 0;
      for (let r of imp.records) {
        if (r.id == null) { r = Object.assign({}, r, { id: M.newId() }); }
        if (!ids.has(r.id)) { M.data.records.push(r); ids.add(r.id); added++; }
      }
      M.save(); M.refreshAll();
      ui.status(`匯入完成：新增 ${added} 筆記錄`);
      await ui.info('匯入完成', `成功新增 ${added} 筆記錄。`);
    } catch (e) { await ui.error('匯入失敗', e.message || String(e)); }
  };
  const clearAll = async () => {
    if (!(await ui.ask('⚠ 清除資料', '確定要清除所有餐費記錄？\n此操作無法復原，建議先備份！\n（雲端試算表的記錄也會一起清除）'))) return;
    if (!(await ui.ask('⚠ 再次確認', '真的要刪除全部記錄嗎？'))) return;
    M.data.records = [];
    M.save(); M.refreshAll();
    ui.status('所有記錄已清除');
    await ui.info('已清除', '所有餐費記錄已刪除。');
  };
  const connect = async () => {
    const url = els.url.value.trim(), pw = els.pw.value.trim();
    els.pw.value = pw;
    if (!/^https:\/\/script\.google\.com\//.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) || !pw) {
      await ui.error('雲端同步', '請填 Apps Script 網頁應用程式網址（https://script.google.com/…/exec）和同步密碼。'); return;
    }
    M.cloud.configure(url, pw);
    els.state.textContent = '目前狀態：☁ 連線中…';
    await M.cloud.request(false);
    P.cloudLabel(); M.updateStatusInfo();
    if (M.cloud.state === 'ok') { M.refreshAll(); for (const pid of ['schedule', 'menu']) if (M.pages[pid].reload) M.pages[pid].reload(); M.uploadPendingImages(); ui.info('雲端同步', '已連線並同步完成。'); }
    else ui.error('雲端同步', M.cloud.statusText());
  };
  const disconnect = async () => {
    if (!M.cloud.enabled) return;
    if (!(await ui.ask('取消連線', '這台裝置將不再跟雲端同步（雲端資料不受影響），確定嗎？'))) return;
    M.cloud.configure(M.cloud.cfg.url, '');
    els.pw.value = ''; P.cloudLabel(); M.updateStatusInfo();
  };
  const changePw = () => {
    if (!M.cloud.enabled) { ui.info('修改密碼', '請先填好網址與密碼，按「連線並同步」連上雲端後再修改。'); return; }
    const oldI = ui.input('', { type: 'password' }), n1 = ui.input('', { type: 'password' }), n2 = ui.input('', { type: 'password' });
    const show = h('input', { type: 'checkbox', onchange: () => { for (const x of [oldI, n1, n2]) x.type = show.checked ? 'text' : 'password'; } });
    const ok = async () => {
      const o = oldI.value.trim(), a = n1.value.trim(), b = n2.value.trim();
      if (!o || !a) { await ui.warn('修改密碼', '請輸入目前密碼與新密碼。'); return; }
      if (a.length < 4) { await ui.warn('修改密碼', '新密碼至少要 4 個字。'); return; }
      if (a !== b) { await ui.warn('修改密碼', '兩次輸入的新密碼不一樣。'); return; }
      try {
        await M.cloud.changePassword(o, a);
        m.close();
        els.pw.value = a;
        await ui.info('修改密碼', '密碼已修改。\n其他電腦 / 裝置下次同步時會顯示密碼錯誤，請到它們的「系統設定 → 雲端同步」輸入新密碼。');
      } catch (e) { await ui.error('修改密碼', e.auth ? '目前密碼不正確。' : (e.message || String(e))); }
    };
    const m = ui.modal({ title: '🔑  修改同步密碼', width: 420, clickOut: false,
      body: h('div', ui.field('目前密碼', oldI), ui.field('新密碼（至少 4 個字）', n1), ui.field('再輸入一次新密碼', n2), h('label.chk', { style: { marginTop: '8px' } }, show, '顯示密碼')),
      buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確定修改', kind: 'blue', onclick: ok }] });
    ui.enterChain([oldI, n1, n2], ok);
    setTimeout(() => oldI.focus(), 40);
  };
})();
