/* 頁面：食材單價（貨單進貨明細）＋ 新增 / 編輯貨單、食材單價對話框 */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).ingredients = P;

  // 品名關鍵字 → 慣用單位（無歷史紀錄時的預設推測；由上而下比對，先中者優先）
  const UNIT_HINTS = [
    ['盒裝', '盒'], ['瓶裝', '瓶'], ['罐裝', '罐'], ['袋裝', '袋'], ['包裝', '包'],
    ['蛋', '盒'], ['吐司', '份'], ['土司', '份'], ['麵包', '份'], ['饅頭', '份'],
    ['牛奶', '瓶'], ['豆漿', '瓶'], ['飲料', '瓶'], ['醬油', '瓶'], ['食用油', '桶'],
    ['肉', '斤'], ['魚', '斤'], ['蝦', '斤'], ['雞', '斤'], ['鴨', '斤'], ['豬', '斤'],
    ['牛', '斤'], ['羊', '斤'], ['排', '斤'], ['菜', '斤'], ['瓜', '斤'], ['蔥', '斤'],
    ['薑', '斤'], ['蒜', '斤'], ['椒', '斤'], ['菇', '斤'], ['筍', '斤'], ['蘿蔔', '斤'],
    ['芹', '斤'], ['豆芽', '斤'], ['馬鈴薯', '斤'], ['洋蔥', '斤'], ['番茄', '斤'],
    ['蘋果', '斤'], ['香蕉', '斤'], ['米', '包'], ['麵', '包'],
  ];
  M.UNITS = ['斤', '公斤', '份', '盒', '包', '箱', '個', '顆', '瓶', '袋', '罐', '把', '條', '片', '打', '桶'];
  const lastMap = () => {
    const last = {};
    for (const r of [...M.data.ingredients].sort(M.sortByDateId)) last[r.name] = [r.unit || '', r.price, r.category || ''];
    return last;
  };
  const detectUnit = (nm, last) => {
    if (last[nm] && last[nm][0]) return last[nm][0];
    const hit = UNIT_HINTS.find(([kw]) => nm.includes(kw));
    return hit ? hit[1] : '';
  };

  let ingName = null, els = {};
  P.build = (el) => {
    const cat = ui.select(['全部', '🌅 早餐', '一般'], '全部', () => P.refresh(), { style: { width: '96px' } });
    const search = ui.input('', { style: { width: '160px' } });
    search.addEventListener('input', () => P.refresh());
    el.appendChild(h('div.toolbar',
      h('div.tb-l', ui.btn('＋  新增貨單 (Ctrl+N)', 'blue', () => M.addSlip()), ui.btn('✏  編輯', 'muted', () => editSlip()),
        ui.btn('✕  刪除最近一筆', 'red', () => delIng()), ui.btn('⬇  匯出 CSV', 'green', () => P.exportCsv())),
      h('div.tb-r', h('span.tb-lbl', '分類'), cat, h('div.tb-sep'), h('span.tb-lbl', '搜尋品名'), search)));
    el.appendChild(h('div.card-h', { style: { '--c': 'var(--accent2)', flex: 'none' } }, h('h3', '食材價格總覽')));
    const t = M.selTable(['品名', '分類', '單位', '最新單價', '前次單價', '漲跌', '最低', '最高', '次數'].map((x) => ({ t: x })), {
      onSel: (k) => { ingName = k; }, onOpen: () => editSlip(), onDel: () => delIng(),
    });
    el.appendChild(t.wrap);
    const status = h('span');
    el.appendChild(h('div.pagefoot', status));
    els = { cat, search, t, status };
    P.searchInput = search;
  };

  const groups = () => {
    const q = els.search.value.trim().toLowerCase();
    const g = {};
    for (const r of [...M.data.ingredients].sort(M.sortByDateId)) {
      if (q && !r.name.toLowerCase().includes(q)) continue;
      (g[r.name] = g[r.name] || []).push(r);
    }
    const cat = els.cat.value;
    for (const n of Object.keys(g)) {
      const bf = g[n][g[n].length - 1].category === '早餐';
      if ((cat === '🌅 早餐' && !bf) || (cat === '一般' && bf)) delete g[n];
    }
    return g;
  };
  P.refresh = () => {
    if (!els.t) return;
    const g = groups();
    const order = Object.entries(g).sort((a, b) => -M.sortByDateId(a[1][a[1].length - 1], b[1][b[1].length - 1]));
    ui.clear(els.t.tbody);
    for (const [name, rs] of order) {
      const last = rs[rs.length - 1], prices = rs.map((x) => Number(x.price));
      let prevS = '—', chg = '', cls = '';
      if (rs.length > 1) {
        const prev = Number(rs[rs.length - 2].price), diff = Number(last.price) - prev;
        if (diff > 0) { chg = `▲ +${M.num(diff)}`; cls = '.up'; } else if (diff < 0) { chg = `▼ ${M.num(diff)}`; cls = '.down'; } else chg = '—';
        prevS = M.num(prev, true);
      }
      els.t.tbody.appendChild(h('tr' + cls, { 'data-k': name },
        h('td.l', name), h('td', last.category === '早餐' ? '🌅 早餐' : ''), h('td', last.unit || ''),
        h('td', M.num(last.price, true)), h('td', prevS), h('td', chg),
        h('td', M.num(Math.min(...prices), true)), h('td', M.num(Math.max(...prices), true)), h('td', rs.length)));
    }
    if (!order.length) els.t.tbody.appendChild(h('tr.empty-row', h('td', { colspan: 9 }, '還沒有食材資料：按「＋ 新增貨單」輸入貨單')));
    if (ingName && g[ingName]) els.t.select(ingName); else ingName = null;
    els.status.textContent = `  共 ${Object.keys(g).length} 種食材  ·  選取食材後可「編輯」（或雙擊），修改最近一筆的單價 / 貨單`;
  };

  const latestRec = (name) => {
    if (!name) return null;
    const rs = M.data.ingredients.filter((r) => r.name === name).sort(M.sortByDateId);
    return rs[rs.length - 1] || null;
  };
  const editSlip = async () => {
    const rec = latestRec(ingName);
    if (!rec) { ui.info('提示', '請先選取要編輯的食材'); return; }
    if (rec.price_only) {
      const res = await priceDialog('編輯食材單價', rec);
      if (!res) return;
      Object.assign(rec, res);
      M.save(); M.refreshAll(); ui.status('單價已更新');
      return;
    }
    M.editSlipBySid(rec.slip_id ?? rec.id);
  };
  const delIng = async () => {
    const rec = latestRec(ingName);
    if (!rec) { ui.info('提示', '請先選取要刪除的食材'); return; }
    const kind = rec.price_only ? '單價紀錄' : '貨單品項';
    const extra = rec.price_only ? '' : '\n對應的餐費記錄會一併更新（貨單刪光則刪除該筆記錄）。';
    if (!(await ui.ask('確認刪除', `刪除「${rec.name}」最近一筆${kind}？\n${rec.date}  NT$${M.num(rec.price, true)}/${rec.unit || ''}${extra}`))) return;
    const sid = rec.slip_id ?? rec.id;
    M.data.ingredients.splice(M.data.ingredients.indexOf(rec), 1);
    if (!rec.price_only) syncSlipRecord(sid);
    M.save(); M.refreshAll();
    ui.status(`已刪除「${rec.name}」最近一筆${kind}`);
  };
  P.exportCsv = () => {
    const q = els.search ? els.search.value.trim().toLowerCase() : '';
    const recs = M.data.ingredients.filter((r) => !r.price_only && (!q || r.name.toLowerCase().includes(q))).sort((a, b) => -M.sortByDateId(a, b));
    const rows = [['日期', '品名', '分類', '數量', '單位', '單價', '金額']];
    for (const r of recs) rows.push([r.date, r.name, r.category || '', r.price_only ? '' : r.qty, r.unit || '', r.price, r.price_only ? '' : r.amount]);
    ui.download('食材單價.csv', ui.csv(rows));
    ui.status(`食材單價 CSV 匯出完成：${recs.length} 筆`);
  };

  // ── 貨單寫入與「費用記錄」同步 ──
  const storeSlip = (res, slipId = null) => {
    const base = M.newId();
    const sid = slipId ?? base;
    M.data.ingredients = M.data.ingredients.filter((r) => (r.slip_id ?? r.id) !== sid);
    res.items.forEach((it, k) => {
      const row = Object.assign({ id: base + k, slip_id: sid, date: res.date, slip_no: res.slip_no, supplier: res.supplier, people: res.people }, it);
      M.data.ingredients.push(row);
    });
    // 讓下一張貨單的 id 不會撞到這張的品項
    for (let k = 1; k < res.items.length; k++) M.newId();
    syncSlipRecord(sid);
    M.save(); M.refreshAll();
  };
  /** 貨單合計 ↔ 費用記錄：沒有對應記錄 → 先認領同日同金額未連結的記錄，找不到才新增；貨單沒品項 → 刪除記錄 */
  const syncSlipRecord = (sid) => {
    const items = M.data.ingredients.filter((r) => (r.slip_id ?? r.id) === sid);
    const recs = M.data.records;
    let rec = recs.find((r) => r.slip_id === sid);
    if (!items.length) { if (rec) recs.splice(recs.indexOf(rec), 1); return; }
    const head = items[0];
    const total = items.reduce((a, i) => a + Number(i.amount), 0);
    const no = head.slip_no || '';
    const note = no ? `貨單 ${no}` : `貨單（${items.length} 項）`;
    const [s, e] = M.getPeriod(D.parse(head.date));
    const period = M.periodKey(s, e);
    if (!rec) {
      rec = recs.find((r) => !('slip_id' in r) && r.date === head.date && Math.abs(Number(r.amount) - total) < 1);
      if (!rec) { recs.push({ id: M.newId() + 500, date: head.date, amount: total, note, period, slip_id: sid }); return; }
      rec.slip_id = sid;
    }
    Object.assign(rec, { date: head.date, amount: total, period });
    if (!rec.note || rec.note.startsWith('貨單')) rec.note = note;
  };
  M.syncSlipRecord = syncSlipRecord;

  M.addSlip = async () => {
    if (ui.modalOpen()) return;
    const withP = M.data.ingredients.filter((r) => r.people);
    const prev = withP.length ? withP.reduce((a, b) => (b.id > a.id ? b : a)) : null;
    const res = await slipDialog('新增貨單', prev ? { people: prev.people } : null);
    if (!res) return;
    storeSlip(res);
    ui.status(`已新增貨單：${res.date}  ${res.items.length} 項，餐費記錄已同步`);
  };
  M.editSlipBySid = (sid) => {
    const items = M.data.ingredients.filter((r) => !r.price_only && (r.slip_id ?? r.id) === sid).sort((a, b) => a.id - b.id);
    if (!items.length) return false;
    slipDialog('編輯貨單', items[0], items).then((res) => { if (res) { storeSlip(res, sid); ui.status('貨單已更新'); } });
    return true;
  };
  M.addPrice = async () => {
    const res = await priceDialog('新增食材單價');
    if (!res) return null;
    M.data.ingredients.push(Object.assign({ id: M.newId(), price_only: true, slip_no: '', supplier: '', qty: 0, amount: 0 }, res));
    M.save(); M.refreshAll();
    ui.status(`已新增單價：${res.name}  NT$${M.num(res.price, true)}/${res.unit}`);
    return res;
  };

  // ════════════════════════════════════════════════════════════ 對話框：單獨新增 / 編輯食材單價
  const priceDialog = (title, defaults = null) => new Promise((res) => {
    defaults = defaults || {};
    const last = lastMap();
    const isNew = !Object.keys(defaults).length;
    const dw = ui.dateInput(defaults.date || D.iso(D.today()), () => setTimeout(() => name.focus(), 60));
    const name = ui.input(defaults.name || '');
    const unit = ui.input(defaults.unit || '');
    const price = ui.input('price' in defaults ? M.num(defaults.price) : '', { inputmode: 'decimal' });
    const bf = h('input', { type: 'checkbox', checked: defaults.category === '早餐' });
    let unitAuto = isNew, catAuto = isNew;
    bf.addEventListener('change', () => { catAuto = false; });
    const nameW = ui.combo(name, () => Object.keys(last).sort(), () => autofill());
    const unitW = ui.combo(unit, () => M.UNITS, () => { unitAuto = false; });
    unit.addEventListener('input', (e) => { if (e.isTrusted) unitAuto = false; });
    name.addEventListener('input', () => {
      if (unit.value.trim() && !unitAuto) return;
      const u = detectUnit(name.value.trim(), last);
      if (u) { unit.value = u; unitAuto = true; }
    });
    const autofill = () => {
      const nm = name.value.trim();
      if (last[nm]) {
        if (!price.value.trim()) price.value = M.num(last[nm][1]);
        if (catAuto) bf.checked = last[nm][2] === '早餐';
      }
    };
    name.addEventListener('blur', autofill);
    const body = h('div', ui.field('📅  日期', dw), ui.field('🥬  品名', nameW), ui.field('📦  單位', unitW), ui.field('💵  單價  ( NT$ )', price),
      h('label.chk', { style: { marginTop: '12px' } }, bf, '🌅 早餐食材'));
    let result = null;
    const confirm = async () => {
      const ds = dw.input.value.trim(), nm = name.value.trim();
      if (!D.parse(ds)) { await ui.error('格式錯誤', '日期格式應為 YYYY-MM-DD'); return; }
      if (!nm) { await ui.warn('必填欄位', '請輸入品名。'); return; }
      const p = Number(price.value.trim());
      if (price.value.trim() === '' || !isFinite(p) || p < 0) { await ui.error('格式錯誤', '單價必須為數字。'); return; }
      result = { date: ds, name: nm, unit: unit.value.trim(), price: p, category: bf.checked ? '早餐' : '' };
      m.close();
    };
    const m = ui.modal({ title, width: 460, body, clickOut: false, onClose: () => res(result),
      buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確  認', kind: 'blue', onclick: confirm }] });
    ui.enterChain([dw.input, name, unit, price], confirm);
    setTimeout(() => (isNew ? name : price).focus(), 40);
  });

  // ════════════════════════════════════════════════════════════ 對話框：新增 / 編輯貨單
  const COLS = ['品名', '數量', '單位', '單價', '金額', '早餐', ''];
  const slipDialog = (title, header = null, items = null) => new Promise((resolve) => {
    header = header || {};
    let last = lastMap(), names = Object.keys(last).sort();
    const rows = [];
    const total = h('span.slip-total');
    const dw = ui.dateInput(header.date || D.iso(D.today()), () => setTimeout(() => { people.focus(); people.select(); }, 60));
    dw.style.width = '220px';
    const people = ui.input(header.people ? M.num(header.people) : '', { inputmode: 'decimal', style: { width: '110px', textAlign: 'center' } });
    const grid = h('div.slip-grid');
    const head = h('div.slip-grid.slip-head', COLS.map((c) => h('div', c)));
    const body = h('div',
      h('div.slip-top', ui.field('📅  日期', dw), ui.field('👥  用餐人數（供叫貨計算）', people)),
      head, grid);
    const reloadNames = () => { last = lastMap(); names = Object.keys(last).sort(); };
    const updateTotal = () => {
      let t = 0;
      for (const r of rows) { const v = Number(r.amt.value); if (r.amt.value.trim() && isFinite(v)) t += v; }
      total.textContent = `合計：NT$ ${M.money(t)}`;
    };
    const fnum = (s) => { s = String(s).trim(); if (!s) return NaN; const v = Number(s); return isFinite(v) ? v : NaN; };
    const addRow = (item = null) => {
      const r = { unitAuto: !item, catAuto: !item, manual: false, qmanual: false };
      r.name = ui.input(item ? item.name : '');
      r.qty = ui.input(item ? M.num(item.qty) : '', { inputmode: 'decimal' });
      r.unit = ui.input(item ? item.unit || '' : '');
      r.price = ui.input(item ? M.num(item.price) : '', { inputmode: 'decimal' });
      r.amt = ui.input(item ? M.num(item.amount) : '', { inputmode: 'decimal' });
      r.bf = h('input', { type: 'checkbox', checked: !!item && item.category === '早餐' });
      if (item) { r.manual = Math.abs(Number(item.amount) - Number(item.qty) * Number(item.price)) > 1; r.qmanual = true; }
      r.bf.addEventListener('change', () => { r.catAuto = false; });
      const nameW = ui.combo(r.name, () => names, () => autofill());
      const unitW = ui.combo(r.unit, () => M.UNITS, () => { r.unitAuto = false; });
      const xb = ui.btn('✕', 'muted', () => removeRow(r)); xb.classList.add('x'); xb.tabIndex = -1;
      r.els = [nameW, r.qty, unitW, r.price, r.amt, h('div.bf', r.bf), xb];
      r.els.forEach((x) => grid.appendChild(x));
      const recalc = () => {           // 金額非手動 → 金額 = 數量 × 單價；金額手動、數量非手動 → 數量 = 金額 ÷ 單價
        const p = fnum(r.price.value);
        if (isNaN(p)) return;
        if (!r.manual) { const q = fnum(r.qty.value); if (isNaN(q)) return; r.amt.value = M.num(Math.floor(q * p + 0.5)); }
        else if (!r.qmanual && p > 0) { const a = fnum(r.amt.value); if (isNaN(a)) return; r.qty.value = M.num(a / p); }
      };
      const mark = () => {
        const a = fnum(r.amt.value), q = fnum(r.qty.value), p = fnum(r.price.value);
        r.amt.classList.toggle('warn', !isNaN(a) && !isNaN(q) && !isNaN(p) && Math.abs(a - q * p) > 1);
      };
      const refresh = () => { recalc(); updateTotal(); mark(); };
      const autofill = () => {
        const nm = r.name.value.trim();
        if (last[nm]) {
          if (!r.price.value.trim()) { r.price.value = M.num(last[nm][1]); refresh(); }
          if (r.catAuto) r.bf.checked = last[nm][2] === '早餐';
        }
      };
      r.name.addEventListener('input', () => {
        if (r.unit.value.trim() && !r.unitAuto) return;
        const u = detectUnit(r.name.value.trim(), last);
        if (u) { r.unit.value = u; r.unitAuto = true; }
      });
      r.name.addEventListener('blur', autofill);
      r.unit.addEventListener('input', (e) => { if (e.isTrusted) r.unitAuto = false; });
      r.qty.addEventListener('input', () => { r.qmanual = !!r.qty.value.trim(); refresh(); });
      r.price.addEventListener('input', refresh);
      r.amt.addEventListener('input', () => { r.manual = !!r.amt.value.trim(); refresh(); });
      for (const x of [r.name, r.qty, r.unit, r.price, r.amt]) x.addEventListener('keydown', goNext);
      rows.push(r);
      mark(); updateTotal();
      return r;
    };
    const removeRow = (r) => {
      r.els.forEach((x) => x.remove());
      rows.splice(rows.indexOf(r), 1);
      updateTotal();
    };
    /** Enter：游標移到下一個輸入框；最後一列的金額欄再按 Enter 會新增一列 */
    const goNext = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
      if (e.ctrlKey) return;
      if (e.target._comboOpen && e.target._comboOpen()) return;
      e.preventDefault();
      const seq = [dw.input, people, ...rows.flatMap((r) => [r.name, r.qty, r.unit, r.price, r.amt])];
      const i = seq.indexOf(e.target);
      if (i < 0) return;
      ui.closeCal(); ui.closeCombo();
      const nx = seq[i + 1] || addRow().name;
      nx.focus(); if (nx.select) nx.select();
      nx.scrollIntoView({ block: 'nearest' });
    };
    dw.input.addEventListener('keydown', goNext);
    people.addEventListener('keydown', goNext);
    for (const it of items || []) addRow(it);
    const blank = addRow();
    let result = null;
    const confirm = async () => {
      const ds = dw.input.value.trim();
      if (!D.parse(ds)) { await ui.error('格式錯誤', '日期格式應為 YYYY-MM-DD'); return; }
      const ps = people.value.trim();
      let pp = null;
      if (ps) { pp = Number(ps); if (!(pp > 0)) { await ui.error('格式錯誤', '用餐人數必須為正數（可留空）。'); return; } }
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = r.name.value.trim();
        const vals = [r.qty, r.unit, r.price, r.amt].map((x) => x.value.trim());
        if (!name && !vals.some(Boolean)) continue;
        if (!name) { await ui.warn('必填欄位', `第 ${i + 1} 列缺少品名。`); return; }
        const qty = Number(vals[0]), price = Number(vals[2]);
        if (!vals[0] || !vals[2] || !(qty > 0) || !isFinite(price) || price < 0) { await ui.error('格式錯誤', `第 ${i + 1} 列（${name}）的數量須為正數、單價須為數字。`); return; }
        const amount = vals[3] ? Number(vals[3]) : Math.floor(qty * price + 0.5);
        if (!isFinite(amount) || amount < 0) { await ui.error('格式錯誤', `第 ${i + 1} 列（${name}）的金額格式錯誤。`); return; }
        out.push({ name, qty, unit: vals[1], price, amount, category: r.bf.checked ? '早餐' : '' });
      }
      if (!out.length) { await ui.warn('沒有品項', '請至少輸入一個品項。'); return; }
      result = { date: ds, slip_no: header.slip_no || '', supplier: header.supplier || '', people: pp, items: out };
      m.close();
    };
    const newPrice = async () => {
      const prev = document.activeElement;
      const r = await M.addPrice();
      if (r) reloadNames();
      if (prev && document.contains(prev)) prev.focus();
    };
    const m = ui.modal({
      title, width: 900, body, clickOut: false, sub: '儲存後自動同步一筆餐費記錄（貨單合計）',
      headRight: ui.btn('＋ 新增單價', 'blue', newPrice),
      footLeft: [ui.btn('＋ 新增一列', 'muted', () => { const r = addRow(); r.name.focus(); r.name.scrollIntoView({ block: 'nearest' }); }), total, h('span.slip-note', '橘色＝金額與數量×單價不符')],
      buttons: [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確  認', kind: 'blue', onclick: confirm }],
      onClose: () => resolve(result),
    });
    m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); confirm(); } });
    setTimeout(() => (items ? dw.input : blank.name).focus(), 40);
  });
})();
