"""組裝網站：python build_web.py → site\\（首頁 + fridge\\ + dish\\ + meal\\）

冰箱、菜品、員工餐的網頁版直接從原本的專案資料夾複製（之後在原專案修改，重新執行這支即可同步），
只在它們的 index.html 加上「首頁」按鈕（kitchen-nav.js）。
"""
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
}
# auth.js：人員權限（沒有權限的人由 kitchen-nav.js 送回首頁）
NAV_TAG = '<script src="../auth.js?v=3"></script>\n<script src="../kitchen-nav.js?v=7"></script>'


def build(out: Path = ROOT / "site") -> Path:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "portal", out, ignore=shutil.ignore_patterns("icon.svg"))
    for name, src in MODULES.items():
        if not (src / "index.html").exists():
            sys.exit(f"找不到 {src}\\index.html")
        dst = out / name
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__test*"))
        idx = dst / "index.html"
        html = idx.read_text(encoding="utf-8")
        # iPhone 主畫面 App：狀態列用不透明黑底，畫面從狀態列下面開始（不會被時間、電量擋到，也沒有淡出）
        html = html.replace('content="black-translucent"', 'content="black"')
        if NAV_TAG not in html:
            html = html.replace("</body>", f"{NAV_TAG}\n</body>", 1)
        idx.write_text(html, encoding="utf-8")
    print(f"網站已組裝：{out}")
    return out


if __name__ == "__main__":
    build(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "site")
