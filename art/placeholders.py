"""谁是牛头王：占位图生成（美术规格阶段，不调 PixelLab）。

按 art/spec.md 的清单，把每一项用正式的文件名、尺寸、帧数画到 apps/web/public/art/。
- 牌面图集（cards-sm / cards-lg）用代码画得基本像样：5 种底色、像素数字、牛头排布，界面排版靠它；
- 其余素材是「纯色底 + 名字缩写」，动画是几帧在动的色块，一眼能看出是占位；
- 生成后把每个文件的 sha256 写进 art/placeholders.json。出图定稿后跑 `--check`，
  还和占位哈希一样的文件会被列出来（换图验收要求一个都没有）。

2026-10-09 起 public/art 里放的是 art/lite.py 画的「简洁版」（能直接上线），哈希表也由它写（kind = "lite"）。
用法：
  ~/miniconda3/envs/quant/bin/python art/placeholders.py --legacy # 重画最早的色块占位（会覆盖简洁版）
  ~/miniconda3/envs/quant/bin/python art/placeholders.py --check  # 列出还是简洁版 / 占位的文件
  ~/miniconda3/envs/quant/bin/python art/placeholders.py --sheet  # 另存一张总览到 art/out/（不进仓库）
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
import random
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "art"
MANIFEST = ROOT / "art" / "placeholders.json"

# ---------------------------------------------------------------- 调色板（和 spec.md 第 2 节一致）
P = {
    "ink": "#2a1a10",        # 描边、深色字
    "cream": "#fff4dc",      # 深底上的字、高光
    "wood_dk": "#37211a", "wood": "#663d24", "wood_md": "#86613a", "wood_lt": "#b0894a",
    "felt_dk": "#24492f", "felt": "#2f5d3e", "felt_lt": "#3d7350", "felt_line": "#5f8f6a",
    "brass": "#d9a441", "brass_dk": "#9a6b22",
    "lamp": "#ffcf6b", "lamp_dk": "#f2a33a",
    "night_bg": "#1e1313", "night_wall": "#45281e",
    "sky": "#77ccef", "sand": "#f4c683", "mesa": "#aa704f",
    "back": "#7a2a22", "back_dk": "#5a1c18",
    "danger": "#e2453a", "snout": "#e8907a",
}
CARD_BG = {1: "#e8d5a8", 2: "#6fb3a6", 3: "#d9a441", 5: "#b5452f", 7: "#3a2f3f"}

# 10 个座位色（Player.seat 0–9），白天、夜间都要分得清
SEATS = [
    ("red", "#e5533f"), ("blue", "#3b82f0"), ("green", "#44b860"), ("yellow", "#f0c030"), ("purple", "#9b6ad6"),
    ("orange", "#f08a2e"), ("cyan", "#36c2c9"), ("pink", "#f06aa8"), ("white", "#eeeae0"), ("charcoal", "#4a4f5c"),
]
ANIMALS = ["FOX", "BER", "RAB", "RAC", "CAT", "DOG", "OWL", "HRS", "GOT", "PIG"]


def rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def shade(c, f: float):
    return tuple(max(0, min(255, round(v * f))) for v in c[:3]) + (c[3],)


def lum(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


# ---------------------------------------------------------------- 牛头数（和规则书 2.1 一致）
def heads_of(n: int) -> int:
    if n == 55:
        return 7
    if n % 11 == 0:
        return 5
    if n % 10 == 0:
        return 3
    if n % 10 == 5:
        return 2
    return 1


# ---------------------------------------------------------------- 像素字
# 占位标签用的 3×5 小字
F35_ROWS = {
    "A": ".#. #.# ### #.# #.#", "B": "##. #.# ##. #.# ##.", "C": ".## #.. #.. #.. .##", "D": "##. #.# #.# #.# ##.",
    "E": "### #.. ##. #.. ###", "F": "### #.. ##. #.. #..", "G": ".## #.. #.# #.# .##", "H": "#.# #.# ### #.# #.#",
    "I": "### .#. .#. .#. ###", "J": "..# ..# ..# #.# .#.", "K": "#.# #.# ##. #.# #.#", "L": "#.. #.. #.. #.. ###",
    "M": "#.# ### ### #.# #.#", "N": "##. #.# #.# #.# #.#", "O": ".#. #.# #.# #.# .#.", "P": "##. #.# ##. #.. #..",
    "Q": ".#. #.# #.# ##. .##", "R": "##. #.# ##. #.# #.#", "S": ".## #.. .#. ..# ##.", "T": "### .#. .#. .#. .#.",
    "U": "#.# #.# #.# #.# ###", "V": "#.# #.# #.# #.# .#.", "W": "#.# #.# ### ### #.#", "X": "#.# #.# .#. #.# #.#",
    "Y": "#.# #.# .#. .#. .#.", "Z": "### ..# .#. #.. ###", "0": "### #.# #.# #.# ###", "1": ".#. ##. .#. .#. ###",
    "2": "##. ..# .#. #.. ###", "3": "##. ..# .#. ..# ##.", "4": "#.# #.# ### ..# ..#", "5": "### #.. ##. ..# ##.",
    "6": ".## #.. ### #.# ###", "7": "### ..# .#. .#. .#.", "8": "### #.# ### #.# ###", "9": "### #.# ### ..# ##.",
    "-": "... ... ### ... ...", " ": "... ... ... ... ...", "+": "... .#. ### .#. ...",
}
F35 = {k: v.replace(" ", "") for k, v in F35_ROWS.items()}
assert all(len(v) == 15 for v in F35.values())

# 牌面数字：小牌 6×12（6×10 点阵把第 2、7 行各复制一次），大牌 8×16（手画）
D610 = {
    "0": [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
    "1": ["..##..", ".###..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
    "2": [".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "##....", "######"],
    "3": [".####.", "##..##", "....##", "....##", "..###.", "....##", "....##", "....##", "##..##", ".####."],
    "4": ["##..##", "##..##", "##..##", "##..##", "######", "....##", "....##", "....##", "....##", "....##"],
    "5": ["######", "##....", "##....", "#####.", "....##", "....##", "....##", "....##", "##..##", ".####."],
    "6": [".####.", "##..##", "##....", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", ".####."],
    "7": ["######", "....##", "....##", "...##.", "...##.", "..##..", "..##..", "..##..", "..##..", "..##.."],
    "8": [".####.", "##..##", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
    "9": [".####.", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "....##", "##..##", ".####."],
}
D612 = {k: v[:3] + [v[2]] + v[3:8] + [v[7]] + v[8:] for k, v in D610.items()}
D816 = {
    "0": [".######.", "########", "##....##", "##....##", "##....##", "##....##", "##....##", "##....##",
          "##....##", "##....##", "##....##", "##....##", "##....##", "##....##", "########", ".######."],
    "1": ["...##...", "..###...", ".####...", "##.##...", "...##...", "...##...", "...##...", "...##...",
          "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "########", "########"],
    "2": [".######.", "########", "##....##", "......##", "......##", "......##", ".....###", "....###.",
          "...###..", "..###...", ".###....", "###.....", "##......", "##......", "########", "########"],
    "3": [".######.", "########", "##....##", "......##", "......##", "......##", "..######", "..######",
          "......##", "......##", "......##", "......##", "......##", "##....##", "########", ".######."],
    "4": ["##....##", "##....##", "##....##", "##....##", "##....##", "##....##", "##....##", "##....##",
          "##....##", "########", "########", "......##", "......##", "......##", "......##", "......##"],
    "5": ["########", "########", "##......", "##......", "##......", "##......", "#######.", "########",
          "......##", "......##", "......##", "......##", "......##", "##....##", "########", ".######."],
    "6": [".######.", "########", "##....##", "##......", "##......", "##......", "#######.", "########",
          "##....##", "##....##", "##....##", "##....##", "##....##", "##....##", "########", ".######."],
    "7": ["########", "########", "##....##", "......##", "......##", ".....##.", ".....##.", "....##..",
          "....##..", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##..."],
    "8": [".######.", "########", "##....##", "##....##", "##....##", "##....##", ".######.", ".######.",
          "##....##", "##....##", "##....##", "##....##", "##....##", "##....##", "########", ".######."],
    "9": [".######.", "########", "##....##", "##....##", "##....##", "##....##", "##....##", "##....##",
          "########", ".#######", "......##", "......##", "......##", "##....##", "########", ".######."],
}

# 牌面上的小牛头（H 头、E 眼睛=底色、S 鼻子）
HEAD5 = ["H...H", "HHHHH", "HEHEH", ".HHH.", ".SSS."]
HEAD7 = ["H.....H", "HH...HH", ".HHHHH.", ".HEHEH.", ".HHHHH.", "..SSS..", "..SSS.."]


def text35(img: Image.Image, text: str, cx: int, cy: int, fill, scale: int = 1, shadow=None) -> None:
    """以 (cx, cy) 为中心写 3×5 小字。"""
    text = text.upper()
    w = (len(text) * 4 - 1) * scale
    x0, y0 = cx - w // 2, cy - (5 * scale) // 2
    d = ImageDraw.Draw(img)
    for i, ch in enumerate(text):
        glyph = F35.get(ch, F35[" "])
        for r in range(5):
            for c in range(3):
                if glyph[r * 3 + c] == "#":
                    x, y = x0 + (i * 4 + c) * scale, y0 + r * scale
                    if shadow is not None:
                        d.rectangle([x + scale, y + scale, x + 2 * scale - 1, y + 2 * scale - 1], fill=shadow)
                    d.rectangle([x, y, x + scale - 1, y + scale - 1], fill=fill)


def digits(img: Image.Image, text: str, cx: int, top: int, font: dict, gap: int, fill, outline) -> None:
    gw, gh = len(font["0"][0]), len(font["0"])
    width = len(text) * gw + (len(text) - 1) * gap
    x0 = cx - width // 2
    mask = Image.new("1", img.size, 0)
    for i, ch in enumerate(text):
        for r, row in enumerate(font[ch]):
            for c, v in enumerate(row):
                if v == "#":
                    mask.putpixel((x0 + i * (gw + gap) + c, top + r), 1)
    px = mask.load()
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y]:
                continue
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
                if 0 <= x + dx < img.width and 0 <= y + dy < img.height and px[x + dx, y + dy]:
                    img.putpixel((x, y), outline)
                    break
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y]:
                img.putpixel((x, y), fill)


def stamp(img: Image.Image, pattern: list[str], x0: int, y0: int, colors: dict) -> None:
    for r, row in enumerate(pattern):
        for c, v in enumerate(row):
            if v in colors:
                img.putpixel((x0 + c, y0 + r), colors[v])


# ---------------------------------------------------------------- 牌
SIZES = {
    # 名字: (宽, 高, 数字字体, 字间距, 小牛头, 牛头间距, 上排牛头 y, 下排牛头 y, 内框内缩)
    "sm": (28, 38, D612, 1, HEAD5, 1, 3, 30, 1),
    "lg": (42, 58, D816, 2, HEAD7, 2, 8, 43, 2),
}
LAYOUT = {1: (1, 0), 2: (2, 0), 3: (3, 0), 5: (3, 2), 7: (4, 3)}  # 上排几个、下排几个


def card_shell(w: int, h: int, base, inset: int) -> Image.Image:
    ink = rgba(P["ink"])
    img = Image.new("RGBA", (w, h), base)
    d = ImageDraw.Draw(img)
    d.rectangle([inset, inset, w - 1 - inset, h - 1 - inset], outline=shade(base, 0.8))
    d.line([1, 1, w - 2, 1], fill=shade(base, 1.12))  # 顶上一道亮边
    d.rectangle([0, 0, w - 1, h - 1], outline=ink)
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        img.putpixel((x, y), (0, 0, 0, 0))
    for x, y in ((1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)):
        img.putpixel((x, y), ink)
    return img


def card_face(n: int, size: str) -> Image.Image:
    w, h, font, gap, head, hgap, top_y, bot_y, inset = SIZES[size]
    k = heads_of(n)
    base = rgba(CARD_BG[k])
    img = card_shell(w, h, base, inset)
    dark_bg = lum(base) < 140
    ink, cream = rgba(P["ink"]), rgba(P["cream"])
    head_c = cream if dark_bg else ink
    colors = {"H": head_c, "E": base, "S": rgba(P["snout"])}
    hw = len(head[0])
    top, bottom = LAYOUT[k]
    for count, y in ((top, top_y), (bottom, bot_y)):
        if not count:
            continue
        row_w = count * hw + (count - 1) * hgap
        x0 = (w - row_w) // 2
        for i in range(count):
            stamp(img, head, x0 + i * (hw + hgap), y, colors)
    gh = len(font["0"])
    num_top = (h - gh) // 2
    if dark_bg:
        digits(img, str(n), w // 2, num_top, font, gap, cream, ink)
    else:
        digits(img, str(n), w // 2, num_top, font, gap, ink, shade(base, 1.18))
    return img


def card_back(size: str) -> Image.Image:
    w, h, _font, _gap, head, _hg, _t, _b, inset = SIZES[size]
    base, dark, gold = rgba(P["back"]), rgba(P["back_dk"]), rgba(P["brass"])
    img = card_shell(w, h, base, inset)
    for y in range(inset + 2, h - inset - 2):
        for x in range(inset + 2, w - inset - 2):
            if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                img.putpixel((x, y), dark)
    d = ImageDraw.Draw(img)
    d.rectangle([inset + 1, inset + 1, w - 2 - inset, h - 2 - inset], outline=gold)
    hw, hh = len(head[0]), len(head)
    cx, cy = w // 2, h // 2
    r = hw // 2 + 3
    d.ellipse([cx - r, cy - r, cx + r - 1, cy + r - 1], fill=dark, outline=gold)
    stamp(img, head, cx - hw // 2, cy - hh // 2, {"H": gold, "E": dark, "S": gold})
    return img


def atlas(size: str) -> Image.Image:
    """10 列 × 11 行：格子 n（0–104）在第 n%10 列、第 n//10 行。0 号是牌背，105–109 空着。"""
    w, h = SIZES[size][:2]
    img = Image.new("RGBA", (w * 10, h * 11), (0, 0, 0, 0))
    img.alpha_composite(card_back(size), (0, 0))
    for n in range(1, 105):
        img.alpha_composite(card_face(n, size), ((n % 10) * w, (n // 10) * h))
    return img


def slot(w: int, h: int) -> Image.Image:
    """空格：毡面上一圈缝线似的虚线框（半透明）。"""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    line = rgba(P["felt_line"], 170)
    ImageDraw.Draw(img).rectangle([1, 1, w - 2, h - 2], fill=(0, 0, 0, 40))
    for x in range(1, w - 1):
        if x % 3 != 0:
            img.putpixel((x, 1), line)
            img.putpixel((x, h - 2), line)
    for y in range(1, h - 1):
        if y % 3 != 0:
            img.putpixel((1, y), line)
            img.putpixel((w - 2, y), line)
    return img


def danger(w: int, h: int, head: list[str]) -> Image.Image:
    """第 6 格：红色警示斜纹 + 虚线框 + 中间一个淡牛头。"""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    red = rgba(P["danger"])
    for y in range(h):
        for x in range(w):
            img.putpixel((x, y), (226, 69, 58, 80) if (x + y) // 4 % 2 == 0 else (20, 10, 10, 70))
    for x in range(w):
        if x // 3 % 2 == 0:
            img.putpixel((x, 0), red)
            img.putpixel((x, h - 1), red)
    for y in range(h):
        if y // 3 % 2 == 0:
            img.putpixel((0, y), red)
            img.putpixel((w - 1, y), red)
    hw, hh = len(head[0]), len(head)
    stamp(img, head, (w - hw) // 2, (h - hh) // 2, {"H": rgba(P["cream"], 200), "S": rgba(P["cream"], 200)})
    return img


# ---------------------------------------------------------------- 通用占位
def label_tile(w: int, h: int, color: str, label: str, shape: str = "rect", transparent: bool = True) -> Image.Image:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0) if transparent else rgba(color))
    d = ImageDraw.Draw(img)
    c, ink = rgba(color), rgba(P["ink"])
    if shape == "circle":
        d.ellipse([0, 0, w - 1, h - 1], fill=c, outline=ink)
    else:
        d.rectangle([0, 0, w - 1, h - 1], fill=c, outline=ink)
        for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            img.putpixel((x, y), (0, 0, 0, 0) if transparent else c)
    scale = max(1, min((w - 2) // (len(label) * 4), (h - 2) // 7))
    fg = rgba(P["cream"]) if lum(c) < 140 else ink
    text35(img, label, w // 2, h // 2, fg, scale)
    return img


def strip(frames: list[Image.Image]) -> Image.Image:
    w, h = frames[0].size
    img = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        img.alpha_composite(f, (i * w, 0))
    return img


def anim(w: int, h: int, n: int, color: str, label: str, motion: str, blank_last: bool) -> Image.Image:
    """几帧在动的色块；左上角写帧号，底下写缩写。blank_last=True 的最后一帧全透明（一次性特效）。"""
    frames = []
    c, ink = rgba(color), rgba(P["ink"])
    for i in range(n):
        f = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        if blank_last and i == n - 1:
            frames.append(f)
            continue
        d = ImageDraw.Draw(f)
        t = i / max(1, n - 1 if blank_last else n)
        s = min(w, h)
        if motion == "grow":  # 尘土：越来越大、越来越淡
            r = max(2, round(s * (0.2 + 0.3 * t)))
            d.ellipse([w // 2 - r, h // 2 - r, w // 2 + r - 1, h // 2 + r - 1], fill=c[:3] + (round(255 * (1 - 0.6 * t)),), outline=ink)
        elif motion == "rise":  # 牛头飘出：往上走
            b = s // 2
            y = round((h - b) * (1 - t))
            d.rectangle([(w - b) // 2, y, (w + b) // 2 - 1, y + b - 1], fill=c, outline=ink)
        elif motion == "bob":  # 奔跑 / 灯火：上下颠
            b = s * 2 // 3
            y = (h - b) // 2 + (-2 if i % 2 else 1)
            x = (w - b) // 2
            d.rectangle([x, y, x + b - 1, y + b - 1], fill=c, outline=ink)
            for k in range(2):  # 两条腿前后换
                lx = x + 2 + k * (b - 6) + (2 if (i + k) % 2 else 0)
                d.rectangle([lx, y + b, lx + 1, min(h - 1, y + b + 2)], fill=ink)
        elif motion == "spin":  # 风滚草 / 沙漏：一根辐条转圈
            r = s // 2 - 1
            d.ellipse([w // 2 - r, h // 2 - r, w // 2 + r - 1, h // 2 + r - 1], fill=c, outline=ink)
            a = 2 * math.pi * i / n
            d.line([w // 2, h // 2, w // 2 + round(r * math.cos(a)), h // 2 + round(r * math.sin(a))], fill=ink)
        elif motion == "twinkle":  # 闪光：十字忽大忽小
            r = 1 + round((s // 2 - 2) * (0.5 + 0.5 * math.sin(2 * math.pi * i / n)))
            d.rectangle([w // 2 - r, h // 2 - 1, w // 2 + r - 1, h // 2], fill=c)
            d.rectangle([w // 2 - 1, h // 2 - r, w // 2, h // 2 + r - 1], fill=c)
        elif motion == "flame":  # 煤油灯：灯座不动，火苗一跳一跳
            d.rectangle([w // 2 - 4, h - 12, w // 2 + 3, h - 1], fill=rgba(P["brass"]), outline=ink)
            fh = 6 + (i * 3) % 4
            d.ellipse([w // 2 - 3, h - 12 - fh, w // 2 + 2, h - 12], fill=c, outline=rgba(P["lamp_dk"]))
        text35(f, str(i), 3, 3, rgba(P["cream"]), 1, shadow=ink)
        frames.append(f)
    return strip(frames)


def scene(color_top: str, color_bottom: str, label: str, table: bool = True) -> Image.Image:
    w, h = 512, 288
    img = Image.new("RGBA", (w, h))
    a, b = rgba(color_top), rgba(color_bottom)
    for y in range(h):
        t = y / (h - 1)
        c = tuple(round(a[k] * (1 - t) + b[k] * t) for k in range(3)) + (255,)
        ImageDraw.Draw(img).line([0, y, w - 1, y], fill=c)
    d = ImageDraw.Draw(img)
    if table:  # 画面下方中间示意一张绿呢牌桌（正式场景里也在这个位置）
        d.rectangle([112, 206, 400, 287], fill=rgba(P["felt"]), outline=rgba(P["wood_dk"]))
    text35(img, label, w // 2, 110, rgba(P["cream"]), 4, shadow=rgba(P["ink"]))
    text35(img, "PLACEHOLDER", w // 2, 150, rgba(P["cream"]), 2, shadow=rgba(P["ink"]))
    return img


def felt_tile() -> Image.Image:
    """64×64 可平铺：毡面底色 + 环面上均匀撒的暗点（无缝），左上角小字 FT。"""
    img = Image.new("RGBA", (64, 64), rgba(P["felt"]))
    rng = random.Random(7)
    for _ in range(90):
        x, y = rng.randrange(64), rng.randrange(64)
        img.putpixel((x, y), rgba(P["felt_dk"] if rng.random() < 0.6 else P["felt_lt"]))
    text35(img, "FT", 6, 4, rgba(P["felt_lt"]))
    return img


def rim_tile() -> Image.Image:
    """24×24 九宫格木边（border-image-slice: 8），中间透明。"""
    img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 23, 23], fill=rgba(P["wood"]))
    d.rectangle([8, 8, 15, 15], fill=(0, 0, 0, 0))
    d.rectangle([0, 0, 23, 23], outline=rgba(P["wood_dk"]))
    d.line([1, 1, 22, 1], fill=rgba(P["wood_lt"]))
    d.rectangle([7, 7, 16, 16], outline=rgba(P["brass"]))
    d.rectangle([8, 8, 15, 15], fill=(0, 0, 0, 0))
    return img


def poster() -> Image.Image:
    """64×80 空白通缉令：羊皮纸 + 钉子 + 中间留 32×32 放头像的框（不写字，字由界面写）。"""
    img = Image.new("RGBA", (64, 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([2, 2, 61, 77], fill=rgba("#e8d5a8"), outline=rgba(P["ink"]))
    d.rectangle([15, 22, 48, 55], fill=rgba(P["wood_md"]), outline=rgba(P["ink"]))
    for x, y in ((6, 6), (57, 6), (6, 73), (57, 73)):
        d.rectangle([x - 1, y - 1, x, y], fill=rgba(P["brass_dk"]))
    text35(img, "POSTER", 32, 66, rgba(P["ink"]), 1)
    return img


# ---------------------------------------------------------------- 清单（和 spec.md 第 4 节一一对应）
def build() -> dict[str, Image.Image]:
    files: dict[str, Image.Image] = {}
    # 牌
    files["cards/cards-sm.png"] = atlas("sm")
    files["cards/cards-lg.png"] = atlas("lg")
    files["cards/slot-sm.png"] = slot(28, 38)
    files["cards/slot-lg.png"] = slot(42, 58)
    files["cards/danger-sm.png"] = danger(28, 38, HEAD5)
    files["cards/danger-lg.png"] = danger(42, 58, HEAD7)
    files["cards/danger-strip-sm.png"] = danger(14, 38, HEAD5)
    # 牌桌
    files["table/felt.png"] = felt_tile()
    files["table/rim.png"] = rim_tile()
    # 场景
    files["scene/night-0.png"] = scene(P["night_bg"], P["night_wall"], "NIGHT 0")
    files["scene/night-1.png"] = scene(P["night_wall"], P["night_bg"], "NIGHT 1")
    files["scene/day-0.png"] = scene(P["sky"], P["sand"], "DAY 0")
    files["scene/day-1.png"] = scene(P["sand"], P["sky"], "DAY 1")
    files["scene/hero.png"] = scene(P["night_wall"], P["wood_md"], "HERO")
    # 界面小图
    files["ui/head-16.png"] = label_tile(16, 16, P["wood"], "HD")
    files["ui/head-32.png"] = label_tile(32, 32, P["wood"], "HEAD")
    files["ui/ready.png"] = label_tile(16, 16, P["back"], "OK")
    files["ui/lasso.png"] = label_tile(16, 16, P["wood_lt"], "LS", "circle")
    files["ui/sheriff-star.png"] = label_tile(32, 32, P["brass"], "STAR", "circle")
    files["ui/king-bull.png"] = label_tile(48, 48, P["brass_dk"], "KING")
    files["ui/poster.png"] = poster()
    files["ui/thinking.png"] = anim(16, 16, 4, P["sand"], "TH", "spin", blank_last=False)
    # 头像（10 个座位，各一只戴牛仔帽的动物，围巾是座位色）
    for i, ((_key, hexc), animal) in enumerate(zip(SEATS, ANIMALS)):
        files[f"avatars/avatar-{i}.png"] = label_tile(32, 32, hexc, animal, "circle")
    # 特效和小动画
    files["fx/dust.png"] = anim(32, 32, 6, P["sand"], "DU", "grow", blank_last=True)
    files["fx/heads-pop.png"] = anim(32, 32, 6, P["wood"], "HP", "rise", blank_last=True)
    files["fx/sparkle.png"] = anim(16, 16, 6, P["lamp"], "SP", "twinkle", blank_last=False)
    files["fx/lamp.png"] = anim(16, 32, 4, P["lamp"], "LP", "flame", blank_last=False)
    files["sprites/calf-run.png"] = anim(32, 32, 6, P["wood_md"], "CF", "bob", blank_last=False)
    files["sprites/tumbleweed.png"] = anim(24, 24, 8, P["wood_lt"], "TW", "spin", blank_last=False)
    return files


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate() -> None:
    files = build()
    manifest = {}
    for rel, img in files.items():
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        manifest[rel] = {"size": list(img.size), "sha256": sha(path)}
        print(f"{rel:32s} {img.size[0]}×{img.size[1]}")
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(f"共 {len(files)} 个文件 → {OUT}；哈希表 {MANIFEST}")


def check(root: pathlib.Path = OUT) -> int:
    """root 默认 public/art；正式美术定稿用 --dir art/out/final 查。"""
    manifest = json.loads(MANIFEST.read_text())
    still, missing, wrong = [], [], []
    for rel, info in manifest.items():
        path = root / rel
        if not path.exists():
            missing.append(rel)
            continue
        with Image.open(path) as im:
            if list(im.size) != info["size"]:
                wrong.append(f"{rel} 是 {im.size[0]}×{im.size[1]}，spec 要 {info['size'][0]}×{info['size'][1]}")
        if sha(path) == info["sha256"]:
            still.append(rel)
    kind = "简洁版" if any(v.get("kind") == "lite" for v in manifest.values()) else "占位图"
    for title, items in ((f"还是{kind}（没被正式图替换）", still), ("缺文件", missing), ("尺寸和 spec 不一样", wrong)):
        print(f"{title}：{len(items)}")
        for item in items:
            print("  ", item)
    return 1 if still or missing or wrong else 0


def sheet() -> None:
    """把所有占位图按 2 倍拼成一张总览，存到 art/out/（不进仓库），给自己看。"""
    files = build()
    pad, x, y, row_h, width = 8, 8, 8, 0, 1400
    placed = []
    for rel, img in files.items():
        big = img.resize((img.width * 2, img.height * 2), Image.NEAREST) if img.width < 600 else img
        if x + big.width > width:
            x, y, row_h = 8, y + row_h + pad, 0
        placed.append((big, x, y))
        x += big.width + pad
        row_h = max(row_h, big.height)
    canvas = Image.new("RGBA", (width, y + row_h + 8), rgba("#806048"))
    for big, px, py in placed:
        canvas.alpha_composite(big, (px, py))
    out = ROOT / "art" / "out" / "placeholders-sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    print(out)


if __name__ == "__main__":
    if "--check" in sys.argv:
        if "--dir" in sys.argv:
            sys.exit(check(pathlib.Path(sys.argv[sys.argv.index("--dir") + 1]).resolve()))
        sys.exit(check())
    if "--sheet" in sys.argv:
        sheet()
    elif "--legacy" in sys.argv:
        generate()
    else:
        print("public/art 现在放的是简洁版（art/lite.py 生成，能直接上线）。这个脚本只剩 --check；"
              "真要重画最早的色块占位图，加 --legacy（会覆盖简洁版和哈希表）。")
