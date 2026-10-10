"""定稿导出：按 art/selection.json 把选中的图做成 spec 第 9 节的 38 个文件，放进 art/out/final/（路径同 public/art/）。

selection.json 每项：{"src": 候选图（相对 art/out/）, "op": 做法, "why": 一句话理由, "alts": [其他候选]}
  op = scene    512×288 场景，直接转成不透明 RGB
       icon     透明小图：裁掉四周空白，放进 spec 尺寸的画布正中（可选 "brighten": 0.25 提亮非描边像素）
       avatar   同 icon，再把围巾按座位色换色（"scarf": [色相中心°, 容差°, 从第几行往下]，没有就不换）
       copy     帧条、代码画的图，原样复制（检查尺寸）
       cards    牌面图集：{"face": "A|B|C", "back": "A|B|C" 或候选图路径}
       code     cards.py 里的函数：{"fn": "slot|danger|felt|rim|poster", "style": ...}
用法：python art/export.py && python art/placeholders.py --check --dir art/out/final
"""
from __future__ import annotations

import colorsys
import json
import pathlib
import shutil

from PIL import Image

import cards

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
FINAL = OUT / "final"
SEL = json.loads((ART / "selection.json").read_text())
MANIFEST = json.loads((ART / "placeholders.json").read_text())
SEATS = ["#e5533f", "#3b82f0", "#44b860", "#f0c030", "#9b6ad6", "#f08a2e", "#36c2c9", "#f06aa8", "#eeeae0", "#4a4f5c"]


def size_of(rel: str) -> tuple[int, int]:
    return tuple(MANIFEST[rel]["size"])


def trim_center(img: Image.Image, size: tuple[int, int], bottom: bool = False) -> Image.Image:
    img = img.convert("RGBA")
    # 半透明的杂点（alpha < 40）当成透明
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            if 0 < px[x, y][3] < 40:
                px[x, y] = (0, 0, 0, 0)
            elif px[x, y][3]:
                px[x, y] = px[x, y][:3] + (255,)
    box = img.getbbox()
    img = img.crop(box)
    if img.width > size[0] or img.height > size[1]:
        raise ValueError(f"内容 {img.size} 比画布 {size} 大")
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - img.width) // 2
    y = size[1] - img.height if bottom else (size[1] - img.height) // 2
    canvas.alpha_composite(img, (x, y))
    return canvas


def brighten(img: Image.Image, amount: float) -> Image.Image:
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a and r + g + b > 120:  # 描边不动
                px[x, y] = (min(255, int(r + (255 - r) * amount)), min(255, int(g + (255 - g) * amount)), min(255, int(b + (255 - b) * amount)), a)
    return img


def recolor_scarf(img: Image.Image, seat: int, hue: float, tol: float, ymin: int, min_sat: float = 0.3) -> Image.Image:
    """只换围巾：第 ymin 行往下、色相在 hue±tol、饱和度够的像素，按明暗映射到座位色。"""
    tr, tg, tb = (int(SEATS[seat][i:i + 2], 16) / 255 for i in (1, 3, 5))
    th, tl, ts = colorsys.rgb_to_hls(tr, tg, tb)
    px = img.load()
    picked = []
    for y in range(ymin, img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            dh = min(abs(h * 360 - hue), 360 - abs(h * 360 - hue))
            if dh <= tol and s > min_sat and 0.2 < l < 0.9:  # 太暗的是描边，不算
                picked.append((x, y, l))
    if not picked:
        return img
    mean_l = sum(l for *_, l in picked) / len(picked)
    for x, y, l in picked:
        nl = max(tl * 0.55, min(0.86, tl * (l / mean_l) ** 1.2))
        r, g, b = colorsys.hls_to_rgb(th, nl, ts)
        px[x, y] = (round(r * 255), round(g * 255), round(b * 255), 255)
    return img


def build(rel: str, item: dict) -> Image.Image:
    op = item["op"]
    size = size_of(rel)
    src = OUT / item["src"] if "src" in item else None
    if op == "scene":
        img = Image.open(src).convert("RGB")
        if img.size != size:
            raise ValueError(f"{rel}: 场景是 {img.size}")
        return img
    if op in ("icon", "avatar"):
        img = trim_center(Image.open(src), size, bottom=item.get("bottom", False))
        if item.get("brighten"):
            img = brighten(img, item["brighten"])
        if op == "avatar" and item.get("scarf"):
            img = recolor_scarf(img, item["seat"], *item["scarf"])
        return img
    if op == "copy":
        img = Image.open(src).convert("RGBA")
        if img.size != size:
            raise ValueError(f"{rel}: 是 {img.size}，spec 要 {size}")
        return img
    if op == "cards":
        sz = "lg" if "lg" in rel else "sm"
        back_key = item["back"]
        if back_key in ("A", "B", "C"):
            back_img = cards.back(sz, back_key)
        else:
            back_img = cards.back(sz, "A", Image.open(OUT / back_key)) if sz == "lg" else cards.back_from_pattern_sm(Image.open(OUT / back_key))
        return cards.atlas(sz, item["face"], back_img)
    if op == "code":
        fn = item["fn"]
        if fn == "slot":
            return cards.slot(*size, item["style"])
        if fn == "danger":
            return cards.danger(*size, "lg" if size[0] >= 40 else "sm", item["style"])
        if fn == "felt":
            return cards.felt(item["style"])
        if fn == "rim":
            return cards.rim(item["style"])
        if fn == "poster":
            return cards.poster_from(Image.open(src)) if src else cards.poster()
    raise ValueError(f"{rel}: 不认识的做法 {op}")


def main() -> None:
    done = 0
    for rel in MANIFEST:
        item = SEL.get(rel)
        if not item:
            print("没选：", rel)
            continue
        if "src" in item and not (OUT / item["src"]).exists():
            print("候选图还没有：", rel, item["src"])
            continue
        img = build(rel, item)
        path = FINAL / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        done += 1
    print(f"导出 {done}/{len(MANIFEST)} 个 → {FINAL}")


if __name__ == "__main__":
    main()
