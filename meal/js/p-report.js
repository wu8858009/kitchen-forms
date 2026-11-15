/* 頁面：歷期報表（年度消費趨勢 ＋ 週期匯總 ＋ 選取週期的明細） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).report = P;
  let els = {}, selKey = null, selDet = null, hits = [], year = String(D.y(D.today()));
  const keys = {};

  P.build = (el) => {
    const hint = h('span.tb-hint', '← 點選任一週期列，查看明細');
    el.appendChild(h('div.toolbar', h('div.tb-l', ui.btn('⬇  匯出全部 CSV', 'green', () => P.exportAll()), ui.btn('⬇  匯出本期 CSV', 'muted', () => exportDetail())), hint));
    const ysel = h('select', { onchange: () => { year = ysel.value; drawAnnual(); } });
    const cv = h('canvas.annual-cv');
    const tip = h('div.popover', { style: { display: 'none', pointerEvents: 'none', minWidth: '0', padding: '6px 10px', fontSize: '12px' } });
    document.body.appendChild(tip);
    cv.addEventListener('mousemove', (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      const a = hits.find((t) => t.x0 <= x && x <= t.x1);
      if (!a) { tip.style.display = 'none'; return; }
      ui.clear(tip);
      const p = a.p;
      [M.periodLabel(p.s, p.e), `消費：NT$ ${M.money(a.total)}`, `預算：NT$ ${M.money(a.budget)}`, `使用率：${M.pct(a.pct)}%`, `剩餘：NT$ ${M.money(a.budget - a.total)}`]
        .forEach((l, j) => tip.appendChild(h('div', { style: { color: j ? 'var(--subtext)' : 'var(--text)', borderTop: j ? '' : '2px solid var(--accent)', paddingTop: j ? '' : '3px' } }, l)));
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      tip.style.left = (e.clientX + 14 + tw > window.innerWidth ? e.clientX - tw - 14 : e.clientX + 14) + 'px';
      tip.style.top = Math.max(4, e.clientY - 50) + 'px';
    });
    cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    el.appendChild(h('div.annual', h('div.annual-h', h('b', '年度消費趨勢'), ysel, h('span.sub', '年'),
      h('div.legend', h('span', h('i'), '實際消費'), h('span', h('i.b'), '預算'))), cv));
    const top = M.selTable(['結算週期', '總金額', '筆數', '平均/筆', '預算', '剩餘', '使用率'].map((t) => ({ t })), { onSel: (k) => { selKey = k; showDetail(); } });
    const detTitle = h('b', '  請在上方選取一個結算週期');
    const kUsed = h('span', { style: { fontWeight: 700 } }), kRem = h('span', { style: { fontWeight: 700 } }), kPct = h('span', { style: { fontFamily: 'var(--mono)' } });
    const det = M.selTable(['日期', '金額', '備註'].map((t) => ({ t })), {
      onSel: (k) => { selDet = Number(k); }, onOpen: () => editDet(), onDel: () => delDet(),
    });
    const detStatus = h('span');
    el.appendChild(h('div.rpt-split',
      h('div', top.wrap),
      h('div', h('div.rpt-det-h', detTitle, kUsed, kRem, kPct),
        h('div.rpt-det-bar', h('div.tb-l', ui.btn('✏  編輯記錄', 'muted', () => editDet()), ui.btn('✕  刪除記錄', 'red', () => delDet())), h('span.tb-hint', '選取下方明細列後操作')),
        det.wrap, h('div.pagefoot', detStatus))));
    els = { hint, ysel, cv, top, detTitle, kUsed, kRem, kPct, det, detStatus };
    new ResizeObserver(() => { if (M.active === 'report') drawAnnual(); }).observe(cv);
  };

  const periodsAll = () => {
    const pd = {};
    for (const r of M.data.records) {
      const d = D.parse(r.date);
      if (!d) continue;
      const [s, e] = M.getPeriod(d), k = M.periodKey(s, e);
      if (!pd[k]) pd[k] = { total: 0, count: 0, s, e };
      pd[k].total += Number(r.amount) || 0; pd[k].count++;
    }
    return pd;
  };
  P.refresh = () => {
    if (!els.top) return;
    const pd = periodsAll();
    const [s, e] = M.getPeriod(D.today());
    const cur = M.periodKey(s, e);
    if (!pd[cur]) pd[cur] = { total: 0, count: 0, s, e };
    const warnPct = M.settings().warn_pct ?? 80;
    ui.clear(els.top.tbody);
    for (const k of Object.keys(keys)) delete keys[k];
    for (const key of Object.keys(pd).sort().reverse()) {
      const row = pd[key];
      const budget = M.getPeriodBudget(row.s), rem = budget - row.total, pct = row.total / budget * 100;
      const isCur = key === cur;
      const tag = isCur ? '.cur' : pct > 100 ? '.over' : pct >= warnPct ? '.warn' : '.normal';
      keys[key] = key.split('~');
      els.top.tbody.appendChild(h('tr' + tag, { 'data-k': key },
        h('td', M.periodLabel(row.s, row.e) + (isCur ? '  ◀ 本期' : '')), h('td', `NT$ ${M.money(row.total)}`), h('td', `${row.count} 筆`),
        h('td', `NT$ ${M.money(row.count ? row.total / row.count : 0)}`), h('td', `NT$ ${M.money(budget)}`), h('td', `NT$ ${M.money(rem)}`), h('td', `${M.pct(pct)}%`)));
    }
    // 年度選單
    const years = [...new Set(M.data.records.map((r) => (r.date || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse();
    const cy = String(D.y(D.today()));
    if (!years.includes(cy)) years.unshift(cy);
    if (!years.includes(year)) year = cy;
    ui.clear(els.ysel);
    for (const y of years) els.ysel.appendChild(h('option', { value: y, selected: y === year }, y));
    if (selKey && keys[selKey]) { els.top.select(selKey); showDetail(); } else selKey = null;
    requestAnimationFrame(drawAnnual);
  };
  const showDetail = () => {
    if (!selKey || !keys[selKey]) return;
    const [si, ei] = keys[selKey];
    const recs = M.data.records.filter((r) => si <= r.date && r.date < ei).sort((a, b) => (a.date < b.date ? 1 : -1));
    const total = recs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const s = D.parse(si), e = D.parse(ei);
    const budget = M.getPeriodBudget(s), remain = budget - total, pct = total / budget * 100;
    els.detTitle.textContent = `  ${M.periodLabel(s, e)}  /  明細記錄`;
    els.hint.textContent = `已選取：${M.periodLabel(s, e)}`;
    els.kUsed.textContent = `已用  NT$ ${M.money(total)}`; els.kUsed.style.color = remain < 0 ? 'var(--danger)' : 'var(--accent)';
    els.kRem.textContent = `剩餘  NT$ ${M.money(remain)}`; els.kRem.style.color = remain < 0 ? 'var(--danger)' : 'var(--accent2)';
    const cfg = M.settings();
    els.kPct.textContent = `${M.pct(pct)}%`;
    els.kPct.style.color = pct >= (cfg.danger_pct ?? 90) ? 'var(--danger)' : pct >= (cfg.warn_pct ?? 80) ? 'var(--warning)' : 'var(--subtext)';
    ui.clear(els.det.tbody);
    for (const r of recs) els.det.tbody.appendChild(h('tr', { 'data-k': r.id }, h('td', r.date), h('td', `NT$ ${M.money(r.amount)}`), h('td.l', r.note || '')));
    if (selDet != null && !els.det.select(selDet)) selDet = null;
    const n = recs.length;
    els.detStatus.textContent = `  共 ${n} 筆  ·  合計 NT$ ${M.money(total)}  ·  平均 NT$ ${M.money(n ? total / n : 0)}  ·  預算使用率 ${M.pct(pct)}%`;
    ui.status(`已載入 ${M.periodLabel(s, e)}：${n} 筆`);
  };
  const editDet = async () => {
    if (selDet == null) { ui.info('提示', '請先選取一筆明細記錄'); return; }
    const rec = M.data.records.find((r) => r.id === selDet);
    if (rec) await M.editRecord(rec, null);
  };
  const delDet = async () => {
    if (selDet == null) { ui.info('提示', '請先選取一筆明細記錄'); return; }
    const rec = M.data.records.find((r) => r.id === selDet);
    if (!rec) return;
    if (!(await ui.ask('確認刪除', `刪除此筆記錄？\n${rec.date}  NT$ ${M.money(rec.amount)}  ${rec.note || ''}`))) return;
    M.data.records = M.data.records.filter((r) => r.id !== selDet);
    selDet = null;
    M.save(); M.refreshAll();
    ui.status(`已刪除：${rec.date}  NT$ ${M.money(rec.amount)}`);
  };
  const exportDetail = () => {
    if (!selKey || !keys[selKey]) { ui.info('提示', '請先在上方選取一個結算週期'); return; }
    const [si, ei] = keys[selKey];
    const s = D.parse(si), e = D.parse(ei);
    const recs = M.data.records.filter((r) => si <= r.date && r.date < ei).sort((a, b) => (a.date < b.date ? -1 : 1));
    const rows = [['日期', '金額', '備註', '結算週期'], ...recs.map((r) => [r.date, r.amount, r.note || '', M.periodLabel(s, e)])];
    ui.download(`餐費_${si.replace(/-/g, '')}_${ei.replace(/-/g, '')}.csv`, ui.csv(rows));
    ui.status(`CSV 匯出：${recs.length} 筆`);
  };
  P.exportAll = () => {
    const pd = periodsAll();
    const rows = [['結算週期', '總金額', '筆數', '平均/筆', '預算', '剩餘', '使用率(%)']];
    for (const k of Object.keys(pd).sort()) {
      const p = pd[k], t = p.total, n = p.count, b = M.getPeriodBudget(p.s);
      rows.push([M.periodLabel(p.s, p.e), t, n, n ? Math.round(t / n * 10) / 10 : 0, b, b - t, Math.round(t / b * 1000) / 10]);
    }
    ui.download('歷期報表.csv', ui.csv(rows));
    ui.status(`已匯出 ${Object.keys(pd).length} 個週期`);
  };

  const drawAnnual = () => {
    const cv = els.cv;
    if (!cv || cv.getBoundingClientRect().width < 20) return;
    const { ctx, w, h: H } = ui.canvas(cv);
    hits = [];
    const col = (n) => ui.css('--' + n);
    const yr = Number(year);
    const pd = {};
    for (const r of M.data.records) {
      const d = D.parse(r.date);
      if (!d) continue;
      const [s, e] = M.getPeriod(d);
      if (D.y(s) !== yr) continue;
      const k = D.iso(s);
      if (!pd[k]) pd[k] = { s, e, total: 0 };
      pd[k].total += Number(r.amount) || 0;
    }
    if (!Object.keys(pd).length) {
      ctx.fillStyle = col('subtext'); ctx.font = `13px ${ui.css('--font')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${yr} 年目前無資料`, w / 2, H / 2); return;
    }
    const ps = Object.values(pd).sort((a, b) => a.s - b.s);
    const totals = ps.map((p) => p.total), budgets = ps.map((p) => M.getPeriodBudget(p.s));
    const cfg = M.settings(), warnT = cfg.warn_pct ?? 80, danT = cfg.danger_pct ?? 90;
    const padL = 54, padR = 20, padT = 18, padB = 38, cw = w - padL - padR, ch = H - padT - padB;
    const maxV = Math.max(Math.max(...totals, 0), Math.max(...budgets, 0)) * 1.2 || 1;
    const mono = (px) => `${px}px ${ui.css('--mono')}`;
    for (let i = 0; i < 5; i++) {
      const gy = padT + ch * i / 4, gv = maxV * (1 - i / 4);
      ctx.strokeStyle = col('border'); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col('muted'); ctx.font = mono(10); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${(gv / 1000).toFixed(1)}k`, padL - 4, gy);
    }
    const n = ps.length;
    const xs = n > 1 ? ps.map((_, i) => padL + cw * i / (n - 1)) : [padL + cw / 2];
    const ys = totals.map((t) => padT + ch * (1 - t / maxV)), by = budgets.map((b) => padT + ch * (1 - b / maxV));
    ctx.strokeStyle = col('warning'); ctx.lineWidth = 1; ctx.setLineDash([5, 3]);
    ctx.beginPath();
    if (n > 1) ui.smoothPath(ctx, xs.map((x, i) => [x, by[i]])); else { ctx.moveTo(padL, by[0]); ctx.lineTo(w - padR, by[0]); }
    ctx.stroke(); ctx.setLineDash([]);
    if (n > 1) { ctx.strokeStyle = col('accent'); ctx.lineWidth = 2; ctx.beginPath(); ui.smoothPath(ctx, xs.map((x, i) => [x, ys[i]])); ctx.stroke(); }
    const curS = M.getPeriod(D.today())[0].getTime();
    ps.forEach((p, i) => {
      const pct = budgets[i] ? totals[i] / budgets[i] * 100 : 0;
      const dc = pct >= 100 || pct >= danT ? col('danger') : pct >= warnT ? col('warning') : col('accent2');
      const isCur = p.s.getTime() === curS;
      ctx.beginPath(); ctx.arc(xs[i], ys[i], isCur ? 5 : 4, 0, Math.PI * 2); ctx.fillStyle = dc; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = isCur ? '#fff' : dc; ctx.stroke();
      ctx.fillStyle = col('subtext'); ctx.font = `11px ${ui.css('--font')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${D.m(p.s)}月`, xs[i], H - padB + 6);
      hits.push({ x0: xs[i] - 18, x1: xs[i] + 18, p, total: totals[i], budget: budgets[i], pct });
    });
    const yt = totals.reduce((a, b) => a + b, 0), yb = budgets.reduce((a, b) => a + b, 0);
    ctx.fillStyle = col('subtext'); ctx.font = mono(10); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(`年度：NT$ ${M.money(yt)} / NT$ ${M.money(yb)}  (${M.pct(yb ? yt / yb * 100 : 0)}%)`, w - padR, padT - 2);
  };
})();
