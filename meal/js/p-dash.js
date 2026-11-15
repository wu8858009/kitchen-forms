/* 頁面：儀表板 */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).dashboard = P;

  let sel = '本期', chartType = 'bar', hits = [], els = {};
  M.periodsMap = {};

  /** 所有出現過的週期（依日期即時計算），供儀表板 / 費用記錄的週期選單 */
  M.refreshPeriods = () => {
    const seen = new Map();
    for (const r of M.data.records) {
      const d = D.parse(r.date);
      if (!d) continue;
      const [s, e] = M.getPeriod(d);
      const k = M.periodKey(s, e);
      if (!seen.has(k)) seen.set(k, [M.periodLabel(s, e), D.iso(s), D.iso(e)]);
    }
    const [s, e] = M.getPeriod(D.today());
    const cur = M.periodKey(s, e);
    if (!seen.has(cur)) seen.set(cur, [M.periodLabel(s, e) + ' (本期)', D.iso(s), D.iso(e)]);
    const periods = [...seen.values()].sort((a, b) => (a[1] < b[1] ? 1 : -1));
    M.periodsMap = {};
    for (const p of periods) M.periodsMap[p[0]] = [p[1], p[2]];
    return ['本期', ...periods.map((p) => p[0])];
  };

  const kpi = (title, color, icon) => {
    const v = h('div.v', '');
    const card = h('div.kpi', { style: { '--c': color } }, h('div.t', h('span', title), h('i', icon)), v);
    return [card, v];
  };

  P.build = (el) => {
    const periodSel = h('select', { style: { width: '250px' }, onchange: () => { sel = periodSel.value; P.refresh(); } });
    const gotoCur = ui.btn('↩ 本期', 'blue', () => P.gotoCurrent());
    const perLbl = h('span.per');
    el.appendChild(h('div.dash-hdr',
      h('h2', '企業儀表板'), perLbl, gotoCur,
      h('span.tb-lbl', '查看週期'), periodSel,
      ui.btn('⟳ 刷新', 'muted', () => { M.refreshAll(); if (M.cloud.enabled) M.cloud.request(false); })));
    const scroll = h('div.scroll');
    el.appendChild(scroll);
    const body = h('div.dash-body');
    scroll.appendChild(body);
    const C = (n) => `var(--${n})`;
    const [k1, used] = kpi('本期已用', C('accent'), '💰');
    const [k2, remain] = kpi('本期剩餘', C('accent2'), '✅');
    const [k3, count] = kpi('本期筆數', C('purple'), '📋');
    const [k4, avg] = kpi('本期平均/筆', C('warning'), '📊');
    const [k5, days] = kpi('剩餘天數', C('accent'), '📅');
    const [k6, max] = kpi('最高單筆', C('danger'), '🔺');
    body.appendChild(h('div.kpis', k1, k2, k3, k4, k5, k6));
    const alert = h('div.alert', { hidden: true });
    body.appendChild(alert);
    // 預算進度卡
    const pct = h('div.big-pct', '0%'), det = h('div.sub', { style: { margin: '4px 0 10px' } });
    const pbar = h('div.pbar', h('i')), tbar = h('div.pbar', { style: { '--c': C('accent') } }, h('i'));
    const tcmp = h('div.sub');
    body.appendChild(h('div.card', h('div.card-h', { style: { '--c': C('accent') } }, h('h3', '預算使用進度')),
      h('div.card-b', pct, det, h('div.sub', '預算使用進度'), pbar, h('div.sub', '期間時間進度'), tbar, tcmp)));
    // 趨勢圖 + 快速操作
    const typeBtn = ui.btn('📈 曲線圖', 'muted', () => { chartType = chartType === 'bar' ? 'line' : 'bar'; typeBtn.textContent = chartType === 'bar' ? '📈 曲線圖' : '📊 長條圖'; P.refresh(); });
    typeBtn.classList.add('sm');
    const cv = h('canvas.chart-cv');
    cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); cv.style.cursor = hitAt(e.clientX - r.left, e.clientY - r.top) ? 'pointer' : 'default'; });
    cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); const a = hitAt(e.clientX - r.left, e.clientY - r.top); if (a) dayPopup(a, e.clientX, e.clientY); });
    const todayT = h('div.sub', '今日消費'), todayV = h('div.num', 'NT$ 0'), weekT = h('div.sub', '本週消費'), weekV = h('div.num', 'NT$ 0');
    body.appendChild(h('div.dash-row',
      h('div.card', h('div.card-h', { style: { '--c': C('warning') } }, h('h3', '每日消費趨勢'), typeBtn), h('div', { style: { padding: '12px' } }, cv)),
      h('div.card', h('div.card-h', { style: { '--c': C('accent2') } }, h('h3', '快速操作')),
        h('div.card-b.qa', ui.btn('＋ 新增消費記錄', 'blue', () => M.addRecord()), ui.btn('📈 前往歷期報表', 'muted', () => M.showPage('report')),
          h('div', { style: { height: '1px', background: 'var(--border)', margin: '8px 0' } }), todayT, todayV, weekT, weekV))));
    els = { periodSel, gotoCur, perLbl, used, remain, count, avg, days, max, alert, pct, det, pbar, tbar, tcmp, cv, todayT, todayV, weekT, weekV };
    new ResizeObserver(() => { if (M.active === 'dashboard' && els.lastRecs) drawChart(els.lastRecs, els.lastS, els.lastE); }).observe(cv);
  };

  P.gotoCurrent = () => { sel = '本期'; P.refresh(); };

  P.refresh = () => {
    if (!els.cv) return;
    const labels = M.refreshPeriods();
    if (!labels.includes(sel)) sel = '本期';
    ui.clear(els.periodSel);
    for (const l of labels) els.periodSel.appendChild(h('option', { value: l, selected: l === sel }, l));
    const today = D.today();
    const [curS, curE] = M.getPeriod(today);
    let s, e, recs, isCur;
    if (sel === '本期' || !M.periodsMap[sel]) { [s, e] = [curS, curE]; recs = M.currentPeriodRecords(); isCur = true; }
    else {
      const [si, ei] = M.periodsMap[sel];
      s = D.parse(si); e = D.parse(ei);
      recs = M.data.records.filter((r) => si <= r.date && r.date < ei);
      isCur = s.getTime() === curS.getTime();
    }
    els.gotoCur.hidden = isCur;
    els.perLbl.textContent = '  ' + M.periodLabel(s, e);
    const cfg = M.settings();
    const warnPct = cfg.warn_pct ?? 80, danPct = cfg.danger_pct ?? 90;
    const budget = M.getPeriodBudget(s);
    let total = recs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const [reserved, , paid] = isCur ? M.baibaiReserve(s, e) : [0, [], 0];
    const count = recs.length;
    const avg = count ? total / count : 0;
    total -= paid;
    const committed = total + reserved;
    const remain = budget - committed;
    const maxA = recs.reduce((a, r) => Math.max(a, Number(r.amount) || 0), 0);
    const realPct = total / budget * 100;
    const pct = Math.min(committed / budget * 100, 100);
    const color = remain < 0 ? 'var(--danger)' : pct >= warnPct ? 'var(--warning)' : 'var(--accent2)';
    const totalDays = D.diff(e, s) || 1;
    let daysLeft, elapsed, timePct;
    if (isCur) {
      daysLeft = D.diff(e, today); elapsed = D.diff(today, s) + 1; timePct = Math.min(elapsed / totalDays * 100, 100);
      const ti = D.iso(today);
      const todaySum = recs.filter((r) => r.date === ti).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const lo = D.iso(D.monday(today)), hi = D.iso(D.add(D.monday(today), 6));
      const weekSum = M.data.records.filter((r) => lo <= r.date && r.date <= hi).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      els.todayT.textContent = '今日消費'; els.weekT.textContent = '本週消費';
      els.todayV.textContent = `NT$ ${M.money(todaySum)}`; els.weekV.textContent = `NT$ ${M.money(weekSum)}`;
    } else {
      daysLeft = 0; elapsed = totalDays; timePct = 100;
      const daily = {};
      for (const r of recs) daily[r.date] = (daily[r.date] || 0) + (Number(r.amount) || 0);
      const vals = Object.values(daily);
      els.todayT.textContent = '最高單日'; els.weekT.textContent = '日均消費';
      els.todayV.textContent = `NT$ ${M.money(vals.length ? Math.max(...vals) : 0)}`;
      els.weekV.textContent = `NT$ ${M.money(vals.length ? total / vals.length : 0)}`;
    }
    els.used.textContent = `NT$ ${M.money(total)}`;
    els.remain.textContent = `NT$ ${M.money(remain)}`; els.remain.style.color = color;
    els.count.textContent = `${count} 筆`;
    els.avg.textContent = `NT$ ${M.money(avg)}`;
    if (isCur) { els.days.textContent = `${daysLeft} 天`; els.days.style.color = daysLeft <= 3 ? 'var(--danger)' : 'var(--accent)'; }
    else { els.days.textContent = '已結算'; els.days.style.color = 'var(--subtext)'; }
    els.max.textContent = `NT$ ${M.money(maxA)}`;
    // 警示橫幅
    const rsvTxt = reserved ? `（含拜拜預扣 NT$${M.money(reserved)}）` : '';
    if (committed > budget) {
      els.alert.hidden = false; els.alert.style.background = 'var(--danger)';
      els.alert.textContent = `⚠  超出預算！已用 NT$${M.money(total)}${rsvTxt}，超出 NT$${M.money(-remain)}，${isCur ? '請立即控制支出' : '該期已超出預算'}`;
    } else if (pct >= warnPct) {
      els.alert.hidden = false; els.alert.style.background = 'var(--warning)';
      els.alert.textContent = isCur ? `⚠  預算使用已達 ${M.pct(pct)}%${rsvTxt}，剩餘 NT$${M.money(remain)}，還有 ${daysLeft} 天`
        : `⚠  該期預算使用達 ${M.pct(pct)}%，已用 NT$${M.money(total)} / NT$${M.money(budget)}`;
    } else els.alert.hidden = true;
    // 進度卡
    els.pbar.style.setProperty('--c', pct >= danPct ? 'var(--danger)' : pct >= warnPct ? 'var(--warning)' : 'var(--accent2)');
    els.pbar.firstChild.style.width = pct + '%';
    els.pct.textContent = `${M.pct(pct)}%`; els.pct.style.color = color;
    els.det.textContent = `已用 NT$${M.money(total)}  /  ` + (reserved ? `拜拜預扣 NT$${M.money(reserved)}  /  ` : '') + `預算 NT$${M.money(budget)}  /  剩餘 NT$${M.money(remain)}`;
    els.tbar.firstChild.style.width = timePct + '%';
    if (isCur) {
      const diff = realPct - timePct;
      const ds = diff > 2 ? `消費進度超前時間 ${M.pct(diff)}%` : diff < -2 ? `消費進度落後時間 ${M.pct(-diff)}%` : '消費進度與時間同步';
      els.tcmp.textContent = `已過 ${elapsed} 天 / 共 ${totalDays} 天（${M.pct(timePct)}%）  ·  ${ds}`;
    } else els.tcmp.textContent = `週期共 ${totalDays} 天  ·  該期已結算（歷史資料）`;
    els.lastRecs = recs; els.lastS = s; els.lastE = e;
    requestAnimationFrame(() => drawChart(recs, s, e));
    // 費用記錄頁的週期跟著儀表板
    if (M.pages.records && M.pages.records.setFilter) M.pages.records.setFilter(sel);
  };

  // ── 每日消費趨勢圖 ──
  const hitAt = (x, y) => hits.find((a) => a.x0 <= x && x <= a.x1 && a.y0 <= y && y <= a.y1);
  const drawChart = (recs, ps, pe) => {
    const cv = els.cv;
    if (!cv || !cv.isConnected || cv.getBoundingClientRect().width < 20) return;
    const { ctx, w, h: H } = ui.canvas(cv);
    hits = [];
    const col = (n) => ui.css('--' + n);
    const daily = {};
    for (const r of recs) daily[r.date] = (daily[r.date] || 0) + (Number(r.amount) || 0);
    ctx.font = `13px ${ui.css('--font')}`;
    if (!Object.keys(daily).length) {
      ctx.fillStyle = col('subtext'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('本期暫無資料', w / 2, H / 2); return;
    }
    const totalDays = D.diff(pe, ps) || 30;
    const dailyBudget = M.getPeriodBudget(ps) / totalDays;
    const dates = Object.keys(daily).sort(), values = dates.map((d) => daily[d]);
    const padL = 52, padR = 16, padT = 20, padB = 32;
    const cw = w - padL - padR, ch = H - padT - padB;
    const maxVal = Math.max(Math.max(...values), dailyBudget) * 1.2 || 1;
    const byDate = {};
    for (const r of recs) (byDate[r.date] = byDate[r.date] || []).push(r);
    const mono = (px) => `${px}px ${ui.css('--mono')}`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const gy = padT + ch * i / 4, gv = maxVal * (1 - i / 4);
      ctx.strokeStyle = col('border'); ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = col('muted'); ctx.font = mono(10); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${(gv / 1000).toFixed(1)}k`, padL - 4, gy);
    }
    const refY = padT + ch * (1 - dailyBudget / maxVal);
    ctx.strokeStyle = col('warning'); ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(padL, refY); ctx.lineTo(w - padR, refY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col('warning'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = mono(10);
    ctx.fillText(`日均 ${dailyBudget.toFixed(0)}`, padL + 4, refY - 2);
    const n = dates.length, slot = cw / n;
    const colorOf = (v) => (v > dailyBudget * 1.5 ? col('danger') : v > dailyBudget ? col('warning') : col('accent'));
    if (chartType === 'line') {
      const pts = values.map((v, i) => [padL + slot * i + slot / 2, padT + ch * (1 - v / maxVal)]);
      if (pts.length >= 2) {
        ctx.beginPath(); ctx.moveTo(padL, padT + ch); ui.smoothPath(ctx, pts); ctx.lineTo(pts[pts.length - 1][0], padT + ch); ctx.closePath();
        ctx.fillStyle = col('accent') + '33'; ctx.fill();
        ctx.beginPath(); ui.smoothPath(ctx, pts); ctx.strokeStyle = col('accent'); ctx.lineWidth = 2; ctx.stroke();
      }
      pts.forEach(([x, y], i) => {
        const v = values[i], c = colorOf(v);
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = col('card'); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = c; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
        if (v > dailyBudget) { ctx.fillStyle = c; ctx.font = mono(9); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(v.toFixed(0), x, y - 9); }
        ctx.fillStyle = col('subtext'); ctx.font = mono(10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(dates[i].slice(8), x, padT + ch + 14);
        hits.push({ x0: x - 10, y0: y - 10, x1: x + 10, y1: y + 10, date: dates[i], total: v, recs: byDate[dates[i]] || [], col: c });
      });
    } else {
      const bw = Math.max(6, Math.min(slot * 0.65, 40));
      values.forEach((v, i) => {
        const x = padL + slot * i + slot / 2, bh = ch * v / maxVal, c = colorOf(v);
        const y0 = padT + ch - bh;
        ctx.fillStyle = c; ctx.fillRect(x - bw / 2, y0, bw, bh);
        if (bh > 18) { ctx.font = mono(9); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(v.toFixed(0), x, y0 - 2); }
        ctx.fillStyle = col('subtext'); ctx.font = mono(10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(dates[i].slice(8), x, padT + ch + 14);
        hits.push({ x0: x - bw / 2 - 3, y0: Math.max(0, y0 - 8), x1: x + bw / 2 + 3, y1: padT + ch, date: dates[i], total: v, recs: byDate[dates[i]] || [], col: c });
      });
    }
  };
  const dayPopup = (a, x, y) => {
    const list = h('div', { style: { padding: '0 14px' } });
    for (const r of [...a.recs].sort((p, q) => q.amount - p.amount)) {
      list.appendChild(h('div', { style: { display: 'flex', gap: '8px', padding: '2px 0' } },
        h('b', { style: { color: 'var(--accent2)', fontFamily: 'var(--mono)' } }, `NT$ ${M.money(r.amount)}`),
        r.note ? h('span.sub', r.note) : null));
    }
    const pop = ui.popover(x, y, h('div',
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '8px 12px 2px' } },
        h('b', a.date), h('button.icon-btn', { style: { fontSize: '13px', color: 'var(--muted)' }, onclick: () => ui.closePopover() }, '✕')),
      h('div', { style: { padding: '0 14px', color: a.col, font: '700 18px var(--mono)' } }, `NT$ ${M.money(a.total)}`),
      h('div', { style: { height: '1px', background: 'var(--border)', margin: '6px 12px 4px' } }), list), a.col);
    return pop;
  };
})();
