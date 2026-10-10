"""出图第四轮：大厅封面补候选，同时实测会员账号的并发（一个进程里的线程池，pxqueue 按进程占位置）。

r1 的 3 张封面牌上都有像字母、点数的角标；这轮提示词强调「纯色空白牌」，出来的仍要逐张查角标，有就用代码抹掉。
第 1 步 2 个线程同时提交，确认没有 429/并发上限报错再走第 2 步（6 个线程）。每张的耗时、报错打印出来，汇总写进 out/r4/concurrency.json。
结果在 art/out/r4/。用法：python art/r4.py
"""
from __future__ import annotations

import concurrent.futures
import json
import time

import pixellab

OUT = pixellab.ART / "out" / "r4"
PROMPT = ("a cozy wild west saloon card table with green felt seen from slightly above, four neat rows of blank solid colored cards "
          "in cream, teal, gold and brick red with no markings at all, a cute round brown bull calf with big eyes and tiny horns "
          "peeking over the far table edge, a brass kerosene lamp glowing, a cowboy hat on a chair, warm lamp light, "
          "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, "
          "no text, no letters, no numbers, no symbols on the cards, no logo, no people")


def one(seed: int) -> dict:
    target = f"cover-s{seed}"
    started = time.time()
    try:
        pixellab.generate_image(target, {"description": PROMPT, "image_size": {"width": 384, "height": 192}, "seed": seed}, OUT)
        return {"seed": seed, "ok": True, "seconds": round(time.time() - started, 1)}
    except Exception as error:
        return {"seed": seed, "ok": False, "seconds": round(time.time() - started, 1), "error": str(error)[:300]}


def batch(seeds: list[int], workers: int) -> dict:
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(one, seeds))
    wall = round(time.time() - started, 1)
    for r in results:
        print(r, flush=True)
    print(f"{workers} 线程 {len(seeds)} 张：总耗时 {wall}s", flush=True)
    return {"workers": workers, "wall": wall, "results": results}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    log = [batch([814, 815], 2)]
    if all(r["ok"] for r in log[0]["results"]):
        log.append(batch([816, 817, 818, 819, 820, 821], 6))
    else:
        print("2 线程有报错，退回串行", flush=True)
        log.append(batch([816, 817], 1))
    (OUT / "concurrency.json").write_text(json.dumps(log, ensure_ascii=False, indent=1))
    print("r4 跑完; spent", round(pixellab.spent_usd(), 4), flush=True)
