"""出图第四轮：大厅封面补候选。r1 的 3 张牌上都有像字母、点数的角标，这轮提示词强调「纯色空白牌」，
出来的仍要逐张查角标，有就用代码抹掉（covers.py）。结果在 art/out/r4/。
用法：python art/r4.py
"""
from __future__ import annotations

import pixellab

OUT = pixellab.ART / "out" / "r4"
PROMPT = ("a cozy wild west saloon card table with green felt seen from slightly above, four neat rows of blank solid colored cards "
          "in cream, teal, gold and brick red with no markings at all, a cute round brown bull calf with big eyes and tiny horns "
          "peeking over the far table edge, a brass kerosene lamp glowing, a cowboy hat on a chair, warm lamp light, "
          "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, "
          "no text, no letters, no numbers, no symbols on the cards, no logo, no people")

if __name__ == "__main__":
    for seed in (814, 815, 816, 817):
        target = f"cover-s{seed}"
        if (OUT / f"{target}.png").exists():
            continue
        try:
            pixellab.generate_image(target, {"description": PROMPT, "image_size": {"width": 384, "height": 192}, "seed": seed}, OUT)
            print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
        except Exception as error:
            print(target, "失败：", error, flush=True)
    print("r4 跑完; spent", round(pixellab.spent_usd(), 4), flush=True)
