/* 頁面：叫貨計算（單日 / 每週 7 天；依貨單人數 → 班表人數 → 均量 → 類推 → 預設 推算需求） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).order = P;
  const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  M.WEEKDAYS = WEEKDAYS;
  const DEFAULT_PER = { 斤: 0.15, 公斤: 0.1 };
  const TAGS = { sched: '班表人數', avg: '均量估算', analog: '類推估算', default: '預設估算' };
  let els = {}, rows = [], saveT = null;
  const plan = () => M.data.order_plan;
  const mode = () => plan().mode || 'day';
  const parse = (t) => { const v = Number(String(t ?? '').trim() || 0); return isFinite(v) ? Math.max(0, v) : 0; };

  const columns = () => (mode() === 'week'
    ? [['食材', 3, 'name'], ['最新單價', 2, 'price'], ...WEEKDAYS.map((d, i) => [d, 1, 'd' + i]), ['週需求', 2, 'need'], ['建議叫貨', 2, 'ord'], ['預估金額', 2, 'est']]
    : [['食材', 3, 'name'], ['最新單價', 2, 'price'], ['需求數量', 2, 'need'], ['歷史最低叫貨', 2, 'minq'], ['建議叫貨', 2, 'ord'], ['預估金額', 2, 'est']]);
  const gridCols = () => columns().map((c) => `minmax(0, ${c[1]}fr)`).join(' ') + ' 44px';

  P.build = (el) => {
    const bDay = ui.btn('單日', 'muted', () => setMode('day'));
    const bWeek = ui.btn('每週 7 天', 'muted', () => setMode('week'));
    const people = ui.input(plan().people ? M.num(plan().people) : '', { inputmode: 'decimal' });
    people.addEventListener('input', changed);
    const dayBox = h('div.tb-m.ord-day', h('b.tb-lbl', '👥  用餐人數'), people, h('span.tb-lbl', '人'));
    const week = plan().week || [0, 0, 0, 0, 0, 0, 0];
    const weekIns = WEEKDAYS.map((d, i) => {
      const inp = ui.input(week[i] ? M.num(week[i]) : '', { inputmode: 'decimal' });
      inp.addEventListener('input', changed);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const nx = weekIns[(i + 1) % 7]; nx.focus(); nx.select(); } });
      return inp;
    });
    const weekBox = h('div.tb-m.ord-week', WEEKDAYS.map((d, i) => [h('b.tb-lbl', d), weekIns[i]]), h('span.tb-lbl', '人'));
    const hint = h('span.tb-hint');
    const restore = ui.btn('', 'muted', () => { plan().hidden = []; M.save(); P.refresh(); });
    const menuBtn = ui.btn('', 'muted', () => { plan().use_menu = !plan().use_menu; M.save(); updMenuBtn(); recalc(); });
    const schedBtn = ui.btn('🗓 帶入本週班表', 'muted', () => fromSchedule());
    el.appendChild(h('div.toolbar',
      h('div.tb-l', bDay, bWeek), h('div.tb-m', dayBox, weekBox, hint),
      h('div.tb-r', restore, menuBtn, schedBtn, ui.btn('📋  複製叫貨單', 'muted', () => P.copy()), ui.btn('⬇  匯出 CSV', 'green', () => P.exportCsv()))));
    const head = h('div.grow.ghead');
    const body = h('div.gbody');
    el.appendChild(h('div.scroll', { style: { padding: '10px 16px 0' } }, h('div.gtable', head, body)));
    const total = h('span.big');
    el.appendChild(h('div.pagefoot', total, h('span', '建議叫貨：斤 / 公斤進位到 0.5，其餘進位到整數；標「估算」者為推估值，請自行斟酌')));
    els = { bDay, bWeek, people, dayBox, weekIns, weekBox, hint, restore, menuBtn, schedBtn, head, body, total };
    applyMode();
  };
  const setMode = (m) => {
    if (m === mode()) return;
    plan().mode = m;
    if (m === 'week' && !weekValues().some(Boolean) && parse(els.people.value) > 0) els.weekIns.forEach((x) => { x.value = els.people.value; });
    M.save();
    applyMode(); P.refresh();
  };
  const applyMode = () => {
    const wk = mode() === 'week';
    els.bDay.className = 'btn ' + (wk ? 'muted' : 'blue');
    els.bWeek.className = 'btn ' + (wk ? 'blue' : 'muted');
    els.dayBox.hidden = wk; els.weekBox.hidden = !wk;
    els.hint.textContent = wk ? '填週一～週日的人數，逐日算需求，週合計後計算建議叫貨量' : '輸入人數，自動偵測所有食材與單價並計算建議叫貨量';
    els.menuBtn.hidden = !wk; els.schedBtn.hidden = !wk;
    updMenuBtn();
    els.head.style.gridTemplateColumns = gridCols();
    ui.clear(els.head);
    columns().forEach((c) => els.head.appendChild(h('div', c[0])));
    els.head.appendChild(h('div'));
  };
  const updMenuBtn = () => {
    const on = !!plan().use_menu;
    els.menuBtn.textContent = `🍱 依菜單：${on ? '開' : '關'}`;
    els.menuBtn.className = 'btn ' + (on ? 'blue' : 'muted');
  };
  const weekValues = () => els.weekIns.map((x) => parse(x.value));
  const dayCounts = () => (mode() === 'week' ? weekValues() : [parse(els.people.value)]);
  const menuWeekIso = () => plan().menu_week || D.iso(D.monday(D.today()));

  function changed() {
    plan().people = parse(els.people.value);
    plan().week = weekValues();
    recalc();
    clearTimeout(saveT); saveT = setTimeout(() => M.save(), 500);
  }
  const fromSchedule = () => {
    const counts = M.schWeekCounts(D.monday(D.today()));
    if (!counts) { ui.info('提示', '本週還沒有班表。\n請先到「排班人數」頁建立本週班表。'); return; }
    M.ordApplyWeekCounts(counts);
    ui.status(`已帶入本週班表：共 ${counts.reduce((a, b) => a + b, 0)} 人次`);
  };
  /** 班表 / 菜單帶入每週人數（切到每週模式） */
  M.ordApplyWeekCounts = (counts) => {
    if (!els.weekIns) { M.showPage('order'); }
    els.weekIns.forEach((x, i) => { x.value = counts[i] ? M.num(counts[i]) : ''; });
    if (mode() !== 'week') setMode('week');
    changed();
    P.refresh();
  };

  /** 依貨單歷史為每種食材建立推算模型：品名 → {unit, price, kind, per, avg, ref, minq} */
  const model = () => {
    const last = M.ingLast();
    const weekCache = new Map();
    const schedPeople = (iso) => {
      const d = D.parse(iso);
      if (!d) return null;
      const mon = D.iso(D.monday(d));
      if (!weekCache.has(mon)) weekCache.set(mon, M.schWeekCounts(D.parse(mon)));
      const c = weekCache.get(mon);
      return c ? (c[D.wd(d)] || null) : null;
    };
    const recs = M.data.ingredients.filter((r) => !r.price_only)
      .map((r) => (r.people ? r : Object.assign({}, r, { people: schedPeople(r.date), _sched: true })));
    const withP = recs.filter((r) => r.people);
    const ref = withP.length ? withP.reduce((a, b) => (M.sortByDateId(a, b) >= 0 ? a : b)).people : null;
    const mdl = {};
    for (const [name, [unit, price]] of Object.entries(last)) {
      const mine = recs.filter((r) => r.name === name);
      const wp = mine.filter((r) => r.people).sort((a, b) => -M.sortByDateId(a, b)).slice(0, 5);
      const m = { unit, price, kind: 'none', per: null, avg: null, ref, minq: null };
      const slipQty = new Map();
      for (const r of mine) { const sid = r.slip_id ?? r.id; slipQty.set(sid, (slipQty.get(sid) || 0) + Number(r.qty)); }
      if (slipQty.size) m.minq = Math.min(...slipQty.values());
      if (wp.length) {
        m.kind = wp.some((r) => r._sched) ? 'sched' : 'exact';
        m.per = wp.reduce((a, r) => a + Number(r.qty), 0) / wp.reduce((a, r) => a + Number(r.people), 0);
      } else if (mine.length) {
        const perSlip = new Map();
        for (const r of mine) { const sid = r.slip_id ?? r.id; const v = perSlip.get(sid) || [r.date, 0]; perSlip.set(sid, [r.date, v[1] + Number(r.qty)]); }
        const latest = [...perSlip.values()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : b[1] - a[1])).slice(0, 5);
        m.kind = 'avg'; m.avg = latest.reduce((a, x) => a + x[1], 0) / latest.length;
      }
      mdl[name] = m;
    }
    const byUnit = {};
    for (const m of Object.values(mdl)) {
      const per = m.per != null ? m.per : (m.avg != null && ref ? m.avg / ref : null);
      if (per != null) (byUnit[m.unit] = byUnit[m.unit] || []).push(per);
    }
    for (const m of Object.values(mdl)) {
      if (m.kind !== 'none') continue;
      if (byUnit[m.unit] && byUnit[m.unit].length) { const v = [...byUnit[m.unit]].sort((a, b) => a - b); m.kind = 'analog'; m.per = v[Math.floor(v.length / 2)]; }
      else { m.kind = 'default'; m.per = DEFAULT_PER[m.unit] ?? 0.1; }
    }
    for (const [name, , unit] of M.BAIBAI_ITEMS) if (!mdl[name]) mdl[name] = { unit, price: null, kind: 'none', per: null, avg: null, ref, minq: null };
    return mdl;
  };
  const needFor = (m, people, base) => {
    if (people <= 0) return 0;
    if (m.per != null) return m.per * people;
    if (m.avg != null) { const ref = m.ref || base; return ref ? m.avg * people / ref : m.avg; }
    return null;
  };
  const calc = () => {
    const counts = dayCounts();
    const pos = counts.filter((n) => n > 0);
    const base = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : null;
    let allowed = null;
    if (mode() === 'week' && plan().use_menu) allowed = M.menuAllowed(rows.map((r) => r.name), menuWeekIso());
    const fixed = Object.fromEntries(M.BAIBAI_ITEMS.map(([n, q]) => [n, q]));
    let bb = [false, false, false, false, false, false, false];
    if (mode() === 'week') { const mon = D.parse(menuWeekIso()); bb = bb.map((_, i) => M.isBaibai(D.add(mon, i))); }
    return rows.map((r) => {
      const m = r.m;
      let on = allowed ? (allowed[r.name] || [false, false, false, false, false, false, false]) : [true, true, true, true, true, true, true];
      let days;
      if (mode() === 'week' && r.name in fixed) {
        on = allowed ? on : [false, false, false, false, false, false, false];
        days = counts.map((n, i) => (bb[i] ? Number(fixed[r.name]) : on[i] ? needFor(m, n, base) : 0));
      } else days = counts.map((n, i) => (on[i] ? needFor(m, n, base) : 0));
      const known = days.filter((d) => d != null);
      const need = known.length ? known.reduce((a, b) => a + b, 0) : null;
      const step = (m.unit === '斤' || m.unit === '公斤') ? 0.5 : 1;
      const qty = need ? Math.ceil(need / step - 1e-9) * step : 0;
      const est = m.price != null && qty > 0 ? qty * m.price : null;
      return { name: r.name, unit: m.unit, need, days, qty, price: m.price, est, kind: m.kind, minq: m.minq };
    });
  };
  P.calc = calc;
  const recalc = () => {
    const c = calc();
    let total = 0;
    rows.forEach((r, i) => {
      const x = c[i], L = r.lbl;
      const has = x.need != null && x.need > 0;
      L.need.textContent = has ? `${M.num(x.need)} ${x.unit}` : '—';
      L.ord.textContent = x.qty > 0 ? `${M.num(x.qty)} ${x.unit}` : '—';
      L.est.textContent = x.est != null ? `NT$ ${M.money(x.est)}` : '—';
      x.days.forEach((d, k) => { if (L['d' + k]) L['d' + k].textContent = d ? M.num(d) : '—'; });
      total += x.est || 0;
    });
    let extra = '';
    if (mode() === 'week') {
      extra = `   ·   週合計 ${M.num(weekValues().reduce((a, b) => a + b, 0))} 人次`;
      if (plan().use_menu) extra += `   ·   依菜單（${D.md(D.parse(menuWeekIso()))} 起）`;
    }
    els.total.textContent = `預估叫貨金額  NT$ ${M.money(total)}   ·   共 ${c.length} 項食材${extra}`;
  };

  P.refresh = () => {
    if (!els.body) return;
    applyMode();
    const hidden = new Set(plan().hidden || []);
    const mdl = model();
    ui.clear(els.body);
    rows = [];
    const names = Object.keys(mdl).sort().filter((n) => !hidden.has(n));
    const st = { price: 'var(--subtext)', minq: 'var(--subtext)', ord: 'var(--accent2)', est: 'var(--warning)', need: 'var(--text)' };
    names.forEach((name) => {
      const m = mdl[name];
      const row = h('div.grow', { style: { gridTemplateColumns: gridCols() } });
      const L = {};
      for (const [, , key] of columns()) {
        if (key === 'name') {
          let tag = TAGS[m.kind];
          if (M.BAIBAI_ITEMS.some(([n]) => n === name)) tag = '🏮 初一／十六固定';
          row.appendChild(h('div.gcell.name', h('span', name), tag ? h('span.tag', tag) : null));
          continue;
        }
        const c = h('div.gcell', { style: { color: st[key] || 'var(--subtext)', fontWeight: key === 'ord' ? '700' : '400', padding: key.startsWith('d') ? '10px 3px' : null } });
        L[key] = c; row.appendChild(c);
      }
      L.price.textContent = m.price != null ? `NT$ ${M.num(m.price, true)}/${m.unit}` : '—';
      if (L.minq) L.minq.textContent = m.minq != null ? `${M.num(m.minq)} ${m.unit}` : '—';
      const x = ui.btn('✕', 'muted', () => { const hd = plan().hidden || (plan().hidden = []); if (!hd.includes(name)) hd.push(name); M.save(); P.refresh(); });
      x.classList.add('x'); x.title = '不需要叫貨：從清單隱藏（可用「還原隱藏」找回）';
      row.appendChild(h('div', { style: { display: 'flex', justifyContent: 'center' } }, x));
      els.body.appendChild(row);
      rows.push({ name, m, lbl: L });
    });
    if (!names.length) els.body.appendChild(h('div.gempty', '尚無食材資料\n\n請先在「新增貨單」輸入貨單，或按貨單視窗右上角的「新增單價」，\n食材就會自動出現在這裡。'));
    const nh = [...hidden].filter((n) => n in mdl).length;
    els.restore.hidden = !nh;
    els.restore.textContent = `還原隱藏 (${nh})`;
    recalc();
  };

  P.copy = async () => {
    const c = calc().filter((x) => x.qty > 0);
    if (!c.length) { ui.info('提示', '目前沒有需要叫貨的品項。\n請先輸入用餐人數。'); return; }
    const title = mode() === 'week' ? `一週叫貨單（合計 ${M.num(weekValues().reduce((a, b) => a + b, 0))} 人次）` : `叫貨單（用餐 ${M.num(parse(els.people.value))} 人）`;
    const ok = await ui.copy([title, ...c.map((x) => `${x.name}  ${M.num(x.qty)}${x.unit}`)].join('\n'));
    ui.status(ok ? `已複製叫貨單：${c.length} 項` : '複製失敗：瀏覽器不允許存取剪貼簿');
    if (ok) ui.toast('已複製叫貨單');
  };
  P.exportCsv = () => {
    const c = calc(), wk = mode() === 'week';
    const out = [];
    if (wk) { out.push(['每日人數', ...WEEKDAYS]); out.push(['', ...weekValues().map((n) => M.num(n))]); }
    else out.push(['用餐人數', M.num(parse(els.people.value))]);
    out.push(['食材', '單位', ...(wk ? WEEKDAYS : []), wk ? '週需求' : '需求數量', '歷史最低叫貨', '建議叫貨', '最新單價', '預估金額', '推算依據']);
    for (const x of c) {
      const r = [x.name, x.unit];
      if (wk) r.push(...x.days.map((d) => (d ? Math.round(d * 1000) / 1000 : '')));
      r.push(x.need == null ? '' : Math.round(x.need * 1000) / 1000, x.minq == null ? '' : x.minq, x.qty, x.price == null ? '' : x.price,
        x.est == null ? '' : Math.round(x.est), TAGS[x.kind] || '依貨單人數');
      out.push(r);
    }
    ui.download('叫貨計算.csv', ui.csv(out));
    ui.status(`叫貨計算 CSV 匯出完成：${c.length} 項`);
  };
  P.onShow = () => updMenuBtn();
})();
