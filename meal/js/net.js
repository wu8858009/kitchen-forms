/* 網路功能：食譜照片（存在 Google 雲端硬碟，各裝置快取）、愛料理查詢（雲端程式代查） */
(() => {
  'use strict';
  const M = window.M, ui = M.ui, h = ui.h;

  // ════════════════════════════════════════════════════════════ 照片
  const uuid = () => ([...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
  const readAsDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  /** 縮到長邊 1200px 的 JPEG（照片太大會讓雲端存取很慢） */
  const shrink = async (file) => {
    const url = await readAsDataURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  };
  const memo = new Map();
  const pendingKey = 'img_pending';
  /** 選好的照片：存到這台裝置，並上傳到雲端硬碟；回傳檔名（跟電腦版一樣用隨機檔名） */
  M.saveImage = async (file) => {
    let dataUrl;
    try { dataUrl = await shrink(file); } catch (e) { ui.error('照片', '無法讀取這張圖片。'); return ''; }
    const name = uuid() + '.jpg';
    memo.set(name, dataUrl);
    await M.idbPut('img:' + name, dataUrl);
    const pend = (await M.idbGet(pendingKey)) || [];
    pend.push(name);
    await M.idbPut(pendingKey, pend);
    M.uploadPendingImages();
    return name;
  };
  let uploading = false;
  M.uploadPendingImages = async () => {
    if (uploading || !M.cloud.enabled) return;
    uploading = true;
    try {
      let pend = (await M.idbGet(pendingKey)) || [];
      for (const name of [...pend]) {
        const d = await M.idbGet('img:' + name);
        if (d) await M.cloud.call({ action: 'img_put', name, b64: d.split(',')[1], mime: 'image/jpeg' }, 120000);
        pend = pend.filter((x) => x !== name);
        await M.idbPut(pendingKey, pend);
      }
    } catch (e) { /* 下次再傳 */ } finally { uploading = false; }
  };
  setInterval(() => M.uploadPendingImages(), 60000);
  const inflight = new Map();
  const fetchImg = async (name) => {
    if (memo.has(name)) return memo.get(name);
    const c = await M.idbGet('img:' + name);
    if (c) { memo.set(name, c); return c; }
    if (!M.cloud.enabled) return null;
    if (!inflight.has(name)) {
      inflight.set(name, M.cloud.call({ action: 'img_get', name }, 60000).then(async (r) => {
        const url = `data:${r.mime || 'image/jpeg'};base64,${r.b64}`;
        memo.set(name, url);
        await M.idbPut('img:' + name, url);
        return url;
      }).catch(() => null).finally(() => setTimeout(() => inflight.delete(name), 30000)));
    }
    return inflight.get(name);
  };
  /** 把照片放進 el（沒有照片 / 讀不到就保留原本的圖示文字） */
  M.loadImg = (name, el) => {
    if (!name) return;
    fetchImg(name).then((url) => {
      if (!url) return;
      ui.clear(el);
      el.appendChild(h('img', { src: url, alt: '' }));
    });
  };

  // ════════════════════════════════════════════════════════════ 愛料理（icook.tw）
  /** 「雞腿肉 2隻」→ {qty, unit, name}；開頭的「[主食材] 」去掉；拆不出數量的整段當品名 */
  const parseIngs = (raw) => {
    const out = [];
    for (let t of raw || []) {
      t = String(t).trim().replace(/^\[[^\]]*\]\s*/, '');
      if (!t) continue;
      const m = /^(.*?)\s*(\d+(?:\.\d+)?)\s*([^\d\s]*)$/.exec(t);
      if (m && m[1].trim()) out.push({ qty: Number(m[2]), unit: m[3].trim(), name: m[1].trim() });
      else out.push({ qty: null, unit: '', name: t });
    }
    return out;
  };
  const icook = async (name, full) => {
    if (!M.cloud.enabled) throw new Error('需要先連線雲端，才能查詢愛料理');
    const r = await M.cloud.call({ action: 'icook', name, full: !!full }, 120000);
    return r;
  };
  /** 菜單排程用：逗號分隔的食材名稱 */
  M.icookRecipe = async (name) => {
    const r = await icook(name, false);
    const items = parseIngs((r.recipe || {}).recipeIngredient).map((i) => i.name).filter(Boolean);
    if (!items.length) throw new Error('這篇食譜沒有食材清單');
    if (items.length === 1 && items[0].length <= 1) throw new Error(`食材清單看起來不完整（只解析到「${items[0]}」），可能是頁面格式不支援`);
    return { items: items.join(','), url: r.url };
  };
  /** 食譜庫用：配料（含數量）、步驟、封面與步驟照片（雲端程式已存進雲端硬碟）、份數 */
  M.icookFull = async (name) => {
    const r = await icook(name, true);
    const rec = r.recipe || {};
    const ings = parseIngs(rec.recipeIngredient).filter((i) => i.name);
    if (!ings.length || (ings.length === 1 && ings[0].name.length <= 1)) throw new Error('這篇食譜的食材清單看起來不完整，可能是頁面格式不支援');
    const imgs = r.images || {};
    const steps = [];
    for (const st of rec.recipeInstructions || []) {
      if (st && typeof st === 'object') {
        const text = String(st.text || '').trim();
        if (text) steps.push({ text, image: imgs[st.image] || '' });
      }
    }
    const cover = rec.image;
    const coverUrl = Array.isArray(cover) ? cover[0] || '' : typeof cover === 'string' ? cover : '';
    let servings = rec.recipeYield;
    servings = servings != null && servings !== '' && isFinite(Number(servings)) ? Number(servings) : null;
    return { ingredients: ings, steps, cover_image: imgs[coverUrl] || '', servings, source_url: r.url };
  };
})();
