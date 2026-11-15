/* 頁面：排班人數（班表 → 早餐人數 / 用餐人數，可帶入叫貨計算） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).schedule = P;
  const COLS = [[2, '職稱'], [2, '姓名'], ...M.WEEKDAYS.map((d) => [3, d])];
  const gridCols = COLS.map((c) => `minmax(0, ${c[0]}fr)`).join(' ') + ' 44px';
  let monday = D.monday(D.today()), staff = [], rows = [], saveT = null, els = {};

  // ── 規則（同電腦版）──
  /** 該格第一段時間 [開始, 結束]（小時，可含小數）；休假 / 空白 → null */
  M.schRange = (text) => {
    const m = /(\d{1,2}(?:\.\d+)?)\s*[-~–－]\s*(\d{1,2}(?:\.\d+)?)/.exec(text || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  /** 有吃到用餐時間的飯：用餐時間前已上班，且用餐時間後 1 小時以上才下班 */
  const eats = (rng, cut) => rng != null && rng[0] < cut && rng[1] > cut + 1;
  /** 有吃到早餐：開始上班時間不晚於早餐時間（含剛好那個時間點） */
  const eatsB = (rng, bcut) => rng != null && rng[0] <= bcut;
  M.schCountsOf = (list, cut, bcut) => {
    const work = [0, 0, 0, 0, 0, 0, 0], eat = [0, 0, 0, 0, 0, 0, 0], bf = [0, 0, 0, 0, 0, 0, 0];
    for (const p of list) {
      const cells = (p.cells || ['', '', '', '', '', '', '']).slice(0, 7);
      cells.forEach((c, i) => {
        const rng = M.schRange(c);
        if (rng) { work[i]++; if (eats(rng, cut)) eat[i]++; if (eatsB(rng, bcut)) bf[i]++; }
      });
    }
    return [work, eat, bf];
  };
  const meta = () => (M.data.schedule_meta = M.data.schedule_meta || {});
  const numOr = (v, d) => { const x = Number(v); return v !== '' && v != null && isFinite(x) ? x : d; };
  /** 某週每天的 [早餐人數, 晚餐用餐人數]；沒有班表 → null */
  M.schWeekMealCounts = (mon) => {
    const list = (M.data.schedule || {})[D.iso(mon)];
    if (!list || !list.length) return null;
    const [, eat, bf] = M.schCountsOf(list, numOr(meta().cutoff, 17), numOr(meta().b_cutoff, 11));
    return [bf, eat];
  };
  M.schWeekCounts = (mon) => { const r = M.schWeekMealCounts(mon); return r ? [...r[1]] : null; };

  const cutoff = () => numOr(els.cut.value.trim(), 17);
  const bcutoff = () => numOr(els.bcut.value.trim(), 11);

  P.build = (el) => {
    const wk = h('span.wk-lbl');
    const bcut = ui.input(M.num(numOr(meta().b_cutoff, 11)), { class: 'sch-cut', inputmode: 'decimal' });
    const cut = ui.input(M.num(numOr(meta().cutoff, 17)), { class: 'sch-cut', inputmode: 'decimal' });
    bcut.addEventListener('input', () => changed(true));
    cut.addEventListener('input', () => changed(true));
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { if (file.files[0]) M.schImportFile(file.files[0]); file.value = ''; } });
    el.appendChild(h('div.toolbar',
      h('div.tb-l', ui.btn('上週', 'muted', () => P.shift(-1)), wk, ui.btn('下週', 'muted', () => P.shift(1)), ui.btn('本週', 'muted', () => P.home()),
        h('div.tb-sep'), ui.btn('＋ 新增人員', 'muted', () => addStaff()), h('div.tb-sep'),
        h('span.tb-lbl', '早餐時間'), bcut, h('span.tb-lbl', '點前'), h('span', { style: { width: '6px' } }), h('span.tb-lbl', '用餐時間'), cut, h('span.tb-lbl', '點')),
      h('div.tb-r', ui.btn('📷 讀取照片', 'blue', () => file.click()), ui.btn('📋 貼上截圖', 'muted', () => M.schImportClipboard()),
        ui.btn('🛒 帶入叫貨', 'green', () => toOrder()), file)));
    const head = h('div.grow.ghead', { style: { gridTemplateColumns: gridCols } });
    const body = h('div.gbody');
    const foot = h('div.grow.sch-foot', { style: { gridTemplateColumns: gridCols } });
    el.appendChild(h('div.scroll', { style: { padding: '10px 16px 8px' } }, h('div.gtable', head, body, foot)));
    els = { wk, bcut, cut, head, body, foot };
    // 貼上截圖：Ctrl+V 也可以
    el.addEventListener('paste', (e) => {
      const it = [...(e.clipboardData || {}).items || []].find((x) => x.type.startsWith('image/'));
      if (it && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); M.schImportFile(it.getAsFile()); }
    });
    loadWeek();
  };
  P.shift = (n) => { monday = D.add(monday, 7 * n); loadWeek(); };
  P.home = () => { monday = D.monday(D.today()); loadWeek(); };
  P.reload = () => { if (els.body) loadWeek(); };
  P.refresh = () => { if (els.body) loadWeek(); };
  P.monday = () => monday;
  P.setMonday = (d) => { monday = d; loadWeek(); };

  /** 載入該週班表；還沒有資料 → 沿用最近一週的人員名單（班別留白） */
  const loadWeek = () => {
    const sched = (M.data.schedule = M.data.schedule || {});
    const iso = D.iso(monday);
    if (sched[iso]) staff = sched[iso];
    else {
      const ks = Object.keys(sched).sort();
      const earlier = ks.filter((k) => k < iso);
      const base = earlier.length ? sched[earlier[earlier.length - 1]] : ks.length ? sched[ks[ks.length - 1]] : [];
      staff = (base || []).map((p) => ({ role: p.role || '', name: p.name || '', cells: ['', '', '', '', '', '', ''] }));
    }
    els.wk.textContent = `${D.fmt(monday)} ～ ${D.md(D.add(monday, 6))}`;
    render();
  };
  P.staff = () => staff;
  P.setStaff = (s) => { staff = s; changed(); render(); };
  P.loadWeek = loadWeek;

  const styleCell = (inp, text) => {
    const rng = M.schRange(text);
    inp.classList.remove('warn', 'off', 'late');
    if (!rng) { const t = text.trim(); if (t.startsWith('?')) inp.classList.add('warn'); else if (t) inp.classList.add('off'); }
    else if (!(eats(rng, cutoff()) || eatsB(rng, bcutoff()))) inp.classList.add('late');
  };
  const render = () => {
    ui.clear(els.head);
    COLS.forEach(([, t], c) => {
      if (c >= 2) { const d = D.add(monday, c - 2); t = `${t}\n${D.m(d)}/${D.d(d)}`; }
      els.head.appendChild(h('div', t));
    });
    els.head.appendChild(h('div'));
    ui.clear(els.body);
    rows = [];
    staff.forEach((p, r) => {
      const row = h('div.grow.sch-row', { style: { gridTemplateColumns: gridCols } });
      const ents = [];
      for (const [k, key, flag] of [[0, 'role', 'role_unsure'], [1, 'name', 'name_unsure']]) {
        const inp = ui.input(p[key] || '');
        if (p[flag]) inp.classList.add('warn');
        inp.addEventListener('input', () => {
          if (p[key] !== inp.value) { p[flag] = false; inp.classList.remove('warn'); }   // 改過 → 視為已確認
          p[key] = inp.value; changed();
        });
        // 只有按 Enter 才算「看過、確認無誤」，免得沒細看就把辨識錯的字樣記進記憶庫
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && p[flag]) { p[flag] = false; inp.classList.remove('warn'); changed(); } });
        row.appendChild(h('div.gcell', inp)); ents.push(inp);
      }
      for (let i = 0; i < 7; i++) {
        const v = (p.cells || [])[i] || '';
        const inp = ui.input(v);
        styleCell(inp, v);
        inp.addEventListener('input', () => {
          (p.cells = p.cells || ['', '', '', '', '', '', ''])[i] = inp.value;
          styleCell(inp, inp.value); updateFoot(); changed();
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); move(r, 2 + i, 0, 1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); move(r, 2 + i, 1, 0); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(r, 2 + i, -1, 0); }
        });
        row.appendChild(h('div.gcell', inp)); ents.push(inp);
      }
      const x = ui.btn('✕', 'muted', () => delStaff(p)); x.classList.add('x');
      row.appendChild(h('div', { style: { display: 'flex', justifyContent: 'center' } }, x));
      els.body.appendChild(row);
      rows.push({ person: p, ents });
    });
    if (!staff.length) els.body.appendChild(h('div.gempty', '這週還沒有班表\n\n按「＋ 新增人員」建立人員，再填每天的上班時間（例如 11-20）；\n休假填「休」或留白。'));
    updateFoot();
  };
  const updateFoot = () => {
    const f = els.foot;
    ui.clear(f);
    const [work, eat, bf] = M.schCountsOf(staff, cutoff(), bcutoff());
    const lab = h('div.gcell', { style: { gridColumn: 'span 2', textAlign: 'left', fontSize: '12px', lineHeight: '1.9' } },
      h('div.sub', '上班人數（灰字＝上班但沒吃到飯）'),
      h('div', { style: { color: 'var(--purple)', fontWeight: 700 } }, `${M.num(bcutoff())} 點前上班早餐人數`),
      h('div', { style: { color: 'var(--accent2)', fontWeight: 700 } }, `${M.num(cutoff())} 點用餐人數`));
    f.appendChild(lab);
    for (let i = 0; i < 7; i++) {
      f.appendChild(h('div.gcell', { style: { lineHeight: '1.5' } },
        h('div.sub', String(work[i])),
        h('div', { style: { color: 'var(--purple)', fontWeight: 700, fontSize: '16px' } }, String(bf[i])),
        h('div', { style: { color: 'var(--accent2)', fontWeight: 700, fontSize: '19px' } }, String(eat[i]))));
    }
    f.appendChild(h('div.gcell', { style: { fontSize: '11px', whiteSpace: 'pre-line', padding: '3px 0' } },
      `早餐\n${bf.reduce((a, b) => a + b, 0)}\n用餐\n${eat.reduce((a, b) => a + b, 0)}`));
  };
  const move = (r, c, dr, dc) => {
    if (dc) { c += dc; if (c > 8) { r++; c = 2; } } else r += dr;
    if (r >= 0 && r < rows.length) { const e = rows[r].ents[c]; e.focus(); e.select(); }
  };
  /** 把目前這週寫回資料（稍後存檔） */
  const changed = (cut = false) => {
    if (cut) {
      meta().cutoff = cutoff(); meta().b_cutoff = bcutoff();
      rows.forEach((row) => { for (let i = 0; i < 7; i++) styleCell(row.ents[2 + i], (row.person.cells || [])[i] || ''); });
      updateFoot();
    }
    (M.data.schedule = M.data.schedule || {})[D.iso(monday)] = staff;
    learn();
    clearTimeout(saveT); saveT = setTimeout(() => { M.save(); M.refreshPage('order'); M.refreshPage('menu'); }, 600);
  };
  P.changed = changed;
  /** 記住「這個字樣圖 = 這個姓名 / 職稱」（照片辨識用；每個名字最多 3 張） */
  const learn = () => {
    for (const [key, tk, ik] of [['name_lib', 'name', 'name_img'], ['role_lib', 'role', 'role_img']]) {
      const lib = (M.data[key] = M.data[key] || {});
      for (const p of staff) {
        const txt = String(p[tk] || '').trim(), img = p[ik];
        if (!txt || !img || p[tk + '_unsure'] || (lib[txt] || []).includes(img)) continue;
        for (const other of Object.keys(lib)) {
          if (other !== txt && lib[other].includes(img)) { lib[other] = lib[other].filter((x) => x !== img); if (!lib[other].length) delete lib[other]; }
        }
        (lib[txt] = lib[txt] || []).push(img);
        lib[txt] = lib[txt].slice(-3);
      }
    }
  };
  const addStaff = () => {
    staff.push({ role: '', name: '', cells: ['', '', '', '', '', '', ''] });
    changed(); render();
    const last = rows[rows.length - 1];
    if (last) { last.ents[1].focus(); last.ents[1].scrollIntoView({ block: 'nearest' }); }
  };
  const delStaff = async (p) => {
    if (!(await ui.ask('確認刪除', `從本週班表刪除「${p.name || '此人員'}」？`))) return;
    staff.splice(staff.indexOf(p), 1);
    changed(); render();
  };
  const toOrder = () => {
    const [, eat, bf] = M.schCountsOf(staff, cutoff(), bcutoff());
    if (!eat.some(Boolean)) { ui.info('提示', '這週還沒有可計算的班表。'); return; }
    M.showPage('order');
    M.ordApplyWeekCounts([...eat]);
    ui.status(`已帶入叫貨計算：${D.md(monday)} 起一週，共 ${eat.reduce((a, b) => a + b, 0)} 人次（早餐 ${bf.reduce((a, b) => a + b, 0)} ＋ 用餐 ${eat.reduce((a, b) => a + b, 0)}）`);
  };

  // 照片辨識：在 p-ocr.js 實作（載入失敗時給提示）
  M.schImportFile = M.schImportFile || (() => ui.info('讀取照片', '照片辨識元件還沒載入完成，請稍後再試。'));
  M.schImportClipboard = M.schImportClipboard || (async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) { M.schImportFile(await it.getType(t)); return; }
      }
      ui.info('提示', '剪貼簿裡沒有圖片。\n請先截圖或複製班表圖片，再按這個按鈕（也可以直接按 Ctrl+V 貼上）。');
    } catch (e) {
      ui.info('提示', '瀏覽器不允許讀取剪貼簿。\n請在這一頁直接按 Ctrl+V 貼上截圖，或用「📷 讀取照片」選擇圖片檔。');
    }
  });
})();
