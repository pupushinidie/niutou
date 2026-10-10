"""代码画的 16px 小图标：ready（扣着的小牌 + 绿色对勾）。

PixelLab v2 出的 64 个 ready 全是品红色的牌配荧光绿对勾，颜色跑出了调色板，所以改用代码画，
牌背和图集 0 号同一套酒红 + 黄铜，3 个变体。结果在 art/out/r2/icons/。
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out" / "r2" / "icons"


def hexa(h: str) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


INK, BACK, BACK_DK, BRASS, CREAM = (hexa(c) for c in ("#2a1a10", "#7a2a22", "#5a1c18", "#d9a441", "#fff4dc"))
GREEN, GREEN_LT, GREEN_DK = hexa("#44b860"), hexa("#7ad88a"), hexa("#2a7a3c")

CHECK = [  # 对勾：G 绿 L 亮 D 暗，外面再描 1px 深棕
    "......G",
    ".....GD",
    "G...GD.",
    "LG.GD..",
    ".LGD...",
    "..L....",
]


def card(img: Image.Image, x0: int, y0: int, w: int, h: int, tilt: bool = False) -> None:
    d = ImageDraw.Draw(img)
    d.rectangle([x0, y0, x0 + w - 1, y0 + h - 1], fill=BACK, outline=INK)
    d.rectangle([x0 + 2, y0 + 2, x0 + w - 3, y0 + h - 3], outline=BRASS)
    for y in range(y0 + 3, y0 + h - 3):
        for x in range(x0 + 3, x0 + w - 3):
            if (x + y) % 2 == 0:
                img.putpixel((x, y), BACK_DK)
    d.line([x0 + 1, y0 + 1, x0 + w - 2, y0 + 1], fill=hexa("#9a3a2e"))
    for x, y in ((x0, y0), (x0 + w - 1, y0), (x0, y0 + h - 1), (x0 + w - 1, y0 + h - 1)):
        img.putpixel((x, y), (0, 0, 0, 0))


def check(img: Image.Image, x0: int, y0: int) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    col = {"G": GREEN, "L": GREEN_LT, "D": GREEN_DK}
    for r, row in enumerate(CHECK):
        for c, v in enumerate(row):
            if v in col:
                layer.putpixel((x0 + c, y0 + r), col[v])
    # 描边
    px = layer.load()
    ring = []
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y][3]:
                continue
            if any(0 <= x + dx < img.width and 0 <= y + dy < img.height and px[x + dx, y + dy][3]
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                ring.append((x, y))
    for q in ring:
        layer.putpixel(q, INK)
    img.alpha_composite(layer)


def ready(variant: str) -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    if variant == "a":  # 一张竖牌，右下角对勾
        card(img, 1, 0, 10, 14)
        check(img, 8, 9)
    elif variant == "b":  # 两张叠着的牌（稍错开），对勾
        card(img, 4, 0, 9, 12)
        card(img, 1, 2, 9, 12)
        check(img, 8, 9)
    else:  # 牌放大一点，对勾在中间偏下
        card(img, 2, 0, 12, 15)
        check(img, 5, 6)
    return img


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for v in "abc":
        ready(v).save(OUT / f"ready-{v}.png")
    print(OUT)
