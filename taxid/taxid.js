/* 統一編號工具：檢查碼驗證、輸入整理、線上查詢結果轉換（可在 node 直接 require 測試） */
(function (root) {
  'use strict';
  const W = [1, 2, 1, 2, 1, 2, 4, 1];

  /** 全形數字 → 半形，只留數字 */
  function clean(s) {
    return String(s == null ? '' : s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, '');
  }

  /** 財政部檢查碼規則（112 年起改為可被 5 整除，舊號碼可被 10 整除也一定符合） */
  function valid(no) {
    no = String(no || '');
    if (!/^\d{8}$/.test(no)) return false;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const p = +no[i] * W[i];
      sum += Math.floor(p / 10) + (p % 10);
    }
    if (sum % 5 === 0) return true;
    return no[6] === '7' && (sum + 1) % 5 === 0;
  }

  /** 回傳 { ok, msg } 給畫面顯示 */
  function status(raw) {
    const no = clean(raw);
    if (!no) return { ok: false, empty: true, msg: '' };
    if (no.length < 8) return { ok: false, msg: `還差 ${8 - no.length} 碼` };
    if (no.length > 8) return { ok: false, msg: '統編只有 8 碼' };
    return valid(no) ? { ok: true, msg: '檢查碼正確' } : { ok: false, msg: '檢查碼不符，請再確認' };
  }

  const str = (v) => (Array.isArray(v) ? v[0] : v) == null ? '' : String(Array.isArray(v) ? v[0] : v).replace(/\s+/g, ' ').trim();

  /** company.g0v.ronny.tw 的一筆資料 → 本系統欄位 */
  function fromG0v(d, no) {
    if (!d || typeof d !== 'object') return null;
    const f = d['財政部'] && typeof d['財政部'] === 'object' ? d['財政部'] : {};
    const name = str(d['公司名稱']) || str(d['商業名稱']) || str(d['名稱']) || str(f['營業人名稱']);
    if (!name) return null;
    return {
      no: clean(d['統一編號'] || no),
      name,
      boss: str(d['代表人姓名']) || str(d['負責人姓名']) || (str(f['負責人姓氏']) ? str(f['負責人姓氏']) + '○○' : ''),
      addr: str(d['公司所在地']) || str(d['地址']) || str(f['營業地址']),
      status: str(d['登記現況']) || str(d['公司狀況']) || str(d['現況']) || (f['營業人名稱'] ? '營業中（財政部）' : ''),
      kind: d['公司名稱'] ? '公司' : d['商業名稱'] ? '商號' : '營業人',
    };
  }

  /** 經濟部商工登記 API（data.gcis.nat.gov.tw）的一筆資料 → 本系統欄位 */
  function fromGcis(d) {
    if (!d || !d.Company_Name) return null;
    return {
      no: clean(d.Business_Accounting_NO),
      name: str(d.Company_Name),
      boss: str(d.Responsible_Name),
      addr: str(d.Company_Location),
      status: str(d.Company_Status_Desc),
      kind: '公司',
    };
  }

  /** 狀態是否需要提醒（歇業、解散、撤銷…） */
  function badStatus(s) {
    s = String(s || '');
    return !!s && !/核准設立|營業中|核准登記|設立/.test(s.replace(/撤銷設立|廢止設立/g, ''));
  }

  /* ---------- 重複／相似資料 ---------- */
  const SUFFIX = /(股份有限公司|有限公司|無限公司|兩合公司|分公司|公司|企業社|工作室|商行|商號|實業社|事務所)/g;
  /** 名稱比對用：去掉公司型態、括號內容、標點空白，臺→台，全形英數→半形，英文小寫 */
  function normName(s) {
    return String(s || '').replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/臺/g, '台')
      .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(SUFFIX, '').replace(/[\s\-_.,，、。·・'"「」]/g, '').toLowerCase();
  }
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const normAddr = (s) => String(s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/臺/g, '台').replace(/[\s,，、()（）]/g, '');
  /** short 的字依序出現在 long 裡（簡稱：台積電 ⊂ 台灣積體電路製造），且第一個字相同 */
  function isAbbr(short, long) {
    if (short.length < 3 || short.length >= long.length || short[0] !== long[0]) return false;
    let i = 0;
    for (const ch of long) if (ch === short[i]) i++;
    return i === short.length;
  }
  /** 兩個統編只差一碼或相鄰兩碼對調（常見打錯） */
  function noTypo(a, b) {
    if (a.length !== 8 || b.length !== 8 || a === b) return false;
    const d = [];
    for (let i = 0; i < 8; i++) if (a[i] !== b[i]) d.push(i);
    return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]);
  }
  /** 找出可能重複的兩兩組合 → [{ a, b, why: [...] }]（a、b 是傳入的物件） */
  function findDups(items, ignore) {
    const out = [], ig = new Set(ignore || []);
    const pre = items.map((it) => ({ it, n: normName(it.name), t: digits(it.tel), ad: normAddr(it.addr) }));
    for (let i = 0; i < pre.length; i++) {
      for (let j = i + 1; j < pre.length; j++) {
        const A = pre[i], B = pre[j], why = [];
        if (A.n.length >= 2 && A.n === B.n) why.push('名稱相同');
        else if (A.n && B.n) {
          const [s, l] = A.n.length <= B.n.length ? [A.n, B.n] : [B.n, A.n];
          if (s.length >= 3 && l.includes(s)) why.push('名稱相似');
          else if (isAbbr(s, l)) why.push('可能是簡稱');
        }
        if (noTypo(A.it.no, B.it.no) && (!valid(A.it.no) || !valid(B.it.no))) why.push('統編疑似打錯');
        if (A.t.length >= 8 && A.t === B.t) why.push('電話相同');
        if (A.ad.length >= 8 && A.ad === B.ad) why.push('地址相同');
        if (!why.length) continue;
        // 只有地址或電話相同（例如同棟大樓、總機）不算，除非名稱也有關係或統編疑似打錯
        if (why.every((w) => w === '電話相同' || w === '地址相同') && why.length < 2) continue;
        const key = [A.it.no, B.it.no].sort().join('|');
        if (ig.has(key)) continue;
        out.push({ a: A.it, b: B.it, why, key });
      }
    }
    return out;
  }

  const api = { clean, valid, status, fromG0v, fromGcis, badStatus, normName, findDups, noTypo, isAbbr };
  root.TaxId = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
