/* 公里及油資紀錄系統 — 計算核心（網頁、桌面、node 測試共用）
 *   請領期間：上月(cut+1)日 ～ 本月 cut 日（預設 25 日結算 → 8/26～9/25 為「2025-09」期）
 *   補貼金額 = 里程數 × 每公里補助(預設 4 元) + 停車費 */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m 為 1～12

  /** 'YYYY-MM' 期 → { from, to }（YYYY-MM-DD，含頭尾） */
  function period(key, cut = 25) {
    const [y, m] = key.split('-').map(Number);
    cut = Math.max(1, Math.min(28, +cut || 25));
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const fromD = Math.min(cut + 1, lastDay(py, pm) + 1);
    const from = fromD > lastDay(py, pm) ? `${y}-${pad(m)}-01` : `${py}-${pad(pm)}-${pad(fromD)}`;
    return { from, to: `${y}-${pad(m)}-${pad(Math.min(cut, lastDay(y, m)))}` };
  }
  /** 某日期屬於哪一期 */
  function periodOf(date, cut = 25) {
    const d = parse(date);
    let y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() > (+cut || 25)) { m++; if (m > 12) { m = 1; y++; } }
    return `${y}-${pad(m)}`;
  }
  function shiftPeriod(key, n) {
    let [y, m] = key.split('-').map(Number);
    m += n;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return `${y}-${pad(m)}`;
  }
  const inPeriod = (date, p) => date >= p.from && date <= p.to;
  const periodLabel = (key, cut = 25) => {
    const p = period(key, cut), f = p.from.split('-'), t = p.to.split('-');
    return `${+f[1]}/${+f[2]}～${+t[1]}/${+t[2]}`;
  };

  /** 單趟里程：km 表以「起點id>終點id」存；只有反方向時用反方向 */
  function kmBetween(km, a, b) {
    if (!a || !b || a === b) return a && a === b ? 0 : null;
    const f = km[`${a}>${b}`], r = km[`${b}>${a}`];
    const v = f && f.v != null && f.v !== '' ? f.v : r && r.v != null && r.v !== '' ? r.v : null;
    return v == null ? null : +v;
  }
  /** 路線（地點 id 陣列，含起點與終點）→ 每一段 { from, to, km }，km 為 null 表示對照表沒有 */
  function legs(km, ids) {
    const out = [];
    for (let i = 1; i < ids.length; i++) out.push({ from: ids[i - 1], to: ids[i], km: kmBetween(km, ids[i - 1], ids[i]) });
    return out;
  }

  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[,，\s$元]/g, '')); return isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round(n * 100) / 100;

  /** 請領表合計 */
  function totals(trips, fuel, park, rate = 4) {
    const km = round2(trips.reduce((s, t) => s + num(t.km), 0));
    const fuelAmt = Math.round(fuel.reduce((s, f) => s + num(f.amount), 0));
    const liters = round2(fuel.reduce((s, f) => s + num(f.liters), 0));
    const parkAmt = Math.round(park.reduce((s, p) => s + num(p.amount), 0));
    const kmPay = Math.round(km * (+rate || 0));
    return { km, fuelAmt, liters, parkAmt, kmPay, total: kmPay + parkAmt, days: new Set(trips.map((t) => t.date)).size, trips: trips.length };
  }

  /* ---- 預設資料：來自「公里數對照表.xlsx」 ---- */
  const SEED_PLACES = [
    ['hq', '新莊總公司', '新莊', '242新北市新莊區新北大道三段5號22之3'],
    ['p_bali', '八里水灣', '八里', '249新北市八里區觀海大道39號'],
    ['p_rongdi', '榕堤水灣', '榕堤', '新北市淡水區中正路229-9號'],
    ['p_yuren', '漁人碼頭', '漁人', '新北市淡水區觀海路199號'],
    ['p_bitan', '碧潭風景區', '碧潭', '新北市新店區碧潭風景區東岸商店街B09'],
    ['p_liukuai', '六塊厝', '六塊厝', '六塊厝漁港'],
    ['p_jianguo', '建國花市', '建國', ''],
    ['p_huanhe', '環河南路', '環河', ''],
    ['p_cheng', '成哥家', '成哥家', ''],
    ['p_zhongjiao', '中角灣派出所', '中角灣', ''],
  ];
  // [起點, 終點, 公里]（單趟）
  const SEED_KM = [
    ['hq', 'p_bali', 16], ['hq', 'p_rongdi', 18], ['hq', 'p_yuren', 22], ['hq', 'p_bitan', 17], ['hq', 'p_liukuai', 26],
    ['hq', 'p_jianguo', 11], ['hq', 'p_huanhe', 6], ['hq', 'p_cheng', 4], ['hq', 'p_zhongjiao', 48],
    ['p_bali', 'p_rongdi', 14], ['p_bali', 'p_yuren', 16], ['p_bali', 'p_bitan', 31], ['p_bali', 'p_liukuai', 21], ['p_bali', 'p_cheng', 16], ['p_bali', 'p_zhongjiao', 44],
    ['p_rongdi', 'p_bali', 14], ['p_rongdi', 'p_yuren', 4], ['p_rongdi', 'p_bitan', 34], ['p_rongdi', 'p_liukuai', 10], ['p_rongdi', 'p_cheng', 18], ['p_rongdi', 'p_zhongjiao', 33],
    ['p_yuren', 'p_bali', 16], ['p_yuren', 'p_rongdi', 4], ['p_yuren', 'p_bitan', 37], ['p_yuren', 'p_liukuai', 12], ['p_yuren', 'p_cheng', 21], ['p_yuren', 'p_zhongjiao', 35],
    ['p_bitan', 'p_bali', 31], ['p_bitan', 'p_rongdi', 34], ['p_bitan', 'p_yuren', 37], ['p_bitan', 'p_liukuai', 43], ['p_bitan', 'p_cheng', 17], ['p_bitan', 'p_zhongjiao', 54],
    ['p_liukuai', 'p_bali', 21], ['p_liukuai', 'p_rongdi', 10], ['p_liukuai', 'p_yuren', 12], ['p_liukuai', 'p_bitan', 43], ['p_liukuai', 'p_cheng', 26], ['p_liukuai', 'p_zhongjiao', 23],
    ['p_cheng', 'p_zhongjiao', 48], ['p_zhongjiao', 'p_cheng', 44],
  ];
  const RULES = '1. 每公里補助 4 元，於每月 25 日結算後，於下月 15 日以轉帳方式匯入同仁薪轉帳戶。\n'
    + '2. 交通補助費之計算：(1) 以總公司為出發點，計算至目的地之直接往返路線。(2) 返回總公司參與會議視為正常出勤，其往返路線不予提供補助。\n'
    + '3. 當日施工地點為二處以上（含），各路線依地點間單趟哩程計算。';

  root.Mileage = { pad, ymd, parse, period, periodOf, shiftPeriod, inPeriod, periodLabel, kmBetween, legs, num, round2, totals, SEED_PLACES, SEED_KM, RULES };
  if (typeof module !== 'undefined') module.exports = root.Mileage;
})(typeof window !== 'undefined' ? window : globalThis);
