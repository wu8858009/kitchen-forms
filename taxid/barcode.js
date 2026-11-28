/* Code 128 條碼（SVG），收銀機／掃描槍預設都能讀。全數字且偶數位用 Code C（較短），其他用 Code B。
 * Barcode.svg('22099131', { h: 80, module: 2 }) → SVG 字串；Barcode.modules(text) → 黑白寬度陣列（測試用） */
(function (root) {
  'use strict';
  const P = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 '
    + '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 '
    + '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 '
    + '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 '
    + '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 '
    + '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 '
    + '311141 411131 211412 211214 211232 2331112').split(' ');

  function codes(text) {
    text = String(text);
    let vals;
    if (/^(\d\d)+$/.test(text)) {
      vals = [105];
      for (let i = 0; i < text.length; i += 2) vals.push(+text.slice(i, i + 2));
    } else {
      vals = [104];
      for (const ch of text) {
        const c = ch.charCodeAt(0);
        if (c < 32 || c > 126) throw new Error('條碼不支援的字元：' + ch);
        vals.push(c - 32);
      }
    }
    let sum = vals[0];
    for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
    vals.push(sum % 103, 106);
    return vals;
  }

  /** 每個元素的寬度（黑、白交替，從黑開始） */
  function modules(text) {
    return codes(text).flatMap((v) => P[v].split('').map(Number));
  }

  function svg(text, o = {}) {
    const m = o.module || 2, h = o.h || 80, quiet = 10 * m;
    let x = quiet, rects = '';
    modules(text).forEach((w, i) => {
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w * m}" height="${h}"/>`;
      x += w * m;
    });
    const W = x + quiet;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" shape-rendering="crispEdges" role="img" aria-label="條碼 ${text}"><rect width="${W}" height="${h}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  }

  const api = { svg, modules, codes };
  root.Barcode = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
