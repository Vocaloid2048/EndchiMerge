"""把逐幀 PNG 合成 GIF（技能示意圖）。

每張圖先用「中間那一幀」算出一個共用調色盤，再把所有幀都量化到它 —— 每幀各自算調色盤會讓
顏色在播放時跳動，共用一個則穩定得多，檔案也更小。

Assemble the per-frame PNGs into GIFs. A single palette is derived from the middle frame and every
frame is quantised to it: per-frame palettes make the colours flicker during playback, while a shared
one is stable and smaller.
"""

import json
import tempfile
from pathlib import Path

from PIL import Image

FRAMES = Path(tempfile.gettempdir()) / "endchi-skill-gifs"
OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "skills"

# 每個技能的輸出寬度（像素）：寬的取景需要更寬才看得清數字。
WIDTHS = {
    "combo_grace": 560,
    "reshuffle": 420,
    "square_core": 640,
}
DEFAULT_WIDTH = 560
FPS = 12
COLORS = 64
# 動得多的（整堆顆粒在飛）用更少顏色換檔案大小。
# The busiest clips trade colours for file size.
COLORS_BY_SKILL = {
    "combo_grace": 24,
    "reshuffle": 24,
}
# 畫布是透明的，疊在這個單色上 —— 取遊戲背景在容器兩側的平均色。
# The canvas is transparent, so it is composited onto this flat colour: the game background's mean
# colour beside the container.
FLAT = (95, 94, 106)


def build(skill_id: str, directory: Path) -> tuple[int, int, int]:
    files = sorted(directory.glob("*.png"))
    if not files:
        raise SystemExit(f"{skill_id}: no frames")

    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    crop = meta.get("crop")

    width = WIDTHS.get(skill_id, DEFAULT_WIDTH)
    frames = []
    for file in files:
        image = Image.open(file)
        if crop is not None:
            w, h = image.size
            image = image.crop(
                (
                    round(w * crop["x"]),
                    round(h * crop["y"]),
                    round(w * (crop["x"] + crop["w"])),
                    round(h * (crop["y"] + crop["h"])),
                )
            )
        if image.mode == "RGBA":
            flat = Image.new("RGB", image.size, FLAT)
            flat.paste(image, mask=image.getchannel("A"))
            image = flat
        else:
            image = image.convert("RGB")
        height = round(image.height * width / image.width)
        frames.append(image.resize((width, height), Image.LANCZOS))

    reference = frames[len(frames) // 2]
    colors = COLORS_BY_SKILL.get(skill_id, COLORS)
    palette = reference.quantize(colors=colors, method=Image.MEDIANCUT)
    quantised = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{skill_id}.gif"
    quantised[0].save(
        target,
        save_all=True,
        append_images=quantised[1:],
        duration=round(1000 / FPS),
        loop=0,
        optimize=True,
        disposal=2,
    )
    return width, frames[0].height, target.stat().st_size


total = 0
for directory in sorted(FRAMES.iterdir()):
    if not directory.is_dir():
        continue
    width, height, size = build(directory.name, directory)
    total += size
    print(f"{directory.name:16s} {width}x{height}  {size / 1024:7.1f} KB")

print(f"{'total':16s}             {total / 1024:7.1f} KB")
