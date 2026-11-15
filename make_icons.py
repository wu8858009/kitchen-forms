"""由 portal/icons/icon.svg 產生 PWA 用 PNG 與 Windows 用 .ico"""
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parent
ICONS = ROOT / "portal" / "icons"


def render(size: int) -> QImage:
    img = QImage(size, size, QImage.Format_ARGB32)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    QSvgRenderer(str(ICONS / "icon.svg")).render(p, img.rect().toRectF())
    p.end()
    return img


def main() -> None:
    QGuiApplication.instance() or QGuiApplication(sys.argv)
    render(192).save(str(ICONS / "icon-192.png"))
    render(512).save(str(ICONS / "icon-512.png"))
    render(180).save(str(ICONS / "apple-touch-icon.png"))
    from PIL import Image
    big = ROOT / "build" / "icon-256.png"
    big.parent.mkdir(exist_ok=True)
    render(256).save(str(big))
    Image.open(big).save(ROOT / "app.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print("icons ok")


if __name__ == "__main__":
    main()
