#!/usr/bin/env python3
"""選單圖示合成：把多個方團團角色依指定位置疊成一張 512×512 透明 WebP。

Menu-art composer: stacks several dumpling characters at given positions into one 512x512
transparent WebP.

用法 / Usage:
    npm run menu-art            # 重新產生三張圖示 / regenerate all three icons
    python scripts/build-menu-art.py

角色來源是 `public/assets/character/<名>_img.webp`（已正規化為 512×512、本體 304px 的透明圖）；
合成前先按 alpha 邊界裁掉留白，所以「同樣 size」等於同樣的**視覺**大小，而不是同樣的畫布。
Sources are the normalised 512x512 transparent portraits; each is cropped to its alpha bounding
box first, so "same size" means the same **visual** size rather than the same canvas.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - 只在缺套件時觸發
    sys.exit("需要 Pillow / Pillow is required:  pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "assets" / "character"
OUTPUT = ROOT / "public" / "assets" / "menu"

CANVAS = 512

# 合成完收緊到內容後，四周留的比例（相對最長邊）。太小會貼邊，太大会把圖示縮回去。
# Margin kept around the content once it is tightened, as a fraction of the longest edge.
MARGIN = 0.04

# 每一格的疊法：(角色, 邊長上限, 中心點)。清單順序＝疊放順序，後者蓋在前者之上。
# Per-icon stacking: (character, longest edge, centre). List order is paint order — later sits on top.
LAYOUTS: dict[str, list[tuple[str, int, tuple[int, int]]]] = {
    # 管理員疊在祀與佩麗卡之上（腳踏在兩者的頭頂上）/ the Administrator over 祀 and 佩麗卡, feet on their heads.
    "merge": [
        ("祀", 200, (150, 335)),
        ("佩麗卡", 200, (362, 335)),
        ("管理員", 200, (256, 155)),
    ],
    # 湯湯 → 弭弗 → 莊方宜 由上而下堆疊（自下而上繪製）/ stacked top-down, painted bottom-up.
    "citybloxx": [
        ("莊方宜", 210, (256, 392)),
        ("弭弗", 210, (256, 256)),
        ("湯湯", 210, (256, 120)),
    ],
    # 一排三隻 / one row of three.
    "match3": [
        ("陳千語", 185, (95, 256)),
        ("佩麗卡", 185, (417, 256)),
        ("管理員", 185, (256, 256)),
    ],
}


def load_blob(name: str, size: int) -> Image.Image:
    """讀一張角色圖、裁掉 alpha 留白、等比縮到最長邊 size。

    Read one portrait, trim its alpha padding and scale it so its longest edge is `size`.

    @param name 角色名（不含 `_img.webp`）/ Character name without the suffix.
    @param size 縮放後的最長邊（px）/ Longest edge after scaling, in px.
    @return 已裁切與縮放的 RGBA 圖 / The cropped and scaled RGBA image.
    """
    path = SOURCE / f"{name}_img.webp"
    if not path.exists():
        sys.exit(f"找不到角色圖 / missing portrait: {path}")

    image = Image.open(path).convert("RGBA")
    box = image.getchannel("A").getbbox()
    if box is None:
        sys.exit(f"角色圖全透明 / fully transparent: {path}")

    blob = image.crop(box)
    blob.thumbnail((size, size), Image.LANCZOS)

    return blob


def compose(icon_id: str, parts: list[tuple[str, int, tuple[int, int]]]) -> Path:
    """依疊法合成一張圖示並寫成 WebP。

    Compose one icon from its stacking plan and write it as a WebP.

    @param icon_id 輸出檔名（不含副檔名）/ Output file stem.
    @param parts 疊放清單 / The stacking plan.
    @return 輸出的路徑 / The written path.
    """
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    for name, size, (cx, cy) in parts:
        blob = load_blob(name, size)
        width, height = blob.size
        canvas.alpha_composite(blob, (cx - width // 2, cy - height // 2))

    target = OUTPUT / f"{icon_id}.webp"
    target.parent.mkdir(parents=True, exist_ok=True)

    # 收緊到內容邊界再補成正方形：透明留白不參與版面，圖示才填得滿格子。
    # Tighten to the content bounds and re-pad to a square: transparent margin must not count, or
    # the icon floats inside its tile.
    box = canvas.getchannel("A").getbbox()
    content = canvas.crop(box) if box is not None else canvas
    side = round(max(content.size) * (1 + 2 * MARGIN))
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(
        content,
        ((side - content.width) // 2, (side - content.height) // 2),
    )

    square.save(target, "WEBP", lossless=True, method=6)

    return target


def main() -> None:
    """跑完三張圖示並列出結果。/ Builds every icon and lists what was written."""
    for icon_id, parts in LAYOUTS.items():
        target = compose(icon_id, parts)
        print(f"{target.relative_to(ROOT)}  ←  {' + '.join(part[0] for part in parts)}")


if __name__ == "__main__":
    main()
