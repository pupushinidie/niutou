"""牌面、牌背、空格、危险格、毡面、木边、通缉令：全部用代码画（数字和牛头数要准，不交给模型）。

字体、牛头数、调色都从 placeholders.py 复用，尺寸和图集排法照 art/spec.md 第 4.1 节，不改。
第一轮出 3 种风格做候选：
  A 素净：纯色底 + 内框 + 顶边亮线（占位图那一版）
  B 羊皮纸：底色上撒细颗粒，四角黄铜铆钉，下边一道暗边
  C 扑克框：内外双框 + 四角小花 + 极淡的斜纹
用法：python art/cards.py candidates   → art/out/r1/code/
     python art/cards.py export <A|B|C> [背 A|B|C]  → art/out/final/cards/（定稿时用；首发后才进 public）
"""
from __future__ import annotations

import pathlib
import random
import sys

from PIL import Image, ImageDraw

import placeholders as ph
from placeholders import P, rgba, shade, lum, heads_of, stamp, digits

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out" / "r1" / "code"
# 正式定稿先放 art/out/final/（路径同 spec），首发上线后制作人通知了才覆盖进 public/art/
FINAL = ART / "out" / "final"

# 牌面上的小牛脸：H 头 E 眼睛（挖空=底色）S 鼻子 K 鼻孔
HEADS = {
    "sm": ["H...H", "HHHHH", "HEHEH", ".SSS.", ".SKS."],
    "lg": [".H...H.", "HHHHHHH", ".HEHEH.", ".HHHHH.", ".SSSSS.", ".SKSKS.", "..SSS.."],
}


def face(n: int, size: str, style: str) -> Image.Image:
    w, h, font, gap, _head, hgap, top_y, bot_y, inset = ph.SIZES[size]
    head = HEADS[size]
    k = heads_of(n)
    base = rgba(ph.CARD_BG[k])
    ink, cream = rgba(P["ink"]), rgba(P["cream"])
    img = ph.card_shell(w, h, base, inset)
    d = ImageDraw.Draw(img)
    rng = random.Random(n * 7 + len(size))
    if style == "B":
        for _ in range(w * h // 9):
            x, y = rng.randrange(inset + 1, w - inset - 1), rng.randrange(inset + 1, h - inset - 1)
            img.putpixel((x, y), shade(base, 0.93 if rng.random() < 0.6 else 1.05))
        d.line([inset + 1, h - inset - 2, w - inset - 2, h - inset - 2], fill=shade(base, 0.86))
        for x, y in ((inset + 2, inset + 2), (w - inset - 3, inset + 2), (inset + 2, h - inset - 3), (w - inset - 3, h - inset - 3)):
            img.putpixel((x, y), rgba(P["brass_dk"]))
            if size == "lg":
                img.putpixel((x + 1 if x < w // 2 else x - 1, y), rgba(P["brass"]))
    elif style == "C":
        for y in range(inset + 1, h - inset - 1):
            for x in range(inset + 1, w - inset - 1):
                if (x + y) % 6 == 0:
                    img.putpixel((x, y), shade(base, 0.95))
        if size == "lg":
            d.rectangle([inset + 2, inset + 2, w - inset - 3, h - inset - 3], outline=shade(base, 0.88))
            for x, y in ((inset + 4, inset + 4), (w - inset - 5, inset + 4), (inset + 4, h - inset - 5), (w - inset - 5, h - inset - 5)):
                d.point([(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)], fill=shade(base, 0.78))
    dark_bg = lum(base) < 140
    colors = {"H": cream if dark_bg else ink, "E": base, "S": rgba(P["snout"]), "K": shade(rgba(P["snout"]), 0.6)}
    hw = len(head[0])
    top, bottom = ph.LAYOUT[k]
    for count, y in ((top, top_y), (bottom, bot_y)):
        if count:
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


BACKS = {  # 主色、暗色、金线
    "A": (P["back"], P["back_dk"], P["brass"]),
    "B": ("#2c3a5c", "#1d2740", P["brass"]),
    "C": ("#5a3420", "#3e2316", P["brass"]),
}


def back(size: str, style: str, pattern: Image.Image | None = None) -> Image.Image:
    w, h, *_rest, inset = ph.SIZES[size]
    head = HEADS[size]
    c1, c2, gold = (rgba(c) for c in BACKS[style])
    ink = rgba(P["ink"])
    img = ph.card_shell(w, h, c1, inset)
    d = ImageDraw.Draw(img)
    if pattern is not None and size == "lg":  # PixelLab 出的图案（40×56）放进框里
        img.alpha_composite(pattern.convert("RGBA").crop((1, 1, 39, 55)).resize((w - 4, h - 4), Image.NEAREST), (2, 2))
        d.rectangle([0, 0, w - 1, h - 1], outline=ink)
        for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            img.putpixel((x, y), (0, 0, 0, 0))
        return img
    step = 4 if size == "lg" else 3
    for y in range(inset + 2, h - inset - 2):
        for x in range(inset + 2, w - inset - 2):
            if style == "C":
                if (y // 2) % 3 == 0 and (x + y // 6) % 5:
                    img.putpixel((x, y), c2)  # 木纹似的横线
            elif (x + y) % step == 0 or (x - y) % step == 0:
                img.putpixel((x, y), c2)
    d.rectangle([inset + 1, inset + 1, w - 2 - inset, h - 2 - inset], outline=gold)
    if size == "lg":
        d.rectangle([inset + 3, inset + 3, w - 4 - inset, h - 4 - inset], outline=shade(gold, 0.7))
    hw, hh = len(head[0]), len(head)
    cx, cy = w // 2, h // 2
    r = hw // 2 + (4 if size == "lg" else 3)
    d.ellipse([cx - r, cy - r, cx + r - 1, cy + r - 1], fill=c2, outline=gold)
    stamp(img, head, cx - hw // 2, cy - hh // 2, {"H": gold, "E": c2, "S": gold, "K": c2})
    return img


def atlas(size: str, style: str, back_img: Image.Image) -> Image.Image:
    w, h = ph.SIZES[size][:2]
    img = Image.new("RGBA", (w * 10, h * 11), (0, 0, 0, 0))
    img.alpha_composite(back_img, (0, 0))
    for n in range(1, 105):
        img.alpha_composite(face(n, size, style), ((n % 10) * w, (n // 10) * h))
    return img


def slot(w: int, h: int, style: str) -> Image.Image:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    line = rgba(P["felt_line"], 190)
    if style == "A":
        return ph.slot(w, h)
    if style == "B":  # 暗一点的凹槽 + 四角
        d.rectangle([0, 0, w - 1, h - 1], fill=rgba(P["felt_dk"], 150))
        for x, y, dx, dy in ((0, 0, 1, 1), (w - 1, 0, -1, 1), (0, h - 1, 1, -1), (w - 1, h - 1, -1, -1)):
            for t in range(4):
                img.putpixel((x + dx * t, y), line)
                img.putpixel((x, y + dy * t), line)
        return img
    # C：只有缝线，没有底
    for x in range(2, w - 2, 2):
        img.putpixel((x, 1), line)
        img.putpixel((x, h - 2), line)
    for y in range(2, h - 2, 2):
        img.putpixel((1, y), line)
        img.putpixel((w - 2, y), line)
    return img


def stamp2(img: Image.Image, pattern: list[str], x0: int, y0: int, colors: dict, k: int) -> None:
    """按 k 倍画点阵（危险格里的大牛头）。"""
    for r, row in enumerate(pattern):
        for c, v in enumerate(row):
            if v in colors:
                ImageDraw.Draw(img).rectangle([x0 + c * k, y0 + r * k, x0 + c * k + k - 1, y0 + r * k + k - 1], fill=colors[v])


def danger(w: int, h: int, size: str, style: str) -> Image.Image:
    head = HEADS["lg" if w >= 40 else "sm"]
    k = 2 if w >= 28 else 1
    if style == "A":
        return ph.danger(w, h, head)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    red, dark = rgba(P["danger"]), rgba("#5a1c18")
    hw, hh = len(head[0]) * k, len(head) * k
    if style == "B":  # 暗红底 + 红虚线框 + 奶白牛头
        d.rectangle([0, 0, w - 1, h - 1], fill=dark[:3] + (150,))
        for x in range(w):
            if x // 2 % 2 == 0:
                img.putpixel((x, 0), red)
                img.putpixel((x, h - 1), red)
        for y in range(h):
            if y // 2 % 2 == 0:
                img.putpixel((0, y), red)
                img.putpixel((w - 1, y), red)
        stamp2(img, head, (w - hw) // 2, (h - hh) // 2, {"H": rgba(P["cream"], 230), "S": red, "K": dark}, k)
        return img
    # C：透明，红色四角括号 + 底部警示斜纹带 + 红牛头
    for x, y, dx, dy in ((0, 0, 1, 1), (w - 1, 0, -1, 1), (0, h - 1, 1, -1), (w - 1, h - 1, -1, -1)):
        for t in range(min(6, w // 3)):
            for k in range(2):
                img.putpixel((x + dx * t, y + dy * k), red)
                img.putpixel((x + dx * k, y + dy * t), red)
    band = 6 if h > 40 else 4
    for yy in range(h - band - 2, h - 2):
        for xx in range(2, w - 2):
            img.putpixel((xx, yy), red[:3] + (170,) if (xx + yy) // 2 % 2 == 0 else (30, 15, 10, 120))
    stamp2(img, head, (w - hw) // 2, (h - band - hh) // 2, {"H": red, "S": rgba(P["cream"], 220), "K": dark}, k)
    return img


def felt(style: str) -> Image.Image:
    """64×64 无缝毡面。A 均匀细颗粒；B 颗粒 + 极淡的斜向绒毛；C 两色抖动。"""
    rng = random.Random({"A": 1, "B": 2, "C": 3}[style])
    base, dk, lt = rgba(P["felt"]), rgba(P["felt_dk"]), rgba(P["felt_lt"])
    img = Image.new("RGBA", (64, 64), base)
    if style == "A":
        for _ in range(260):
            img.putpixel((rng.randrange(64), rng.randrange(64)), dk if rng.random() < 0.65 else lt)
    elif style == "B":
        for _ in range(180):
            img.putpixel((rng.randrange(64), rng.randrange(64)), dk if rng.random() < 0.65 else lt)
        for _ in range(40):
            x, y = rng.randrange(64), rng.randrange(64)
            for t in range(3):
                img.putpixel(((x + t) % 64, (y + t) % 64), shade(base, 1.06))
    else:
        mid = shade(base, 0.94)
        for y in range(64):
            for x in range(64):
                if (x + 2 * y) % 5 == 0 and rng.random() < 0.7:
                    img.putpixel((x, y), mid)
        for _ in range(60):
            img.putpixel((rng.randrange(64), rng.randrange(64)), dk)
    return img


def rim(style: str) -> Image.Image:
    """24×24 九宫格（border-image-slice: 8），中间透明。"""
    img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    wood, dk, md, lt, brass = (rgba(P[k]) for k in ("wood", "wood_dk", "wood_md", "wood_lt", "brass"))
    d.rectangle([0, 0, 23, 23], fill=wood)
    for y in (3, 5, 18, 20):  # 木纹
        d.line([1, y, 22, y], fill=shade(wood, 0.88))
    for x in (3, 5, 18, 20):
        d.line([x, 6, x, 17], fill=shade(wood, 0.88))
    d.rectangle([0, 0, 23, 23], outline=rgba(P["ink"]))
    d.line([1, 1, 22, 1], fill=lt)
    d.line([1, 1, 1, 22], fill=md)
    d.line([1, 22, 22, 22], fill=dk)
    d.line([22, 1, 22, 22], fill=dk)
    if style in ("A", "C"):
        d.rectangle([7, 7, 16, 16], outline=brass if style == "A" else dk)
    if style == "C":
        for x, y in ((3, 3), (20, 3), (3, 20), (20, 20)):
            d.rectangle([x - 1, y - 1, x, y], fill=brass)
    if style == "B":
        d.rectangle([7, 7, 16, 16], outline=rgba(P["ink"]))
        d.line([6, 6, 17, 6], fill=dk)
    d.rectangle([8, 8, 15, 15], fill=(0, 0, 0, 0))
    return img


def poster() -> Image.Image:
    """64×80 空白通缉令，头像框内部 (16,23)–(47,54)。"""
    img = Image.new("RGBA", (64, 80), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    paper, ink = rgba("#e8d5a8"), rgba(P["ink"])
    rng = random.Random(5)
    d.rectangle([2, 2, 61, 77], fill=paper, outline=ink)
    for _ in range(140):
        img.putpixel((rng.randrange(4, 60), rng.randrange(4, 76)), shade(paper, 0.92))
    for x in range(3, 61):  # 毛边：上下随机缺口
        if rng.random() < 0.18:
            img.putpixel((x, 2), (0, 0, 0, 0))
            img.putpixel((x, 3), ink)
        if rng.random() < 0.18:
            img.putpixel((x, 77), (0, 0, 0, 0))
            img.putpixel((x, 76), ink)
    d.line([3, 3, 60, 3], fill=shade(paper, 1.06))
    d.rectangle([4, 4, 59, 75], outline=shade(paper, 0.8))
    d.rectangle([15, 22, 48, 55], fill=shade(paper, 0.72), outline=ink)
    for y in (10, 14, 62, 66, 70):  # 留给界面写字的位置，只画几道浅横线当装饰
        d.line([12, y, 51, y], fill=shade(paper, 0.88))
    for x, y in ((6, 6), (57, 6), (6, 73), (57, 73)):
        d.rectangle([x - 1, y - 1, x, y], fill=rgba(P["brass_dk"]))
        img.putpixel((x - 1, y - 1), rgba(P["brass"]))
    return img


def zoom(img: Image.Image, k: int) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def candidates() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sample = [0, 1, 5, 10, 11, 55, 77, 104]
    felt_bg = felt("A")
    for style in "ABC":
        for size in ("lg", "sm"):
            atlas(size, style, back(size, style)).save(OUT / f"cards-{size}-{style}.png")
        # 预览：毡面上摆一排样牌（lg 2×、sm 2×）
        w = 8 * (84 + 8) + 8
        prev = Image.new("RGBA", (w, 116 + 76 + 24), (0, 0, 0, 255))
        for x in range(0, w, 128):
            for y in range(0, prev.height, 128):
                prev.alpha_composite(zoom(felt_bg, 2).crop((0, 0, min(128, w - x), min(128, prev.height - y))), (x, y))
        for i, n in enumerate(sample):
            lg = back("lg", style) if n == 0 else face(n, "lg", style)
            sm = back("sm", style) if n == 0 else face(n, "sm", style)
            prev.alpha_composite(zoom(lg, 2), (8 + i * 92, 8))
            prev.alpha_composite(zoom(sm, 2), (8 + i * 92 + 14, 132))
        prev.save(OUT / f"cards-preview-{style}.png")
        slot(42, 58, style).save(OUT / f"slot-lg-{style}.png")
        slot(28, 38, style).save(OUT / f"slot-sm-{style}.png")
        danger(42, 58, "lg", style).save(OUT / f"danger-lg-{style}.png")
        danger(28, 38, "sm", style).save(OUT / f"danger-sm-{style}.png")
        danger(14, 38, "sm", style).save(OUT / f"danger-strip-sm-{style}.png")
        felt(style).save(OUT / f"felt-{style}.png")
        rim(style).save(OUT / f"rim-{style}.png")
        # 一排的样子：5 张 + 空格 + 危险格，毡面、木边
        row = Image.new("RGBA", (6 * 48 + 40, 58 + 40), (0, 0, 0, 0))
        tile = felt(style)
        for x in range(0, row.width, 64):
            for y in range(0, row.height, 64):
                row.alpha_composite(tile, (x, y))
        r = rim(style)
        for x in range(0, row.width, 8):  # 简单拼木边看效果
            row.alpha_composite(r.crop((8, 0, 16, 8)), (x, 0))
            row.alpha_composite(r.crop((8, 16, 16, 24)), (x, row.height - 8))
        for y in range(0, row.height, 8):
            row.alpha_composite(r.crop((0, 8, 8, 16)), (0, y))
            row.alpha_composite(r.crop((16, 8, 24, 16)), (row.width - 8, y))
        for corner, (sx, sy) in {(0, 0): (0, 0), (row.width - 8, 0): (16, 0), (0, row.height - 8): (0, 16), (row.width - 8, row.height - 8): (16, 16)}.items():
            row.alpha_composite(r.crop((sx, sy, sx + 8, sy + 8)), corner)
        for i, n in enumerate([41, 44, 45, 46]):
            row.alpha_composite(face(n, "lg", style), (20 + i * 48, 20))
        row.alpha_composite(slot(42, 58, style), (20 + 4 * 48, 20))
        row.alpha_composite(danger(42, 58, "lg", style), (20 + 5 * 48, 20))
        zoom(row, 2).save(OUT / f"row-preview-{style}.png")
    poster().save(OUT / "poster-code.png")
    zoom(poster(), 3).save(OUT / "poster-code-3x.png")
    print("候选在", OUT)


def export(style: str, back_style: str) -> None:
    for size in ("lg", "sm"):
        (FINAL / "cards").mkdir(parents=True, exist_ok=True)
        atlas(size, style, back(size, back_style)).save(FINAL / "cards" / f"cards-{size}.png")


if __name__ == "__main__":
    if sys.argv[1:2] == ["export"]:
        export(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else sys.argv[2])
    else:
        candidates()
