// 在本機用假的 Apps Script 服務執行 cloud/Code.gs（多分頁），測試同步用
// 用法：node tools/gasmock.js <port> [state.json]
//   GET  /__dump          → 目前所有分頁內容與屬性
//   POST /__edit {sheet,row,col,value} → 模擬在試算表手動修改一格並觸發 onEdit
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const port = Number(process.argv[2] || 8802);
const stateFile = process.argv[3];
let state = { props: {}, sheets: {} };
if (stateFile && fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => stateFile && fs.writeFileSync(stateFile, JSON.stringify(state));

function makeSheet(name) {
  const grid = () => state.sheets[name];
  const lastRow = () => { const g = grid(); let n = g.length; while (n > 0 && !(g[n - 1] || []).some((c) => c !== '' && c != null)) n--; return n; };
  const range = (r, c, nr, nc) => {
    const R = {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const row = grid()[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error(`setValues dimension mismatch ${vals.length}x${vals[0] && vals[0].length} vs ${nr}x${nc}`);
        vals.forEach((v, i) => { const g = grid(); const row = g[r - 1 + i] = g[r - 1 + i] || []; v.forEach((x, j) => (row[c - 1 + j] = x)); });
        return R;
      },
      clearContent() { for (let i = 0; i < nr; i++) { const row = grid()[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return R; },
      setNumberFormat() { return R; },
      setFontWeight() { return R; },
      getRow: () => r, getNumRows: () => nr, getSheet: () => sheet,
    };
    return R;
  };
  const sheet = {
    getName: () => name, getLastRow: lastRow,
    getLastColumn: () => grid().reduce((mx, r) => { let n = (r || []).length; while (n > 0 && (r[n - 1] === '' || r[n - 1] == null)) n--; return Math.max(mx, n); }, 0),
    getRange: (r, c, nr = 1, nc = 1) => range(r, c, nr, nc),
    setFrozenRows() {},
  };
  return sheet;
}
const ss = {
  getSheetByName: (n) => (state.sheets[n] ? makeSheet(n) : null),
  insertSheet: (n) => { state.sheets[n] = []; return makeSheet(n); },
  getSheets: () => Object.keys(state.sheets).map(makeSheet),
  deleteSheet: (s) => { delete state.sheets[s.getName()]; },
  getUrl: () => 'https://docs.google.com/spreadsheets/d/MOCK/edit',
};
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = String(v); }, deleteProperty: (k) => { delete state.props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    formatDate: (d) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' '),
    getUuid: () => crypto.randomUUID(),
  },
  Session: { getScriptTimeZone: () => 'Asia/Taipei' },
  SpreadsheetApp: { getActive: () => ss, getActiveSpreadsheet: () => ss },
  Logger: { log: console.log },
  CacheService: { getScriptCache: () => { const m = (global.__kfCache = global.__kfCache || {}); return { get: (k) => (k in m ? m[k] : null), put: (k, v) => { m[k] = v; }, remove: (k) => { delete m[k]; } }; } },
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cloud', 'Code.gs'), 'utf8'), ctx);

http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out;
    try {
      if (req.url.startsWith('/__dump')) out = { text: JSON.stringify(state) };
      else if (req.url.startsWith('/__edit')) {
        const q = JSON.parse(body);
        const sh = ss.getSheetByName(q.sheet);
        sh.getRange(q.row, q.col).setValues([[q.value]]);
        ctx.onEdit({ range: sh.getRange(q.row, q.col) });
        out = { text: '{"ok":true}' };
      } else out = req.method === 'POST' ? ctx.doPost({ postData: { contents: body } }) : ctx.doGet();
      save();
    } catch (e) { out = { text: JSON.stringify({ ok: false, err: 'MOCK: ' + e.stack }) }; }
    res.writeHead(200, cors);
    res.end(out.text);
  });
}).listen(port, '127.0.0.1', () => console.log('gasmock on ' + port));
