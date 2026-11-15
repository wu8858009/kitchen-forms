/* 頁面：菜單排程（每週週一～週日；早餐自由排、晚餐固定三菜一湯可加菜） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const P = {};
  (M.pages = M.pages || {}).menu = P;
  const DINNER = ['菜①', '菜②', '菜③', '湯'];
  let monday = D.monday(D.today()), saveT = null, els = {};
  let lookupSuspended = false;               // 查詢失敗過就先不再自動查，直到設定重新儲存或重新開啟
  const lookupGen = new Map();
  M.resumeLookup = () => { lookupSuspended = false; };
  M.lookupSuspended = () => lookupSuspended;
  M.suspendLookup = () => { lookupSuspended = true; };

  const blankDay = () => ({ breakfast: { people: null, dishes: [] }, dinner: { people: null, dishes: DINNER.map(() => ({ name: '', items: '' })) } });
  /** 舊格式（一天只有 people/dishes）搬成 {breakfast, dinner}；晚餐至少 4 格 */
  M.menuNormalize = (day) => {
    if (!('breakfast' in day) && !('dinner' in day)) {
      const op = day.people ?? null, od = day.dishes || [];
      delete day.people; delete day.dishes;
      day.breakfast = { people: null, dishes: [] };
      day.dinner = { people: op, dishes: od };
    }
    day.breakfast = day.breakfast || { people: null, dishes: [] };
    day.dinner = day.dinner || { people: null, dishes: [] };
    day.breakfast.dishes = day.breakfast.dishes || [];
    const ds = (day.dinner.dishes = day.dinner.dishes || []);
    while (ds.length < DINNER.length) ds.push({ name: '', items: '' });
    return day;
  };
  const dayHasContent = (day) => {
    if (!('breakfast' in day) && !('dinner' in day)) return (day.dishes || []).some((x) => x.name || x.items);
    return ['breakfast', 'dinner'].some((m) => ((day[m] || {}).dishes || []).some((x) => x.name || x.items));
  };
  const iso = () => D.iso(monday);
  const menuDay = (i) => {
    const menus = (M.data.menu = M.data.menu || {});
    const wk = (menus[iso()] = menus[iso()] || { days: [] });
    while (wk.days.length < 7) wk.days.push(blankDay());
    return M.menuNormalize(wk.days[i]);
  };
  const peek = (i) => {
    const wk = (M.data.menu || {})[iso()];
    return wk && i < wk.days.length ? M.menuNormalize(wk.days[i]) : blankDay();
  };
  const changed = () => { clearTimeout(saveT); saveT = setTimeout(() => { M.save(); M.refreshPage('order'); }, 600); };

  /** 這週碰到農曆初一、十六：晚餐自動先排入拜拜菜（每天只排一次，之後手動刪掉不會再補回） */
  const prefillBaibai = (mon) => {
    const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => M.isBaibai(D.add(mon, i)));
    if (!days.length) return false;
    const menus = (M.data.menu = M.data.menu || {});
    const wk = (menus[D.iso(mon)] = menus[D.iso(mon)] || { days: [] });
    while (wk.days.length < 7) wk.days.push(blankDay());
    let ch = false;
    for (const i of days) {
      const day = M.menuNormalize(wk.days[i]);
      if (day.baibai_added) continue;
      const dishes = day.dinner.dishes;
      const have = new Set(dishes.map((x) => String(x.name || '').trim()));
      const free = [0, 1, 2].filter((k) => !(dishes[k].name || dishes[k].items));
      for (const [name] of M.BAIBAI_ITEMS) {
        if (have.has(name)) continue;
        const dish = { name, items: name, baibai: true };
        if (free.length) dishes[free.shift()] = dish; else dishes.push(dish);
      }
      day.baibai_added = true;
      ch = true;
    }
    return ch;
  };

  P.build = (el) => {
    const wk = h('span.wk-lbl');
    el.appendChild(h('div.toolbar',
      h('div.tb-l', ui.btn('上週', 'muted', () => P.shift(-1)), wk, ui.btn('下週', 'muted', () => P.shift(1)), ui.btn('本週', 'muted', () => P.home()),
        h('div.tb-sep'), ui.btn('📋 複製上週菜單', 'muted', () => copyPrev())),
      h('div.tb-r', ui.btn('🛒 帶入叫貨計算（依菜單）', 'green', () => toOrder()))));
    const grid = h('div.menu-grid');
    el.appendChild(h('div.scroll', grid));
    el.appendChild(h('div.pagefoot', h('span', '食材請用逗號分隔，名稱同「食材單價」頁（例：三層肉,青江菜,雞蛋）；菜名可從下拉選單挑選以前排過的菜色，會自動帶入配菜；'
      + '晚餐固定三菜一湯，可再「＋加菜」；人數預設取「排班人數」頁對應的早餐／用餐人數，可各自直接修改')));
    els = { wk, grid };
    loadWeek();
  };
  P.shift = (n) => { monday = D.add(monday, 7 * n); loadWeek(); };
  P.home = () => { monday = D.monday(D.today()); loadWeek(); };
  P.gotoDate = (d) => { monday = D.monday(d); if (els.grid) loadWeek(); };
  P.reload = () => { if (els.grid) render(); };
  P.refresh = () => { if (els.grid) render(); };
  const loadWeek = () => { els.wk.textContent = `${D.fmt(monday)} ～ ${D.md(D.add(monday, 6))}`; render(); };

  const render = () => {
    const grid = els.grid;
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.mk : null;
    ui.clear(grid);
    if (prefillBaibai(monday)) changed();
    const auto = M.schWeekMealCounts(monday);
    const bAuto = auto ? auto[0] : null, dAuto = auto ? auto[1] : null;
    const recipeNames = () => Object.keys(M.data.recipe_book || {}).sort();
    for (let i = 0; i < 7; i++) {
      const d = D.add(monday, i), day = peek(i), we = i >= 5;
      const lu = M.lunarDate(d);
      const bb = !!lu && M.BAIBAI_DAYS.includes(lu[2]);
      const col = h('div.mday',
        h('div.mday-h' + (we ? '.we' : ''), h('i'), h('b', M.WEEKDAYS[i]), h('small', `${D.m(d)}/${D.d(d)}`),
          h('span.lu' + (bb ? '.bb' : ''), lu ? `農曆 ${M.lunarLabel(d)}` : ''), bb ? h('div', h('span.bbtag', ` 🏮 ${M.lunarDayName(lu[2])} 拜拜 `)) : null));
      col.appendChild(renderMeal(i, 'breakfast', '早餐', '🌅', 'var(--purple)', day.breakfast, bAuto ? bAuto[i] : null, recipeNames, false));
      col.appendChild(renderMeal(i, 'dinner', '晚餐', '🌙', 'var(--accent2)', day.dinner, dAuto ? dAuto[i] : null, recipeNames, true));
      grid.appendChild(col);
    }
    if (focusKey) { const f = grid.querySelector(`[data-mk="${focusKey}"]`); if (f) f.focus(); }
  };

  const renderMeal = (i, meal, title, icon, accent, mdata, autoPeople, recipeNames, fixed) => {
    const box = h('div.meal', { style: { '--c': accent } });
    box.appendChild(h('div.meal-h', h('span', icon), h('span', title), fixed ? h('span.chip', ' 三菜一湯 ') : null));
    let shown = mdata.people;
    if (shown == null && autoPeople != null) shown = autoPeople;
    const pv = ui.input(shown ? M.num(shown) : '', { inputmode: 'decimal' });
    pv.addEventListener('input', () => {
      const t = pv.value.trim();
      const v = t ? Number(t) : null;
      if (t && !isFinite(v)) return;
      menuDay(i)[meal].people = v;
      changed();
    });
    box.appendChild(h('div.meal-p', '👥', pv, '人'));
    mdata.dishes.forEach((dish, j) => {
      const label = fixed && j < DINNER.length ? DINNER[j] : dish.baibai ? '🏮' : null;
      const nm = ui.input(dish.name || '', { 'data-mk': `${i}-${meal}-${j}-n` });
      const it = ui.input(dish.items || '', { 'data-mk': `${i}-${meal}-${j}-i` });
      if (dish.recipe_suggested) it.classList.add('warn');
      const blk = h('div.dish' + (label ? '' : '.nolab'));
      if (label) blk.appendChild(h('div.lab', label));
      const autofill = () => {
        const name = nm.value.trim();
        if (!name || it.value.trim()) return;
        const book = (M.data.recipe_book || {})[name];
        const items = book ? M.recipeIngredientsStr(book) : '';
        if (items) { setItems(items); return; }
        const r = (M.data.recipes || {})[name];
        if (r) setItems(r); else webLookup(i, meal, j, name);
      };
      const setItems = (v) => { it.value = v; it.dispatchEvent(new Event('input')); };
      const nmW = ui.combo(nm, recipeNames, () => {
        const book = (M.data.recipe_book || {})[nm.value.trim()];
        const items = book ? M.recipeIngredientsStr(book) : '';
        if (items) setItems(items); else autofill();
      });
      blk.appendChild(h('div.nm', nmW));
      const canDel = !fixed || j >= DINNER.length;
      if (canDel) { const x = ui.btn('✕', 'muted', () => delDish(i, meal, j)); x.classList.add('x'); x.tabIndex = -1; blk.appendChild(h('div.del', x)); }
      else blk.appendChild(h('div'));
      blk.appendChild(h('div.it', it));
      if (dish.recipe_loading) blk.appendChild(h('div.note.ld', '🔍 查詢食譜中…'));
      else if (dish.recipe_suggested && dish.recipe_source) blk.appendChild(h('div.note', `來源：愛料理 ${dish.recipe_source}`));
      for (const [inp, key] of [[nm, 'name'], [it, 'items']]) {
        inp.addEventListener('input', () => {
          const ds = menuDay(i)[meal].dishes;
          if (j >= ds.length) return;
          ds[j][key] = inp.value;
          const slot = `${i}|${meal}|${j}`;
          lookupGen.set(slot, (lookupGen.get(slot) || 0) + 1);
          changed();
        });
      }
      const learnIt = () => {
        const ds = menuDay(i)[meal].dishes;
        if (j >= ds.length) return;
        const n = String(ds[j].name || '').trim(), its = String(ds[j].items || '').trim();
        if (n && its) (M.data.recipes = M.data.recipes || {})[n] = its;
      };
      nm.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== nm) { autofill(); learnIt(); } }, 160); });
      nm.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && !(nm._comboOpen && nm._comboOpen())) { e.preventDefault(); autofill(); it.focus(); } });
      it.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addDish(i, meal); } });
      it.addEventListener('blur', () => {
        learnIt();
        const ds = menuDay(i)[meal].dishes;
        if (j < ds.length && ds[j].recipe_suggested) {      // 看過網路查來的食材就算確認
          ds[j].recipe_suggested = false; ds[j].recipe_source = '';
          it.classList.remove('warn');
          const note = blk.querySelector('.note'); if (note) note.remove();
          changed();
        }
      });
      box.appendChild(blk);
    });
    box.appendChild(Object.assign(ui.btn(fixed ? '＋ 加菜' : '＋ 新增菜色', 'muted', () => addDish(i, meal)), { className: 'btn muted add' }));
    return box;
  };
  const addDish = (i, meal) => {
    const ds = menuDay(i)[meal].dishes;
    ds.push({ name: '', items: '' });
    changed(); render();
    const f = els.grid.querySelector(`[data-mk="${i}-${meal}-${ds.length - 1}-n"]`);
    if (f) f.focus();
  };
  const delDish = async (i, meal, j) => {
    const ds = menuDay(i)[meal].dishes;
    if (j >= ds.length) return;
    const d = ds[j];
    if ((d.name || d.items) && !(await ui.ask('確認刪除', `刪除菜色「${d.name || '（未命名）'}」？`))) return;
    ds.splice(j, 1);
    if (meal === 'dinner') while (ds.length < DINNER.length) ds.push({ name: '', items: '' });
    changed(); render();
  };
  const copyPrev = async () => {
    const prev = (M.data.menu || {})[D.iso(D.add(monday, -7))];
    if (!prev || !prev.days.some(dayHasContent)) { ui.info('提示', '上週沒有菜單可以複製。'); return; }
    const cur = (M.data.menu || {})[iso()];
    if (cur && cur.days.some(dayHasContent) && !(await ui.ask('覆蓋菜單', '本週已有菜單，要用上週的菜單覆蓋嗎？'))) return;
    const days = prev.days.map((d) => {
      const x = M.menuNormalize(M.clone(d));
      delete x.baibai_added;
      x.dinner.dishes = x.dinner.dishes.filter((y) => !y.baibai);
      return M.menuNormalize(x);
    });
    (M.data.menu = M.data.menu || {})[iso()] = { days };
    M.save(); render(); ui.status('已複製上週菜單');
  };

  // ── 連動：叫貨計算 ──
  /** 某週每天的叫貨人數（只算晚餐）：菜單頁填的人數 > 班表算出的人數 > 0 */
  const peopleCounts = (mon) => {
    const wk = (M.data.menu || {})[D.iso(mon)];
    const a = M.schWeekMealCounts(mon);
    const dAuto = a ? a[1] : [0, 0, 0, 0, 0, 0, 0];
    return [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const day = wk && i < wk.days.length ? M.menuNormalize(wk.days[i]) : null;
      const dp = day ? day.dinner.people : null;
      return dp != null ? dp : dAuto[i];
    });
  };
  /** 品名 → 這週哪幾天有排到；整週沒排任何食材 → null */
  M.menuAllowed = (names, mondayIso) => {
    const wk = (M.data.menu || {})[mondayIso];
    if (!wk) return null;
    const used = [[], [], [], [], [], [], []];
    wk.days.slice(0, 7).forEach((day, i) => {
      day = M.menuNormalize(day);
      for (const meal of ['breakfast', 'dinner'])
        for (const dish of day[meal].dishes || [])
          used[i].push(...String(dish.items || '').split(/[,，、;；\s]+/).filter(Boolean));
    });
    if (!used.some((u) => u.length)) return null;
    const out = {};
    for (const n of names) out[n] = used.map((u) => u.some((t) => t === n || n.includes(t) || t.includes(n)));
    return out;
  };
  const toOrder = () => {
    const counts = peopleCounts(monday);
    if (!counts.some(Boolean)) { ui.info('提示', '這週還沒有用餐人數。\n請先建立班表，或在各天填入人數。'); return; }
    if (M.menuAllowed(Object.keys(M.ingLast()), iso()) === null) { ui.info('提示', '這週還沒有排任何菜色或食材。'); return; }
    const plan = M.data.order_plan;
    plan.menu_week = iso(); plan.use_menu = true;
    M.showPage('order');
    M.ordApplyWeekCounts(counts);
    ui.status(`已帶入叫貨計算：${D.md(monday)} 起一週菜單，共 ${M.num(counts.reduce((a, b) => a + b, 0))} 人次`);
  };

  // ── 自動查詢食材（愛料理）：透過雲端程式代查（瀏覽器不能直接連 icook.tw）──
  const webLookup = (i, meal, j, name) => {
    if (lookupSuspended || !M.settings().recipe_lookup_enabled || !M.cloud.enabled) return;
    const ds = menuDay(i)[meal].dishes;
    if (j >= ds.length || ds[j].recipe_loading) return;
    ds[j].recipe_loading = true;
    const slot = `${i}|${meal}|${j}`;
    const gen = (lookupGen.get(slot) || 0) + 1;
    lookupGen.set(slot, gen);
    const wkIso = iso();
    render();
    M.icookRecipe(name).then((res) => [res, null], (err) => [null, err]).then(([res, err]) => {
      const wk = (M.data.menu || {})[wkIso];
      const dd = wk && wk.days[i] ? M.menuNormalize(wk.days[i])[meal].dishes : [];
      const stale = j >= dd.length || String(dd[j].name || '').trim() !== name || lookupGen.get(slot) !== gen;
      if (j < dd.length) delete dd[j].recipe_loading;
      if (err) {
        lookupSuspended = true;
        ui.status(`食譜查詢失敗，本次已停用自動查詢：${err.message || err}`);
        if (iso() === wkIso) render();
        return;
      }
      if (!stale) {
        dd[j].items = res.items; dd[j].recipe_suggested = true; dd[j].recipe_source = res.url;
        (M.data.recipes = M.data.recipes || {})[name] = res.items;
        changed();
      }
      if (iso() === wkIso) render();
    });
  };
})();
