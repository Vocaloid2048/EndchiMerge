"""把逐幀 PNG 合成技能示意 GIF。

畫布本身是透明 PNG，所以先在 Python 疊上**真正的背景圖**（`public/assets/ui/background.webp`，
按 `background-size: cover` 與 `center` 對位裁切）。以前用單一灰色頂替 —— 那張背景中心是亮青、
四周是深灰，用平均值去填等於把整張圖的色調壓成一片死灰，容器內的玻璃白也會跟著偏。

調色盤取自**多幀攤平後的樣本**而不是單一中間幀：效果最劇烈的那一幀往往只有幾種顏色，
拿它當全域調色盤會讓其餘格數全部走樣。共用一個調色盤仍然必要 —— 每幀各算一次會讓顏色在
播放時閃動。

Assemble the per-frame PNGs into the skill GIFs. The canvas is a transparent PNG, so it is first
composited onto the **real backdrop** (`public/assets/ui/background.webp`, cropped to match
`background-size: cover` with `center`). A single grey used to stand in for it, but that backdrop is
bright teal at the centre and dark grey at the edges: filling with the mean colour flattens the whole
palette, and the container's glass fill shifts with it.

The palette comes from a **montage of several frames** rather than one middle frame: the most
dramatic frame often holds only a handful of colours, and using it as the global palette distorts
every other frame. One shared palette is still essential — per-frame palettes make colours flicker.
"""

import json
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
FRAMES = Path(tempfile.gettempdir()) / "endchi-skill-gifs"
OUT = ROOT / "public" / "assets" / "skills"
BACKDROP = ROOT / "public" / "assets" / "ui" / "background.webp"

# 每個技能的輸出寬度（像素）：寬的取景需要更寬才看得清數字。
# Output width per skill: a wide framing needs the extra pixels for the numbers to stay legible.
WIDTHS = {
    "combo_grace": 560,
    "reshuffle": 500,
    # 以方代圓整塊畫布進圖，碰撞體那幾個點佔的比例很小，所以輸出寬一點。
    # Square Rule shows the whole canvas and the collider dots are a tiny part of it, so it renders wider.
    "square_core": 760,
}
DEFAULT_WIDTH = 560
FPS = 12

# 在 GIF 的 256 色上限內盡量給足：照片背景 ＋ 十級角色立繪在 64 色下走樣得很明顯。
# Go near the GIF ceiling of 256: a photographic backdrop plus ten character sprites drifts badly at 64.
COLORS = 160
# 動得最多的兩張（整堆顆粒在飛）用少一點顏色換檔案大小。
# The two busiest clips trade a few colours for file size.
COLORS_BY_SKILL = {
    "combo_grace": 112,
    "reshuffle": 96,
    "shake": 120,
}


def backdrop_crop(viewport: dict, clip: dict, size: tuple[int, int]) -> Image.Image:
    """按 `cover` ＋ `center` 取出畫面對應的那塊背景。 / The backdrop region behind the frame."""
    image = Image.open(BACKDROP).convert("RGB")
    scale = max(viewport["width"] / image.width, viewport["height"] / image.height)
    offset_x = (viewport["width"] - image.width * scale) / 2
    offset_y = (viewport["height"] - image.height * scale) / 2

    box = (
        (clip["x"] - offset_x) / scale,
        (clip["y"] - offset_y) / scale,
        (clip["x"] + clip["width"] - offset_x) / scale,
        (clip["y"] + clip["height"] - offset_y) / scale,
    )
    return image.crop(tuple(round(value) for value in box)).resize(size, Image.LANCZOS)


def palette_sheet(frames: list[Image.Image], colors: int) -> tuple[Image.Image, int]:
    """把幾幀攤平成一張樣本圖，供全域調色盤使用；另外回傳一個留空的透明索引。

    Flatten a few frames into one palette sample, and return a spare index for transparency.

    留空的做法是「少收一個顏色，再把最後一格填成品紅」：品紅不在遊戲的色域裡，所以量化時
    不會有像素被吸過去，那一格就空著可以當透明色。若不先留空，就只能搶一個真的在用的顏色，
    把它改成透明會在畫面上挖出洞。
    The spare slot comes from asking for one colour fewer and painting the last entry magenta:
    magenta is outside the game's gamut, so quantisation never sends a pixel there and the slot
    stays free for transparency. Without reserving it, the only option is to hijack a colour that
    is actually in use, and turning that transparent punches holes in the picture.
    """
    picks = [frames[round(index * (len(frames) - 1) / 4)] for index in range(5)]
    thumbs = [
        frame.resize((240, round(frame.height * 240 / frame.width)), Image.LANCZOS)
        for frame in picks
    ]

    sheet = Image.new("RGB", (240, sum(thumb.height for thumb in thumbs)))
    top = 0
    for thumb in thumbs:
        sheet.paste(thumb, (0, top))
        top += thumb.height

    palette = sheet.quantize(colors=max(2, colors - 1), method=Image.MEDIANCUT)
    transparent = max(1, colors - 1)

    entries = list(palette.getpalette()) + [0, 0, 0] * 256
    entries[3 * transparent : 3 * transparent + 3] = [255, 0, 255]
    palette.putpalette(entries[:768])
    return palette, transparent


def write_gif(target: Path, frames: list[Image.Image], palette: Image.Image, transparent: int) -> None:
    """寫出 GIF：只重畫有變化的像素，其餘留透明。

    Write the GIF, repainting only the pixels that changed and leaving the rest transparent.

    背景是靜態的，但 GIF 的每一格都是完整畫面 —— 同一張照片背景被 LZW 重複編碼幾十次，就是
    之前 36MB 的來源。用「與上一格逐像素比較、沒變的填透明色」加上 `disposal=1`（保留前格），
    背景只付一次，而畫面內容一點沒少。
    The backdrop never moves, yet every GIF frame is a full picture — the same photograph going
    through LZW dozens of times is what produced 36MB. Comparing each frame with the previous one and
    filling the unchanged pixels with the transparent index (with `disposal=1`, which keeps the
    previous frame) charges for the backdrop once and loses nothing on screen.
    """
    quantised = [
        frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames
    ]

    # 品紅格理論上不會被選中（不在遊戲色域內），但一旦有像素真的落在它上面，那格就會變成
    # 透明的洞。把這種像素推回索引 0：極少數像素偏色，總好過畫面上出現穿孔。
    # The magenta slot should never be chosen (it is outside the game's gamut), but if a pixel did
    # land on it, that pixel would become a transparent hole. Such pixels are pushed back to index
    # 0: a handful of slightly off pixels beats punctures in the picture.
    for image in quantised:
        raw = image.tobytes()
        if bytes([transparent]) in raw:
            image.putdata([0 if value == transparent else value for value in raw])

    patches = [quantised[0].copy()]
    previous = frames[0]
    for frame, image in zip(frames[1:], quantised[1:]):
        changed = ImageChops.difference(frame, previous).convert("L").point(
            lambda value: 255 if value > 0 else 0
        )
        patch = image.copy()
        patch.paste(transparent, mask=ImageChops.invert(changed))
        patches.append(patch)
        previous = frame

    patches[0].save(
        target,
        save_all=True,
        append_images=patches[1:],
        duration=round(1000 / FPS),
        loop=0,
        disposal=1,
        transparency=transparent,
        optimize=False,
    )


def build(skill_id: str, directory: Path) -> tuple[int, int, int]:
    files = sorted(directory.glob("*.png"))
    if not files:
        raise SystemExit(f"{skill_id}: no frames")

    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    page_shot = meta.get("mode") == "page"

    width = WIDTHS.get(skill_id, DEFAULT_WIDTH)
    frames = []

    for file in files:
        image = Image.open(file)
        if page_shot:
            image = image.convert("RGB")
        else:
            if image.mode != "RGBA":
                image = image.convert("RGBA")
            flat = backdrop_crop(meta["viewport"], meta["clip"], image.size)
            flat.paste(image, mask=image.getchannel("A"))
            image = flat

        height = round(image.height * width / image.width)
        frames.append(image.resize((width, height), Image.LANCZOS))

    colors = COLORS_BY_SKILL.get(skill_id, COLORS)
    palette, transparent = palette_sheet(frames, colors)

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{skill_id}.gif"
    write_gif(target, frames, palette, transparent)
    return width, frames[0].height, target.stat().st_size


total = 0
for directory in sorted(FRAMES.iterdir()):
    if not directory.is_dir():
        continue
    width, height, size = build(directory.name, directory)
    total += size
    print(f"{directory.name:16s} {width}x{height}  {size / 1024:7.1f} KB")

print(f"{'total':16s}             {total / 1024:7.1f} KB")
