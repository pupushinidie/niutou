"""出图第三轮：奔跑小牛的跑步循环（/animate-with-text-v3）。结果在 art/out/r3/（不进仓库）。

首帧 = 选中的 r1 小牛（v2 出的全朝左，先水平翻成朝右），最近邻放大 2 倍到 64×64 再动，
首帧末帧都给静态图保证循环（会多回一帧，导出时去掉）；出来后用 2×2 取众数缩回 32×32。
用法：python art/r3.py
"""
from __future__ import annotations

import base64
import io
import sys

from PIL import Image, ImageOps

import pixellab

ART = pixellab.ART
OUT = ART / "out" / "r3"

RUNS = {  # 名字: (候选图, 种子)
    "calf45": ("r1/calf-run/calf-run-45.png", (501, 502)),
    "calf30": ("r1/calf-run/calf-run-30.png", (503,)),
}
ACTION = ("a cute cartoon calf running to the right in a bouncy gallop, four legs moving in a run cycle, "
          "body bobs up and down slightly, tail swings, side view")


def doubled(rel: str) -> tuple[dict, Image.Image]:
    img = ImageOps.mirror(Image.open(ART / "out" / rel).convert("RGBA"))
    big = img.resize((64, 64), Image.NEAREST)
    buf = io.BytesIO()
    big.save(buf, format="PNG")
    return {"type": "base64", "base64": base64.b64encode(buf.getvalue()).decode(), "format": "png"}, img


def main() -> None:
    for name, (rel, seeds) in RUNS.items():
        frame, small = doubled(rel)
        (OUT / name).mkdir(parents=True, exist_ok=True)
        small.save(OUT / name / f"{name}-static.png")
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / name / f"{target}-00.png").exists():
                continue
            try:
                pixellab.animate(target, {
                    "first_frame": frame, "last_frame": frame, "action": ACTION,
                    "frame_count": 6, "seed": seed, "no_background": True,
                }, OUT / name)
                print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
            except Exception as error:
                print(target, "失败：", error, flush=True)
    print("r3 跑完; spent", round(pixellab.spent_usd(), 4), flush=True)


if __name__ == "__main__":
    main()
