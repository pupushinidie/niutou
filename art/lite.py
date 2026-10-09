"""谁是牛头王「简洁版」美术：全部用代码画，能直接上线；正式美术（PixelLab）定稿后按同样的文件名覆盖。

文件名、尺寸、帧数和 art/spec.md 完全一样（界面已经按这些文件排版）。不画任何字母和文字。
生成后把每个文件的哈希写进 art/placeholders.json（kind = "lite"），
`python art/placeholders.py --check` 会列出哪些还是简洁版、没被正式图替换。

用法：~/miniconda3/envs/quant/bin/python art/lite.py           # 生成到 apps/web/public/art/
     ~/miniconda3/envs/quant/bin/python art/lite.py --sheet   # 另存总览到 art/out/lite-sheet.png（不进仓库）
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
import random
import sys

from PIL import Image, ImageDraw

import cards
import placeholders as ph
from placeholders import P, rgba, shade

ART = pathlib.Path(__file__).resolve().parent
PUBLIC = ART.parent / "apps" / "web" / "public" / "art"
MANIFEST = ART / "placeholders.json"
INK = rgba(P["ink"])
CREAM = rgba(P["cream"])
CLEAR = (0, 0, 0, 0)

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def C(h: str, a: int = 255):
    return rgba(h, a)


# ====================================================================== 光照：按灯位算亮度，量化成几档 + 抖动
def relight(img: Image.Image, lamps: list[tuple[int, int, int, float]], ambient: float, vignette: float,
            warm=(255, 200, 110), levels: float = 0.12) -> Image.Image:
    """lamps: (x, y, 半径, 强度)。亮度 = 环境 + 灯光 − 暗角，按 levels 一档量化（4×4 抖动），暖色加在亮处。"""
    w, h = img.size
    src = img.load()
    out = Image.new("RGBA", img.size)
    dst = out.load()
    for y in range(h):
        for x in range(w):
            light = ambient
            for lx, ly, r, s in lamps:
                d = math.hypot((x - lx) * 0.9, y - ly)
                if d < r:
                    light += s * (1 - d / r) ** 1.6
            dx, dy = (x - w / 2) / (w / 2), (y - h / 2) / (h / 2)
            light -= vignette * max(0.0, (dx * dx + dy * dy) ** 0.5 - 0.55)
            t = (BAYER[y % 4][x % 4] + 0.5) / 16 - 0.5
            q = round(light / levels + t) * levels
            q = max(0.25, min(1.45, q))
            r0, g0, b0, a0 = src[x, y]
            warmth = max(0.0, q - 1.0)
            r1 = r0 * q + warm[0] * warmth * 0.25
            g1 = g0 * q + warm[1] * warmth * 0.18
            b1 = b0 * q + warm[2] * warmth * 0.05
            dst[x, y] = (min(255, round(r1)), min(255, round(g1)), min(255, round(b1)), a0)
    return out


def planks_v(d: ImageDraw.ImageDraw, box, colors, rng, width=(14, 22), seam=None):
    x0, y0, x1, y1 = box
    x = x0
    while x < x1:
        pw = rng.randint(*width)
        c = rng.choice(colors)
        d.rectangle([x, y0, min(x1, x + pw - 1), y1], fill=c)
        for _ in range(3):  # 木纹
            gx = x + rng.randint(2, max(2, pw - 3))
            gy = rng.randint(y0, y1)
            d.line([gx, gy, gx, min(y1, gy + rng.randint(8, 30))], fill=shade(c, 0.9))
        d.line([x, y0, x, y1], fill=seam or shade(c, 0.6))
        for ny in (y0 + 6, y1 - 6):  # 钉子
            if y1 - y0 > 20:
                d.point([(x + 3, ny), (x + pw - 4, ny)], fill=shade(c, 0.55))
        x += pw


def planks_h(d: ImageDraw.ImageDraw, box, colors, rng, perspective=True):
    """地板：越往下木板越宽（近大远小）。"""
    x0, y0, x1, y1 = box
    y, k = y0, 0
    while y <= y1:
        hgt = 3 + (k * 2 if perspective else 4)
        c = colors[k % len(colors)]
        d.rectangle([x0, y, x1, min(y1, y + hgt - 1)], fill=c)
        d.line([x0, y, x1, y], fill=shade(c, 0.62))
        off = rng.randint(0, 60)
        step = 40 + k * 18
        for sx in range(x0 + off, x1, step):  # 木板接缝
            d.line([sx, y, sx, min(y1, y + hgt - 1)], fill=shade(c, 0.62))
        y += hgt
        k += 1


def horseshoe(d, x, y, s=1, c=None):
    c = c or C("#8a8f99")
    d.arc([x, y, x + 9 * s, y + 10 * s], -40, 220, fill=INK, width=3 * s)
    d.arc([x + s, y + s, x + 8 * s, y + 9 * s], -40, 220, fill=c, width=2 * s)
    d.point([(x + 2 * s, y + 4 * s), (x + 7 * s, y + 4 * s)], fill=INK)


def hat(d, x, y, c=None):
    c = c or C("#7a4a2a")
    d.ellipse([x, y + 8, x + 22, y + 13], fill=shade(c, 0.85), outline=INK)
    d.rounded_rectangle([x + 6, y, x + 16, y + 10], 3, fill=c, outline=INK)
    d.line([x + 7, y + 7, x + 15, y + 7], fill=C("#3a2418"))
    d.line([x + 8, y + 2, x + 9, y + 2], fill=shade(c, 1.2))


def lasso(d, x, y):
    for i, r in enumerate((10, 8, 6)):
        d.ellipse([x - r, y - r + i, x + r, y + r + i], outline=C("#b0894a"))
    d.line([x + 6, y + 8, x + 9, y + 18], fill=C("#b0894a"))
    d.point([(x - 10, y), (x + 10, y + 1)], fill=C("#86613a"))


def sconce(d, x, y):
    d.rectangle([x - 3, y + 4, x + 3, y + 7], fill=C(P["brass_dk"]), outline=INK)
    d.rectangle([x - 2, y - 4, x + 2, y + 3], fill=C("#fff1c0"), outline=C(P["brass_dk"]))
    d.point([(x, y - 2), (x, y - 1)], fill=C(P["lamp_dk"]))


def table_lamp(d, x, y):
    d.ellipse([x - 6, y + 10, x + 6, y + 16], fill=C(P["brass_dk"]), outline=INK)
    d.rectangle([x - 4, y + 4, x + 4, y + 11], fill=C(P["brass"]), outline=INK)
    d.ellipse([x - 4, y - 8, x + 4, y + 5], fill=C("#fff4dc", 255), outline=C("#c9a46a"))
    d.ellipse([x - 2, y - 4, x + 2, y + 2], fill=C(P["lamp"]))
    d.point([(x, y - 3)], fill=C("#ffffff"))


def felt_table(d, cx, top, w_top, w_bot, bottom, rng):
    """透视的绿呢牌桌：上窄下宽的梯形 + 木边。"""
    l0, r0 = cx - w_top // 2, cx + w_top // 2
    l1, r1 = cx - w_bot // 2, cx + w_bot // 2
    d.polygon([(l0 - 8, top - 6), (r0 + 8, top - 6), (r1 + 14, bottom), (l1 - 14, bottom)], fill=C(P["wood"]), outline=INK)
    d.polygon([(l0 - 8, top - 6), (r0 + 8, top - 6), (r0 + 6, top - 4), (l0 - 6, top - 4)], fill=C(P["wood_lt"]))
    d.polygon([(l0, top), (r0, top), (r1, bottom), (l1, bottom)], fill=C(P["felt"]), outline=C(P["felt_dk"]))
    for _ in range(300):
        y = rng.randint(top + 1, bottom - 1)
        t = (y - top) / max(1, bottom - top)
        lx, rx = l0 + (l1 - l0) * t, r0 + (r1 - r0) * t
        d.point([(rng.uniform(lx + 1, rx - 1), y)], fill=C(P["felt_dk"]))
    # 一圈淡淡的缝线
    d.polygon([(l0 + 10, top + 6), (r0 - 10, top + 6), (r1 - 16, bottom - 2), (l1 + 16, bottom - 2)], outline=C(P["felt_lt"]))


# ====================================================================== 场景
def scene_night(variant: int) -> Image.Image:
    rng = random.Random(100 + variant)
    w, h = 512, 288
    img = Image.new("RGBA", (w, h), C("#3a2418"))
    d = ImageDraw.Draw(img)
    wall = [C("#6b4128"), C("#5f3a24"), C("#734730"), C("#64402a")] if variant == 0 else [C("#5a3826"), C("#4f3222"), C("#61402b")]
    planks_v(d, (0, 14, w - 1, 150), wall, rng)
    d.rectangle([0, 0, w, 13], fill=C("#2a1a10"))
    for bx in range(20, w, 96):  # 天花板梁头
        d.rectangle([bx, 0, bx + 14, 20], fill=C("#3e2516"), outline=INK)
    d.rectangle([0, 150, w, 186], fill=C("#4a2c1a"))  # 护墙板
    for px in range(0, w, 32):
        d.rectangle([px + 3, 154, px + 28, 182], outline=C("#37211a"))
        d.line([px + 4, 155, px + 27, 155], fill=C("#5e3a23"))
    d.line([0, 150, w, 150], fill=C("#86613a"))
    d.line([0, 151, w, 151], fill=INK)
    planks_h(d, (0, 187, w - 1, h - 1), [C("#5a3622"), C("#53321f"), C("#603a25")], rng)
    # 窗户：夜空 + 星星 + 月亮
    wx = 300 if variant == 0 else 60
    d.rectangle([wx - 2, 40, wx + 62, 112], fill=C("#3e2516"), outline=INK)
    d.rectangle([wx + 2, 44, wx + 58, 108], fill=C("#141a33"))
    for _ in range(14):
        d.point([(rng.randint(wx + 4, wx + 56), rng.randint(46, 100))], fill=C("#e8e4c8"))
    d.ellipse([wx + 38, 52, wx + 50, 64], fill=C("#f3ead2"))
    d.ellipse([wx + 42, 50, wx + 54, 62], fill=C("#141a33"))
    d.rectangle([wx + 29, 44, wx + 31, 108], fill=C("#3e2516"))
    d.rectangle([wx + 2, 75, wx + 58, 77], fill=C("#3e2516"))
    # 吧台和酒架（左或右）
    bx0 = 0 if variant == 0 else 352
    d.rectangle([bx0 + 8, 30, bx0 + 150, 120], fill=C("#3a2418"), outline=INK)
    for sy in (58, 88, 118):
        d.rectangle([bx0 + 8, sy, bx0 + 150, sy + 2], fill=C("#86613a"))
    bottles = ["#3c7a4a", "#6a3a22", "#2f5d6b", "#8a6a2a", "#4a6a2a"]
    for sy in (58, 88, 118):
        x = bx0 + 14
        while x < bx0 + 142:
            bh = rng.randint(14, 22)
            c = C(rng.choice(bottles))
            d.rectangle([x, sy - bh + 6, x + 5, sy - 1], fill=c, outline=INK)
            d.rectangle([x + 2, sy - bh + 2, x + 3, sy - bh + 6], fill=c)
            d.point([(x + 1, sy - bh + 8)], fill=shade(c, 1.5))
            x += rng.randint(9, 13)
    d.rectangle([bx0, 132, bx0 + 160, 200], fill=C("#5a3420"), outline=INK)
    d.rectangle([bx0, 128, bx0 + 164, 134], fill=C("#86613a"), outline=INK)
    for px in range(bx0 + 8, bx0 + 156, 24):
        d.rectangle([px, 142, px + 18, 192], outline=C("#3e2516"))
    # 墙上装饰：马蹄铁、帽子、套索
    deco_x = [200, 236, 420, 456] if variant == 0 else [200, 236, 270, 306]
    horseshoe(d, deco_x[0], 46, 2)
    hat(d, deco_x[1], 52)
    lasso(d, deco_x[2] + 10, 60)
    horseshoe(d, deco_x[3], 46, 2, C("#b0894a"))
    for sx, sy in ((180, 90), (390 if variant == 0 else 330, 90)):
        sconce(d, sx, sy)
    # 钢琴（只在 0 号）或木桶
    if variant == 0:
        d.rectangle([424, 120, 506, 200], fill=C("#2e1a12"), outline=INK)
        d.rectangle([424, 150, 506, 158], fill=C("#f3ead2"), outline=INK)
        for k in range(428, 504, 6):
            d.rectangle([k, 150, k + 2, 154], fill=INK)
    else:
        for bx in (20, 52):
            d.rounded_rectangle([bx, 168, bx + 28, 206], 6, fill=C("#6b4128"), outline=INK)
            for yy in (176, 196):
                d.line([bx + 1, yy, bx + 27, yy], fill=C("#37211a"))
    felt_table(d, 256, 214, 300, 400, h + 4, rng)
    table_lamp(d, 130, 206)
    table_lamp(d, 382, 206)
    lamps = [(130, 206, 160, 0.7), (382, 206, 160, 0.7), (180, 90, 70, 0.35),
             (390 if variant == 0 else 330, 90, 70, 0.35), (256, 250, 220, 0.25)]
    return relight(img, lamps, ambient=0.62, vignette=0.7)


def mesa(d, x, base, w, hgt, c):
    d.polygon([(x, base), (x + w * 0.15, base - hgt), (x + w * 0.85, base - hgt), (x + w, base)], fill=c)
    d.line([x + w * 0.15, base - hgt, x + w * 0.85, base - hgt], fill=shade(c, 1.15))
    for k in range(3):
        yy = base - hgt * (0.3 + 0.2 * k)
        d.line([x + w * 0.1, yy, x + w * 0.9, yy], fill=shade(c, 0.85))


def cactus(d, x, base, s=1):
    g, gd = C("#4f9a52"), C("#2f6b3a")
    d.rounded_rectangle([x, base - 30 * s, x + 6 * s, base], 3, fill=g, outline=INK)
    d.rounded_rectangle([x - 7 * s, base - 22 * s, x - 2 * s, base - 10 * s], 2, fill=g, outline=INK)
    d.rectangle([x - 3 * s, base - 13 * s, x, base - 10 * s], fill=g)
    d.rounded_rectangle([x + 8 * s, base - 26 * s, x + 13 * s, base - 14 * s], 2, fill=g, outline=INK)
    d.rectangle([x + 6 * s, base - 17 * s, x + 9 * s, base - 14 * s], fill=g)
    d.line([x + 2 * s, base - 27 * s, x + 2 * s, base - 2], fill=gd)


def cow(d, x, y, flip=False):
    """远处牧场里的小长角牛（侧面，几笔）。"""
    body, white = C("#8a5230"), C("#f3ead2")
    sgn = -1 if flip else 1
    d.ellipse([x - 10, y - 6, x + 10, y + 5], fill=body, outline=INK)
    d.ellipse([x - 4, y - 5, x + 4, y + 1], fill=white)
    hx = x + 12 * sgn
    d.ellipse([hx - 4, y - 8, hx + 4, y - 1], fill=body, outline=INK)
    d.line([hx - 7, y - 9, hx + 7, y - 9], fill=white)
    for lx in (x - 7, x - 3, x + 3, x + 7):
        d.line([lx, y + 4, lx, y + 9], fill=INK)


def sky(img: Image.Image, top: str, bottom: str, y1: int, bands: int = 7):
    d = ImageDraw.Draw(img)
    a, b = C(top), C(bottom)
    for y in range(y1):
        t = y / max(1, y1 - 1)
        for x in range(img.width):
            tt = min(1.0, max(0.0, t + ((BAYER[y % 4][x % 4] + 0.5) / 16 - 0.5) / bands))
            q = round(tt * bands) / bands
            img.putpixel((x, y), tuple(round(a[k] * (1 - q) + b[k] * q) for k in range(3)) + (255,))
    return d


def cloud(d, x, y, s):
    for dx, dy, r in ((0, 4, 6), (8, 0, 8), (18, 3, 7), (26, 5, 5)):
        d.ellipse([x + dx * s - r * s, y + dy * s - r * s, x + dx * s + r * s, y + dy * s + r * s], fill=C("#ffffff"))
    d.rectangle([x - 6 * s, y + 5 * s, x + 31 * s, y + 9 * s], fill=C("#ffffff"))
    d.line([x - 6 * s, y + 9 * s, x + 31 * s, y + 9 * s], fill=C("#cfe6f2"))


def scene_day(variant: int) -> Image.Image:
    rng = random.Random(200 + variant)
    w, h = 512, 288
    img = Image.new("RGBA", (w, h))
    d = sky(img, "#5fb6e6", "#bfe6f6", 150)
    for cx, cy, s in ((60, 26, 1), (300, 40, 1), (420, 18, 1)) if variant == 0 else ((140, 30, 1), (380, 24, 1)):
        cloud(d, cx, cy, s)
    for mx, mw, mh in ((20, 120, 54), (150, 90, 38), (300, 140, 64), (440, 100, 42)) if variant == 0 else ((0, 100, 44), (120, 150, 70), (330, 110, 48), (450, 90, 36)):
        mesa(d, mx, 150, mw, mh, C(P["mesa"]))
    d.rectangle([0, 150, w, 220], fill=C(P["sand"]))
    for _ in range(160):
        d.point([(rng.randint(0, w), rng.randint(152, 218))], fill=C("#e2a96a"))
    # 牧场围栏 + 小牛
    fx0, fx1 = (120, 330) if variant == 0 else (200, 420)
    for fy in (178, 186):
        d.line([fx0, fy, fx1, fy], fill=C("#86613a"))
    for px in range(fx0, fx1 + 1, 20):
        d.rectangle([px, 172, px + 2, 196], fill=C("#86613a"), outline=INK)
    cow(d, fx0 + 50, 190)
    cow(d, fx0 + 130, 192, flip=True)
    # 水塔
    tx = 420 if variant == 0 else 90
    for lx in (tx, tx + 22):
        d.line([lx, 120, lx + (6 if lx == tx else -6), 172], fill=C("#5a3420"), width=2)
    d.rounded_rectangle([tx - 4, 92, tx + 26, 122], 4, fill=C("#86613a"), outline=INK)
    d.polygon([(tx - 6, 92), (tx + 11, 80), (tx + 28, 92)], fill=C("#5a3420"), outline=INK)
    for yy in (100, 110):
        d.line([tx - 3, yy, tx + 25, yy], fill=C("#5a3420"))
    cactus(d, 60 if variant == 0 else 470, 200, 1)
    cactus(d, 360 if variant == 0 else 30, 190, 1)
    # 门廊：屋檐、柱子、地板、栏杆
    d.rectangle([0, 0, w, 16], fill=C("#5a3420"), outline=INK)
    for bx in range(0, w, 40):
        d.rectangle([bx, 14, bx + 10, 22], fill=C("#4a2c1a"), outline=INK)
    for px in (0, 150, 352, 498):
        d.rectangle([px, 16, px + 14, 230], fill=C("#6b4128"), outline=INK)
        d.line([px + 3, 18, px + 3, 228], fill=C("#86613a"))
    for px in (14, 352):
        d.line([px, 40, px + 30, 16], fill=C("#4a2c1a"), width=4)
    for px in (150, 498):
        d.line([px, 40, px - 30, 16], fill=C("#4a2c1a"), width=4)
    d.rectangle([0, 212, w, 218], fill=C("#86613a"), outline=INK)  # 栏杆横木
    for px in range(4, w, 18):
        d.rectangle([px, 218, px + 5, 236], fill=C("#734730"), outline=INK)
    planks_h(d, (0, 236, w - 1, h - 1), [C("#8a5a36"), C("#80522f"), C("#93613b")], rng)
    felt_table(d, 256, 238, 300, 380, h + 4, rng)
    lamps = [(256, 120, 400, 0.15)]
    return relight(img, lamps, ambient=1.0, vignette=0.35, levels=0.1)


def scene_hero() -> Image.Image:
    rng = random.Random(300)
    w, h = 512, 288
    img = Image.new("RGBA", (w, h))
    d = sky(img, "#3b2d5c", "#f2a35a", 190, bands=8)
    d.ellipse([60, 120, 110, 170], fill=C("#ffd27a"))
    for mx, mw, mh in ((0, 130, 60), (110, 100, 40), (380, 140, 70)):
        mesa(d, mx, 190, mw, mh, C("#7a3a3a"))
    d.rectangle([0, 190, w, h], fill=C("#c98a52"))
    for _ in range(200):
        d.point([(rng.randint(0, w), rng.randint(192, h))], fill=C("#b37444"))
    # 酒馆正面：假门脸 + 二层 + 门廊
    x0, x1 = 150, 362
    d.rectangle([x0, 70, x1, 236], fill=C("#86613a"), outline=INK)
    d.polygon([(x0, 70), (x0 + 30, 44), (x1 - 30, 44), (x1, 70)], fill=C("#86613a"), outline=INK)
    planks_v(d, (x0 + 1, 71, x1 - 1, 235), [C("#86613a"), C("#7a5632"), C("#906a40")], rng, (10, 16))
    d.rectangle([x0 + 50, 52, x1 - 50, 72], fill=C("#5a3420"), outline=INK)  # 空白招牌
    d.rectangle([x0 + 53, 55, x1 - 53, 69], fill=C("#6b4128"))
    for wx in (x0 + 24, x1 - 64):  # 二楼窗，透着暖光
        d.rectangle([wx, 90, wx + 40, 124], fill=C("#ffcf6b"), outline=INK)
        d.rectangle([wx + 19, 90, wx + 21, 124], fill=C("#5a3420"))
        d.rectangle([wx, 106, wx + 40, 108], fill=C("#5a3420"))
    d.rectangle([x0 - 10, 136, x1 + 10, 144], fill=C("#5a3420"), outline=INK)  # 门廊顶
    for px in (x0 - 6, x0 + 60, x1 - 66, x1 + 2):
        d.rectangle([px, 144, px + 5, 236], fill=C("#5a3420"), outline=INK)
    d.rectangle([228, 160, 284, 236], fill=C("#ffcf6b"), outline=INK)  # 门洞 + 弹簧门
    for dx in (230, 258):
        d.rectangle([dx, 176, dx + 24, 212], fill=C("#6b4128"), outline=INK)
        for yy in (184, 194, 204):
            d.line([dx + 2, yy, dx + 22, yy], fill=C("#4a2c1a"))
    for wx in (x0 + 12, x1 - 56):
        d.rectangle([wx, 162, wx + 44, 196], fill=C("#ffcf6b"), outline=INK)
        d.rectangle([wx + 21, 162, wx + 23, 196], fill=C("#5a3420"))
    d.rectangle([x0 - 14, 236, x1 + 14, 246], fill=C("#6b4128"), outline=INK)
    # 拴马桩、水槽、仙人掌、风滚草
    d.rectangle([60, 214, 120, 218], fill=C("#5a3420"), outline=INK)
    for px in (64, 112):
        d.rectangle([px, 214, px + 4, 244], fill=C("#5a3420"), outline=INK)
    d.rectangle([392, 226, 446, 244], fill=C("#6b4128"), outline=INK)
    d.rectangle([395, 226, 443, 230], fill=C("#4a7aa0"))
    cactus(d, 470, 250, 1)
    cactus(d, 30, 250, 1)
    d.ellipse([340, 252, 356, 268], outline=C("#8a6a3a"))
    d.ellipse([343, 255, 353, 265], outline=C("#a8803f"))
    lamps = [(256, 190, 140, 0.45), (x0 + 44, 107, 70, 0.3), (x1 - 44, 107, 70, 0.3)]
    return relight(img, lamps, ambient=0.92, vignette=0.6, levels=0.1)


# ====================================================================== 小牛脸（图标、牛头王、飘出特效共用）
HEAD16 = [
    "................",
    ".WW..........WW.",
    ".WOW........WOW.",
    "..WOO......OOW..",
    "...OBBBBBBBBO...",
    "..OBBBLLLLBBBO..",
    ".OEBBLLLLLLBBEO.",
    ".OEBBBBBBBBBBEO.",
    "..OBKWBBBBKWBO..",
    "..OBKKBBBBKKBO..",
    "..OBBBBBBBBBBO..",
    "...OPPPPPPPPO...",
    "...OPPNPPNPPO...",
    "...OPPPPPPPPO...",
    "....OOOOOOOO....",
    "................",
]
HEAD_COLORS = {
    "O": INK, "B": C("#9a5a32"), "L": C("#c07a46"), "W": C("#f3ead2"), "E": C("#7a4428"),
    "K": INK, "P": C("#f2a090"), "N": C("#a8584a"),
}


def head16() -> Image.Image:
    img = Image.new("RGBA", (16, 16), CLEAR)
    ph.stamp(img, HEAD16, 0, 0, HEAD_COLORS)
    return img


def head_big(size: int, crown: bool = False) -> Image.Image:
    """32 / 48 的小牛脸：用形状画，圆脸、短角、大眼、粉鼻子。"""
    img = Image.new("RGBA", (size, size), CLEAR)
    d = ImageDraw.Draw(img)
    s = size / 32
    oy = round(6 * s) if crown else 0
    sc = 0.85 if crown else 1.0

    def R(x0, y0, x1, y1):
        cx, cy = size / 2, size / 2
        return [round(cx + (x0 - 16) * s * sc), round(oy + cy + (y0 - 16) * s * sc - (2 * s if crown else 0)),
                round(cx + (x1 - 16) * s * sc), round(oy + cy + (y1 - 16) * s * sc - (2 * s if crown else 0))]

    horn, fur, light, snout = C("#f3ead2"), C("#9a5a32"), C("#c07a46"), C("#f2a090")
    d.polygon([tuple(R(5, 9, 0, 0)[:2]), tuple(R(2, 2, 0, 0)[:2]), tuple(R(9, 7, 0, 0)[:2])], fill=horn, outline=INK)
    d.polygon([tuple(R(27, 9, 0, 0)[:2]), tuple(R(30, 2, 0, 0)[:2]), tuple(R(23, 7, 0, 0)[:2])], fill=horn, outline=INK)
    d.ellipse(R(0, 10, 9, 17), fill=C("#7a4428"), outline=INK)  # 耳朵
    d.ellipse(R(23, 10, 32, 17), fill=C("#7a4428"), outline=INK)
    d.ellipse(R(4, 5, 28, 29), fill=fur, outline=INK)
    d.ellipse(R(10, 6, 22, 14), fill=light)  # 额头亮斑
    d.ellipse(R(9, 13, 14, 19), fill=INK)
    d.ellipse(R(18, 13, 23, 19), fill=INK)
    d.rectangle(R(10, 14, 11, 15), fill=C("#ffffff"))
    d.rectangle(R(19, 14, 20, 15), fill=C("#ffffff"))
    d.ellipse(R(7, 19, 25, 30), fill=snout, outline=INK)
    d.ellipse(R(11, 23, 13, 26), fill=C("#a8584a"))
    d.ellipse(R(19, 23, 21, 26), fill=C("#a8584a"))
    if crown:
        gold, gd = C(P["brass"]), C(P["brass_dk"])
        c0, c1 = round(size * 0.28), round(size * 0.72)
        top, base = 1, round(13 * s)
        pts = [(c0, base), (c0, top + 4), (c0 + (c1 - c0) // 4, top + 8), (size // 2, top), (c1 - (c1 - c0) // 4, top + 8), (c1, top + 4), (c1, base)]
        d.polygon(pts, fill=gold, outline=INK)
        d.line([c0 + 1, base - 3, c1 - 1, base - 3], fill=gd)
        for gx, col in ((size // 2, "#e2453a"), (c0 + 4, "#3b82f0"), (c1 - 4, "#44b860")):
            d.rectangle([gx - 1, base - 6, gx, base - 5], fill=C(col))
        d.point([(c0 + 1, top + 5), (size // 2, top + 1)], fill=C("#fff4dc"))
    return img


# ====================================================================== 界面小图
def ready() -> Image.Image:
    img = Image.new("RGBA", (16, 16), CLEAR)
    d = ImageDraw.Draw(img)
    d.rectangle([1, 1, 10, 14], fill=C(P["back"]), outline=INK)
    d.rectangle([3, 3, 8, 12], outline=C(P["brass"]))
    d.point([(5, 7), (6, 8), (5, 8), (6, 7)], fill=C(P["brass"]))
    green, gdk = C("#55c46a"), C("#1f5e2c")
    pts = [(6, 10), (8, 12), (14, 5)]
    d.line(pts, fill=gdk, width=4)
    d.line(pts, fill=green, width=2)
    return img


def lasso_icon() -> Image.Image:
    img = Image.new("RGBA", (16, 16), CLEAR)
    d = ImageDraw.Draw(img)
    rope, dk = C("#c99a5a"), C("#7a5632")
    d.ellipse([1, 1, 14, 10], outline=INK, width=3)
    d.ellipse([2, 2, 13, 9], outline=rope, width=1)
    d.ellipse([3, 3, 12, 8], outline=dk)
    d.line([10, 9, 13, 15], fill=INK, width=3)
    d.line([10, 9, 13, 15], fill=rope)
    for x, y in ((4, 2), (9, 2), (13, 5), (2, 6)):
        d.point([(x, y)], fill=dk)
    return img


def hourglass(frame: int) -> Image.Image:
    img = Image.new("RGBA", (16, 16), CLEAR)
    d = ImageDraw.Draw(img)
    wood, glass, sand = C("#7a4a2a"), C("#cfe6f2"), C("#f0c030")
    d.rectangle([3, 1, 12, 2], fill=wood, outline=INK)
    d.rectangle([3, 13, 12, 14], fill=wood, outline=INK)
    d.polygon([(4, 3), (11, 3), (8, 7), (8, 8), (11, 12), (4, 12), (7, 8), (7, 7)], fill=glass, outline=INK)
    top = [3, 2, 1, 0][frame]
    bottom = [0, 1, 2, 3][frame]
    for i in range(top):  # 上半沙子
        y = 6 - i
        d.line([7 - i, y, 8 + i, y], fill=sand)
    for i in range(bottom):  # 下半沙堆
        y = 11 - i
        d.line([5 + i, y, 10 - i, y], fill=sand)
    if frame < 3:
        d.point([(7, 8 + frame), (8, 9 + frame % 2)], fill=sand)  # 流下的一粒
    return img


def star_points(cx, cy, r_out, r_in, n=5, rot=-90):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def sheriff_star() -> Image.Image:
    img = Image.new("RGBA", (32, 32), CLEAR)
    d = ImageDraw.Draw(img)
    gold, gd, gl = C(P["brass"]), C(P["brass_dk"]), C("#ffe08a")
    pts = star_points(16, 17, 13, 6)
    d.polygon(pts, fill=gold, outline=INK)
    for i in range(0, 10, 2):  # 每个尖上一个小球
        x, y = pts[i]
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=gold, outline=INK)
    d.ellipse([11, 12, 21, 22], fill=gd, outline=INK)
    d.ellipse([12, 13, 20, 21], fill=gold)
    d.point([(13, 14), (14, 14), (13, 15)], fill=gl)
    d.line([pts[0][0], pts[0][1] + 3, 16, 12], fill=gl)
    return img


def poster() -> Image.Image:
    return cards.poster()


# ====================================================================== 头像：座位色圆章 + 动物脸
def avatar(seat: int) -> Image.Image:
    _key, color = ph.SEATS[seat]
    img = Image.new("RGBA", (32, 32), CLEAR)
    d = ImageDraw.Draw(img)
    base = C(color)
    ring = C("#fff4dc") if seat == 9 else INK
    d.ellipse([0, 0, 31, 31], fill=ring)
    d.ellipse([1, 1, 30, 30], fill=base)
    d.ellipse([3, 3, 28, 28], fill=shade(base, 0.85))
    animal = ph.ANIMALS[seat]
    draw_animal(d, animal)
    return img


def eyes(d, y, l=12, r=19, c=INK):
    d.rectangle([l, y, l + 1, y + 1], fill=c)
    d.rectangle([r, y, r + 1, y + 1], fill=c)


def draw_animal(d: ImageDraw.ImageDraw, a: str) -> None:
    cream, pink = C("#fff4dc"), C("#f2a090")
    if a == "FOX":
        o = C("#e8742a")
        d.polygon([(7, 4), (13, 11), (8, 13)], fill=o, outline=INK)
        d.polygon([(25, 4), (19, 11), (24, 13)], fill=o, outline=INK)
        d.polygon([(6, 12), (26, 12), (16, 27)], fill=o, outline=INK)
        d.polygon([(9, 16), (16, 27), (23, 16), (16, 21)], fill=cream)
        eyes(d, 15)
        d.rectangle([15, 25, 16, 26], fill=INK)
    elif a == "BER":
        b = C("#8a5230")
        for x in (7, 21):
            d.ellipse([x, 5, x + 5, 10], fill=b, outline=INK)
        d.ellipse([6, 7, 26, 27], fill=b, outline=INK)
        d.ellipse([11, 17, 21, 25], fill=C("#d2a070"), outline=INK)
        eyes(d, 13)
        d.rectangle([15, 18, 16, 19], fill=INK)
    elif a == "RAB":
        w = C("#c99a6a")
        for x in (10, 18):
            d.ellipse([x, 1, x + 5, 15], fill=w, outline=INK)
            d.line([x + 2, 4, x + 2, 12], fill=pink)
        d.ellipse([7, 11, 25, 28], fill=w, outline=INK)
        d.ellipse([11, 19, 21, 27], fill=cream)
        eyes(d, 16)
        d.rectangle([15, 21, 16, 22], fill=pink)
    elif a == "RAC":
        g = C("#9a9aa0")
        for x in (7, 21):
            d.polygon([(x, 12), (x + 2, 5), (x + 5, 11)], fill=g, outline=INK)
        d.ellipse([6, 8, 26, 27], fill=g, outline=INK)
        d.rectangle([8, 13, 24, 18], fill=C("#3a3a40"))
        d.rectangle([11, 14, 12, 15], fill=cream)
        d.rectangle([19, 14, 20, 15], fill=cream)
        d.ellipse([12, 19, 20, 26], fill=cream)
        d.rectangle([15, 20, 16, 21], fill=INK)
    elif a == "CAT":
        g = C("#a0a0a8")
        d.polygon([(7, 4), (14, 10), (7, 14)], fill=g, outline=INK)
        d.polygon([(25, 4), (18, 10), (25, 14)], fill=g, outline=INK)
        d.ellipse([6, 8, 26, 27], fill=g, outline=INK)
        for y in (11, 13):
            d.line([13, y, 19, y], fill=C("#6a6a72"))
        d.rectangle([11, 15, 12, 17], fill=C("#55c46a"))
        d.rectangle([19, 15, 20, 17], fill=C("#55c46a"))
        d.rectangle([15, 20, 16, 21], fill=pink)
        for y in (21, 23):
            d.line([4, y, 10, y - 1], fill=INK)
            d.line([22, y - 1, 28, y], fill=INK)
    elif a == "DOG":
        b = C("#c08a4a")
        d.ellipse([7, 6, 25, 26], fill=b, outline=INK)
        for x in (3, 23):
            d.ellipse([x, 8, x + 6, 20], fill=C("#6b4128"), outline=INK)
        d.ellipse([11, 17, 21, 26], fill=cream, outline=INK)
        eyes(d, 13)
        d.ellipse([14, 17, 18, 20], fill=INK)
        d.rectangle([15, 24, 16, 26], fill=pink)
    elif a == "OWL":
        b = C("#8a6a4a")
        d.polygon([(6, 5), (11, 9), (6, 12)], fill=b, outline=INK)
        d.polygon([(26, 5), (21, 9), (26, 12)], fill=b, outline=INK)
        d.ellipse([5, 6, 27, 28], fill=b, outline=INK)
        for x in (8, 17):
            d.ellipse([x, 10, x + 7, 17], fill=cream, outline=INK)
            d.rectangle([x + 3, 13, x + 4, 14], fill=INK)
        d.polygon([(14, 17), (18, 17), (16, 21)], fill=C(P["brass"]), outline=INK)
        for y in (22, 25):
            d.line([11, y, 21, y], fill=shade(b, 0.8))
    elif a == "HRS":
        g = C("#b8b8c0")
        d.polygon([(10, 4), (12, 10), (8, 10)], fill=g, outline=INK)
        d.polygon([(22, 4), (24, 10), (20, 10)], fill=g, outline=INK)
        d.rounded_rectangle([9, 7, 23, 28], 6, fill=g, outline=INK)
        d.polygon([(13, 8), (15, 3), (17, 8)], fill=C("#5a4a4a"))  # 鬃毛
        d.polygon([(16, 8), (18, 4), (20, 8)], fill=C("#5a4a4a"))
        d.rounded_rectangle([10, 20, 22, 28], 4, fill=C("#8a8a92"), outline=INK)
        d.rectangle([13, 23, 14, 24], fill=INK)
        d.rectangle([18, 23, 19, 24], fill=INK)
        eyes(d, 13, 11, 20)
        for x, y in ((12, 17), (20, 11)):
            d.point([(x, y)], fill=C("#8a8a92"))
    elif a == "GOT":
        t = C("#d8b888")
        d.line([10, 9, 6, 3], fill=C("#7a5632"), width=2)
        d.line([22, 9, 26, 3], fill=C("#7a5632"), width=2)
        d.ellipse([3, 10, 10, 14], fill=t, outline=INK)
        d.ellipse([22, 10, 29, 14], fill=t, outline=INK)
        d.rounded_rectangle([9, 7, 23, 25], 6, fill=t, outline=INK)
        d.polygon([(13, 24), (19, 24), (16, 30)], fill=C("#f3ead2"), outline=INK)
        eyes(d, 13)
        d.rectangle([14, 20, 15, 20], fill=INK)
        d.rectangle([17, 20, 18, 20], fill=INK)
    elif a == "PIG":
        p = C("#f2a8b0")
        d.polygon([(7, 6), (12, 9), (8, 13)], fill=p, outline=INK)
        d.polygon([(25, 6), (20, 9), (24, 13)], fill=p, outline=INK)
        d.ellipse([6, 7, 26, 27], fill=p, outline=INK)
        d.ellipse([11, 17, 21, 24], fill=C("#e07a8a"), outline=INK)
        d.rectangle([13, 20, 14, 21], fill=C("#8a3a4a"))
        d.rectangle([18, 20, 19, 21], fill=C("#8a3a4a"))
        eyes(d, 13)


# ====================================================================== 特效和小动画
def strip(frames):
    return ph.strip(frames)


def dust() -> Image.Image:
    frames = []
    rng = random.Random(9)
    puffs = [(rng.uniform(-1, 1), rng.uniform(-0.4, 0.6)) for _ in range(7)]
    for i in range(6):
        f = Image.new("RGBA", (32, 32), CLEAR)
        if i < 5:
            d = ImageDraw.Draw(f)
            t = i / 4
            for k, (vx, vy) in enumerate(puffs):
                r = 3 + t * 4 - (k % 3) * 0.6
                x = 16 + vx * (4 + 10 * t)
                y = 22 + vy * (3 + 8 * t) - t * 4
                col = C("#e2c08a") if k % 2 else C("#c9a06a")
                if t > 0.6:  # 后几帧变成稀疏的抖动点，像在散开
                    for yy in range(int(y - r), int(y + r) + 1):
                        for xx in range(int(x - r), int(x + r) + 1):
                            if (xx - x) ** 2 + (yy - y) ** 2 <= r * r and (xx + yy + i) % 2 == 0 and 0 <= xx < 32 and 0 <= yy < 32:
                                f.putpixel((xx, yy), col)
                else:
                    d.ellipse([x - r, y - r, x + r, y + r], fill=col)
                    d.arc([x - r, y - r, x + r, y + r], 30, 150, fill=C("#a87a4a"))
        frames.append(f)
    return strip(frames)


def heads_pop() -> Image.Image:
    head = head16()
    frames = []
    for i in range(6):
        f = Image.new("RGBA", (32, 32), CLEAR)
        if i < 5:
            y = [16, 11, 8, 6, 4][i]
            scale_img = head
            if i == 0:
                scale_img = head.resize((12, 12), Image.NEAREST)
                f.alpha_composite(scale_img, (10, y + 2))
            else:
                if i == 4:  # 最后一帧只剩一半像素，像淡出
                    scale_img = head.copy()
                    px = scale_img.load()
                    for yy in range(16):
                        for xx in range(16):
                            if (xx + yy) % 2:
                                px[xx, yy] = CLEAR
                f.alpha_composite(scale_img, (8, y))
            d = ImageDraw.Draw(f)
            if 1 <= i <= 3:  # 两侧的小火花
                for sx, sy in ((4, y + 6 - i), (27, y + 4 - i)):
                    d.point([(sx, sy), (sx - 1, sy), (sx + 1, sy), (sx, sy - 1), (sx, sy + 1)], fill=C("#ffe08a"))
        frames.append(f)
    return strip(frames)


def sparkle() -> Image.Image:
    frames = []
    sizes = [1, 3, 5, 7, 5, 3]
    for i, r in enumerate(sizes):
        f = Image.new("RGBA", (16, 16), CLEAR)
        d = ImageDraw.Draw(f)
        c, core = C("#ffe08a"), C("#ffffff")
        d.line([8 - r, 8, 8 + r, 8], fill=c)
        d.line([8, 8 - r, 8, 8 + r], fill=c)
        if r >= 5:
            d.point([(6, 6), (10, 6), (6, 10), (10, 10)], fill=C(P["brass"]))
        d.rectangle([7, 7, 8, 8], fill=core if r > 1 else c)
        frames.append(f)
    return strip(frames)


def lamp() -> Image.Image:
    frames = []
    flames = [(5, 0), (6, 1), (5, -1), (4, 0)]  # 火苗高度、左右摆
    for fh, sway in flames:
        f = Image.new("RGBA", (16, 32), CLEAR)
        d = ImageDraw.Draw(f)
        d.ellipse([2, 26, 13, 31], fill=C(P["brass_dk"]), outline=INK)
        d.rectangle([4, 20, 11, 27], fill=C(P["brass"]), outline=INK)
        d.line([5, 21, 5, 26], fill=C("#ffe08a"))
        d.rectangle([6, 18, 9, 20], fill=C(P["brass_dk"]), outline=INK)
        d.ellipse([3, 5, 12, 19], fill=C("#fff4dc", 120), outline=C("#c9a46a"))  # 玻璃罩
        cx = 7 + sway * 0.5
        d.ellipse([cx - 2, 16 - fh * 1.6, cx + 2, 17], fill=C(P["lamp_dk"]))
        d.ellipse([cx - 1, 16 - fh * 1.2, cx + 1, 17], fill=C(P["lamp"]))
        d.point([(round(cx), 15)], fill=C("#ffffff"))
        d.rectangle([6, 3, 9, 5], fill=C(P["brass_dk"]), outline=INK)
        frames.append(f)
    return strip(frames)


def calf_frame(i: int) -> Image.Image:
    """侧面朝右奔跑的小牛，6 帧：身体上下颠，四条腿交替前后。"""
    f = Image.new("RGBA", (32, 32), CLEAR)
    d = ImageDraw.Draw(f)
    bob = [0, -1, -2, 0, -1, -2][i]
    fur, light, white = C("#9a5a32"), C("#c07a46"), C("#f3ead2")
    y = 15 + bob
    swing = [3, 1, -1, -3, -1, 1][i]
    legs = [(8, swing), (12, -swing), (19, -swing), (23, swing)]
    for lx, s in legs:
        d.line([lx, y + 5, lx + s, y + 11], fill=INK, width=3)
        d.line([lx, y + 5, lx + s, y + 10], fill=shade(fur, 0.8))
        d.point([(lx + s, y + 11)], fill=INK)
    d.line([4, y - 1, 1, y - 4 - (i % 2)], fill=INK, width=2)  # 尾巴
    d.ellipse([4, y - 4, 26, y + 7], fill=fur, outline=INK)
    d.ellipse([10, y - 3, 17, y + 2], fill=white)
    d.line([7, y - 3, 22, y - 3], fill=light)
    hx, hy = 25, y - 7
    d.polygon([(hx - 1, hy - 1), (hx + 1, hy - 5), (hx + 3, hy)], fill=white, outline=INK)  # 角
    d.ellipse([hx - 4, hy - 1, hx + 4, hy + 8], fill=C("#7a4428"), outline=INK)  # 耳
    d.ellipse([hx - 1, hy - 1, hx + 7, hy + 9], fill=fur, outline=INK)
    d.ellipse([hx + 3, hy + 5, hx + 8, hy + 10], fill=C("#f2a090"), outline=INK)
    d.point([(hx + 3, hy + 3)], fill=INK)
    if i in (2, 5):  # 脚下扬起一点土
        d.point([(2, 28), (4, 29), (6, 28)], fill=C("#c9a06a"))
    return f


def calf_run() -> Image.Image:
    return strip([calf_frame(i) for i in range(6)])


def tumbleweed() -> Image.Image:
    """风滚草：一团交错的细枝（短直线），每帧转 45°，滚的时候轻轻弹一下。"""
    rng = random.Random(4)
    twigs = []
    for _ in range(16):
        r1, a1 = rng.uniform(2, 9.5), rng.uniform(0, 360)
        a2 = a1 + rng.uniform(70, 160)
        r2 = rng.uniform(4, 9.5)
        twigs.append((r1, a1, r2, a2, rng.random() < 0.5))
    frames = []
    for i in range(8):
        f = Image.new("RGBA", (24, 24), CLEAR)
        d = ImageDraw.Draw(f)
        rot = i * 45
        hop = [0, -1, -2, -2, -1, 0, 0, 0][i]
        cx, cy = 12, 13 + hop
        d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=C("#8a6a3a", 70))
        for r1, a1, r2, a2, light in twigs:
            p1 = (cx + r1 * math.cos(math.radians(a1 + rot)), cy + r1 * math.sin(math.radians(a1 + rot)))
            p2 = (cx + r2 * math.cos(math.radians(a2 + rot)), cy + r2 * math.sin(math.radians(a2 + rot)))
            d.line([p1, p2], fill=C("#d2a868") if light else C("#8a6a3a"))
        for k in range(12):  # 外圈参差的枝梢
            ang = math.radians(k * 30 + rot + (k % 3) * 7)
            r = 9.5 + (k % 2)
            d.point([(cx + r * math.cos(ang), cy + r * math.sin(ang))], fill=C("#5a3e22"))
        frames.append(f)
    return strip(frames)


# ====================================================================== 清单
def build() -> dict[str, Image.Image]:
    files: dict[str, Image.Image] = {}
    back = cards.back("lg", "A"), cards.back("sm", "A")
    files["cards/cards-lg.png"] = cards.atlas("lg", "B", back[0])
    files["cards/cards-sm.png"] = cards.atlas("sm", "B", back[1])
    files["cards/slot-lg.png"] = cards.slot(42, 58, "B")
    files["cards/slot-sm.png"] = cards.slot(28, 38, "B")
    files["cards/danger-lg.png"] = cards.danger(42, 58, "lg", "B")
    files["cards/danger-sm.png"] = cards.danger(28, 38, "sm", "B")
    files["cards/danger-strip-sm.png"] = cards.danger(14, 38, "sm", "B")
    files["table/felt.png"] = cards.felt("A")
    files["table/rim.png"] = cards.rim("A")
    files["scene/night-0.png"] = scene_night(0)
    files["scene/night-1.png"] = scene_night(1)
    files["scene/day-0.png"] = scene_day(0)
    files["scene/day-1.png"] = scene_day(1)
    files["scene/hero.png"] = scene_hero()
    files["ui/head-16.png"] = head16()
    files["ui/head-32.png"] = head_big(32)
    files["ui/ready.png"] = ready()
    files["ui/lasso.png"] = lasso_icon()
    files["ui/sheriff-star.png"] = sheriff_star()
    files["ui/king-bull.png"] = head_big(48, crown=True)
    files["ui/poster.png"] = poster()
    files["ui/thinking.png"] = strip([hourglass(i) for i in range(4)])
    for i in range(10):
        files[f"avatars/avatar-{i}.png"] = avatar(i)
    files["fx/dust.png"] = dust()
    files["fx/heads-pop.png"] = heads_pop()
    files["fx/sparkle.png"] = sparkle()
    files["fx/lamp.png"] = lamp()
    files["sprites/calf-run.png"] = calf_run()
    files["sprites/tumbleweed.png"] = tumbleweed()
    return files


def check_sizes(files: dict[str, Image.Image]) -> None:
    spec = json.loads(MANIFEST.read_text())
    assert set(spec) == set(files), set(spec) ^ set(files)
    for rel, img in files.items():
        assert list(img.size) == spec[rel]["size"], (rel, img.size, spec[rel]["size"])


def generate() -> None:
    files = build()
    check_sizes(files)
    manifest = {}
    for rel, img in files.items():
        path = PUBLIC / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        manifest[rel] = {"size": list(img.size), "kind": "lite", "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(f"简洁版 {len(files)} 个文件 → {PUBLIC}；哈希 → {MANIFEST}")


def sheet() -> None:
    files = build()
    out = ART / "out" / "lite-sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    big = [(k, v) for k, v in files.items() if v.width >= 280]
    small = [(k, v) for k, v in files.items() if v.width < 280]
    width = 1100
    rows, x, y, rh = [], 8, 8, 0
    for k, v in small:
        z = v.resize((v.width * 3, v.height * 3), Image.NEAREST)
        if x + z.width > width:
            x, y, rh = 8, y + rh + 8, 0
        rows.append((z, x, y))
        x += z.width + 8
        rh = max(rh, z.height)
    y += rh + 8
    for k, v in big:
        z = v if v.width > 300 else v.resize((v.width * 2, v.height * 2), Image.NEAREST)
        rows.append((z, 8, y))
        y += z.height + 8
    canvas = Image.new("RGBA", (max(width, 900), y), C("#20140e"))
    half = Image.new("RGBA", (canvas.width // 2, rows[0][2] + rh + 8), C("#f4ecdc"))
    canvas.alpha_composite(half, (canvas.width // 2, 0))
    for z, px, py in rows:
        canvas.alpha_composite(z, (px, py))
    canvas.save(out)
    print(out)


if __name__ == "__main__":
    if "--sheet" in sys.argv:
        sheet()
    else:
        generate()
