/**
 * 廚房專用表格系統 — 人員與權限（Apps Script，綁定在試算表「廚房專用表格系統 人員權限」）
 *
 * 分頁「人員權限」：每人一列，可以直接在試算表勾選權限（填「是」或留空）。
 * 分頁「登入裝置」：每台登入的裝置一列（Token）。刪掉某列＝那台裝置被登出。
 * PIN 碼只存雜湊（加上只有這個指令碼知道的 SALT），試算表看不到 PIN。
 * 第一位管理者由第一次打開網頁的人建立（setup），之後只有管理者能新增、修改人員。
 *
 * 各系統的雲端連線（網址、密碼）由管理者設定一次，存在指令碼屬性 CLOUD_CFG；登入的人會自動拿到自己有權限的系統的設定，
 *   不用每台裝置、每個系統再輸入密碼（cloud_set）。
 *
 * 分頁「備料資料」：備料交接日誌的資料，所有裝置共用（prep_sync）。每個設定、品項、每天每一格各一列，
 * 「版本」越大越新；裝置只下載自己上次同步後有變動的列。值是 JSON，請不要手動修改。
 */

const SH_PEOPLE = '人員權限';
const SH_DEV = '登入裝置';
const MODS = ['fridge', 'prep', 'dish', 'meal', 'sop', 'equip', 'energy'];
const HEAD = ['姓名', '角色', '冰箱溫度', '備料交接', '菜品銷售', '員工餐', '廚房SOP', '設備管家', '水電瓦斯', '水電瓦斯權限', '水電瓦斯區域', '停用', 'PIN雜湊', '更新時間'];
// 水電瓦斯抄表每個人能看什麼：權限（查看／編輯／完整）＋區域（用「、」分開，空白＝全部區域）
const EN_LV = { '查看': 'View', '編輯': 'Edit', '完整': 'Full' }, EN_LVN = { View: '查看', Edit: '編輯', Full: '完整' };
function enRead_(lv, g) { return { lv: EN_LV[String(lv == null ? '' : lv).trim()] || 'Edit', g: String(g == null ? '' : g).split(/[、,，\n]+/).map((x) => x.trim()).filter(Boolean) }; }
function enOf_(p) { return p.role === 'admin' ? { lv: 'Full', g: [] } : (p.en || { lv: 'Edit', g: [] }); }
const DEV_HEAD = ['Token', '姓名', '登入時間', '裝置', '最後使用'];
const SH_PREP = '備料資料';
const PREP_HEAD = ['鍵', '值', '版本', '更新者', '更新時間'];
const ROLE_N = { admin: '管理者', staff: '員工' };
const MAX_FAIL = 5, LOCK_MS = 5 * 60 * 1000;

function doGet() { return out_(status_()); }
function doPost(e) {
  let q = {};
  try { q = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: '資料格式錯誤' }); }
  try {
    const a = q.action;
    if (a === 'status') return out_(status_());
    // 只讀的請求不用排隊（每台裝置會定時問，排隊會互相卡住、變慢甚至逾時）
    if (a === 'me') return out_(withMe_(q, (me) => ({ ok: true, me: pub_(me), cloud: cloudFor_(me) })));
    if (a === 'prep_rev') return out_(withMe_(q, (me) => (me.role === 'admin' || me.perms.prep ? { ok: true, rev: Number(PropertiesService.getScriptProperties().getProperty('PREP_REV') || 0) } : { ok: false, code: 'perm', error: '你沒有備料交接日誌的權限' })));
    if (a === 'list') return out_(withAdmin_(q, () => ({ ok: true, people: people_().map(pub_), sheet: SpreadsheetApp.getActive().getUrl() })));
    if (a === 'energy_ticket') return out_(withMe_(q, (me) => energyTicket_(me)));
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (a === 'setup') return out_(setup_(q));
      if (a === 'login') return out_(login_(q));
      if (a === 'me') return out_(withMe_(q, (me) => ({ ok: true, me: pub_(me), cloud: cloudFor_(me) })));
      if (a === 'cloud_set') return out_(withAdmin_(q, (me) => cloudSet_(me, q)));
      if (a === 'logout') { delTokens_((r) => r[0] === q.token); return out_({ ok: true }); }
      if (a === 'pin') return out_(withMe_(q, (me) => changePin_(me, q)));
      if (a === 'list') return out_(withAdmin_(q, () => ({ ok: true, people: people_().map(pub_), sheet: SpreadsheetApp.getActive().getUrl() })));
      if (a === 'save') return out_(withAdmin_(q, (me) => save_(me, q.p || {}, q.token)));
      if (a === 'del') return out_(withAdmin_(q, (me) => del_(me, String(q.name || ''))));
      if (a === 'prep_sync') return out_(withMe_(q, (me) => prepSync_(me, q)));
      // 只問目前版本（很快），有變才做完整同步
      if (a === 'prep_rev') return out_(withMe_(q, (me) => (me.role === 'admin' || me.perms.prep ? { ok: true, rev: Number(PropertiesService.getScriptProperties().getProperty('PREP_REV') || 0) } : { ok: false, code: 'perm', error: '你沒有備料交接日誌的權限' })));
      return out_({ ok: false, error: '不認得的動作：' + a });
    } finally { lock.releaseLock(); }
  } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}

// 第一次在試算表編輯器按「執行」用：建立分頁、讓 Google 跳出授權
function authorize() { sheet_(SH_PEOPLE, HEAD); sheet_(SH_DEV, DEV_HEAD); Logger.log('OK：' + SpreadsheetApp.getActive().getUrl()); }

// ------------------------------------------------------------------ 動作
function status_() {
  const ps = people_().filter((p) => !p.off);
  return { ok: true, setup: ps.length > 0, names: ps.map((p) => p.name) };
}
function setup_(q) {
  if (people_().length) return { ok: false, error: '已經設定過管理者了，請用自己的名字登入' };
  const name = cleanName_(q.name), pin = String(q.pin || '');
  if (!name) return { ok: false, error: '請輸入姓名' };
  if (!pinOk_(pin)) return { ok: false, error: 'PIN 要 4～8 位數字' };
  const p = { name, role: 'admin', perms: allPerms_(true), off: false, h: hash_(name, pin), at: Date.now() };
  writePeople_([p]);
  return issue_(p, q.dev);
}
function login_(q) {
  const name = String(q.name || '').trim(), pin = String(q.pin || '');
  const p = people_().find((x) => x.name === name);
  if (!p || p.off) return { ok: false, error: '找不到這個人，或已經停用' };
  const props = PropertiesService.getScriptProperties(), key = 'FAIL_' + hashHex_(name).slice(0, 16);
  let f = {}; try { f = JSON.parse(props.getProperty(key) || '{}'); } catch (e) { f = {}; }
  if (f.until && f.until > Date.now()) return { ok: false, error: `PIN 錯太多次，請 ${Math.ceil((f.until - Date.now()) / 60000)} 分鐘後再試` };
  if (p.h !== hash_(name, pin)) {
    f.n = (f.n || 0) + 1;
    if (f.n >= MAX_FAIL) { f = { n: 0, until: Date.now() + LOCK_MS }; }
    props.setProperty(key, JSON.stringify(f));
    return { ok: false, error: f.until ? 'PIN 錯太多次，請 5 分鐘後再試' : `PIN 不對（還可以試 ${MAX_FAIL - f.n} 次）` };
  }
  props.deleteProperty(key);
  return issue_(p, q.dev);
}
function changePin_(me, q) {
  if (me.h !== hash_(me.name, String(q.old || ''))) return { ok: false, error: '原本的 PIN 不對' };
  if (!pinOk_(String(q.pin || ''))) return { ok: false, error: 'PIN 要 4～8 位數字' };
  const ps = people_(), p = ps.find((x) => x.name === me.name);
  p.h = hash_(p.name, String(q.pin)); p.at = Date.now();
  writePeople_(ps);
  delTokens_((r) => r[1] === me.name && r[0] !== q.token); // 其他裝置要用新 PIN 重新登入
  return { ok: true };
}
function save_(me, x, token) {
  const ps = people_();
  const name = cleanName_(x.name), old = x.old != null ? String(x.old) : null;
  if (!name) return { ok: false, error: '請輸入姓名' };
  let p = old != null ? ps.find((y) => y.name === old) : null;
  if (old != null && !p) return { ok: false, error: '找不到「' + old + '」，可能已被別人刪除' };
  if (ps.some((y) => y.name === name && y !== p)) return { ok: false, error: '已經有人叫「' + name + '」了' };
  const isNew = !p;
  if (isNew) {
    if (!pinOk_(String(x.pin || ''))) return { ok: false, error: '新人員要設定 4～8 位數字的 PIN' };
    p = { name, role: 'staff', perms: allPerms_(false), en: { lv: 'Edit', g: [] }, off: false, h: '', at: 0 };
    ps.push(p);
  }
  const before = { name: p.name, role: p.role, off: p.off };
  if (x.role === 'admin' || x.role === 'staff') p.role = x.role;
  if (x.perms) MODS.forEach((m) => { if (m in x.perms) p.perms[m] = !!x.perms[m]; });
  if ('off' in x) p.off = !!x.off;
  if (x.en && typeof x.en === 'object') {
    const cur = p.en || { lv: 'Edit', g: [] };
    p.en = { lv: EN_LVN[x.en.lv] ? x.en.lv : cur.lv, g: Array.isArray(x.en.g) ? x.en.g.map((g) => String(g).replace(/[、,，\n]/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 50) : cur.g };
  }
  if (p.name === me.name && (p.role !== 'admin' || p.off)) return { ok: false, error: '不能把自己改成員工或停用（請另一位管理者來改）' };
  if (!ps.some((y) => y.role === 'admin' && !y.off)) return { ok: false, error: '至少要留一位管理者' };
  const rename = p.name !== name;
  p.name = name;
  if (x.pin) { if (!pinOk_(String(x.pin))) return { ok: false, error: 'PIN 要 4～8 位數字' }; p.h = hash_(name, String(x.pin)); }
  p.at = Date.now();
  writePeople_(ps);
  if (!isNew && rename) renameTokens_(before.name, name);
  // 停用、重設 PIN：那個人的裝置都要重新登入（自己正在用的這台除外）
  if (!isNew && (p.off || x.pin)) delTokens_((r) => r[1] === name && r[0] !== token);
  return { ok: true, p: pub_(p) };
}
function del_(me, name) {
  if (name === me.name) return { ok: false, error: '不能刪除自己' };
  const ps = people_(), rest = ps.filter((p) => p.name !== name);
  if (rest.length === ps.length) return { ok: true };
  if (!rest.some((p) => p.role === 'admin' && !p.off)) return { ok: false, error: '至少要留一位管理者' };
  writePeople_(rest);
  delTokens_((r) => r[1] === name);
  return { ok: true };
}

// ------------------------------------------------------------------ 備料交接日誌同步
// changes：{鍵: JSON 字串，null＝刪除}；回傳版本大於 since 的所有列（含剛剛寫入的）
function prepSync_(me, q) {
  if (me.role !== 'admin' && !me.perms.prep) return { ok: false, code: 'perm', error: '你沒有備料交接日誌的權限' };
  const sh = sheet_(SH_PREP, PREP_HEAD), n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, PREP_HEAD.length).getValues() : [];
  const idx = {};
  rows.forEach((r, i) => { idx[String(r[0])] = i; });
  const props = PropertiesService.getScriptProperties();
  let rev = Number(props.getProperty('PREP_REV') || 0);
  const ch = q.changes || {}, keys = Object.keys(ch);
  if (keys.length) {
    rev++;
    const now = fmt_(new Date()), add = [], upd = [];
    keys.forEach((k) => {
      const v = ch[k] == null ? '' : String(ch[k]);
      const row = [k, v, rev, me.name, now];
      if (k in idx) { rows[idx[k]] = row; upd.push(idx[k]); } else { add.push(row); rows.push(row); idx[k] = rows.length - 1; }
    });
    if (upd.length > 20) sh.getRange(2, 1, n, PREP_HEAD.length).setNumberFormat('@').setValues(rows.slice(0, n));
    else upd.forEach((i) => sh.getRange(i + 2, 1, 1, PREP_HEAD.length).setNumberFormat('@').setValues([rows[i]]));
    if (add.length) sh.getRange(n + 2, 1, add.length, PREP_HEAD.length).setNumberFormat('@').setValues(add);
    props.setProperty('PREP_REV', String(rev));
  }
  const since = Number(q.since) || 0, out = {};
  rows.forEach((r) => { if (Number(r[2]) > since) out[String(r[0])] = String(r[1]) === '' ? null : String(r[1]); });
  return { ok: true, rev, rows: out };
}

// ------------------------------------------------------------------ 各系統的雲端連線（管理者分發）
const CLOUD_MODS = ['fridge', 'dish', 'meal', 'sop', 'equip', 'energy'];
function cloudGet_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('CLOUD_CFG') || '{}'); } catch (e) { return {}; } }
function cloudFor_(me) {
  const c = cloudGet_(), out = {};
  // 水電瓦斯抄表的同步密碼只給管理者；其他人用 energy_ticket 拿通行證
  CLOUD_MODS.forEach((m) => { if (c[m] && (me.role === 'admin' || (me.perms || {})[m])) out[m] = m === 'energy' && me.role !== 'admin' ? { url: c[m].url, at: c[m].at } : c[m]; });
  return out;
}
// 水電瓦斯抄表的通行證：用同步密碼簽章，寫明是誰、權限等級、可以看的區域（5 分鐘內有效）
function energyTicket_(me) {
  if (!(me.role === 'admin' || me.perms.energy)) return { ok: false, code: 'perm', error: '你沒有水電瓦斯抄表的權限' };
  const c = cloudGet_().energy;
  if (!c || !c.pw) return { ok: false, code: 'nocfg', error: '管理者還沒有設定水電瓦斯抄表的同步密碼' };
  const en = enOf_(me);
  const body = encodeURIComponent(JSON.stringify({ n: me.name, a: me.role === 'admin' ? 1 : 0, lv: en.lv, g: en.g, x: Date.now() + 5 * 60000 }));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, c.pw, Utilities.Charset.UTF_8)).replace(/=+$/, '');
  return { ok: true, url: c.url, ticket: body + '.' + sig };
}
function cloudSet_(me, q) {
  const m = String(q.mod || '');
  if (CLOUD_MODS.indexOf(m) < 0) return { ok: false, error: '不認得的系統：' + m };
  const c = cloudGet_();
  if (q.cfg && q.cfg.url) {
    const x = { url: String(q.cfg.url).slice(0, 300), at: Date.now(), by: me.name };
    if (m === 'sop' || m === 'equip') x.key = String(q.cfg.key || ''); else x.pw = String(q.cfg.pw || '');
    c[m] = x;
  } else delete c[m];
  PropertiesService.getScriptProperties().setProperty('CLOUD_CFG', JSON.stringify(c));
  return { ok: true, cloud: cloudFor_(me) };
}

// ------------------------------------------------------------------ 登入裝置
function issue_(p, dev) {
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const sh = sheet_(SH_DEV, DEV_HEAD), now = new Date();
  sh.getRange(sh.getLastRow() + 1, 1, 1, DEV_HEAD.length).setValues([[token, p.name, fmt_(now), String(dev || '').slice(0, 120), fmt_(now)]]);
  cacheDel_('kf_devs');
  return { ok: true, token, me: pub_(p), cloud: cloudFor_(p) };
}
// ------------------------------------------------------------------ 快取（讀試算表很慢，常用的資料記 30 秒）
function cacheGet_(k) { try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function cachePut_(k, v, s) { try { CacheService.getScriptCache().put(k, JSON.stringify(v), s || 30); } catch (e) { /* 太大就不快取 */ } }
function cacheDel_(k) { try { CacheService.getScriptCache().remove(k); } catch (e) { /* */ } }
function devRows_() {
  const c = cacheGet_('kf_devs');
  if (c) return c;
  const sh = sheet_(SH_DEV, DEV_HEAD), n = sh.getLastRow() - 1;
  const rows = (n > 0 ? sh.getRange(2, 1, n, DEV_HEAD.length).getValues() : []).map((r) => r.map((x) => (x instanceof Date ? x.toISOString() : x)));
  cachePut_('kf_devs', rows);
  return rows;
}
function withMe_(q, fn) {
  const rows = devRows_();
  const i = rows.findIndex((r) => String(r[0]) === String(q.token || '') && q.token);
  if (i < 0) return { ok: false, code: 'auth', error: '請重新登入' };
  const me = people_().find((p) => p.name === String(rows[i][1]));
  if (!me || me.off) { delTokens_((r) => r[0] === q.token); return { ok: false, code: 'auth', error: me ? '帳號已停用' : '帳號已被刪除' }; }
  const last = Date.parse(String(rows[i][4]).replace(' ', 'T')) || 0;
  if (Date.now() - last > 3600 * 1000) { // 每小時最多記一次「最後使用」
    const sh = sheet_(SH_DEV, DEV_HEAD), n = sh.getLastRow() - 1;
    const live = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
    const j = live.findIndex((r) => String(r[0]) === String(q.token));
    if (j >= 0) sh.getRange(j + 2, 5).setValues([[fmt_(new Date())]]);
    cacheDel_('kf_devs');
  }
  return fn(me);
}
function withAdmin_(q, fn) { return withMe_(q, (me) => (me.role === 'admin' ? fn(me) : { ok: false, error: '只有管理者可以管理權限' })); }
function renameTokens_(from, to) {
  const sh = sheet_(SH_DEV, DEV_HEAD), n = sh.getLastRow() - 1;
  if (n <= 0) return;
  const rows = sh.getRange(2, 1, n, DEV_HEAD.length).getValues();
  let hit = false;
  rows.forEach((r) => { if (String(r[1]) === from) { r[1] = to; hit = true; } });
  if (hit) sh.getRange(2, 1, n, DEV_HEAD.length).setValues(rows);
  cacheDel_('kf_devs');
}
function delTokens_(match) {
  const sh = sheet_(SH_DEV, DEV_HEAD), n = sh.getLastRow() - 1;
  if (n <= 0) return;
  const rows = sh.getRange(2, 1, n, DEV_HEAD.length).getValues();
  const keep = rows.filter((r) => r[0] !== '' && !match(r));
  if (keep.length === rows.length) return;
  sh.getRange(2, 1, n, DEV_HEAD.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, DEV_HEAD.length).setValues(keep);
  cacheDel_('kf_devs');
}

// ------------------------------------------------------------------ 人員分頁
function people_() {
  const c = cacheGet_('kf_people');
  if (c) return c;
  const r = readPeople_();
  cachePut_('kf_people', r);
  return r;
}
function readPeople_() {
  const sh = sheet_(SH_PEOPLE, HEAD), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = (h) => head.indexOf(h);
  return sh.getRange(2, 1, n, head.length).getValues().filter((r) => String(r[col('姓名')]).trim()).map((r) => {
    const role = String(r[col('角色')]).trim() === '管理者' ? 'admin' : 'staff';
    const perms = {};
    MODS.forEach((m, k) => { perms[m] = yes_(r[col(HEAD[2 + k])]); });
    return { name: String(r[col('姓名')]).trim(), role, perms, en: enRead_(r[col('水電瓦斯權限')], r[col('水電瓦斯區域')]), off: yes_(r[col('停用')]), h: String(r[col('PIN雜湊')] || ''), at: Number(r[col('更新時間')]) || 0 };
  });
}
function writePeople_(ps) {
  cacheDel_('kf_people');
  const sh = sheet_(SH_PEOPLE, HEAD), n = Math.max(0, sh.getLastRow() - 1);
  const w = Math.max(HEAD.length, sh.getLastColumn());
  if (n) sh.getRange(2, 1, n, w).clearContent();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]); // 欄位有增加時，標題列一起更新
  if (!ps.length) return;
  sh.getRange(2, 1, ps.length, HEAD.length).setValues(ps.map((p) => [p.name, ROLE_N[p.role], ...MODS.map((m) => (p.role === 'admin' || p.perms[m] ? '是' : '')), EN_LVN[enOf_(p).lv], enOf_(p).g.join('、'), p.off ? '是' : '', p.h, p.at]));
}
function sheet_(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ------------------------------------------------------------------ 小工具
function pub_(p) { return { name: p.name, role: p.role, perms: p.role === 'admin' ? allPerms_(true) : Object.assign({}, p.perms), en: enOf_(p), off: !!p.off }; }
function allPerms_(v) { const o = {}; MODS.forEach((m) => { o[m] = v; }); return o; }
function yes_(v) { const s = String(v).trim(); return v === true || s === '是' || s === 'TRUE' || s === 'V' || s === 'v' || s === '✓' || s === '1'; }
function pinOk_(s) { return /^\d{4,8}$/.test(s); }
function cleanName_(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 20); }
function salt_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SALT');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SALT', s); }
  return s;
}
function hashHex_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''); }
function hash_(name, pin) { return hashHex_(salt_() + '|pin|' + pin); } // 改名字不用重設 PIN
function fmt_(d) { return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd HH:mm'); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
