#!/usr/bin/env python3
"""由設計素材產生遊戲用精靈圖：512×512、透明 padding、lossless WebP。
Build 512×512 padded lossless-WebP sprites from the design assets.

用法 / Usage:
    python scripts/build-character-image.py <名> [<名> ...] [--dry-run]
    npm run sprite -- <名>

來源 / Sources (預設 / defaults):
    <workspace>/Assets/<名>.svg        設計檔，讀 viewBox 與本體方框
    <workspace>/Assets/png/<名>.png    512 寬渲染圖（找不到時退回 <名>_img.png）
輸出 / Output:
    public/assets/character/<名>_img.webp
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # 缺 Pillow 就給明確指引，而不是丟 traceback / clear hint, not a traceback
    sys.exit("缺少 Pillow / Pillow missing — 請執行 / run: pip install Pillow")

# 輸出畫布正規化常數 / Output normalisation constants
CANVAS = 512
BODY = 304           # 本體外方框在輸出畫布上的邊長 / body outer square edge on the output canvas
ANCHOR = (256, 328)  # 本體中心在輸出畫布上的位置 / body centre on the output canvas
ALPHA_T = 8          # 內容 bbox 的 alpha 門檻 / alpha threshold for the content bbox
STROKE_HALF = 2.5    # 本體 5px 描邊的一半 / half of the body's 5px stroke

REPO = Path(__file__).resolve().parents[1]   # EndchiMerge/
WORKSPACE = REPO.parent                       # 團圓大作戰/
DEF_ASSETS = WORKSPACE / "Assets"
DEF_OUT = REPO / "public" / "assets" / "character"
LANCZOS = getattr(Image, "Resampling", Image).LANCZOS


def find_body(svg_text):
    """回傳 (vbW, vbH, bx, by, bw, bh)：viewBox 尺寸與本體方框（面積最大的正方形 rect 或正方 path）。
    Return (vbW, vbH, bx, by, bw, bh): viewBox size and the body box (largest square rect or square path)."""
    m = re.search(r'viewBox="([^"]+)"', svg_text)
    if not m:
        raise ValueError("SVG 沒有 viewBox / no viewBox")
    vb = [float(x) for x in m.group(1).split()]

    cands = []
    for tag in re.findall(r"<rect[^>]*>", svg_text):
        g = lambda k: (lambda r: float(r.group(1)) if r else None)(re.search(k + r'="([^"]+)"', tag))
        w, h = g("width"), g("height")
        if w and h:
            cands.append((w * h, g("x") or 0.0, g("y") or 0.0, w, h))
    for d in re.findall(r'\bd="([^"]+)"', svg_text):
        v = [float(x) for x in re.findall(r"-?\d+\.?\d*(?:e-?\d+)?", d)]
        xs, ys = v[0::2], v[1::2]
        if not xs or not ys:
            continue
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if abs(w - h) < 1.0 and w > 100:  # 方形本體 / square body
            cands.append((w * h, min(xs), min(ys), w, h))

    if not cands:
        raise ValueError("找不到本體方框 / no square body found")
    _, x, y, w, h = max(cands)
    return vb[2], vb[3], x, y, w, h


def content_bbox(im):
    """內容（alpha > ALPHA_T）的邊界框，用於裁切檢查。
    Bounding box of the content (alpha > ALPHA_T), used for the clip check."""
    return im.getchannel("A").point(lambda a: 255 if a > ALPHA_T else 0).getbbox()


def build(name, assets, out_dir, dry_run):
    """處理單一角色，回傳一列統計。/ Process one character and return a stats row."""
    svg_path = assets / f"{name}.svg"
    if not svg_path.exists():
        raise FileNotFoundError(f"找不到設計檔 / no SVG: {svg_path}")
    png_path = next(
        (p for p in (assets / "png" / f"{name}.png", assets / "png" / f"{name}_img.png") if p.exists()),
        None,
    )
    if png_path is None:
        raise FileNotFoundError(f"找不到來源 PNG / no source PNG for {name}")

    vbW, vbH, bx, by, bw, bh = find_body(svg_path.read_text(encoding="utf-8"))
    im = Image.open(png_path).convert("RGBA")
    W, H = im.size
    s = W / vbW                        # 來源 px / viewBox 單位 / source px per viewBox unit
    box = (bw + 2 * STROKE_HALF) * s   # 本體含描邊的外框邊長 / outer body box incl. stroke
    bcx = (bx - STROKE_HALF) * s + box / 2
    bcy = (by - STROKE_HALF) * s + box / 2
    g = BODY / box                     # 正規化縮放 / normalisation scale

    nw, nh = max(1, round(W * g)), max(1, round(H * g))
    scaled = im.convert("RGBa").resize((nw, nh), LANCZOS).convert("RGBA")
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ox, oy = round(ANCHOR[0] - bcx * g), round(ANCHOR[1] - bcy * g)
    canvas.alpha_composite(scaled, (ox, oy))

    cb = content_bbox(canvas)
    clipped = cb[0] <= 0 or cb[1] <= 0 or cb[2] >= CANVAS - 1 or cb[3] >= CANVAS - 1
    dst = out_dir / f"{name}_img.webp"
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        canvas.save(dst, "WEBP", lossless=True, quality=100, method=6)

    return {
        "name": name,
        "src": f"{W}×{H}",
        "box": box,
        "scale": g,
        "offset": (ox, oy),
        "bbox": cb,
        "clipped": clipped,
        "bytes": dst.stat().st_size if (not dry_run and dst.exists()) else 0,
        "dst": dst,
    }


def main():
    ap = argparse.ArgumentParser(description="產生 512×512 lossless WebP 角色精靈圖 / build 512×512 character sprites")
    ap.add_argument("names", nargs="+", help="角色名（對應 Assets/<名>.svg）/ character name")
    ap.add_argument("--assets", type=Path, default=DEF_ASSETS, help=f"設計素材根目錄 / design assets root (預設 {DEF_ASSETS})")
    ap.add_argument("--out", type=Path, default=DEF_OUT, help=f"輸出路徑 / output directory (預設 {DEF_OUT})")
    ap.add_argument("--dry-run", action="store_true", help="只計算與檢查，不寫檔 / compute and check only")
    args = ap.parse_args()

    rows, failed = [], []
    for name in args.names:
        try:
            rows.append(build(name, args.assets, args.out, args.dry_run))
        except Exception as e:  # 逐個角色失敗不中斷其餘 / one failure must not abort the rest
            failed.append((name, str(e)))

    print("| 角色 | 來源 | 本體外框 | 縮放 | 貼上位移 | 內容 bbox | WebP | 裁切? |")
    print("|---|---|---|---|---|---|---|---|")
    for r in rows:
        cut = "⚠ 貼邊" if r["clipped"] else "✓"
        wb = f"{r['bytes'] / 1024:.1f} KB" if r["bytes"] else "—"
        print(f"| {r['name']} | {r['src']} | {r['box']:.1f} | {r['scale']:.3f} | {r['offset']} | {r['bbox']} | {wb} | {cut} |")

    tail = "（dry-run，未寫檔）" if args.dry_run else f"→ {args.out}"
    print(f"\n{len(rows)} 成功、{len(failed)} 失敗 {tail}")

    if failed:
        for n, msg in failed:
            print(f"FAILED  {n}  {msg}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
