/* 頁面：農民曆（國曆＋農曆月曆、連續假期、初一／十六拜拜菜預排叫貨與預扣） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).lunar = P;
  P.alwaysRefresh = true;                      // 單價 / 日期可能變了 → 每次進來都重算
  let ym = [D.y(D.today()), D.m(D.today())], els = {};
  const BB_NAMES = () => new Set(M.BAIBAI_ITEMS.map((x) => x[0]));

  const prevBaibai = (d) => {
    let p = D.add(d, -1);
    for (let k = 0; k < 20; k++) { if (M.isBaibai(p)) break; p = D.add(p, -1); }
    return p;
  };
  /** 拜拜日 d 的拜拜菜中，已經叫貨／記帳的品名（上一個初一／十六隔天起到 d；備註含「拜拜」的記錄 → 整組都算已買） */
  M.baibaiBought = (d) => {
    const lo = D.iso(prevBaibai(d)), hi = D.iso(d);
    const names = BB_NAMES();
    if (M.data.records.some((r) => lo < (r.date || '') && (r.date || '') <= hi && String(r.note || '').includes('拜拜'))) return names;
    return new Set(M.data.ingredients.filter((r) => names.has(r.name) && !r.price_only && lo < r.date && r.date <= hi).map((r) => r.name));
  };
  /** 結算週期 [s, e) 的拜拜菜預扣 → [預扣總額, 拜拜日期, 其中已叫貨的金額]（呼叫端要從已用扣掉 paid） */
  M.baibaiReserve = (s, e) => {
    const last = M.ingLast();
    const names = BB_NAMES();
    const loP = D.iso(s), hiP = D.iso(e), today = D.today();
    let total = 0, paid = 0;
    const days = [];
    let prev = prevBaibai(s);
    let d = s;
    const end = D.add(e, 20);
    while (d < end) {
      if (M.isBaibai(d)) {
        const lo = D.iso(prev), hi = D.iso(d);
        const inwin = (x) => lo < x && x <= hi && loP <= x && x < hiP;
        let amtPaid = M.data.ingredients.filter((r) => names.has(r.name) && !r.price_only && inwin(r.date)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
        amtPaid += M.data.records.filter((r) => String(r.note || '').includes('拜拜') && inwin(r.date || '')).reduce((a, r) => a + (Number(r.amount) || 0), 0);
        let amtDue = 0;
        if (today <= d && d < e) {
          const bought = M.baibaiBought(d);
          for (const [n, q] of M.BAIBAI_ITEMS) if (!bought.has(n)) amtDue += ((last[n] || [null, null])[1] || 0) * q;
        }
        if (amtPaid || amtDue) { paid += amtPaid; total += amtPaid + amtDue; days.push(d); }
        prev = d;
      }
      d = D.add(d, 1);
    }
    return [total, days, paid];
  };
  /** 接下來 n 個初一／十六的預排叫貨 */
  const upcoming = (n = 6) => {
    const last = M.ingLast();
    return M.nextBaibaiDays(D.today(), n).map((d) => {
      const bought = M.baibaiBought(d);
      let total = 0, reserve = 0;
      const items = M.BAIBAI_ITEMS.map(([name, q, u]) => {
        const price = (last[name] || [null, null])[1];
        const amt = price != null ? price * q : null;
        total += amt || 0;
        if (!bought.has(name)) reserve += amt || 0;
        return [name, q, u, amt];
      });
      return { date: d, items, total, bought, reserve };
    });
  };

  P.build = (el) => {
    const title = h('span.wk-lbl', { style: { minWidth: '230px' } });
    el.appendChild(h('div.toolbar',
      h('div.tb-l', ui.btn('上月', 'muted', () => P.shift(-1)), title, ui.btn('下月', 'muted', () => P.shift(1)), ui.btn('本月', 'muted', () => P.home())),
      h('div.tb-r', ui.btn('📋 複製預排叫貨單', 'green', () => P.copy()))));
    const grid = h('div.lgrid'), side = h('div.lside');
    el.appendChild(h('div.lunar-body', grid, side));
    const items = M.BAIBAI_ITEMS.map(([n, q, u]) => `${n} ${q}${u}`).join('、');
    el.appendChild(h('div.pagefoot', h('span', `每逢農曆初一、十六，菜單排程會自動在晚餐先排入拜拜菜（${items}），叫貨計算「每週」模式固定帶入這個數量，`
      + '金額先從本期剩餘預扣（叫貨記帳後自動改算實際金額）；點日期可跳到那週的菜單')));
    els = { title, grid, side };
  };
  P.shift = (n) => { let [y, m] = ym; m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; ym = [y, m]; P.refresh(); };
  P.home = () => { ym = [D.y(D.today()), D.m(D.today())]; P.refresh(); };
  const gotoMenu = (d) => { M.pages.menu.gotoDate(d); M.showPage('menu'); };

  P.refresh = () => {
    if (!els.grid) return;
    const [y, m] = ym;
    els.title.textContent = `${y} 年 ${m} 月（民國 ${y - 1911} 年）`;
    const grid = ui.clear(els.grid);
    '日一二三四五六'.split('').forEach((c, i) => grid.appendChild(h('div.dow' + (i === 0 ? '.sun' : i === 6 ? '.sat' : ''), c)));
    const today = D.today();
    const first = D.make(y, m, 1), lastD = D.make(y, m, D.daysInMonth(y, m));
    const inLong = new Map();
    for (const hl of M.longHolidays(first, lastD)) for (let k = hl.start; k <= hl.end; k = D.add(k, 1)) inLong.set(k.getTime(), hl);
    for (let i = 0; i < first.getUTCDay(); i++) grid.appendChild(h('div'));
    for (let day = 1; day <= D.daysInMonth(y, m); day++) {
      const d = D.make(y, m, day), c = d.getUTCDay();
      const lu = M.lunarDate(d);
      const bb = !!lu && M.BAIBAI_DAYS.includes(lu[2]);
      const hname = M.holidayName(d);
      const run = inLong.get(d.getTime());
      const isToday = d.getTime() === today.getTime();
      const cell = h('div.lcell' + (run ? '.hol' : '') + (isToday ? '.today' : bb ? '.bb' : ''), { onclick: () => gotoMenu(d), title: '點一下看那週的菜單' },
        h('div.top', h('span.dn' + (c === 0 || hname ? '.red' : c === 6 ? '.sat' : ''), day),
          run && (d.getTime() === run.start.getTime() || day === 1) ? h('span.lr', ` 連假 ${run.days} 天 `) : null),
        lu ? h('div.lu' + (bb ? '.bb' : ''), lu[2] === 1 ? M.lunarMonthName(lu[1], lu[3]) : M.lunarDayName(lu[2])) : null,
        hname ? h('div.hn', `🎌 ${hname}`) : null,
        bb ? h('div.bbt', '🏮 拜拜叫貨') : null);
      grid.appendChild(cell);
    }
    // 側欄
    const side = ui.clear(els.side);
    side.appendChild(h('h4', { style: { '--c': 'var(--danger)' } }, '🎌 近期連續假期'));
    const wd = '一二三四五六日';
    for (const hl of M.longHolidays(today, D.add(today, 365)).slice(0, 4)) {
      const left = D.diff(hl.start, today);
      side.appendChild(h('div.lh-row', { onclick: () => { ym = [D.y(hl.start), D.m(hl.start)]; P.refresh(); } },
        h('span.n', `${hl.name}  ${D.md(hl.start)}（${wd[D.wd(hl.start)]}）～${D.md(hl.end)}（${wd[D.wd(hl.end)]}）`),
        h('span.d', `${hl.days} 天`), h('span.s' + (left <= 7 ? '.soon' : ''), left <= 0 ? '放假中' : `${left} 天後`)));
    }
    side.appendChild(h('h4', { style: { '--c': 'var(--warning)', marginTop: '16px' } }, '🏮 初一／十六 預排叫貨'));
    const [cs, ce] = M.getPeriod(today);
    const [reserved, rdays] = M.baibaiReserve(cs, ce);
    side.appendChild(h('div', { style: { color: reserved ? 'var(--warning)' : 'var(--subtext)', fontWeight: 700, fontSize: '13px', marginTop: '4px' } },
      reserved ? `本期預扣 NT$ ${M.money(reserved)}（${rdays.length} 次，已從本期剩餘先扣除）` : '本期沒有待預扣的拜拜菜'));
    const up = upcoming(4);
    if (!up.length) side.appendChild(h('div.sub', '超出內建農曆資料範圍（1900～2049 年）'));
    for (const e of up) {
      const d = e.date, left = D.diff(d, today);
      const box = h('div.bbbox',
        h('div.hd', h('b', `${D.md(d)}（${wd[D.wd(d)]}）`), h('span.lu', `農曆 ${M.lunarLabel(d)}`),
          h('span', { style: { fontSize: '12px', color: left <= 3 ? 'var(--accent)' : 'var(--subtext)' } }, left === 0 ? '今天' : `${left} 天後`)));
      for (const [name, q, u, amt] of e.items) {
        let txt, fg;
        if (e.bought.has(name)) { txt = '✅ 已叫貨'; fg = 'var(--accent2)'; }
        else if (amt != null) { txt = `NT$ ${M.money(amt)}`; fg = 'var(--subtext)'; }
        else { txt = '尚無單價'; fg = 'var(--danger)'; }
        box.appendChild(h('div.it', h('span', `· ${name}  ${M.num(q)} ${u}`), h('span', { style: { color: fg } }, txt)));
      }
      const ft = e.reserve ? `預扣 NT$ ${M.money(e.reserve)}` : e.bought.size ? '已全部叫貨' : `小計 NT$ ${M.money(e.total)}`;
      const b = ui.btn('🍱 看菜單', 'muted', () => gotoMenu(d)); b.classList.add('sm');
      box.appendChild(h('div.ft', h('span', { style: { color: e.reserve || !e.bought.size ? 'var(--warning)' : 'var(--accent2)' } }, ft), b));
      side.appendChild(box);
    }
  };
  P.copy = async () => {
    const up = upcoming();
    if (!up.length) { ui.info('提示', '目前沒有可預排的初一／十六。'); return; }
    const lines = ['初一／十六 預排叫貨'];
    for (const e of up) lines.push(`${D.md(e.date)}（農曆${M.lunarLabel(e.date)}）：${e.items.map(([n, q, u]) => `${n} ${M.num(q)}${u}`).join('、')}`);
    const ok = await ui.copy(lines.join('\n'));
    ui.status(ok ? `已複製預排叫貨單：${up.length} 次拜拜` : '複製失敗：瀏覽器不允許存取剪貼簿');
    if (ok) ui.toast('已複製預排叫貨單');
  };
})();
