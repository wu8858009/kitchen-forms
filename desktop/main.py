"""廚房專用表格系統 — Windows 桌面版（pywebview + WebView2）

首頁儀表板 + 內建冰箱溫度記錄表、菜品銷售紀錄；員工餐開啟原本的「碧水堂員工餐.exe」。
冰箱、菜品的資料與原本的單獨程式共用：%APPDATA%\\FridgeTemp、%APPDATA%\\DishSales。
"""
import base64
import ctypes
import datetime as dt
import functools
import json
import secrets
import ssl
import urllib.parse
import urllib.request
import os
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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
    "sop": (_APPDATA / "KitchenSOP", "廚房SOP", "KitchenSOP_SingleInstance"),  # 和原本的廚房SOP程式同一份資料
    "equip": (_APPDATA / "ShebeiGuanjia", "設備管家", "ShebeiGuanjia_SingleInstance"),  # 和原本的設備管家程式同一份資料
    "taxid": (_APPDATA / "TaxIdRecord", "統編紀錄系統", "TaxIdRecord_SingleInstance"),  # 和原本的統編紀錄系統同一份資料
    "mileage": (_APPDATA / "MileageFuel", "公里及油資紀錄系統", "MileageFuel_SingleInstance"),  # 和原本的公里及油資紀錄系統同一份資料
}
# 設備管家的網頁用 /api/*（跟它原本的程式一樣）讀寫資料，要帶這個 token，其他網站才不能亂寫
EQUIP_TOKEN = secrets.token_urlsafe(24)
FILE_TYPES = {
    ".xlsx": "Excel 活頁簿 (*.xlsx)",
    ".json": "JSON 備份 (*.json)",
    ".csv": "CSV 檔 (*.csv)",
    ".pdf": "PDF 檔 (*.pdf)",
    ".png": "PNG 圖片 (*.png)",
    ".jpg": "JPG 圖片 (*.jpg;*.jpeg)",
    ".csv": "CSV 檔 (*.csv)",
}
GCIS = "https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6"  # 統編紀錄系統的備援查詢
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


# ---------------------------------------------------------------- 輸入法切換
# WebView2 的輸入框在另一個行程，不能直接用 ImmGetContext；改送 WM_IME_CONTROL 給焦點視窗的預設 IME 視窗，
# 微軟注音等新版輸入法也吃這個訊息。
_WM_IME_CONTROL = 0x0283
_IMC_GETCONVERSIONMODE, _IMC_SETCONVERSIONMODE, _IMC_GETOPENSTATUS, _IMC_SETOPENSTATUS = 0x1, 0x2, 0x5, 0x6
_IME_CMODE_NATIVE = 0x1
_WM_INPUTLANGCHANGEREQUEST = 0x0050
_ZH_LANGS = (0x0404, 0x0C04, 0x1404, 0x0804, 0x1004)  # 繁中台灣優先，其次香港、澳門、簡中


class _GUITHREADINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint32), ("flags", ctypes.c_uint32), ("hwndActive", ctypes.c_void_p),
                ("hwndFocus", ctypes.c_void_p), ("hwndCapture", ctypes.c_void_p), ("hwndMenuOwner", ctypes.c_void_p),
                ("hwndMoveSize", ctypes.c_void_p), ("hwndCaret", ctypes.c_void_p), ("rcCaret", ctypes.c_long * 4)]


def _focus_hwnd():
    u = ctypes.windll.user32
    u.GetForegroundWindow.restype = ctypes.c_void_p
    fg = u.GetForegroundWindow()
    if not fg:
        return None, 0
    tid = u.GetWindowThreadProcessId(ctypes.c_void_p(fg), None)
    gti = _GUITHREADINFO(cbSize=ctypes.sizeof(_GUITHREADINFO))
    if u.GetGUIThreadInfo(tid, ctypes.byref(gti)) and gti.hwndFocus:
        return gti.hwndFocus, tid
    return fg, tid


def _ime_send(hwnd, cmd, val=0):
    u, imm = ctypes.windll.user32, ctypes.windll.imm32
    imm.ImmGetDefaultIMEWnd.restype = ctypes.c_void_p
    ime = imm.ImmGetDefaultIMEWnd(ctypes.c_void_p(hwnd))
    if not ime:
        return None
    res = ctypes.c_size_t(0)
    ok = u.SendMessageTimeoutW(ctypes.c_void_p(ime), _WM_IME_CONTROL, ctypes.c_size_t(cmd), ctypes.c_ssize_t(val), 0x2, 300, ctypes.byref(res))
    return res.value if ok else None


def _set_ime(chinese):
    try:
        hwnd, tid = _focus_hwnd()
        if not hwnd:
            return False
        u = ctypes.windll.user32
        if chinese:
            # 目前不是中文鍵盤時，切到已安裝的中文輸入法
            u.GetKeyboardLayout.restype = ctypes.c_void_p
            cur = (u.GetKeyboardLayout(tid) or 0) & 0xFFFF
            if cur not in _ZH_LANGS:
                n = u.GetKeyboardLayoutList(0, None)
                arr = (ctypes.c_void_p * n)()
                u.GetKeyboardLayoutList(n, arr)
                hkls = [h for h in arr if h]
                zh = next((h for lang in _ZH_LANGS for h in hkls if h & 0xFFFF == lang), None)
                if zh:
                    u.PostMessageW(ctypes.c_void_p(hwnd), _WM_INPUTLANGCHANGEREQUEST, 0, ctypes.c_void_p(zh))
                    time.sleep(0.15)
        _ime_send(hwnd, _IMC_SETOPENSTATUS, 1)
        mode = _ime_send(hwnd, _IMC_GETCONVERSIONMODE) or 0
        mode = (mode | _IME_CMODE_NATIVE) if chinese else (mode & ~_IME_CMODE_NATIVE)
        _ime_send(hwnd, _IMC_SETCONVERSIONMODE, mode)
        return _ime_send(hwnd, _IMC_GETCONVERSIONMODE)
    except Exception:  # noqa: BLE001 - 切換失敗不影響輸入
        return False


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
        """用預設瀏覽器開啟 Google 試算表；SOP 的標籤列印交給瀏覽器（WebView2 不能連藍牙／USB 印表機）"""
        if not str(url).startswith(("https://docs.google.com/", "https://wu8858009.github.io/kitchen-sop/", "https://www.google.com/maps/")):
            return False
        return webbrowser.open(url)

    def lookup(self, no):
        """統編紀錄系統：備援查詢，直接問經濟部商工登記 API（g0v 連不上時用；和原本的程式一樣）"""
        no = "".join(c for c in str(no) if c.isdigit())
        if len(no) != 8:
            return None
        q = urllib.parse.urlencode({"$format": "json", "$filter": f"Business_Accounting_NO eq {no}", "$skip": 0, "$top": 1})
        try:
            req = urllib.request.Request(f"{GCIS}?{q}", headers={"User-Agent": "Mozilla/5.0 KitchenForms"})
            ctx = ssl.create_default_context()
            # 政府網站憑證缺 Subject Key Identifier，Python 3.13 的嚴格模式會擋；只關嚴格旗標，憑證照樣驗證
            ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
            with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
                body = r.read().decode("utf-8", "replace").strip()
            data = json.loads(body) if body else []
            return data[0] if data else None
        except Exception as e:  # noqa: BLE001
            return {"error": f"{type(e).__name__}: {e}"}

    def export_image(self, data_url, filename):
        """SOP：把標籤或照片存成圖片檔（PNG 或 JPG）"""
        jpg = data_url.startswith("data:image/jpeg")
        name = Path(filename).with_suffix(".jpg" if jpg else ".png").name
        return self.export_file(data_url.split(",", 1)[1], name)

    def set_ime(self, mode):
        """SOP：輸入框取得焦點時切換輸入法：'zh' 中文、'en' 英數"""
        return _set_ime(mode == "zh")

    def export_file(self, b64, filename):
        """另存新檔（Excel、PDF 或 JSON 備份）；回傳儲存路徑，取消時回傳空字串"""
        ext = Path(filename).suffix.lower()
        try:
            text_mode = self._mod() == "sop" and ext == ".json"  # SOP 的備份傳的是文字，不是 base64
        except RuntimeError:
            text_mode = False
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
        if text_mode:
            path.write_text(b64, encoding="utf-8")
        else:
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

    # ---- 設備管家：和它原本程式（desktop_app.py）一樣的 /api/*，資料在 %APPDATA%\ShebeiGuanjia
    def _equip_dir(self):
        return MODULES["equip"][0]

    def _authorized(self):
        q = parse_qs(urlparse(self.path).query)
        return secrets.compare_digest(self.headers.get("X-SG-Token", "") or (q.get("t") or [""])[0], EQUIP_TOKEN)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n).decode("utf-8") if n else ""

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/"):
            if not self._authorized():
                return self._json({"ok": False}, 403)
            d = self._equip_dir()
            if u.path == "/api/db":
                def rj(f, default=None):
                    try:
                        return json.loads((d / f).read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        return default
                return self._json({"ok": True, "db": rj("data.json"), "prefs": rj("prefs.json", {}), "path": str(d)})
            if u.path == "/api/autostart":
                return self._json({"ok": True, "on": False})
            return self._json({"ok": False}, 404)
        # 設備管家桌面模式：網址自動補上 token（從首頁點進來時沒有）
        if u.path in ("/equip/", "/equip/index.html") and "desktop=1" in u.query and "t=" not in u.query:
            self.send_response(302)
            self.send_header("Location", f"/equip/index.html?{u.query}&t={EQUIP_TOKEN}")
            self.end_headers()
            return
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/") or not self._authorized():
            return self._json({"ok": False}, 403)
        d = self._equip_dir()
        try:
            if u.path == "/api/db":
                text = self._body()
                json.loads(text)  # 不寫入損壞的內容
                d.mkdir(parents=True, exist_ok=True)
                tmp = d / "data.json.tmp"
                tmp.write_text(text, encoding="utf-8")
                os.replace(tmp, d / "data.json")
                _daily_backup(d, text)
                return self._json({"ok": True})
            if u.path == "/api/prefs":
                prefs = json.loads(self._body() or "{}")
                d.mkdir(parents=True, exist_ok=True)
                tmp = d / "prefs.json.tmp"
                tmp.write_text(json.dumps(prefs, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, d / "prefs.json")
                return self._json({"ok": True})
            if u.path in ("/api/notify", "/api/bg", "/api/show"):
                return self._json({"ok": True})
            if u.path == "/api/autostart":
                return self._json({"ok": False, "error": "開機自動啟動請在原本的設備管家程式設定"})
            if u.path in ("/api/openfile", "/api/savefile"):
                q = parse_qs(u.query)
                name = os.path.basename((q.get("name") or ["file"])[0]) or "file"
                name = "".join(c for c in name if c not in '<>:"/\\|?*') or "file"
                text = self._body()
                is_data = text.startswith("data:") and ";base64," in text[:80]
                if u.path == "/api/openfile":
                    if not is_data:
                        return self._json({"ok": False, "error": "檔案格式錯誤"})
                    folder = Path(os.environ.get("TEMP") or d) / "ShebeiGuanjia"
                    folder.mkdir(parents=True, exist_ok=True)
                    target = folder / name
                    target.write_bytes(base64.b64decode(text.split(",", 1)[1]))
                    if not os.environ.get("KITCHEN_SELFTEST"):
                        os.startfile(str(target))  # 用預設程式開啟（PDF、照片）
                    return self._json({"ok": True, "path": str(target)})
                out = os.environ.get("KITCHEN_EXPORT_DIR")
                if out:
                    target = str(Path(out) / name)
                else:
                    ext = Path(name).suffix.lower()
                    res = _window.create_file_dialog(webview.FileDialog.SAVE, directory=str(Path.home() / "Documents"),
                                                     save_filename=name, file_types=(FILE_TYPES.get(ext, "所有檔案 (*.*)"),))
                    if not res:
                        return self._json({"ok": False, "cancelled": True})
                    target = res if isinstance(res, str) else res[0]
                if is_data:
                    Path(target).write_bytes(base64.b64decode(text.split(",", 1)[1]))
                else:
                    Path(target).write_text(text, encoding="utf-8", newline="")
                return self._json({"ok": True, "path": str(target)})
        except Exception as e:  # noqa: BLE001 - 回報錯誤，不要斷線
            return self._json({"ok": False, "error": str(e)}, 500)
        return self._json({"ok": False}, 404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # 更新 exe 後不吃舊快取
        super().end_headers()

    def log_message(self, *args):  # --windowed 時沒有 stderr
        pass


def _serve_site():
    """只綁本機的靜態伺服器；固定優先用同一個埠，網頁的 localStorage 才不會每次換一份"""
    handler = functools.partial(_QuietHandler, directory=str(SITE_DIR))
    httpd = None
    # 測試模式用隨機埠：Windows 上同一個埠可以被重複綁定，會連到使用者正在開的程式
    for port in ((0,) if _TEST_ROOT else (47816, 47817, 47818, 0)):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            continue
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}"


_mutexes = []


_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


def _pids_of(exe_name):
    """正在執行的 exe_name（例如 設備管家.exe）的 PID 清單"""
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH", "/FI", f"IMAGENAME eq {exe_name}"],
                             capture_output=True, text=True, encoding="mbcs", errors="replace",
                             creationflags=_NO_WINDOW, timeout=10).stdout
    except Exception:
        return []
    pids = []
    for line in out.splitlines():
        cols = [c.strip('"') for c in line.split('","')]
        if len(cols) > 1 and cols[0].lower() == exe_name.lower() and cols[1].isdigit():
            pids.append(int(cols[1]))
    return [p for p in pids if p != os.getpid()]


def _close_windows_of(pids):
    """送「關閉」給這些程式的視窗（等同按右上角 X，讓它們自己存檔後結束）"""
    user32 = ctypes.windll.user32
    want = set(pids)
    proto = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def cb(hwnd, _):
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(ctypes.c_void_p(hwnd), ctypes.byref(pid))
        if pid.value in want and user32.IsWindowVisible(ctypes.c_void_p(hwnd)):
            user32.PostMessageW(ctypes.c_void_p(hwnd), 0x0010, 0, 0)  # WM_CLOSE
        return True
    user32.EnumWindows(proto(cb), 0)


def _ask_equip_quit(folder):
    """新版設備管家有 /api/quit：存好資料、收起系統匣圖示後結束"""
    try:
        import urllib.request
        info = json.loads((folder / "instance.json").read_text(encoding="utf-8"))
        req = urllib.request.Request(f"http://127.0.0.1:{int(info['port'])}/api/quit", data=b"{}",
                                     headers={"X-SG-Token": info["token"]}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


def _stop_standalone(mod, label):
    """結束原本的單獨程式；成功（已經沒有在執行）回傳 True"""
    exe = f"{label}.exe"

    def wait_gone(sec):
        end = time.time() + sec
        while time.time() < end:
            if not _pids_of(exe):
                return True
            time.sleep(0.3)
        return not _pids_of(exe)

    if not _pids_of(exe):
        return False  # 找不到程式（可能用別的檔名），只能請使用者自己關
    if mod == "equip" and _ask_equip_quit(MODULES[mod][0]) and wait_gone(6):
        return True
    _close_windows_of(_pids_of(exe))
    if wait_gone(5):
        return True
    pids = _pids_of(exe)  # 在背景（系統匣）裡沒有視窗可關的，直接結束
    if pids:
        subprocess.run(["taskkill", "/F", "/T"] + sum([["/PID", str(p)] for p in pids], []),
                       capture_output=True, creationflags=_NO_WINDOW, timeout=15)
    return wait_gone(5)


def _single_instance():
    """本程式只開一個；原本的冰箱／菜品／SOP／設備管家單獨程式開著時，
    先問要不要幫忙關掉它（避免兩邊同時寫同一份資料）"""
    if _TEST_ROOT:
        return True
    k32 = ctypes.windll.kernel32
    msgbox = ctypes.windll.user32.MessageBoxW
    names = [("KitchenForms_SingleInstance", None, None)] + \
        [(m[2], m[1], mod) for mod, m in MODULES.items() if m[2]]
    for name, label, mod in names:
        h = k32.CreateMutexW(None, False, name)
        if k32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            if label is None:
                msgbox(None, "廚房專用表格系統已經在執行中。", APP_TITLE, 0x40)
                return False
            bg = "（它可能藏在右下角系統匣，在背景執行）" if mod == "equip" else ""
            ans = msgbox(None, f"「{label}」單獨程式正在執行{bg}。\n\n"
                               f"它和廚房專用表格系統共用同一份資料，不能同時開。\n\n"
                               f"要幫你關閉「{label}」，然後繼續開啟嗎？\n"
                               f"（選「否」可以先自己去關閉它）", APP_TITLE, 0x24)  # 是/否 + 問號
            if ans != 6:  # IDYES
                return False
            if not _stop_standalone(mod, label):
                msgbox(None, f"沒辦法自動關閉「{label}」。\n\n請在右下角系統匣的圖示上按右鍵 →「結束」，"
                             f"或從工作管理員結束它，再開啟廚房專用表格系統。", APP_TITLE, 0x30)
                return False
            # 我們拿到的這個 handle 會讓這個名稱一直存在，原本的程式之後就打不開（不會兩邊同時寫）
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
        # 冰箱月報表：中越雙語 PDF（桌面版直接另存）
        js("window.__fridge.flush(); location.hash = '#/month'")
        time.sleep(1.0)
        result["fridge_sheet_vi"] = js("(document.querySelector('.sheet .sh-vi') || {}).textContent || ''")
        js("document.querySelector('[data-act=print]').click()")
        exp = Path(os.environ.get("KITCHEN_EXPORT_DIR", "."))
        fpdfs = []
        for _ in range(40):
            time.sleep(0.5)
            fpdfs = [p for p in exp.glob("*冰箱溫度記錄表*.pdf") if p.stat().st_size > 10000]
            if fpdfs:
                break
        result["fridge_pdf"] = [[p.name, p.stat().st_size, p.read_bytes().count(b"/Type /Page\n")] for p in fpdfs]
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
        # 廚房 SOP：開啟、讀到範例食譜、存檔到 %APPDATA%\KitchenSOP、回首頁
        js("document.querySelector('.card.sop .btn').click()")
        result["sop_recipes"] = wait("window.__kitchen && window.__kitchen.db && window.__kitchen.db.recipes ? window.__kitchen.db.recipes.length : 0")
        result["sop_home_btn"] = bool(js("!!document.querySelector('.kn-home')"))
        js("window.__kitchen.persist(true)")
        time.sleep(1.0)
        sf = _data_file("sop")
        result["sop_saved"] = sf.exists() and len(json.loads(sf.read_text(encoding="utf-8")).get("recipes", [])) == result["sop_recipes"]
        js("document.querySelector('.kn-home').click()")
        result["back_home_4"] = wait("window.__kitchen && window.__kitchen.summary && window.__kitchen.summary.sop ? 1 : 0")
        result["sop_summary"] = js("JSON.stringify(window.__kitchen.summary.sop)")
        # 設備管家：開啟、桌面資料介面接上（%APPDATA%\\ShebeiGuanjia）、存檔、回首頁
        js("document.querySelector('.card.equip .btn').click()")
        result["equip_desktop"] = wait("window.SG && SG.desktop && SG.db && SG.db.loaded ? SG.desktop.dataPath : ''")
        js("SG.db.data.settings = SG.db.data.settings || {}; SG.db.data.settings.__kf_test = {id: '__kf_test', updatedAt: Date.now()}; SG.db.saveNow()")
        time.sleep(1.0)
        ef = _data_file("equip")
        result["equip_saved"] = ef.exists() and "__kf_test" in ef.read_text(encoding="utf-8")
        result["equip_home_btn"] = bool(js("!!document.querySelector('.kn-home')"))
        js("document.querySelector('.kn-home').click()")
        result["back_home_5"] = wait("window.__kitchen && window.__kitchen.summary && 'equip' in window.__kitchen.summary ? 1 : 0")
        # 統編紀錄系統、公里及油資紀錄系統：原封不動放進來，資料跟原本的程式同一份
        for mod, glob in (("taxid", "__taxid"), ("mileage", "__mf")):
            js(f"document.querySelector('.card.{mod} .btn').click()")
            result[f"{mod}_loaded"] = wait(f"window.{glob} && window.{glob}.db ? 1 : 0")
            result[f"{mod}_path"] = wait("window.pywebview && window.pywebview.api ? window.pywebview.api.data_path() : ''")
            js(f"window.{glob}.flush()")
            time.sleep(1.0)
            result[f"{mod}_saved"] = _data_file(mod).exists()
            result[f"{mod}_home_btn"] = bool(js("!!document.querySelector('.kn-home')"))
            js("document.querySelector('.kn-home').click()")
            result[f"{mod}_back"] = wait("document.querySelector('#cards .card') ? 1 : 0")
            time.sleep(0.5)
        time.sleep(0.3)
        result["kpis"] = js("[...document.querySelectorAll('.kpi')].map(e => e.innerText.replace(/\\n/g, ' '))")
        result["window"] = [_window.x, _window.y, _window.width, _window.height]
        fs = json.loads(result["fridge_summary"] or "null") or {}
        ds = json.loads(result["dish_summary"] or "null") or {}
        ps = json.loads(result.get("prep_summary") or "null") or {}
        result["ok"] = bool(result["home_cards"] == 9 and ps.get("done", 0) >= 2 and ps.get("sign") and result["prep_pdf"] and result["prep_saved"] and result["fridge_loaded"] and result["fridge_home_btn"]
                            and result["fridge_saved_today"] and fs.get("done", 0) >= 1 and result["fridge_pdf"] and result["fridge_sheet_vi"]
                            and result["dish_loaded"] and ds.get("t", {}).get("q", 0) >= 3
                            and result["sop_recipes"] and result["sop_saved"] and result["sop_home_btn"] and result["back_home_4"]
                            and result["equip_desktop"] and result["equip_saved"] and result["equip_home_btn"] and result["back_home_5"]
                            and all(result[f"{m}_{k}"] for m in ("taxid", "mileage") for k in ("loaded", "saved", "home_btn", "back")))
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
