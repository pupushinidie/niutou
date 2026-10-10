"""把一批 v2 候选（64 张）拼成带编号的总览图，方便挑：每张放大 k 倍，左半夜间底色、右半白天底色。

用法：python art/sheet.py <文件夹名 ...>   （art/out/r1/<名字>/ → art/out/r1/<名字>.sheet.png）
"""
from __future__ import annotations

import pathlib
import re
import sys

from PIL import Image, ImageDraw

import placeholders as ph

OUT = pathlib.Path(__file__).resolve().parent / "out" / "r1"


def index_of(path: pathlib.Path) -> int:
    if path.stem == path.parent.name:  # 第一张没有序号（名字里本身可能带数字，比如 head-16）
        return 0
    m = re.search(r"-(\d+)$", path.stem)
    return int(m.group(1)) if m else 0


def sheet(name: str, cols: int = 8) -> pathlib.Path:
    folder = OUT / name
    files = sorted((p for p in folder.glob("*.png") if not p.name.endswith("sheet.png")), key=index_of)
    imgs = [Image.open(p).convert("RGBA") for p in files]
    w, h = imgs[0].size
    k = max(1, 96 // max(w, h))
    cw, ch = w * k + 8, h * k + 16
    rows = (len(imgs) + cols - 1) // cols
    canvas = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 255))
    d = ImageDraw.Draw(canvas)
    for i, (path, img) in enumerate(zip(files, imgs)):
        x, y = (i % cols) * cw, (i // cols) * ch
        half = cw // 2
        d.rectangle([x, y, x + half - 1, y + ch - 1], fill=(30, 19, 19, 255))
        d.rectangle([x + half, y, x + cw - 1, y + ch - 1], fill=(244, 236, 220, 255))
        canvas.alpha_composite(img.resize((w * k, h * k), Image.NEAREST), (x + 4, y + 12))
        ph.text35(canvas, str(index_of(path)), x + 10, y + 5, (255, 230, 120, 255), 1)
    out = OUT / f"{name}.sheet.png"
    canvas.save(out)
    return out


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(sheet(arg))
