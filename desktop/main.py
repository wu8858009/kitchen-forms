"""廚房專用表格系統 — Windows 桌面版（pywebview + WebView2）

首頁儀表板 + 內建冰箱溫度記錄表、菜品銷售紀錄；員工餐開啟原本的「碧水堂員工餐.exe」。
冰箱、菜品的資料與原本的單獨程式共用：%APPDATA%\\FridgeTemp、%APPDATA%\\DishSales。
"""
import base64
import ctypes
import datetime as dt
import functools
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import webview

APP_TITLE = "廚房專用表格系統"
MEAL_EXE_NAME = "碧水堂員工餐.exe"

if getattr(sys, "frozen", False):
    SITE_DIR = Path(sys._MEIPASS) / "site"
    EXE_DIR = Path(sys.executable).resolve().parent
else:
    SITE_DIR = Path(__file__).resolve().parent.parent / "site"
    EXE_DIR = Path(__file__).resolve().parent.parent

# KITCHEN_DATA=<資料夾>：測試用，三個資料夾都放在它底下（也不檢查重複開啟）
_TEST_ROOT = os.environ.get("KITCHEN_DATA")
_APPDATA = Path(_TEST_ROOT) if _TEST_ROOT else Path(os.environ.get("APPDATA", Path.home()))
OWN_DIR = _APPDATA / "KitchenForms"
CONFIG_FILE = OWN_DIR / "config.json"
KEEP_BACKUPS = 30
MODULES = {
    # 網址資料夾 → (資料夾, 原本單獨程式的名稱, 原本程式的單一執行 mutex)
    "fridge": (_APPDATA / "FridgeTemp", "冰箱溫度記錄表", "FridgeTemp_SingleInstance"),
    "dish": (_APPDATA / "DishSales", "菜品銷售紀錄", "DishSales_SingleInstance"),
    "prep": (_APPDATA / "KitchenPrep", "備料交接日誌", None),  # 只在本系統裡，沒有單獨程式
}
FILE_TYPES = {
    ".xlsx": "Excel 活頁簿 (*.xlsx)",
    ".json": "JSON 備份 (*.json)",
    ".csv": "CSV 檔 (*.csv)",
    ".pdf": "PDF 檔 (*.pdf)",
}
MEAL_CANDIDATES = [
    EXE_DIR / MEAL_EXE_NAME,
    Path(r"E:\程式碼APP製作\VS CODE\員工餐金額總計\dist") / MEAL_EXE_NAME,
    Path(r"C:\Users\admin\Desktop\廚房表單\碧水堂員工餐預算紀錄") / MEAL_EXE_NAME,
    Path.home() / "Desktop" / "廚房表單" / "碧水堂員工餐預算紀錄" / MEAL_EXE_NAME,
]

_window = None


def _data_file(mod):
    return MODULES[mod][0] / "data.json"


def _read_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _write_config(cfg):
    OWN_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")


def _meal_exe():
    """員工餐程式位置：環境變數 → 使用者設定 → 常見位置（同資料夾、子資料夾、原專案 dist）"""
    env = os.environ.get("KITCHEN_MEAL_EXE")
    if env:
        return Path(env)
    p = _read_config().get("meal_exe")
    if p and Path(p).exists():
        return Path(p)
    for c in MEAL_CANDIDATES:
        if c.exists():
            return c
    try:
        for c in EXE_DIR.glob(f"*/{MEAL_EXE_NAME}"):
            return c
    except OSError:
        pass
    return None


def _daily_backup(folder, text):
    """每天保留一份資料快照，最多 KEEP_BACKUPS 份（和原本單獨程式同一個 backups 資料夾）"""
    bdir = folder / "backups"
    bdir.mkdir(parents=True, exist_ok=True)
    (bdir / f"data_{dt.date.today():%Y%m%d}.json").write_text(text, encoding="utf-8")
    for old in sorted(bdir.glob("data_*.json"))[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)


def _clean_env():
    """開啟另一個 PyInstaller 程式時不能帶著本程式的 _PYI_*／_MEI* 變數，否則會找錯 python DLL"""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("_PYI", "_MEI"))}
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    return env


class Api:
    """給網頁呼叫的介面（window.pywebview.api.*）；冰箱、菜品頁面依目前網址決定讀寫哪一份資料"""

    def _mod(self):
        url = _window.get_current_url() or ""
        part = urlparse(url).path.strip("/").split("/")[0]
        if part not in MODULES:
            raise RuntimeError(f"不明的頁面：{url}")
        return part

    # ---- 冰箱、菜品共用（與原本單獨程式相同的介面）
    def load(self):
        f = _data_file(self._mod())
        return f.read_text(encoding="utf-8") if f.exists() else ""

    def save(self, text):
        try:
            mod = self._mod()
            json.loads(text)  # 不寫入損壞的內容
            folder = MODULES[mod][0]
            folder.mkdir(parents=True, exist_ok=True)
            f = _data_file(mod)
            tmp = f.with_suffix(".tmp")
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, f)
            _daily_backup(folder, text)
            return True
        except Exception as e:  # noqa: BLE001 - 錯誤訊息回傳給網頁顯示
            return f"{type(e).__name__}: {e}"

    def data_path(self):
        return str(_data_file(self._mod()))

    def open_url(self, url):
        """用預設瀏覽器開啟 Google 試算表（只允許 Google 網址）"""
        if not str(url).startswith("https://docs.google.com/"):
            return False
        return webbrowser.open(url)

    def export_file(self, b64, filename):
        """另存新檔（Excel、PDF 或 JSON 備份）；回傳儲存路徑，取消時回傳空字串"""
        ext = Path(filename).suffix.lower()
        docs = Path.home() / "Documents"
        out = os.environ.get("KITCHEN_EXPORT_DIR")  # 自我測試時不跳對話框
        if out:
            res = str(Path(out) / filename)
        else:
            res = _window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(docs if docs.exists() else Path.home()),
                save_filename=filename,
                file_types=(FILE_TYPES.get(ext, "所有檔案 (*.*)"),),
            )
        if not res:
            return ""
        path = Path(res[0] if isinstance(res, (list, tuple)) else res)
        if ext and path.suffix.lower() != ext:
            path = path.with_suffix(ext)
        path.write_bytes(base64.b64decode(b64))
        return str(path)

    # ---- 首頁
    def dash(self):
        """首頁儀表板需要的三份資料（原始 JSON 文字，在網頁端計算）"""
        out = {}
        for mod in MODULES:
            f = _data_file(mod)
            out[mod] = f.read_text(encoding="utf-8") if f.exists() else ""
        exe = _meal_exe()
        out["meal_info"] = {"exe": str(exe) if exe else ""}
        out["meal"] = ""
        if exe:
            mf = exe.parent / "meal_data.json"
            if mf.exists():
                try:
                    out["meal"] = mf.read_text(encoding="utf-8")
                except OSError as e:
                    out["meal_info"]["error"] = str(e)
        return json.dumps(out, ensure_ascii=False)

    def open_meal(self):
        exe = _meal_exe()
        if not exe or not exe.exists():
            return f"找不到「{MEAL_EXE_NAME}」，請按「程式位置…」選擇它。"
        if os.environ.get("KITCHEN_SELFTEST"):
            return True  # 自我測試不真的開啟
        try:
            subprocess.Popen([str(exe)], cwd=str(exe.parent), env=_clean_env(), close_fds=True,
                             creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
            return True
        except OSError as e:
            return f"無法開啟：{e}"

    def pick_meal(self):
        cur = _meal_exe()
        res = _window.create_file_dialog(
            webview.FileDialog.OPEN,
            directory=str(cur.parent if cur else Path.home() / "Desktop"),
            file_types=("員工餐程式 (*.exe)",),
        )
        if not res:
            return ""
        p = Path(res[0] if isinstance(res, (list, tuple)) else res)
        cfg = _read_config()
        cfg["meal_exe"] = str(p)
        _write_config(cfg)
        return str(p)


class _QuietHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # 更新 exe 後不吃舊快取
        super().end_headers()

    def log_message(self, *args):  # --windowed 時沒有 stderr
        pass


def _serve_site():
    """只綁本機的靜態伺服器；固定優先用同一個埠，網頁的 localStorage 才不會每次換一份"""
    handler = functools.partial(_QuietHandler, directory=str(SITE_DIR))
    httpd = None
    for port in (47816, 47817, 47818, 0):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            continue
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}"


_mutexes = []


def _single_instance():
    """本程式只開一個；原本的冰箱／菜品單獨程式開著時不能同時開（避免兩邊同時寫同一份資料）"""
    if _TEST_ROOT:
        return True
    k32 = ctypes.windll.kernel32
    names = [("KitchenForms_SingleInstance", None)] + [(m[2], m[1]) for m in MODULES.values() if m[2]]
    for name, label in names:
        h = k32.CreateMutexW(None, False, name)
        if k32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            msg = "廚房專用表格系統已經在執行中。" if label is None else \
                f"「{label}」單獨程式正在執行。\n\n請先關閉它，再開啟廚房專用表格系統（避免兩邊同時寫入同一份資料）。"
            ctypes.windll.user32.MessageBoxW(None, msg, APP_TITLE, 0x40)
            return False
        _mutexes.append(h)
    return True


def _selftest(out_path):
    """KITCHEN_SELFTEST=<結果檔>：啟動後自動操作首頁與兩個系統、寫出結果並關閉"""
    result = {"ok": False}
    js = _window.evaluate_js

    def wait(expr, timeout=20):
        v = None
        for _ in range(int(timeout / 0.2)):
            try:
                v = js(expr)
            except Exception:  # noqa: BLE001 - 換頁時 evaluate 可能失敗
                v = None
            if v:
                return v
            time.sleep(0.2)
        return v

    try:
        _window.events.loaded.wait(30)
        result["home_cards"] = wait("document.querySelectorAll('.card').length")
        time.sleep(1)
        result["home_meal_before"] = js("JSON.stringify(window.__kitchen.summary.meal)")
        # 冰箱：從首頁按「開啟」，輸入一筆溫度，按「首頁」回來
        js("document.querySelector('.card.fridge .btn').click()")
        result["fridge_loaded"] = wait("window.__fridge && window.__fridge.db ? window.__fridge.db.fridges.length : 0")
        time.sleep(1.5)
        result["fridge_home_btn"] = js("!!document.querySelector('.kn-home')")
        js("""(() => { const m = document.querySelector('#me'); if (m) { m.value = '測試員'; m.dispatchEvent(new Event('input', {bubbles: true})); }
            const ins = document.querySelectorAll('[data-t]');
            ins[0].value = '3.5'; ins[0].dispatchEvent(new Event('change', {bubbles: true})); })()""")
        time.sleep(0.6)
        js("document.querySelector('.kn-home').click()")
        result["back_home_1"] = wait("window.__kitchen && window.__kitchen.summary && window.__kitchen.summary.fridge ? 1 : 0")
        result["fridge_summary"] = js("JSON.stringify(window.__kitchen.summary.fridge)")
        saved = json.loads(_data_file("fridge").read_text(encoding="utf-8"))
        result["fridge_saved_today"] = bool(saved["recs"].get(dt.date.today().isoformat()))
        # 菜品：開啟、按三次 ＋、回首頁
        js("document.querySelector('.card.dish .btn').click()")
        result["dish_loaded"] = wait("window.__dish && window.__dish.db ? window.__dish.db.dishes.length : 0")
        time.sleep(1)
        result["dish_before"] = js("document.querySelector('#daykpi') && document.querySelector('#daykpi').innerText")
        js("for (let i = 0; i < 3; i++) document.querySelector('.row [data-act=inc]').click()")
        time.sleep(0.4)
        js("document.querySelector('.kn-home').click()")
        result["back_home_2"] = wait("window.__kitchen && window.__kitchen.summary && window.__kitchen.summary.dish ? 1 : 0")
        result["dish_summary"] = js("JSON.stringify(window.__kitchen.summary.dish)")
        # 備料交接：開啟、填兩項＋簽名、存 PDF、回首頁
        js("document.querySelector('.card.prep .btn').click()")
        result["prep_items"] = wait("window.__prep && window.__prep.db ? window.__prep.db.items.length : 0")
        time.sleep(0.8)
        js("""(() => { const q = document.querySelectorAll('.it input.q'); q[0].value = '10'; q[0].dispatchEvent(new Event('input', {bubbles: true}));
            document.querySelectorAll('.it .ck')[1].click();
            const s = document.querySelector('[data-k=sign]'); s.value = '測試主管'; s.dispatchEvent(new Event('input', {bubbles: true})); })()""")
        time.sleep(0.6)
        js("window.__prep.flush().then(() => { location.hash = '#/sheet'; setTimeout(() => document.querySelector('[data-act=print]').click(), 600); })")
        exp = Path(os.environ.get("KITCHEN_EXPORT_DIR", "."))
        pdfs = []
        for _ in range(40):
            time.sleep(0.5)
            pdfs = [p for p in exp.glob("*交接*.pdf") if p.stat().st_size > 10000]
            if pdfs:
                break
        result["prep_pdf"] = [[p.name, p.stat().st_size, p.read_bytes().count(b"/Type /Page\n")] for p in pdfs]
        result["prep_saved"] = bool(json.loads(_data_file("prep").read_text(encoding="utf-8"))["logs"].get(dt.date.today().isoformat()))
        js("document.querySelector('.kn-home').click()")
        result["back_home_3"] = wait("window.__kitchen && window.__kitchen.summary && window.__kitchen.summary.prep ? 1 : 0")
        result["prep_summary"] = js("JSON.stringify(window.__kitchen.summary.prep)")
        result["meal_summary"] = js("JSON.stringify(window.__kitchen.summary.meal)")
        result["open_meal"] = js("window.pywebview.api.open_meal()")
        time.sleep(0.3)
        result["kpis"] = js("[...document.querySelectorAll('.kpi')].map(e => e.innerText.replace(/\\n/g, ' '))")
        result["window"] = [_window.x, _window.y, _window.width, _window.height]
        fs = json.loads(result["fridge_summary"] or "null") or {}
        ds = json.loads(result["dish_summary"] or "null") or {}
        ps = json.loads(result.get("prep_summary") or "null") or {}
        result["ok"] = bool(result["home_cards"] == 4 and ps.get("done", 0) >= 2 and ps.get("sign") and result["prep_pdf"] and result["prep_saved"] and result["fridge_loaded"] and result["fridge_home_btn"]
                            and result["fridge_saved_today"] and fs.get("done", 0) >= 1
                            and result["dish_loaded"] and ds.get("t", {}).get("q", 0) >= 3)
    except Exception as e:  # noqa: BLE001
        result["error"] = repr(e)
    Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    _window.destroy()


def _fit_screen(margin=24):
    """依螢幕工作區（扣掉工作列）決定視窗大小，並置中"""
    try:
        wa = webview.screens[0].frame
        w, h = max(420, wa.Width - margin * 2), max(560, wa.Height - margin * 2)
        return dict(width=w, height=h, x=wa.X + (wa.Width - w) // 2, y=wa.Y + (wa.Height - h) // 2)
    except Exception:  # noqa: BLE001
        return dict(width=1200, height=760)


def main():
    global _window
    if not _single_instance():
        return
    OWN_DIR.mkdir(parents=True, exist_ok=True)
    base = _serve_site()
    _window = webview.create_window(
        APP_TITLE, f"{base}/index.html?desktop=1", js_api=Api(), min_size=(420, 560), text_select=True,
        maximized=not os.environ.get("KITCHEN_SELFTEST"), **_fit_screen(),
    )
    selftest = os.environ.get("KITCHEN_SELFTEST")
    kwargs = dict(private_mode=False, storage_path=str(OWN_DIR / "webview"), gui="edgechromium")
    if selftest:
        webview.start(_selftest, (selftest,), **kwargs)
    else:
        webview.start(**kwargs)


if __name__ == "__main__":
    main()
