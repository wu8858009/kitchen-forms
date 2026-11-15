/* 加在冰箱、菜品、員工餐系統頁面上的「首頁」按鈕：先把資料存好再回到廚房專用表格系統首頁 */
(() => {
  'use strict';
  const DESK = new URLSearchParams(location.search).has('desktop');
  const home = '../index.html' + (DESK ? '?desktop=1' : '');
  const st = document.createElement('style');
  st.textContent = `.kn-home{display:inline-flex;align-items:center;gap:4px;flex:none;margin-right:8px;padding:5px 10px;border-radius:8px;
    background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);color:#fff;text-decoration:none;font-size:14px;font-weight:700;white-space:nowrap}
    .kn-home:hover{background:rgba(255,255,255,.26)} .kn-home span{font-size:17px;line-height:1}
    @media print{.kn-home{display:none!important}}`;
  document.head.appendChild(st);
  const a = document.createElement('a');
  a.className = 'kn-home'; a.href = home; a.title = '回到廚房專用表格系統首頁';
  a.innerHTML = '<span>⌂</span>首頁';
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const m = window.__fridge || window.__dish || window.__meal;
    try { if (m && m.flush) await Promise.race([m.flush(), new Promise((r) => setTimeout(r, 3000))]); } catch (err) { /* 照樣回首頁 */ }
    location.href = home;
  });
  const top = document.querySelector('header.top');
  if (top) top.insertBefore(a, top.firstChild);
})();
