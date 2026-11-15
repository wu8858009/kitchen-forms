/* 員工餐金額總計 — 網頁版介面元件：DOM 工具、對話框、提示、月曆、可搜尋下拉、畫布 */
(() => {
  'use strict';
  const M = window.M;
  const D = M.D;
  const ui = (M.ui = {});

  // ════════════════════════════════════════════════════════════ DOM
  /** h('div.cls#id', {attrs/on*}, ...children) */
  const h = (sel, attrs, ...kids) => {
    const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    const el = document.createElement(m[1] || 'div');
    for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  };
  ui.h = h;
  ui.$ = (s, r = document) => r.querySelector(s);
  ui.$$ = (s, r = document) => [...r.querySelectorAll(s)];
  ui.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ui.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // 按鈕：kind = blue / green / red / muted
  ui.btn = (text, kind, onclick, extra = {}) => h('button.btn.' + (kind || 'muted'), Object.assign({ type: 'button', onclick }, extra), text);
  ui.input = (value = '', extra = {}) => h('input', Object.assign({ type: 'text', value: value ?? '', autocomplete: 'off', spellcheck: false }, extra));

  // ════════════════════════════════════════════════════════════ 狀態列 / 提示
  ui.status = (msg) => { const s = document.getElementById('status'); if (s) s.textContent = '  ' + msg; };
  ui.toast = (msg, ms = 2600) => {
    let t = document.getElementById('toast');
    if (!t) { t = h('div#toast.toast'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; t.classList.add('show');
    clearTimeout(ui.toast.t);
    ui.toast.t = setTimeout(() => { t.classList.remove('show'); t.hidden = true; }, ms);
  };
  ui.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } }, text);
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { /* 略過 */ }
      ta.remove();
      return ok;
    }
  };
  /** 下載文字檔（CSV 加 BOM，Excel 才看得懂中文） */
  ui.download = (name, text, type = 'text/csv') => {
    const blob = new Blob([type === 'text/csv' ? '﻿' + text : text], { type: type + ';charset=utf-8' });
    if (window.pywebview && window.pywebview.api && window.pywebview.api.export_file) {   // 廚房專用表格系統（桌面版）：另存新檔對話框
      blob.arrayBuffer().then((buf) => {
        const u8 = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return window.pywebview.api.export_file(btoa(bin), name);
      }).then((p) => { if (p) { ui.status('已儲存：' + p); ui.toast('已儲存：' + p); } });
      return;
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  ui.csv = (rows) => rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n') + '\r\n';

  // ════════════════════════════════════════════════════════════ 對話框
  const stack = [];
  ui.modalOpen = () => stack.length > 0;
  /**
   * 開對話框：{title, accent, width, body, buttons:[{text,kind,onclick}], sub, onClose, cls}
   * 回傳 {el, body, close(), foot}
   */
  ui.modal = (opt) => {
    const bg = h('div.modal-bg');
    const box = h('div.modal' + (opt.cls ? '.' + opt.cls : ''), { role: 'dialog', 'aria-modal': 'true' });
    if (opt.width) box.style.width = `min(${opt.width}px, calc(100vw - 24px))`;
    if (opt.height) box.style.height = `min(${opt.height}px, calc(100dvh - 24px))`;
    box.appendChild(h('div.modal-accent', { style: { background: opt.accent || 'var(--accent)' } }));
    const head = h('div.modal-head', h('h3', opt.title || ''), opt.sub ? h('span.modal-sub', opt.sub) : null, opt.headRight || null);
    if (opt.title !== null) box.appendChild(head);
    const body = h('div.modal-body');
    if (opt.body) body.appendChild(opt.body);
    box.appendChild(body);
    const foot = h('div.modal-foot');
    if (opt.footLeft) foot.appendChild(h('div.foot-left', opt.footLeft));
    const right = h('div.foot-right');
    for (const b of opt.buttons || []) right.appendChild(ui.btn(b.text, b.kind, b.onclick));
    foot.appendChild(right);
    if ((opt.buttons || []).length || opt.footLeft) box.appendChild(foot);
    bg.appendChild(box);
    document.body.appendChild(bg);
    const m = { el: box, body, foot, head, closed: false };
    m.close = (val) => {
      if (m.closed) return;
      m.closed = true;
      bg.remove();
      const i = stack.indexOf(m);
      if (i >= 0) stack.splice(i, 1);
      if (opt.onClose) opt.onClose(val);
      if (m._prevFocus && document.contains(m._prevFocus)) { try { m._prevFocus.focus({ preventScroll: true }); } catch (e) { /* 略過 */ } }
    };
    m.esc = opt.esc !== false;
    m.onEnter = opt.onEnter || null;
    m._prevFocus = document.activeElement;
    bg.addEventListener('mousedown', (e) => { if (e.target === bg && opt.clickOut !== false) bg._down = true; });
    bg.addEventListener('mouseup', (e) => { if (e.target === bg && bg._down && opt.clickOut) m.close(); bg._down = false; });
    stack.push(m);
    requestAnimationFrame(() => box.classList.add('in'));
    return m;
  };
  ui.topModal = () => stack[stack.length - 1] || null;
  document.addEventListener('keydown', (e) => {
    const m = ui.topModal();
    if (!m) return;
    if (e.key === 'Escape' && m.esc) {
      if (document.querySelector('.cal-pop, .combo-pop')) return;   // 先讓月曆 / 下拉收起
      e.preventDefault(); m.close();
    }
  }, true);

  /** 訊息框（info / warn / error），回傳 Promise */
  const msgBox = (kind, title, msg, buttons) => new Promise((res) => {
    const icon = { info: 'ℹ', warn: '⚠', error: '✕', ask: '?' }[kind];
    const color = { info: 'var(--accent)', warn: 'var(--warning)', error: 'var(--danger)', ask: 'var(--accent)' }[kind];
    let m;
    const body = h('div.msg', h('div.msg-ic', { style: { color } }, icon), h('div.msg-t', String(msg)));
    m = ui.modal({
      title, accent: color, width: 440, body, clickOut: false,
      buttons: buttons.map((b) => ({ text: b[0], kind: b[1], onclick: () => { m.close(); res(b[2]); } })),
      onClose: () => res(buttons[0][2] === true && buttons.length > 1 ? false : buttons[buttons.length - 1][2]),
    });
    setTimeout(() => { const bs = m.foot.querySelectorAll('button'); if (bs.length) bs[bs.length - 1].focus(); }, 30);
  });
  ui.info = (title, msg) => msgBox('info', title, msg, [['確  定', 'blue', true]]);
  ui.warn = (title, msg) => msgBox('warn', title, msg, [['確  定', 'blue', true]]);
  ui.error = (title, msg) => msgBox('error', title, msg, [['確  定', 'blue', true]]);
  ui.ask = (title, msg) => new Promise((res) => {
    let done = false;
    const m = ui.modal({
      title, accent: 'var(--warning)', width: 460, clickOut: false,
      body: h('div.msg', h('div.msg-ic', { style: { color: 'var(--warning)' } }, '?'), h('div.msg-t', String(msg))),
      buttons: [{ text: '否', kind: 'muted', onclick: () => { done = true; m.close(); res(false); } },
        { text: '是', kind: 'blue', onclick: () => { done = true; m.close(); res(true); } }],
      onClose: () => { if (!done) res(false); },
    });
    setTimeout(() => m.foot.querySelector('.btn.blue').focus(), 30);
  });

  /** 表單列：label + 元件 */
  ui.field = (label, el, cls = '') => h('label.fld' + (cls ? '.' + cls : ''), h('span.fld-l', label), el);

  /** Enter 依序跳下一欄；最後一欄 Enter 呼叫 done() */
  ui.enterChain = (els, done) => {
    els.forEach((el, i) => el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
      if (el._comboOpen && el._comboOpen()) return;
      e.preventDefault();
      const nx = els[i + 1];
      if (nx) { nx.focus(); if (nx.select) nx.select(); } else done();
    }));
  };

  // ════════════════════════════════════════════════════════════ 月曆選日期（民國年、農曆小字、今天）
  let calCur = null;
  ui.closeCal = () => { if (calCur) { calCur.remove(); calCur = null; } };
  ui.calendar = (input, afterPick, anchor) => {
    ui.closeCal();
    let sel = D.parse(input.value) || D.today();
    let y = D.y(sel), mo = D.m(sel);
    const pop = h('div.cal-pop');
    const draw = () => {
      ui.clear(pop);
      const nav = h('div.cal-nav',
        h('button.cal-arrow', { type: 'button', onclick: () => { mo--; if (mo < 1) { mo = 12; y--; } draw(); } }, '◀'),
        h('b', `民國 ${y - 1911} 年  ${mo} 月`),
        h('button.cal-arrow', { type: 'button', onclick: () => { mo++; if (mo > 12) { mo = 1; y++; } draw(); } }, '▶'));
      pop.appendChild(nav);
      const dow = h('div.cal-dow');
      '日一二三四五六'.split('').forEach((c, i) => dow.appendChild(h('span' + (i === 0 ? '.sun' : i === 6 ? '.sat' : ''), c)));
      pop.appendChild(dow);
      const grid = h('div.cal-grid');
      const first = D.make(y, mo, 1);
      const lead = first.getUTCDay();            // 週日開頭
      for (let i = 0; i < lead; i++) grid.appendChild(h('span.cal-blank'));
      const today = D.today();
      for (let day = 1; day <= D.daysInMonth(y, mo); day++) {
        const d = D.make(y, mo, day);
        const lu = M.lunarDate(d);
        const luTxt = lu ? (lu[2] === 1 ? M.lunarMonthName(lu[1], lu[3]) : M.lunarDayName(lu[2])) : '';
        const c = d.getUTCDay();
        let cls = '';
        if (d.getTime() === sel.getTime()) cls = '.sel';
        else if (d.getTime() === today.getTime()) cls = '.today';
        else if (lu && M.BAIBAI_DAYS.includes(lu[2])) cls = '.bb';
        else if (c === 0) cls = '.sun';
        else if (c === 6) cls = '.sat';
        grid.appendChild(h('button.cal-day' + cls, { type: 'button', onclick: () => pick(d) }, h('b', day), h('small', luTxt)));
      }
      pop.appendChild(grid);
      pop.appendChild(h('button.cal-today', { type: 'button', onclick: () => pick(D.today()) }, '今天'));
    };
    const pick = (d) => {
      input.value = D.iso(d);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      ui.closeCal();
      if (afterPick) afterPick(d);
    };
    draw();
    document.body.appendChild(pop);
    const r = (anchor || input).getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - pw - 8), top = r.bottom + 2;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 2);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = top + 'px';
    calCur = pop;
    pop.addEventListener('mousedown', (e) => e.preventDefault());
  };
  document.addEventListener('mousedown', (e) => {
    if (calCur && !calCur.contains(e.target) && !(e.target.closest && e.target.closest('.date-wrap'))) ui.closeCal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && calCur) { e.stopPropagation(); ui.closeCal(); } }, true);

  /** 日期輸入框 + 📅 鈕：點輸入框或按鈕都會開月曆 */
  ui.dateInput = (value, afterPick) => {
    const inp = ui.input(value || D.iso(D.today()), { inputmode: 'numeric', class: 'date-in' });
    const b = h('button.btn.muted.cal-btn', { type: 'button', title: '選擇日期', tabindex: -1 }, '📅');
    const wrap = h('div.date-wrap', inp, b);
    const open = () => ui.calendar(inp, afterPick, wrap);
    b.addEventListener('click', open);
    inp.addEventListener('click', () => { if (!calCur) open(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') ui.closeCal(); else if (calCur && e.key.length === 1) ui.closeCal(); });
    wrap.input = inp;
    return wrap;
  };

  // ════════════════════════════════════════════════════════════ 可搜尋的下拉（同電腦版 _searchable_combo）
  let comboCur = null;
  const closeCombo = () => { if (comboCur) { comboCur.pop.remove(); comboCur.input._comboShown = false; comboCur = null; } };
  ui.closeCombo = closeCombo;
  /**
   * input 加上下拉：打字列出「包含」文字的項目（開頭相符的排前面），↑↓ 選、Enter / 點一下帶入，Esc 收起；
   * ▾ 按鈕顯示完整清單。onPick(value) 相當於 <<ComboboxSelected>>。
   */
  ui.combo = (input, valuesFn, onPick, opts = {}) => {
    const arrow = h('button.combo-arrow', { type: 'button', tabindex: -1, title: '展開清單' }, '▾');
    const wrap = h('div.combo-wrap');
    input.parentNode ? input.parentNode.replaceChild(wrap, input) : null;
    wrap.appendChild(input); wrap.appendChild(arrow);
    const show = (items, all) => {
      closeCombo();
      if (!items.length) return;
      const pop = h('div.combo-pop');
      items.slice(0, 300).forEach((v, i) => pop.appendChild(h('div.combo-it' + (i === 0 && !all ? '.on' : ''), { 'data-v': v }, v)));
      pop.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const it = e.target.closest('.combo-it');
        if (it) pick(it.dataset.v);
      });
      document.body.appendChild(pop);
      const r = wrap.getBoundingClientRect();
      pop.style.minWidth = Math.max(r.width, 200) + 'px';
      pop.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8) + 'px';
      const below = window.innerHeight - r.bottom;
      if (below < 220 && r.top > below) { pop.style.bottom = (window.innerHeight - r.top + 2) + 'px'; pop.style.maxHeight = Math.min(300, r.top - 10) + 'px'; }
      else { pop.style.top = r.bottom + 2 + 'px'; pop.style.maxHeight = Math.min(300, below - 10) + 'px'; }
      comboCur = { pop, input };
      input._comboShown = true;
      if (all) { const cur = pop.querySelector(`[data-v="${CSS.escape(input.value)}"]`); if (cur) { cur.classList.add('on'); cur.scrollIntoView({ block: 'nearest' }); } }
    };
    const pick = (v) => {
      closeCombo();
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      if (onPick) onPick(v);
    };
    const search = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { closeCombo(); return; }
      const vals = valuesFn();
      const pre = vals.filter((v) => v.toLowerCase().startsWith(q));
      const sub = vals.filter((v) => v.toLowerCase().includes(q) && !v.toLowerCase().startsWith(q));
      const items = [...pre, ...sub];
      if (!items.length || (items.length === 1 && items[0] === input.value.trim())) { closeCombo(); return; }
      show(items, false);
    };
    input._comboOpen = () => comboCur && comboCur.input === input;
    input.addEventListener('input', (e) => { if (e.isTrusted || e.inputType) search(); });
    input.addEventListener('keydown', (e) => {
      const open = comboCur && comboCur.input === input;
      if (e.key === 'ArrowDown' && !open && opts.arrowOpens !== false) { e.preventDefault(); show(valuesFn(), true); return; }
      if (!open) return;
      const its = [...comboCur.pop.querySelectorAll('.combo-it')];
      let i = its.findIndex((x) => x.classList.contains('on'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        i = Math.max(0, Math.min(its.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        its.forEach((x) => x.classList.remove('on'));
        its[i].classList.add('on'); its[i].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && !e.isComposing) {
        const on = its[i];
        if (on) { e.preventDefault(); e.stopImmediatePropagation(); pick(on.dataset.v); }
        else closeCombo();
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCombo(); }
      else if (e.key === 'Tab') closeCombo();
    });
    input.addEventListener('blur', () => setTimeout(() => { if (comboCur && comboCur.input === input && document.activeElement !== input) closeCombo(); }, 150));
    arrow.addEventListener('mousedown', (e) => e.preventDefault());
    arrow.addEventListener('click', () => {
      if (comboCur && comboCur.input === input) { closeCombo(); return; }
      input.focus();
      show(valuesFn(), true);
    });
    return wrap;
  };
  /** 一般下拉（單選、不可打字）：用原生 select */
  ui.select = (values, value, onchange, extra = {}) => {
    const s = h('select', Object.assign({ onchange: () => onchange && onchange(s.value) }, extra));
    for (const v of values) {
      const [val, txt] = Array.isArray(v) ? v : [v, v];
      s.appendChild(h('option', { value: val, selected: val === value }, txt));
    }
    return s;
  };

  // ════════════════════════════════════════════════════════════ 畫布：依容器大小與螢幕解析度調整
  ui.canvas = (cv) => {
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), hgt = Math.max(1, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    return { ctx, w, h: hgt };
  };
  ui.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  /** 平滑曲線（類似 Tk 的 smooth=True） */
  ui.smoothPath = (ctx, pts) => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2, yc = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
    }
    const n = pts.length;
    ctx.quadraticCurveTo(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1]);
  };

  /** 浮動小視窗（趨勢圖點日期的明細） */
  ui.popover = (x, y, content, color) => {
    ui.closePopover();
    const p = h('div.popover', h('div.pop-accent', { style: { background: color } }), content);
    document.body.appendChild(p);
    const w = p.offsetWidth, hh = p.offsetHeight;
    p.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - w - 8)) + 'px';
    p.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - hh - 8)) + 'px';
    ui._pop = p;
    setTimeout(() => document.addEventListener('mousedown', ui._popOut = (e) => { if (!p.contains(e.target)) ui.closePopover(); }), 0);
    return p;
  };
  ui.closePopover = () => {
    if (ui._pop) { ui._pop.remove(); ui._pop = null; }
    if (ui._popOut) { document.removeEventListener('mousedown', ui._popOut); ui._popOut = null; }
  };

  /** 進度條小視窗 */
  ui.progress = (title, detail) => {
    const det = h('div.prog-detail', detail || '');
    const bar = h('div.prog-bar', h('i'));
    const m = ui.modal({ title, accent: 'var(--accent)', width: 380, body: h('div', det, bar), esc: false, clickOut: false });
    bar.classList.add('indet');
    return {
      set(done, total, text) {
        if (total) { bar.classList.remove('indet'); bar.firstChild.style.width = (done / total * 100).toFixed(1) + '%'; }
        if (text != null) det.textContent = text;
      },
      close: () => m.close(),
    };
  };
})();
