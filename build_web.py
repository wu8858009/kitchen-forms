"""組裝網站：python build_web.py → site\\（首頁 + fridge\\ + dish\\ + meal\\ + prep\\ + sop\\）

冰箱、菜品、員工餐的網頁版直接從原本的專案資料夾複製（之後在原專案修改，重新執行這支即可同步），
只在它們的 index.html 加上「首頁」按鈕（kitchen-nav.js）。
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VSCODE = ROOT.parent
MODULES = {
    "fridge": VSCODE / "冰箱溫度記錄表系統" / "web",
    "dish": VSCODE / "菜品銷售紀錄系統" / "web",
    "meal": VSCODE / "員工餐金額總計" / "web",
    "prep": ROOT / "prep",
    "sop": VSCODE / "廚房SOP食譜及倍數計算系統" / "web",
    "equip": VSCODE / "設備更換紀錄及價位",  # 網頁檔案直接放在專案資料夾
    "energy": VSCODE / "碧潭水電瓦斯抄表",  # 線上版（GitHub Pages）的網頁檔案
}
# 只複製網頁需要的檔案（沒列的系統整個資料夾都複製）
ONLY = {"equip": ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "icons"], "energy": ["index.html", "manifest.json", "icons"]}
# auth.js：人員權限（沒有權限的人由 kitchen-nav.js 送回首頁）
NAV_TAG = '<script src="../auth.js?v=10"></script>\n<script src="../kitchen-nav.js?v=15"></script>'
# 統一暗色配色：在 <html> 標上 kf-dark kf-<系統>，再載入共用主題（要在各系統自己的樣式之後才蓋得過去）；
# 設備管家、冰箱、菜品另外固定用它們自己的暗色模式（data-theme=dark）
THEME_TAG = (
    '<script>(function(){var m=(location.pathname.match(/\\/(fridge|prep|dish|meal|sop|equip|energy)\\//)||[])[1]||"";'
    'var d=document.documentElement;d.classList.add("kf-dark","kf-"+m);'
    'if(m==="equip"||m==="fridge"||m==="dish"){d.dataset.theme="dark";new MutationObserver(function(){if(d.dataset.theme!=="dark")d.dataset.theme="dark";})'
    '.observe(d,{attributes:true,attributeFilter:["data-theme"]});}'
    # 水電瓦斯抄表：固定打開它自己的深色模式（body.dark-mode）；不改它記在瀏覽器的設定，原本的網站不受影響
    'if(m==="energy"){var e=function(){var b=document.body;if(!b)return;b.classList.add("dark-mode");'
    'new MutationObserver(function(){if(!b.classList.contains("dark-mode"))b.classList.add("dark-mode");})'
    '.observe(b,{attributes:true,attributeFilter:["class"]});};'
    'if(document.body)e();else document.addEventListener("DOMContentLoaded",e);'
    # 雲端回「要登入」(401) 時通知 kitchen-nav.js 用管理者分發的帳號自動登入（不用它的登入畫面）
    'var of=window.fetch;window.fetch=function(u,o){var p=of.apply(this,arguments);'
    'try{if(String(u).indexOf("script.google.com")>=0&&o&&typeof o.body==="string"&&o.body.indexOf("\\"p\\":")>=0){'
    'p.then(function(r){r.clone().json().then(function(j){if(j&&j.s===401){window.__kfE401=1;window.dispatchEvent(new Event("kf-energy-401"));}})["catch"](function(){});})["catch"](function(){});}}catch(x){}'
    'return p;};}})();</script>\n'
    '<link rel="stylesheet" href="../kitchen-theme.css?v=4">'
)


def build(out: Path = ROOT / "site") -> Path:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "portal", out, ignore=shutil.ignore_patterns("icon.svg"))
    for name, src in MODULES.items():
        if not (src / "index.html").exists():
            sys.exit(f"找不到 {src}\\index.html")
        dst = out / name
        if name in ONLY:
            dst.mkdir(parents=True)
            for item in ONLY[name]:
                (shutil.copytree if (src / item).is_dir() else shutil.copy2)(src / item, dst / item)
        else:
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__test*"))
        idx = dst / "index.html"
        html = idx.read_text(encoding="utf-8")
        # iPhone 主畫面 App：狀態列用不透明黑底，畫面從狀態列下面開始（不會被時間、電量擋到，也沒有淡出）
        html = html.replace('content="black-translucent"', 'content="black"')
        if THEME_TAG not in html:
            html = html.replace("</head>", f"{THEME_TAG}\n</head>", 1)
        html = re.sub(r'<meta name="theme-color" content="[^"]*">', '<meta name="theme-color" content="#050b17">', html)
        if NAV_TAG not in html:
            # 放在「最後一個」</body> 前面（有的系統程式碼的文字裡也有 </body>，例如報表範本）
            i = html.rfind("</body>")
            html = html[:i] + f"{NAV_TAG}\n" + html[i:]
        idx.write_text(html, encoding="utf-8")
    print(f"網站已組裝：{out}")
    return out


if __name__ == "__main__":
    build(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "site")
