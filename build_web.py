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
NAV_TAG = '<script src="../kitchen-nav.js?v=3"></script>'


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
        if NAV_TAG not in html:
            html = html.replace("</body>", f"{NAV_TAG}\n</body>", 1)
        idx.write_text(html, encoding="utf-8")
    print(f"網站已組裝：{out}")
    return out


if __name__ == "__main__":
    build(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "site")
