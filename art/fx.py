"""特效帧条：一次性的尘土、牛头飘出，循环的闪光、风滚草滚动、煤油灯火苗、沙漏。

这些都是 16–32px 的小图，用 /animate-with-text-v3 在这个尺寸上会糊成一团，所以用代码画，
用的是 spec 第 2 节的调色板，左上来光、1px 深棕描边；风滚草、煤油灯、沙漏的底图来自选中的 PixelLab 静态图。
每样出 3 个变体（a/b/c）做候选，结果在 art/out/r2/fx/。

用法：python art/fx.py            → 全部候选
"""
from __future__ import annotations

import json
import math
import pathlib
import random

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out" / "r2" / "fx"
SEL = json.loads((ART / "selection.json").read_text())


def hexa(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


INK = hexa("#2a1a10")
CREAM = hexa("#fff4dc")
GOLD = hexa("#d9a441")
GOLD_DK = hexa("#9a6b22")
LAMP = hexa("#ffcf6b")
LAMP2 = hexa("#f2a33a")
SAND = [hexa("#fbe3b4"), hexa("#f4c683"), hexa("#d39b5c"), hexa("#aa704f")]


def strip(frames: list[Image.Image]) -> Image.Image:
    w, h = frames[0].size
    out = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.alpha_composite(f, (i * w, 0))
    return out


def outline(img: Image.Image, color=INK) -> Image.Image:
    """不透明区域外面加 1px 描边（四邻）。"""
    w, h = img.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= x + dx < w and 0 <= y + dy < h and px[x + dx, y + dy][3] > 0:
                    out.putpixel((x, y), color)
                    break
    out.alpha_composite(img)
    return out


# ---------- 尘土：6 帧 32×32，一次性，最后一帧全空 ----------
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]  # 变淡用的 4×4 有序抖动
def puff(img: Image.Image, cx: float, cy: float, r: float, keep: float, rng: random.Random) -> None:
    """一团尘：三层色（左上亮、右下暗），keep<1 时按抖动去掉一部分像素（变淡）。"""
    px = img.load()
    w, h = img.size
    for y in range(int(cy - r - 1), int(cy + r + 2)):
        for x in range(int(cx - r - 1), int(cx + r + 2)):
            if not (0 <= x < w and 0 <= y < h):
                continue
            d = math.hypot(x - cx, y - cy)
            if d > r:
                continue
            if keep < 1 and (BAYER[y % 4][x % 4] + 0.5) / 16 >= keep:
                continue
            light = ((x - cx) + (y - cy)) / max(r, 1)  # 左上 -1，右下 +1
            if d > r - 1:
                c = SAND[3]
            elif light < -0.5:
                c = SAND[0]
            elif light < 0.35:
                c = SAND[1]
            else:
                c = SAND[2]
            px[x, y] = c


def dust(variant: str) -> Image.Image:
    """从底部中间往两边、往上扬起的几团尘：0–2 帧变大散开，3–4 帧往上飘、变小变淡，5 帧全空。"""
    rng = random.Random({"a": 1, "b": 2, "c": 3}[variant])
    n = {"a": 6, "b": 8, "c": 5}[variant]
    blobs = []
    for i in range(n):
        side = -1 if i % 2 else 1
        spread = (i // 2 + 1) / ((n + 1) // 2)  # 越往后的团飞得越远
        blobs.append((side * spread * rng.uniform(9, 12), -rng.uniform(1, 4) - (1 - spread) * 5, rng.uniform(3.2, 5.2) * (1.2 - spread * 0.4)))
    grow = [0.45, 0.8, 1.0, 0.9, 0.65, 0]
    rise = [0, 1, 2, 4, 6, 0]
    out_t = [0.25, 0.65, 0.9, 1.0, 1.05, 0]
    keep = [1, 1, 1, 0.62, 0.32, 0]
    frames = []
    for f in range(6):
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        if f < 5:
            for dx, dy, r in blobs:
                cx = 16 + dx * out_t[f]
                cy = 27 + dy * out_t[f] - rise[f]
                puff(img, cx, cy, r * grow[f] * (1.15 if variant == "c" else 1), keep[f], rng)
            if variant == "b" and f < 3:  # 飞出去的小石子
                for k in range(4):
                    sx = 16 + (k - 1.5) * 4 * (f + 1.5)
                    sy = 24 - (f + 1) * 3 + abs(k - 1.5) * 2
                    if 0 <= sx < 32 and 0 <= sy < 32:
                        img.putpixel((int(sx), int(sy)), SAND[3])
        frames.append(img)
    return strip(frames)


# ---------- 闪光：6 帧 16×16，循环 ----------
STAR = {  # 不同大小的四角星
    0: [],
    1: [(0, 0)],
    2: [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)],
    3: [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)],
    4: [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2), (3, 0), (-3, 0), (0, 3), (0, -3), (1, 1), (-1, -1), (1, -1), (-1, 1)],
}


def draw_star(img: Image.Image, cx: int, cy: int, size: int) -> None:
    for dx, dy in STAR[size]:
        x, y = cx + dx, cy + dy
        if 0 <= x < 16 and 0 <= y < 16:
            dist = max(abs(dx), abs(dy)) if dx and dy else abs(dx) + abs(dy)
            ring = [CREAM, LAMP, LAMP2, GOLD_DK][min(dist + (4 - size if size < 3 else 0), 3)] if size > 1 else LAMP
            img.putpixel((x, y), ring)


def sparkle(variant: str) -> Image.Image:
    seq = [1, 2, 3, 4, 2, 0] if variant != "c" else [0, 1, 3, 4, 3, 1]
    spots = {"a": [(4, 4, 0), (11, 9, 3), (5, 12, 1)],
             "b": [(8, 7, 0), (3, 12, 2), (13, 3, 4)],
             "c": [(7, 8, 0), (12, 3, 3)]}[variant]
    frames = []
    for f in range(6):
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        for x, y, phase in spots:
            size = seq[(f + phase) % 6]
            if variant == "b" and phase:
                size = min(size, 2)
            draw_star(img, x, y, size)
        frames.append(img)
    return strip(frames)


# ---------- 牛头飘出：6 帧 32×32，一次性 ----------
def heads_pop(variant: str, head16: Image.Image) -> Image.Image:
    """牛头飘出：a 一个牛头弹起往上飘，第 5 帧「噗」地变成一圈星星，第 6 帧全空；
    b 同样的飘法但最后散成小点；c 两个牛头一前一后飘。"""
    frames = []
    ys = [17, 10, 6, 3]
    for f in range(6):
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        if f < 4:
            if variant == "c":
                img.alpha_composite(head16, (4, min(16, ys[f] + 4)))
                if f >= 1:
                    img.alpha_composite(head16, (13, ys[f - 1] + 2))
            else:
                img.alpha_composite(head16, (8, ys[f]))
            if f in (1, 2) and variant != "c":
                draw_star16(img, 5, 20 - f * 3)
                draw_star16(img, 27, 16 - f * 3)
        elif f == 4:  # 噗：一圈星星 / 小点
            cx, cy = 16, 9
            for k in range(8):
                ang = k * math.pi / 4
                x, y = round(cx + 9 * math.cos(ang)), round(cy + 7 * math.sin(ang))
                if variant == "b":
                    if 0 <= x < 32 and 0 <= y < 32:
                        img.putpixel((x, y), LAMP)
                elif k % 2 == 0:
                    draw_star16(img, x, y)
                else:
                    if 0 <= x < 32 and 0 <= y < 32:
                        img.putpixel((x, y), CREAM)
            draw_star(img, cx, cy, 2) if False else None
        frames.append(img)
    return strip(frames)


def draw_star16(img: Image.Image, x: int, y: int) -> None:
    for dx, dy in STAR[2]:
        if 0 <= x + dx < img.width and 0 <= y + dy < img.height:
            img.putpixel((x + dx, y + dy), CREAM if (dx, dy) == (0, 0) else LAMP)


# ---------- 风滚草：8 帧 24×24，循环滚动 ----------
def tumbleweed(variant: str, base: Image.Image) -> Image.Image:
    """风滚草是圆的：外轮廓（描边那一圈）每帧不动，只把里面的枝条按 45° 一步转（往右滚 = 顺时针），再上下弹一点。
    直接转 45° 会把描边转碎，所以描边圈用原图的、里面的空洞补成暗枝条色。"""
    base = base.convert("RGBA")
    w, h = base.size
    px = base.load()
    inside = {(x, y) for y in range(h) for x in range(w) if px[x, y][3] > 128}
    ring = {(x, y) for x, y in inside if any((x + dx, y + dy) not in inside for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    core = inside - ring
    cols = sorted((px[x, y] for x, y in core), key=lambda c: sum(c[:3]))
    twig_dk = cols[len(cols) // 3] if cols else hexa("#663d24")  # 转出来的空洞补成偏暗的枝条色
    bounce = {"a": [0, 1, 2, 2, 1, 0, 0, 0], "b": [0, 0, 1, 1, 0, 0, 1, 1], "c": [0, 2, 3, 2, 0, 1, 1, 0]}[variant]
    frames = []
    for f in range(8):
        rot = base.rotate(-45 * f, resample=Image.NEAREST, center=((w - 1) / 2, (h - 1) / 2))
        rp = rot.load()
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        q = img.load()
        for x, y in ring:
            q[x, y] = px[x, y]
        for x, y in core:
            c = rp[x, y]
            q[x, y] = c if c[3] > 128 else twig_dk
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        out.alpha_composite(img, (0, -bounce[f]))
        frames.append(out)
    return strip(frames)


# ---------- 煤油灯：4 帧 16×32，循环（火苗跳） ----------
def lamp(variant: str, base: Image.Image) -> Image.Image:
    if variant == "a":
        return lamp_drawn(base)
    base = base.convert("RGBA")
    px = base.load()
    w, h = base.size
    # 火苗像素：很亮、偏黄橙（不包括玻璃罩的高光：要求饱和度够）
    # 火苗像素：灯罩里（上半截）很亮、偏黄橙的像素；黄铜灯座也是黄的，所以只看上半截
    flame = []
    for y in range(int(h * 0.55)):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and r > 220 and g > 150 and b < 150 and r - b > 90:
                flame.append((x, y))
    if not flame:
        raise RuntimeError("煤油灯底图里没找到火苗")
    top = min(y for _, y in flame)
    bot = max(y for _, y in flame)
    xs = [x for x, _ in flame]
    cx = round(sum(xs) / len(xs))
    frames = []
    shapes = {"a": [(0, 0), (1, 0), (0, -1), (-1, 0)], "b": [(0, 0), (0, -1), (1, -1), (0, 1)], "c": [(0, 0), (-1, -1), (0, -2), (1, -1)]}[variant]
    for dx, dy in shapes:
        img = base.copy()
        p = img.load()
        # 先把火苗抹成灯罩里的暖光色，再画移过的火苗
        for x, y in flame:
            p[x, y] = LAMP2
        for x, y in flame:
            tx, ty = x, y
            if y < (top + bot) / 2:  # 只有上半截跟着摆
                tx, ty = x + dx, y + dy
            if 0 <= tx < w and 0 <= ty < h:
                r, g, b, a = px[x, y]
                p[tx, ty] = (r, g, b, 255)
        # 火苗尖：变体之间高一点矮一点
        if dy < 0 and 0 <= cx + dx < w and top + dy - 1 >= 0:
            p[cx + dx, top + dy - 1] = LAMP
        frames.append(img)
    return strip(frames)


FLAMES = [  # 手画的 4 帧火苗：c 奶白芯、y 灯光黄、o 橙边；底边对齐原火苗底边
    ["..o..", ".oyo.", ".ycy.", "oycyo", ".yyy."],
    [".o...", ".yo..", ".yyo.", ".ycy.", "oycyo", ".yyy."],
    [".oyo.", "oycyo", "oycyo", ".yyy."],
    ["...o.", "..oy.", ".oyy.", ".ycy.", "oycyo", ".yyy."],
]


def lamp_drawn(base: Image.Image) -> Image.Image:
    """把原图的火苗抹成灯罩玻璃色，再按 FLAMES 画 4 帧（比平移原火苗干净）。"""
    from collections import Counter
    base = base.convert("RGBA")
    px = base.load()
    w, h = base.size
    flame = [(x, y) for y in range(int(h * 0.55)) for x in range(w)
             if px[x, y][3] and px[x, y][0] > 220 and px[x, y][1] > 150 and px[x, y][2] < 150 and px[x, y][0] - px[x, y][2] > 90]
    if not flame:
        raise RuntimeError("煤油灯底图里没找到火苗")
    fs = set(flame)
    near = Counter(px[x + dx, y + dy] for x, y in flame for dx, dy in ((1, 0), (-1, 0), (0, -1))
                   if 0 <= x + dx < w and (x + dx, y + dy) not in fs and px[x + dx, y + dy][3])
    glass = near.most_common(1)[0][0]
    bottom = max(y for _, y in flame)
    cx = round(sum(x for x, _ in flame) / len(flame))
    colors = {"c": CREAM, "y": LAMP, "o": LAMP2}
    frames = []
    for shape in FLAMES:
        img = base.copy()
        p = img.load()
        for x, y in flame:
            p[x, y] = glass
        for r, row in enumerate(shape):
            y = bottom - (len(shape) - 1 - r)
            for c, v in enumerate(row):
                x = cx - 2 + c
                if v in colors and 0 <= x < w and 0 <= y < h:
                    p[x, y] = colors[v]
        frames.append(img)
    return strip(frames)


# ---------- 沙漏：4 帧 16×16，循环（沙子往下漏 → 翻过来） ----------
def thinking(variant: str, base: Image.Image) -> Image.Image:
    base = base.convert("RGBA")
    px = base.load()
    w, h = base.size
    sand = [(x, y) for y in range(h) for x in range(w)
            if px[x, y][3] and px[x, y][0] > 190 and px[x, y][1] > 140 and px[x, y][2] < 140]
    if len(sand) < 4:
        raise RuntimeError("沙漏底图里没找到沙子")
    mid = (min(y for _, y in sand) + max(y for _, y in sand)) / 2
    top = [(x, y) for x, y in sand if y < mid]
    bottom = [(x, y) for x, y in sand if y >= mid]
    glass = None
    # 玻璃色：取沙子旁边最常见的非沙子颜色
    from collections import Counter
    near = Counter()
    for x, y in sand:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (x + dx, y + dy)
            if 0 <= q[0] < w and 0 <= q[1] < h and q not in sand and px[q][3]:
                near[px[q][:3]] += 1
    glass = near.most_common(1)[0][0] + (255,) if near else (120, 90, 60, 255)
    sand_c = px[sand[0]]

    def fill(img: Image.Image, top_frac: float) -> Image.Image:
        p = img.load()
        for x, y in sand:
            p[x, y] = glass
        # 上半边从下往上剩 top_frac，下半边从下往上堆 1-top_frac
        cells_top = sorted(top + [(x, y) for x, y in bottom], key=lambda c: c[1])
        upper = sorted([c for c in sand if c[1] < mid], key=lambda c: -c[1])
        lower = sorted([c for c in sand if c[1] >= mid], key=lambda c: -c[1])
        for c in upper[: round(len(upper) * top_frac)]:
            p[c] = sand_c
        for c in lower[: round(len(lower) * (1 - top_frac))]:
            p[c] = sand_c
        return img

    f0 = fill(base.copy(), 1.0)
    f1 = fill(base.copy(), 0.55)
    f2 = fill(base.copy(), 0.1)
    if variant == "a":   # 漏完转 90°（翻的半路），回到 f0
        f3 = f2.rotate(-90, resample=Image.NEAREST)
    elif variant == "b":  # 漏完直接倒过来
        f3 = f2.rotate(180, resample=Image.NEAREST)
    else:                 # 轻轻晃一下
        f3 = fill(base.copy(), 0.1)
        f3 = Image.new("RGBA", (w, h), (0, 0, 0, 0)); f3.alpha_composite(f2, (0, -1))
    # 沙漏中间漏下的一粒
    for img in (f1,):
        img.putpixel((w // 2, int(mid) + 1), sand_c)
    return strip([f0, f1, f2, f3])


def sel_image(key: str) -> Image.Image:
    v = SEL[key]
    return Image.open(ART / "out" / (v["src"] if isinstance(v, dict) else v)).convert("RGBA")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for v in "abc":
        dust(v).save(OUT / f"dust-{v}.png")
        sparkle(v).save(OUT / f"sparkle-{v}.png")
    head16 = ART / "out" / "final" / "ui" / "head-16.png"  # 用导出好的（已裁好、居中）
    if head16.exists():
        for v in "abc":
            heads_pop(v, Image.open(head16).convert("RGBA")).save(OUT / f"heads-pop-{v}.png")
    for key, fn, name in (("_static/tumbleweed", tumbleweed, "tumbleweed"), ("_static/lamp", lamp, "lamp"), ("_static/thinking", thinking, "thinking")):
        if SEL.get(key):
            for v in "abc":
                try:
                    fn(v, sel_image(key)).save(OUT / f"{name}-{v}.png")
                except Exception as error:
                    print(name, v, "失败：", error)
    print("帧条在", OUT)


if __name__ == "__main__":
    main()
