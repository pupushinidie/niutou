"""定稿总览：art/out/final/ 里的小图按 2 倍放在夜间底（上）和白天底（下）各一排，场景另拼一张。给自己查图用。
用法：python art/overview.py → art/out/final-overview.png、art/out/final-scenes.png
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
FINAL = ART / "out" / "final"
NIGHT, DAY = (30, 19, 19, 255), (244, 236, 220, 255)


def main() -> None:
    files = sorted(p for p in FINAL.rglob("*.png") if "scene" not in p.parts and "cards-" not in p.name)
    k, pad, width = 2, 10, 1500
    placed, x, y, row_h = [], pad, pad, 0
    for p in files:
        im = Image.open(p).convert("RGBA")
        big = im.resize((im.width * k, im.height * k), Image.NEAREST)
        if x + big.width > width:
            x, y, row_h = pad, y + row_h + pad + 12, 0
        placed.append((p, big, x, y))
        x += big.width + pad
        row_h = max(row_h, big.height)
    half = y + row_h + pad + 12
    canvas = Image.new("RGBA", (width, half * 2), NIGHT)
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, half, width, half * 2], fill=DAY)
    for p, big, px, py in placed:
        for off in (0, half):
            canvas.alpha_composite(big, (px, py + off + 12))
            d.text((px, py + off), p.stem[:14], fill=(255, 0, 255, 255))
    canvas.convert("RGB").save(ART / "out" / "final-overview.png")
    scenes = sorted((FINAL / "scene").glob("*.png"))
    sc = Image.new("RGB", (512 * 2 + 10, (288 + 10) * ((len(scenes) + 1) // 2)), (60, 60, 60))
    for i, p in enumerate(scenes):
        sc.paste(Image.open(p).convert("RGB"), ((i % 2) * 522, (i // 2) * 298))
    sc.save(ART / "out" / "final-scenes.png")
    print(ART / "out" / "final-overview.png")


if __name__ == "__main__":
    main()
