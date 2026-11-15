"""發布網頁版：python deploy_pages.py → 組裝 site\\ 並推送到 GitHub 的 gh-pages 分支

網址：https://wu8858009.github.io/kitchen-forms/
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import build_web

ROOT = Path(__file__).resolve().parent
REPO = "https://github.com/wu8858009/kitchen-forms.git"


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True, encoding="utf-8").stdout


def main() -> None:
    site = build_web.build()
    tmp = Path(tempfile.mkdtemp(prefix="kitchen-pages-"))
    try:
        exists = subprocess.run(["git", "ls-remote", "--exit-code", "--heads", REPO, "gh-pages"], capture_output=True).returncode == 0
        if exists:
            git("clone", "-q", "--depth", "1", "-b", "gh-pages", REPO, str(tmp), cwd=ROOT)
        else:
            git("init", "-q", "-b", "gh-pages", str(tmp), cwd=ROOT)
            git("remote", "add", "origin", REPO, cwd=tmp)
        for p in tmp.iterdir():  # 清掉舊檔（保留 .git）
            if p.name != ".git":
                shutil.rmtree(p) if p.is_dir() else p.unlink()
        shutil.copytree(site, tmp, dirs_exist_ok=True)
        (tmp / ".nojekyll").write_text("", encoding="utf-8")
        git("add", "-A", cwd=tmp)
        if not git("status", "--porcelain", cwd=tmp).strip():
            print("網站沒有變更，不用發布")
            return
        msg = sys.argv[1] if len(sys.argv) > 1 else "更新網頁版"
        git("commit", "-q", "-m", msg, cwd=tmp)
        git("push", "-q", "origin", "gh-pages", cwd=tmp)
        print("已發布：https://wu8858009.github.io/kitchen-forms/")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
