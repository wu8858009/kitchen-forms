/* 頁面：費用記錄 ＋ 新增 / 編輯餐費記錄對話框 */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).records = P;
  let filter = '本期', sortCol = '日期', sortRev = true, selId = null, els = {};

  /** 可選取的表格：點一下選取、雙擊、Enter 編輯、Delete 刪除 */
  M.selTable = (cols, { onSel, onOpen, onDel, sort } = {}) => {
    const thead = h('tr');
    for (const c of cols) {
      const th = h('th' + (sort ? '.sort' : ''), { style: c.w ? { minWidth: c.w + 'px' } : null }, c.t);
      if (sort) th.addEventListener('click', () => sort(c.t));
      thead.appendChild(th);
    }
    const tbody = h('tbody');
    const table = h('table.tbl', h('thead', thead), tbody);
    const wrap = h('div.tbl-wrap', { tabindex: 0 }, table);
    const pick = (tr) => {
      for (const x of tbody.querySelectorAll('tr.sel')) x.classList.remove('sel');
      if (tr) { tr.classList.add('sel'); if (onSel) onSel(tr.dataset.k); }
    };
    tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-k]'); if (tr) pick(tr); });
    tbody.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-k]'); if (tr) { pick(tr); if (onOpen) onOpen(tr.dataset.k); } });
    wrap.addEventListener('keydown', (e) => {
      const cur = tbody.querySelector('tr.sel');
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const nx = cur ? (e.key === 'ArrowDown' ? cur.nextElementSibling : cur.previousElementSibling) : tbody.querySelector('tr[data-k]');
        if (nx && nx.dataset.k) { pick(nx); nx.scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter' && cur && onOpen) { e.preventDefault(); onOpen(cur.dataset.k); }
      else if (e.key === 'Delete' && cur && onDel) { e.preventDefault(); onDel(cur.dataset.k); }
    });
    return { wrap, tbody, thead, pick, select(k) { const tr = tbody.querySelector(`tr[data-k="${CSS.escape(String(k))}"]`); if (tr) { tr.classList.add('sel'); tr.scrollIntoView({ block: 'nearest' }); } return !!tr; } };
  };

  P.build = (el) => {
    const search = ui.input('', { placeholder: '', style: { width: '150px' } });
    search.addEventListener('input', () => P.refresh());
    const fsel = h('select', { style: { width: '250px' }, onchange: () => { filter = fsel.value; P.refresh(); } });
    el.appendChild(h('div.toolbar',
      h('div.tb-l', ui.btn('＋  新增記錄', 'blue', () => M.addRecord()), ui.btn('✏  編輯', 'muted', () => edit()),
        ui.btn('✕  刪除', 'red', () => del()), h('div.tb-sep'), ui.btn('⬇  匯出 CSV', 'green', () => P.exportCsv())),
      h('div.tb-r', h('span.tb-lbl', '搜尋'), search, h('div.tb-sep'), h('span.tb-lbl', '週期'), fsel)));
    const t = M.selTable([{ t: '日期', w: 120 }, { t: '金額', w: 130 }, { t: '備註', w: 200 }, { t: '結算週期', w: 220 }], {
      sort: (c) => { if (c === '結算週期') return; if (sortCol === c) sortRev = !sortRev; else { sortCol = c; sortRev = false; } P.refresh(); },
      onSel: (k) => { selId = Number(k); }, onOpen: (k) => openRec(Number(k)), onDel: () => del(),
    });
    el.appendChild(t.wrap);
    const status = h('span');
    el.appendChild(h('div.pagefoot', status));
    els = { search, fsel, t, status };
    P.searchInput = search;
  };
  P.setFilter = (v) => { filter = v; };

  const filtered = () => {
    const kw = els.search.value.trim().toLowerCase();
    let recs;
    if (filter === '本期') recs = M.currentPeriodRecords();
    else if (M.periodsMap[filter]) { const [si, ei] = M.periodsMap[filter]; recs = M.data.records.filter((r) => si <= r.date && r.date < ei); }
    else recs = [...M.data.records];
    if (kw) recs = recs.filter((r) => r.date.includes(kw) || String(r.note || '').toLowerCase().includes(kw));
    const k = sortCol === '金額' ? 'amount' : sortCol === '備註' ? 'note' : 'date';
    recs.sort((a, b) => {
      const x = k === 'amount' ? Number(a.amount) : String(a[k] || ''), y = k === 'amount' ? Number(b.amount) : String(b[k] || '');
      return (x < y ? -1 : x > y ? 1 : 0) * (sortRev ? -1 : 1);
    });
    return recs;
  };
  P.filtered = filtered;

  P.refresh = () => {
    if (!els.t) return;
    const labels = M.refreshPeriods();
    if (!labels.includes(filter)) filter = '本期';
    ui.clear(els.fsel);
    for (const l of labels) els.fsel.appendChild(h('option', { value: l, selected: l === filter }, l));
    const recs = filtered();
    ui.clear(els.t.tbody);
    let total = 0;
    for (const r of recs) {
      const d = D.parse(r.date);
      const [s, e] = d ? M.getPeriod(d) : [null, null];
      els.t.tbody.appendChild(h('tr', { 'data-k': r.id }, h('td', r.date), h('td', `NT$ ${M.money(r.amount)}`),
        h('td.l', r.note || ''), h('td', s ? M.periodLabel(s, e) : '')));
      total += Number(r.amount) || 0;
    }
    if (!recs.length) els.t.tbody.appendChild(h('tr.empty-row', h('td', { colspan: 4 }, '沒有記錄')));
    if (selId != null && !els.t.select(selId)) selId = null;
    for (const th of els.t.thead.children) th.textContent = th.textContent.replace(/ [↑↓]$/, '') + (th.textContent.startsWith(sortCol) ? (sortRev ? ' ↓' : ' ↑') : '');
    els.status.textContent = `  共 ${recs.length} 筆記錄  ·  合計  NT$ ${M.money(total)}  ·  排序：${sortCol} ${sortRev ? '↓' : '↑'}`;
  };

  /** 雙擊：有對應貨單（或同一天的貨單）→ 開貨單；否則編輯記錄 */
  const openRec = (rid) => {
    const rec = M.data.records.find((r) => r.id === rid);
    if (!rec) return;
    let sid = rec.slip_id;
    if (sid == null) {
      const same = M.data.ingredients.filter((r) => !r.price_only && r.date === rec.date).sort((a, b) => a.id - b.id);
      if (same.length) sid = same[0].slip_id ?? same[0].id;
    }
    if (sid != null && M.editSlipBySid(sid)) return;
    edit();
  };
  const edit = async () => {
    if (selId == null) { ui.info('提示', '請先選取一筆記錄'); return; }
    const rec = M.data.records.find((r) => r.id === selId);
    if (rec) await M.editRecord(rec);
  };
  const del = async () => {
    if (selId == null) { ui.info('提示', '請先選取一筆記錄'); return; }
    if (!(await ui.ask('確認刪除', '確定要刪除此筆記錄？'))) return;
    M.data.records = M.data.records.filter((r) => r.id !== selId);
    selId = null;
    M.save(); M.refreshAll(); ui.status('記錄已刪除');
  };
  P.exportCsv = () => {
    const recs = filtered();
    const rows = [['日期', '金額', '備註', '結算週期']];
    for (const r of recs) { const [s, e] = M.getPeriod(D.parse(r.date)); rows.push([r.date, r.amount, r.note || '', M.periodLabel(s, e)]); }
    ui.download('費用記錄.csv', ui.csv(rows));
    ui.status(`CSV 匯出完成：${recs.length} 筆`);
  };

  // ════════════════════════════════════════════════════════════ 對話框：新增 / 編輯記錄
  M.recordDialog = (title, defaults = null, continuous = false, onSave = null) => new Promise((res) => {
    const dw = ui.dateInput((defaults || {}).date || D.iso(D.today()), () => setTimeout(() => { amt.focus(); amt.select(); }, 60));
    const amt = ui.input(defaults && defaults.amount !== '' && defaults.amount != null ? String(defaults.amount) : '', { inputmode: 'decimal' });
    const note = ui.input((defaults || {}).note || '');
    const st = h('div', { style: { color: 'var(--accent2)', fontSize: '12px', textAlign: 'right', minHeight: '18px', marginTop: '8px' } });
    const body = h('div', ui.field('📅  日期', dw), ui.field('💵  金額  ( NT$ )', amt), ui.field('📝  備註', note), continuous ? st : null);
    let result = null, added = 0;
    const validate = async () => {
      const ds = dw.input.value.trim(), a = amt.value.trim(), n = note.value.trim();
      if (!ds || !a) { await ui.warn('必填欄位', '日期、金額 為必填。'); return null; }
      if (!D.parse(ds)) { await ui.error('格式錯誤', '日期格式應為 YYYY-MM-DD'); return null; }
      const amount = Number(a);
      if (!(amount > 0) || !isFinite(amount)) { await ui.error('格式錯誤', '金額必須為正數。'); return null; }
      return { date: ds, amount, note: n };
    };
    const confirm = async () => {
      const rec = await validate();
      if (!rec) return;
      if (continuous && onSave) {
        onSave(rec);
        added++;
        st.textContent = `✓  已儲存第 ${added} 筆（${rec.date}  NT$${M.money(rec.amount)}）`;
        amt.value = ''; note.value = ''; amt.focus();
      } else { result = rec; m.close(); }
    };
    const m = ui.modal({
      title, width: 480, body, clickOut: false,
      buttons: continuous ? [{ text: '完  成', kind: 'muted', onclick: () => m.close() }, { text: '儲存並繼續', kind: 'blue', onclick: confirm }]
        : [{ text: '取  消', kind: 'muted', onclick: () => m.close() }, { text: '確  認', kind: 'blue', onclick: confirm }],
      onClose: () => res(result),
    });
    for (const x of [dw.input, amt, note]) x.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ui.closeCal(); confirm(); } });
    setTimeout(() => dw.input.focus(), 40);
  });

  const stamp = (rec) => { const [s, e] = M.getPeriod(D.parse(rec.date)); rec.period = M.periodKey(s, e); return rec; };
  M.addRecord = async () => {
    if (ui.modalOpen()) return;
    if (M.settings().continuous_input) {
      await M.recordDialog('新增餐費記錄（連續輸入）', null, true, (rec) => {
        stamp(rec); rec.id = M.newId();
        M.data.records.push(rec); M.save(); M.refreshAll();
        ui.status(`已新增：${rec.date}  NT$${M.money(rec.amount)}`);
      });
    } else {
      const rec = await M.recordDialog('新增餐費記錄');
      if (!rec) return;
      stamp(rec); rec.id = M.newId();
      M.data.records.push(rec); M.save(); M.refreshAll();
      ui.status(`已新增：${rec.date}  NT$${M.money(rec.amount)}`);
    }
  };
  M.editRecord = async (rec, after) => {
    const upd = await M.recordDialog('編輯餐費記錄', rec);
    if (!upd) return false;
    stamp(upd); upd.id = rec.id;
    if ('slip_id' in rec) upd.slip_id = rec.slip_id;
    const i = M.data.records.indexOf(rec);
    if (i >= 0) M.data.records[i] = upd;
    M.save(); M.refreshAll();
    ui.status(after || '記錄已更新');
    return true;
  };
})();
