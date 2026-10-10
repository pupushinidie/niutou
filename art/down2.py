"""把 32px 的 PixelLab 图标缩成 16px：每 2×2 取出现最多的颜色（透明少于 2 个像素时不透明），再补 1px 深棕描边。

用法：python art/down2.py <源图> <输出>
"""
from __future__ import annotations

import collections
import sys

from PIL import Image

INK = (42, 26, 16, 255)


def down2(src: Image.Image) -> Image.Image:
    src = src.convert("RGBA")
    w, h = src.width // 2, src.height // 2
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            px = [src.getpixel((2 * x + dx, 2 * y + dy)) for dx in (0, 1) for dy in (0, 1)]
            solid = [p for p in px if p[3] > 128]
            if len(solid) < 2:
                continue
            # 深色（描边、眼睛）优先保留：有两个以上深色就用深色
            dark = [p for p in solid if sum(p[:3]) < 200]
            pick = collections.Counter(dark if len(dark) >= 2 else solid).most_common(1)[0][0]
            out.putpixel((x, y), pick[:3] + (255,))
    # 外圈补描边：透明像素挨着不透明像素、且那个不透明像素不是深色时，把那个不透明像素换成描边
    res = out.copy()
    for y in range(h):
        for x in range(w):
            p = out.getpixel((x, y))
            if p[3] == 0:
                continue
            edge = any(
                not (0 <= x + dx < w and 0 <= y + dy < h) or out.getpixel((x + dx, y + dy))[3] == 0
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            if edge and sum(p[:3]) >= 200:
                res.putpixel((x, y), INK)
    return res


if __name__ == "__main__":
    down2(Image.open(sys.argv[1])).save(sys.argv[2])
