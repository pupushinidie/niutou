"""动画：把 r3 的跑步帧缩成 32px 帧条；检查所有定稿帧条（照宝石商人 finalize.py 的 report / has_glitch_frame）。

用法：python art/anim.py strips   → art/out/r3/calf-run-*.png（每个种子一条）
     python art/anim.py report   → 逐条打印：最大变化（和首帧比）、相邻帧变化、坏帧、循环接缝、一次性特效末帧是否全空
"""
from __future__ import annotations

import collections
import pathlib
import sys

from PIL import Image, ImageChops

ART = pathlib.Path(__file__).resolve().parent
R3 = ART / "out" / "r3"
FINAL = ART / "out" / "final"

# 文件: (帧数, 是否循环)
ANIMS = {
    "ui/thinking.png": (4, True),
    "fx/dust.png": (6, False),
    "fx/heads-pop.png": (6, False),
    "fx/sparkle.png": (6, True),
    "fx/lamp.png": (4, True),
    "sprites/calf-run.png": (6, True),
    "sprites/tumbleweed.png": (8, True),
}


# 故意的关键帧：沙漏第 4 帧是「横过来翻面」，和前后帧差很多是设计如此，不是模型坏帧
KEYFRAME_OK = {"thinking.png": "第 4 帧是沙漏横过来翻面的关键帧，故意的"}


def down2(img: Image.Image) -> Image.Image:
    """2×2 取众数缩一半；4 个里透明的占一半以上就透明。"""
    img = img.convert("RGBA")
    w, h = img.width // 2, img.height // 2
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    src = img.load()
    for y in range(h):
        for x in range(w):
            px = [src[2 * x + dx, 2 * y + dy] for dx in (0, 1) for dy in (0, 1)]
            solid = [p[:3] for p in px if p[3] > 128]
            if len(solid) >= 2:
                dark = [p for p in solid if sum(p) < 200]  # 描边优先
                pick = collections.Counter(dark if len(dark) >= 2 else solid).most_common(1)[0][0]
                out.putpixel((x, y), pick + (255,))
    return out


def strips() -> None:
    for folder in sorted(p for p in R3.iterdir() if p.is_dir()):
        seeds = sorted({f.stem.rsplit("-", 1)[0] for f in folder.glob("*-s*-??.png")})
        for name in seeds:
            frames = sorted(folder.glob(f"{name}-??.png"))[:6]  # 首帧末帧同图时会多回一帧，去掉
            small = [down2(Image.open(f)) for f in frames]
            strip = Image.new("RGBA", (32 * len(small), 32), (0, 0, 0, 0))
            for i, f in enumerate(small):
                strip.alpha_composite(f, (i * 32, 0))
            strip.save(R3 / f"calf-run-{name}.png")
            print(R3 / f"calf-run-{name}.png")


def frames_of(path: pathlib.Path, n: int) -> list[Image.Image]:
    img = Image.open(path).convert("RGBA")
    w = img.width // n
    return [img.crop((i * w, 0, (i + 1) * w, img.height)) for i in range(n)]


def change(a: Image.Image, b: Image.Image) -> float:
    # 每个像素取 RGBA 四个通道里差得最多的那个（只看亮度会漏掉火苗、灯光这种变色不变亮的动静）
    d = ImageChops.difference(a, b).split()
    diff = ImageChops.lighter(ImageChops.lighter(d[0], d[1]), ImageChops.lighter(d[2], d[3])).point(lambda v: 255 if v > 24 else 0)
    return sum(1 for v in diff.getdata() if v) / (a.width * a.height)  # 和宝石商人 finalize.py 一样按整帧面积算


def check(path: pathlib.Path, n: int, loop: bool) -> tuple[bool, str]:
    fr = frames_of(path, n)
    vs_first = [change(fr[0], f) for f in fr[1:]]
    steps = [change(fr[i], fr[i + 1]) for i in range(n - 1)]
    problems, problems_note = [], []
    body = vs_first if loop else vs_first[:-1]
    worst = max(body) if body else 0
    if worst < 0.03:
        problems.append("太静")
    if loop and worst > 0.75:
        problems.append("走形?")
    s = sorted(steps)
    if loop and s[-1] >= 0.15 and s[-1] >= 2.5 * s[len(s) // 2]:
        if path.name in KEYFRAME_OK:
            problems_note.append(KEYFRAME_OK[path.name])
        else:
            problems.append("有坏帧")
    seam = change(fr[-1], fr[0])
    if loop and seam > max(steps) * 1.5 + 0.02 and path.name not in KEYFRAME_OK:
        problems.append(f"循环接缝跳 {seam:.0%}")
    if not loop and fr[-1].getbbox() is not None:
        problems.append("末帧不是全空")
    info = f"最大变化 {worst:5.1%}  相邻 {' '.join(f'{v:.0%}' for v in steps)}  接缝 {seam:.0%}"
    return not problems, info + ("  ✗ " + "、".join(problems) if problems else "  ✓") + ("（" + "；".join(problems_note) + "）" if problems_note else "")


def report(root: pathlib.Path = FINAL) -> int:
    bad = 0
    for rel, (n, loop) in ANIMS.items():
        path = root / rel
        if not path.exists():
            print(f"{rel:24s} 缺文件")
            bad += 1
            continue
        ok, info = check(path, n, loop)
        bad += not ok
        print(f"{rel:24s} {'循环' if loop else '一次'} {n} 帧  {info}")
    print("全部通过" if not bad else f"{bad} 条没过")
    return bad


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    if cmd == "strips":
        strips()
    else:
        sys.exit(1 if report() else 0)
