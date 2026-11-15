/* 班表照片辨識（網頁版）：流程同電腦版 _ocr_schedule
 *   找表格線 → 找員工列 → 每格多組參數投票辨識時間 → 姓名 / 職稱（記憶庫字樣比對，不行再文字辨識）→ 由表頭日期推算週別
 *   文字辨識用 tesseract.js（第一次使用時從網路下載，之後瀏覽器會快取） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, D = M.D, h = ui.h;
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const VARIANTS = [[6, 200, 7], [5, 190, 7], [7, 190, 7], [6, 180, 7], [6, 200, 13], [4, 180, 13], [8, 190, 13], [10, 200, 13], [4, 220, 13], [10, 220, 13], [12, 200, 13], [10, 200, 7]];
  const TEXT_VARIANTS = [[4, 170, 7], [3, 170, 7], [6, 170, 7], [4, 150, 7], [4, 190, 7], [4, 170, 13]];
  const ROLE_FULL = ['副店長', '店長'];
  const ROLE_SUFFIX = ['組長', '服務員', '廚師', '吧檯', '外場', '內場', 'O', 'S/O', 'R'];

  // ════════════════════════════════════════════════════════════ difflib（SequenceMatcher.ratio / get_close_matches）
  const ratio = (a, b) => {
    a = [...a]; b = [...b];
    const T = a.length + b.length;
    if (!T) return 1;
    const match = (alo, ahi, blo, bhi) => {
      let besti = alo, bestj = blo, bestk = 0;
      let j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const nj = new Map();
        for (let j = blo; j < bhi; j++) {
          if (a[i] !== b[j]) continue;
          const k = (j2len.get(j - 1) || 0) + 1;
          nj.set(j, k);
          if (k > bestk) { besti = i - k + 1; bestj = j - k + 1; bestk = k; }
        }
        j2len = nj;
      }
      if (!bestk) return 0;
      return bestk + match(alo, besti, blo, bestj) + match(besti + bestk, ahi, bestj + bestk, bhi);
    };
    return 2 * match(0, a.length, 0, b.length) / T;
  };
  M.seqRatio = ratio;
  const closeMatch = (w, poss, cutoff) => {
    let best = null, bs = -1;
    for (const p of poss) { const r = ratio(w, p); if (r >= cutoff && r > bs) { best = p; bs = r; } }
    return best;
  };
  /** 職稱修正（例如「幕職-廚師」→「兼職-廚師」） */
  const fixRole = (text) => {
    const t = String(text || '').replace(/\|/g, '').replace(/ /g, '').trim();
    if (!t) return '';
    const chars = [...t];
    const sep = chars.findIndex((ch) => '-~－—'.includes(ch));
    let pre, suf;
    if (sep >= 0) { pre = chars.slice(0, sep).join(''); suf = chars.slice(sep + 1).join(''); }
    else if (t.includes('職')) { const k = chars.indexOf('職') + 1; pre = chars.slice(0, k).join(''); suf = chars.slice(k).join(''); }
    else { return closeMatch(t, ROLE_FULL, 0.5) || t; }
    const prefix = pre.slice(0, 1) === '正' ? '正職' : '兼職';
    suf = suf.replace(/0/g, 'O');
    if (['o', 'r', 's/o'].includes(suf.toLowerCase())) return `${prefix}-${suf.toLowerCase() === 's/o' ? 'S/O' : suf.toUpperCase()}`;
    const m = closeMatch(suf, ROLE_SUFFIX, 0.4);
    return m ? `${prefix}-${m}` : `${prefix}-${suf}`;
  };

  // ════════════════════════════════════════════════════════════ 影像工具（灰階陣列 {w, h, d: Uint8ClampedArray}）
  const mkCanvas = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, hh); return c; };
  const grayToCanvas = (g) => {
    const c = mkCanvas(g.w, g.h), ctx = c.getContext('2d'), im = ctx.createImageData(g.w, g.h);
    for (let i = 0; i < g.d.length; i++) { const v = g.d[i]; im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    return c;
  };
  const canvasToGray = (c) => {
    const im = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const d = new Uint8ClampedArray(c.width * c.height);
    for (let i = 0; i < d.length; i++) d[i] = im.data[i * 4 + 1];
    return { w: c.width, h: c.height, d };
  };
  /** Lanczos 縮放（同 PIL 的 Image.LANCZOS；瀏覽器內建縮放會把細表格線糊掉） */
  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const lanczos = (x) => (x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);
  const coeffs = (inLen, outLen) => {
    const scale = inLen / outLen, fs = Math.max(scale, 1), support = 3 * fs, out = [];
    for (let xx = 0; xx < outLen; xx++) {
      const center = (xx + 0.5) * scale;
      const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
      const xmax = Math.min(Math.trunc(center + support + 0.5), inLen);
      const ws = []; let ss = 0;
      for (let x = xmin; x < xmax; x++) { const w = lanczos((x - center + 0.5) / fs); ws.push(w); ss += w; }
      out.push([xmin, ws.map((w) => (ss ? w / ss : 0))]);
    }
    return out;
  };
  const resample = (src, w, hh, nw, nh) => {
    const tmp = new Float32Array(nw * hh), out = new Uint8ClampedArray(nw * nh);
    const cx = coeffs(w, nw), cy = coeffs(hh, nh);
    for (let y = 0; y < hh; y++) {
      const row = y * w;
      for (let x = 0; x < nw; x++) { const [x0, ws] = cx[x]; let v = 0; for (let k = 0; k < ws.length; k++) v += src[row + x0 + k] * ws[k]; tmp[y * nw + x] = v; }
    }
    for (let y = 0; y < nh; y++) {
      const [y0, ws] = cy[y];
      for (let x = 0; x < nw; x++) { let v = 0; for (let k = 0; k < ws.length; k++) v += tmp[(y0 + k) * nw + x] * ws[k]; out[y * nw + x] = Math.round(v); }
    }
    return out;
  };
  const resizeGray = (g, w, hh) => ({ w, h: hh, d: resample(g.d, g.w, g.h, w, hh) });
  const crop = (g, x0, y0, x1, y1) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(g.w, x1); y1 = Math.min(g.h, y1);
    const w = Math.max(0, x1 - x0), hh = Math.max(0, y1 - y0), d = new Uint8ClampedArray(w * hh);
    for (let y = 0; y < hh; y++) d.set(g.d.subarray((y0 + y) * g.w + x0, (y0 + y) * g.w + x0 + w), y * w);
    return { w, h: hh, d };
  };
  /** 黑字最小外框（< 150）；沒字 → null */
  const inkSeg = (g) => {
    let y0 = -1, y1 = -1, x0 = g.w, x1 = -1;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.d[y * g.w + x] < 150) {
      if (y0 < 0) y0 = y; y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x;
    }
    return y0 < 0 ? null : crop(g, x0, y0, x1 + 1, y1 + 1);
  };
  /** 放大 → 二值化 → 四周補 30px 白邊（給 tesseract） */
  const prepOcr = (g, scale, thr) => {
    const big = resizeGray(g, g.w * scale, g.h * scale);
    const c = mkCanvas(big.w + 60, big.h + 60), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const im = ctx.createImageData(big.w, big.h);
    for (let i = 0; i < big.d.length; i++) { const v = big.d[i] < thr ? 0 : 255; im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 30, 30);
    return c;
  };
  // 字樣（姓名 / 職稱）記憶庫：固定高度 32 → 高斯模糊 → 置左補白到 160 → 零均值單位向量
  const segNorm = (seg, H = 32) => resizeGray(seg, Math.max(1, Math.round(seg.w * H / seg.h)), H);
  const blur = (g, sigma = 1.5) => {
    const r = Math.ceil(sigma * 3), k = [];
    let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float32Array(g.w * g.h), out = new Float32Array(g.w * g.h);
    const at = (arr, x, y) => arr[Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x))];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * at(g.d, x + i, y); tmp[y * g.w + x] = v; }
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * at(tmp, x, y + i); out[y * g.w + x] = v; }
    return out;
  };
  const segFeat = (seg, H = 32, W = 160) => {
    const n = seg.h === H ? seg : segNorm(seg, H);
    const b = blur(n);
    const f = new Float32Array(H * W).fill(255);
    const w = Math.min(W, n.w);
    for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) f[y * W + x] = b[y * n.w + x];
    let mean = 0;
    for (let i = 0; i < f.length; i++) { f[i] = 255 - f[i]; mean += f[i]; }
    mean /= f.length;
    let norm = 0;
    for (let i = 0; i < f.length; i++) { f[i] -= mean; norm += f[i] * f[i]; }
    norm = Math.sqrt(norm);
    if (norm) for (let i = 0; i < f.length; i++) f[i] /= norm;
    return f;
  };
  const segPack = (seg) => grayToCanvas(segNorm(seg)).toDataURL('image/png').split(',')[1];
  const segUnpack = (b64) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { const c = mkCanvas(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0); res(canvasToGray(c)); };
    im.onerror = () => res(null);
    im.src = 'data:image/png;base64,' + b64;
  });

  // ════════════════════════════════════════════════════════════ tesseract.js（工作者池）
  let tessP = null;
  const loadTess = () => tessP || (tessP = new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement('script');
    s.src = TESS_URL; s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('無法下載文字辨識元件（需要網路）')); };
    document.head.appendChild(s);
  }));
  const pools = {};
  const makePool = async (lang, n) => {
    const T = await loadTess();
    const workers = await Promise.all(Array.from({ length: n }, () => T.createWorker(lang, 1)));
    const free = [...workers], queue = [];
    const run = (fn) => new Promise((res, rej) => { queue.push([fn, res, rej]); pump(); });
    const pump = () => {
      while (free.length && queue.length) {
        const w = free.pop(), [fn, res, rej] = queue.shift();
        fn(w).then(res, rej).finally(() => { free.push(w); pump(); });
      }
    };
    return { run, end: () => Promise.all(workers.map((w) => w.terminate())) };
  };
  const pool = (lang, n) => pools[lang] || (pools[lang] = makePool(lang, n).catch((e) => { delete pools[lang]; throw e; }));
  const ocr = async (lang, canvas, psm, whitelist) => {
    const p = await pool(lang, lang === 'eng' ? 3 : 2);
    return p.run(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: whitelist || '' });
      const r = await w.recognize(canvas);
      return String(r.data.text || '').trim();
    });
  };

  // ════════════════════════════════════════════════════════════ 主流程
  const ocrSchedule = async (img, progress, libs) => {
    let w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height;
    if (w < 300 || hh < 200) throw new Error('圖片太小，請使用清楚的班表截圖。');
    // 統一縮放到約 950px 寬（辨識參數依此調校）；超大的手機照片先用瀏覽器縮到 2 倍左右，再用 Lanczos
    let sw = w, sh = hh;
    let src = mkCanvas(sw, sh);
    { const x = src.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, sw, sh); x.drawImage(img, 0, 0); }
    if (Math.abs(w - 950) > 30) { hh = Math.max(1, Math.round(hh * 950 / w)); w = 950; }
    while (sw > w * 2.5) {
      const t = mkCanvas(Math.round(sw / 2), Math.round(sh / 2)); const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(src, 0, 0, t.width, t.height);
      src = t; sw = t.width; sh = t.height;
    }
    const raw = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    const px = new Uint8ClampedArray(w * hh * 4);
    for (let ch = 0; ch < 3; ch++) {
      const plane = new Uint8ClampedArray(sw * sh);
      for (let i = 0; i < plane.length; i++) plane[i] = raw[i * 4 + ch];
      const r = (sw === w && sh === hh) ? plane : resample(plane, sw, sh, w, hh);
      for (let i = 0; i < r.length; i++) px[i * 4 + ch] = r[i];
    }
    const R = (x, y) => px[(y * w + x) * 4], G = (x, y) => px[(y * w + x) * 4 + 1], B = (x, y) => px[(y * w + x) * 4 + 2];
    const green = { w, h: hh, d: new Uint8ClampedArray(w * hh) };
    for (let i = 0; i < w * hh; i++) green.d[i] = px[i * 4 + 1];
    const peaks = (f, thr) => {
      const out = [];
      f.forEach((v, i) => { if (v > thr) { if (out.length && i - out[out.length - 1][1] <= 2) out[out.length - 1][1] = i; else out.push([i, i]); } });
      return out.map(([s, e]) => Math.floor((s + e) / 2));
    };
    // 表格線：深色且低飽和（排除紅字 / 黃底）
    const colF = new Float32Array(w), rowF = new Float32Array(hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const r = R(x, y), g = G(x, y), b = B(x, y);
      if ((r + g + b) / 3 < 190 && Math.max(r, g, b) - Math.min(r, g, b) < 70) { colF[x]++; rowF[y]++; }
    }
    const V = peaks([...colF].map((v) => v / hh), 0.3);
    let Hs = peaks([...rowF].map((v) => v / w), 0.3);
    if (V.length < 8 || Hs.length < 4) throw new Error('看不出班表的表格線，請確認照片是正面、清楚的班表截圖。');
    const diffs = Hs.slice(1).map((v, i) => v - Hs[i]).sort((a, b) => a - b);
    const med = diffs.length % 2 ? diffs[(diffs.length - 1) / 2] : (diffs[diffs.length / 2 - 1] + diffs[diffs.length / 2]) / 2;
    const fixed = [Hs[0]];
    for (let i = 0; i < Hs.length - 1; i++) {
      const y0 = Hs[i], y1 = Hs[i + 1], k = Math.round((y1 - y0) / med);
      if (k >= 2 && Math.abs((y1 - y0) - k * med) < 0.25 * med) for (let j = 1; j < k; j++) fixed.push(Math.trunc(y0 + (y1 - y0) * j / k));
      fixed.push(y1);
    }
    Hs = fixed;
    const xs = V.slice(-8);
    const rows = Hs.slice(0, -1).map((y, i) => [y, Hs[i + 1]]);
    const box = (r, x0, x1) => [x0 + 3, rows[r][0] + 3, x1 - 2, rows[r][1] - 2];
    const cellBox = (r, i) => box(r, xs[i], xs[i + 1]);
    const kind = ([x0, y0, x1, y1]) => {
      const n = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      if (!n) return 'empty';
      let yel = 0, red = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const r = R(x, y), g = G(x, y), b = B(x, y);
        if (r > 200 && g > 200 && b < 140) yel++;
        if (r > 130 && g < 130 && b < 130 && r - g > 60) red++;
      }
      if (yel / n > 0.35) return 'off';
      return red >= 12 ? 'text' : 'empty';
    };
    const lineImages = (bx, scale, thr) => {
      const g = crop(green, ...bx);
      const rws = []; for (let y = 0; y < g.h; y++) { let any = false; for (let x = 0; x < g.w; x++) if (g.d[y * g.w + x] < 170) { any = true; break; } rws.push(any); }
      const bands = []; let s = null;
      rws.forEach((v, i) => { if (v && s === null) s = i; if (!v && s !== null) { bands.push([s, i]); s = null; } });
      if (s !== null) bands.push([s, rws.length]);
      if (!bands.length) return [];
      const merged = [bands[0]];
      for (const b of bands.slice(1)) { if (b[0] - merged[merged.length - 1][1] <= 2) merged[merged.length - 1][1] = b[1]; else merged.push(b); }
      return merged.map(([y0, y1]) => {
        const seg = crop(g, 0, Math.max(0, y0 - 2), g.w, y1 + 2);
        let xa = -1, xb = -1;
        for (let x = 0; x < seg.w; x++) for (let y = 0; y < seg.h; y++) if (seg.d[y * seg.w + x] < 170) { if (xa < 0) xa = x; xb = x; break; }
        return prepOcr(crop(seg, Math.max(0, xa - 2), 0, xb + 3, seg.h), scale, thr);
      });
    };
    const RANGE = /(\d{1,2}(?:\.\d+)?)\s*-\s*(\d{1,2}(?:\.\d+)?)/g;
    const half = (x) => { const v = Number(x); return Math.trunc(v) + (v % 1 ? 0.5 : 0); };
    const plausible = (s, e) => s >= 6 && s <= 23.5 && s < e && e <= 30 && e - s >= 2 && e - s <= 16;
    const fmt = (v) => String(v);
    const votesForLine = async (bx, idx, variants = VARIANTS) => {
      const votes = new Map(), first = new Map();
      for (const [scale, thr, psm] of variants) {
        const ims = lineImages(bx, scale, thr);
        if (idx >= ims.length) break;
        const t = await ocr('eng', ims[idx], psm, '0123456789.-');
        for (const m of t.matchAll(RANGE)) {
          let s = half(m[1]); const e = half(m[2]);
          if (s === 1 && e > 6 && e <= 30) s = 11;
          if (plausible(s, e)) { const k = `${fmt(s)}-${fmt(e)}`; votes.set(k, (votes.get(k) || 0) + 1); if (!first.has(k)) first.set(k, first.size); break; }
        }
        const top = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
        if (top.length && top[0][1] >= 2 && (top.length === 1 || top[0][1] > top[1][1])) break;
      }
      if (!votes.size) return null;
      return [...votes.keys()].sort((a, b) => (votes.get(b) - votes.get(a)) || (first.get(a) - first.get(b)))[0];
    };
    const readTime = async (bx, quick = false) => (quick ? votesForLine(bx, 0, VARIANTS.slice(0, 2)) : (await votesForLine(bx, 0)) || votesForLine(bx, 1));
    const readNumber = async (bx) => {
      const seg = inkSeg(crop(green, ...bx));
      if (!seg) return null;
      const t = await ocr('eng', prepOcr(seg, 5, 150), 7, '0123456789');
      return /^\d+$/.test(t) && +t >= 1 && +t <= 31 ? +t : null;
    };
    // 1. 員工列
    const kinds = rows.map((_, r) => [0, 1, 2, 3, 4, 5, 6].map((i) => kind(cellBox(r, i))));
    const firstOff = kinds.findIndex((ks) => ks.includes('off'));
    let start = null;
    for (let r = 0; r < kinds.length; r++) {
      if (firstOff >= 0 && r >= firstOff) break;
      const ks = kinds[r];
      if (!ks.includes('text')) continue;
      let hit = false;
      for (let i = 0; i < 7 && !hit; i++) if (ks[i] === 'text' && (await readTime(cellBox(r, i), true))) hit = true;
      if (hit) { start = r; break; }
    }
    if (start === null && firstOff >= 0) start = firstOff;
    if (start === null) throw new Error('照片裡沒有讀到任何上班時間，請確認是班表截圖。');
    let last = start;
    kinds.forEach((ks, r) => { if (r >= start && ks.some((k) => k !== 'empty')) last = r; });
    const staffRows = []; for (let r = start; r <= last; r++) staffRows.push(r);
    // 2. 姓名 / 職稱：先比對記憶庫
    const nameCol = V.length >= 9 ? [V[V.length - 9], V[V.length - 8]] : null;
    const roleCol = V.length >= 10 ? [V[V.length - 10], V[V.length - 9]] : null;
    const buildLib = async (lib) => {
      const out = [];
      for (const [nm, imgs] of Object.entries(lib || {})) for (const b of imgs) { const g = await segUnpack(b); if (g) out.push([nm, segFeat(g)]); }
      return out;
    };
    const nameLib = await buildLib(libs.names), roleLib = await buildLib(libs.roles);
    const libMatch = (seg, lib) => {
      if (!seg || !lib.length) return null;
      const f = segFeat(seg), per = new Map();
      for (const [nm, g] of lib) { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * g[i]; per.set(nm, Math.max(per.has(nm) ? per.get(nm) : -1, s)); }
      const ranked = [...per.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length && ranked[0][1] >= 0.85 && (ranked.length === 1 || ranked[0][1] - ranked[1][1] >= 0.08)) return ranked[0][0];
      return null;
    };
    const n = staffRows.length;
    const nameSegs = Array(n).fill(null), roleSegs = Array(n).fill(null), nameHit = Array(n).fill(null), roleHit = Array(n).fill(null);
    staffRows.forEach((r, k) => {
      if (nameCol) { nameSegs[k] = inkSeg(crop(green, ...box(r, nameCol[0], nameCol[1]))); nameHit[k] = libMatch(nameSegs[k], nameLib); }
      if (roleCol) { roleSegs[k] = inkSeg(crop(green, ...box(r, roleCol[0], roleCol[1]))); roleHit[k] = libMatch(roleSegs[k], roleLib); }
    });
    // 3. 逐格辨識
    let chi = true;
    try { await pool('chi_tra', 2); } catch (e) { chi = false; }
    const jobs = [];
    for (const r of staffRows) for (let i = 0; i < 7; i++) if (kinds[r][i] === 'text') jobs.push([r, i]);
    const textJobs = [];
    if (chi && nameCol) staffRows.forEach((r, k) => {
      if (nameHit[k] === null) textJobs.push(['name', r, nameCol, 6]);
      if (roleCol && roleHit[k] === null) textJobs.push(['role', r, roleCol, 3]);
    });
    const total = jobs.length + textJobs.length;
    let done = 0;
    const tick = () => { done++; if (progress) progress(done, total); };
    if (progress) progress(0, total);
    const read = new Map(), texts = new Map();
    const readText = async (bx, votesN) => {
      const seg = inkSeg(crop(green, ...bx));
      if (!seg) return '';
      const votes = new Map();
      for (const [scale, thr, psm] of TEXT_VARIANTS.slice(0, votesN)) {
        const t = (await ocr('chi_tra', prepOcr(seg, scale, thr), psm, '')).replace(/ /g, '');
        if (t) votes.set(t, (votes.get(t) || 0) + 1);
      }
      return votes.size ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0] : '';
    };
    await Promise.all([
      ...jobs.map(async ([r, i]) => { read.set(`${r},${i}`, await readTime(cellBox(r, i))); tick(); }),
      ...textJobs.map(async ([kd, r, [x0, x1], vn]) => { texts.set(`${kd},${r}`, await readText(box(r, x0, x1), vn)); tick(); }),
    ]);
    const haveNames = chi || nameHit.some(Boolean);
    const names = haveNames ? staffRows.map((r, k) => nameHit[k] || texts.get(`name,${r}`) || '') : null;
    const roles = haveNames ? staffRows.map((r, k) => roleHit[k] || fixRole(texts.get(`role,${r}`) || '')) : null;
    let unsure = 0;
    const out = staffRows.map((r) => [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const k = kinds[r][i];
      if (k === 'off') return '休';
      if (k === 'empty') return '';
      const v = read.get(`${r},${i}`);
      if (v) return v;
      unsure++; return '?';
    }));
    // 4. 由表頭日期推算哪一週
    let monday = null;
    for (let r = 0; r < Math.min(start, 3); r++) {
      const nums = [];
      for (let i = 0; i < 7; i++) nums.push(kinds[r][i] === 'empty' ? await readNumber(cellBox(r, i)) : null);
      if (nums.filter(Boolean).length < 3) continue;
      const today = D.today();
      const first = D.add(today, -(D.wd(today) + 7 * 20));
      let best = null, bestScore = 0;
      for (let k = 0; k < 45; k++) {
        const d = D.add(first, 7 * k);
        const score = nums.reduce((a, nn, i) => a + (nn && D.d(D.add(d, i)) === nn ? 1 : 0), 0);
        if (score > bestScore || (score === bestScore && score && best && Math.abs(D.diff(d, today)) < Math.abs(D.diff(best, today)))) { best = d; bestScore = score; }
      }
      if (bestScore >= 3) { monday = best; break; }
    }
    return { monday, rows: out, unsure, names, roles, name_hit: nameHit.map(Boolean), role_hit: roleHit.map(Boolean),
      name_imgs: nameSegs.map((s) => (s ? segPack(s) : '')), role_imgs: roleSegs.map((s) => (s ? segPack(s) : '')) };
  };

  // ════════════════════════════════════════════════════════════ 套用到班表（同電腦版 _sch_apply_photo）
  const mergePerson = (i, ocrName, ocrRole, roster, used, nRows) => {
    const cur = i < roster.length ? roster[i] : null;
    let pick = null, certain = false;
    if (ocrName) {
      if (cur && cur.name && ratio(ocrName, cur.name) >= 0.34) { pick = i; certain = true; }
      else {
        let best = [0, null];
        roster.forEach((p, j) => { if (!used.has(j) && p.name) { const s = ratio(ocrName, p.name); if (s > best[0]) best = [s, j]; } });
        if (best[0] >= 0.5) { pick = best[1]; certain = true; }
      }
    }
    if (pick === null && cur && cur.name && roster.length === nRows && !used.has(i)) pick = i;
    if (pick !== null) { used.add(pick); const p = roster[pick]; return [p.name || '', p.role || ocrRole, certain]; }
    return [ocrName, ocrRole, false];
  };
  const applyPhoto = async (res) => {
    const S = M.pages.schedule;
    if (res.monday && res.monday.getTime() !== S.monday().getTime()) S.setMonday(res.monday);
    const mon = S.monday();
    if (S.staff().some((p) => (p.cells || []).some(Boolean))) {
      if (!(await ui.ask('覆蓋班表', `${D.fmt(mon)} ～ ${D.md(D.add(mon, 6))} 已有班表，\n要用照片讀到的內容覆蓋嗎？`))) { ui.status('已取消：保留原班表'); return; }
    }
    const roster = S.staff(), used = new Set(), n = res.rows.length;
    const names = res.names || Array(n).fill(''), roles = res.roles || Array(n).fill('');
    const neu = res.rows.map((cells, i) => {
      let name, role, sureName, sureRole;
      if (res.name_hit[i]) {
        name = names[i]; role = roles[i]; sureName = true; sureRole = res.role_hit[i];
        roster.forEach((pp, j) => { if (pp.name === name) used.add(j); });
      } else {
        const [nm, rm, certain] = mergePerson(i, names[i], roles[i], roster, used, n);
        name = nm; role = res.role_hit[i] ? roles[i] : rm; sureName = certain; sureRole = res.role_hit[i] || certain;
      }
      return { role, name, cells, name_img: res.name_imgs[i], role_img: res.role_imgs[i], name_unsure: !!name && !sureName, role_unsure: !!role && !sureRole };
    });
    S.setStaff(neu);
    const meta = M.data.schedule_meta || {};
    const cut = Number(meta.cutoff ?? 17), bcut = Number(meta.b_cutoff ?? 11);
    const [, eat, bf] = M.schCountsOf(neu, cut, bcut);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const lines = [`已讀取 ${n} 位人員 × 7 天。`, `${M.num(bcut)} 點前上班早餐人數：${bf.join('、')}（共 ${sum(bf)} 人次）`, `${M.num(cut)} 點用餐人數：${eat.join('、')}（共 ${sum(eat)} 人次）`];
    if (res.unsure) lines.push(`\n有 ${res.unsure} 格讀不出來（標「?」），請自行填入時間。`);
    if (n !== roster.length) lines.push(`\n照片有 ${n} 人，原名單有 ${roster.length} 人。`);
    const hits = res.name_hit.filter(Boolean).length;
    if (hits) lines.push(`\n有 ${hits} 位姓名是憑「以前改對過的字樣」直接認出來的。`);
    if (res.names === null) lines.push('\n無法載入中文辨識資料，姓名 / 職稱沒有讀取，是依列的順序沿用原名單。');
    else if (hits < n) lines.push('\n其餘姓名 / 職稱是用文字辨識讀取的，可能有錯字，已用橘字標出。\n請核對並直接改對；改過、或確認無誤在欄位按 Enter，橘字就會消失，\n程式會記住確認過的字樣，之後同一個人就能直接認出來。');
    ui.status(`班表照片已讀取：${n} 人，早餐＋用餐共 ${sum(eat) + sum(bf)} 人次`);
    await ui.info('讀取完成', lines.join('\n'));
  };

  let busy = false;
  M.schImportFile = async (file) => {
    if (busy || !file) return;
    busy = true;
    let prog = null;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('無法開啟圖片')); i.src = url; });
      prog = ui.progress('📷 讀取班表照片', '正在載入文字辨識元件、偵測班表格線…（第一次使用需要下載約 20MB）');
      ui.status('正在讀取班表照片…');
      const res = await ocrSchedule(img, (d, t) => {
        if (t) prog.set(d, t, `辨識班表內容中…  ${d} / ${t} 格  (${Math.round(d / t * 100)}%)`);
        if (t) ui.status(`正在讀取班表照片… ${d}/${t}`);
      }, { names: M.data.name_lib || {}, roles: M.data.role_lib || {} });
      URL.revokeObjectURL(url);
      prog.close(); prog = null;
      M.showPage('schedule');
      await applyPhoto(res);
    } catch (e) {
      if (prog) prog.close();
      ui.status('班表照片讀取失敗');
      await ui.error('讀取失敗', e.message || String(e));
    } finally { busy = false; }
  };
  M.ocrInternals = { ratio, fixRole, segFeat, segPack, segUnpack, inkSeg, ocrSchedule };
})();
