"""谁是牛头王 出图第二轮：补 r1 自查没过的。结果在 art/out/r2/（不进仓库）。

- s37-fix：夜间 s37 很好，只有右上墙上挂着两个带角的牛头，bitforge 重画成牛仔帽（禁忌：墙上不挂牛头）
- hero：r1 的 s71/s72 招牌上有乱码字（s72 还挂着像绞索的绳圈），s71 的招牌 bitforge 重画成空白木牌；再出 2 个新种子
- avatar-7-horse：r1 的马全带一圈圆形边框，和别的头像不统一，换提示词重出
- head-16：r1 的 16px 牛头脸太长，用选中的 head-32（24 号）作风格参考重出一批
用法：python art/r2.py [任务 ...]
"""
from __future__ import annotations

import sys

from PIL import Image, ImageDraw

import pixellab

ART = pixellab.ART
R1 = ART / "out" / "r1"
OUT = ART / "out" / "r2"

INPAINT = {
    # 名字: (原图, 窗口左上角, 白色重画区域（窗口坐标）, 提示词)
    "s37-fix": (R1 / "scenes" / "night-s37.png", (312, 0), (100, 30, 196, 92),
                "two brown cowboy hats hanging on wooden pegs on the plank wall, warm lamp light, interior of a wild west saloon at night"),
    "s71-fix": (R1 / "scenes" / "hero-s71.png", (180, 20), (70, 64, 172, 110),
                "a plain blank wooden plank board above the saloon porch, completely empty, warm sunset light"),
}


def inpaint(name: str) -> None:
    src, (ox, oy), box, prompt = INPAINT[name]
    folder = OUT / "scenes"
    folder.mkdir(parents=True, exist_ok=True)
    full = Image.open(src).convert("RGBA")
    window = full.crop((ox, oy, ox + 200, oy + 200))
    window.save(folder / f"{name}-window.png")
    mask = Image.new("RGB", (200, 200), "black")
    ImageDraw.Draw(mask).rectangle(box, fill="white")
    mask.save(folder / f"{name}-mask.png")
    for seed in (911, 912):
        target = f"{name}-{seed}"
        if (folder / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt + ", no skulls, no animal heads, no horns, no text, no letters, no writing",
            "image_size": {"width": 200, "height": 200},
            "inpainting_image": pixellab.b64_image(folder / f"{name}-window.png"),
            "mask_image": pixellab.b64_image(folder / f"{name}-mask.png"),
            "no_background": False,
            "seed": seed,
        }, folder, endpoint="/create-image-bitforge")
        # 贴回整张图
        patch = Image.open(folder / f"{target}.png").convert("RGBA").resize((200, 200), Image.NEAREST)
        merged = full.copy()
        merged.paste(patch, (ox, oy))
        merged.save(folder / f"{name}-{seed}-full.png")
        print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def hero() -> None:
    prompt = ("front of a small wooden wild west saloon building at dusk with swinging doors, a plain blank wooden board above the porch, "
              "warm lamp light glowing from the windows, hitching post, water trough, cactus, distant red desert mesas and an orange "
              "and purple sunset sky, cozy, wide view, no people, no text, no letters, no signs, no writing, no skulls, no ropes")
    for seed in (74, 75):
        target = f"hero-s{seed}"
        if (OUT / "scenes" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT / "scenes", endpoint="/create-image-pixen")
        print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def v2(name: str, body: dict) -> None:
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    pixellab.generate_async(name, body, folder, endpoint="/generate-image-v2")
    print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def style_ref(path, w: int, h: int) -> dict:
    return {"image": pixellab.b64_image(path), "size": {"width": w, "height": h}}


TASKS = {
    "s37": lambda: inpaint("s37-fix"),
    "s71": lambda: inpaint("s71-fix"),
    "hero": hero,
    "horse": lambda: v2("avatar-7-horse", {
        "description": "cute cartoon grey dappled horse head and neck, long friendly face with a dark grey mane, wearing a brown cowboy hat "
                       "and a pink neckerchief, front three-quarter view, friendly smile, wild west game character portrait, "
                       "bold dark brown pixel outline, light from top left, no frame, no border, no circle, no text, no background",
        "image_size": {"width": 32, "height": 32},
        "no_background": True,
        "seed": 731,
    }),
    "head16": lambda: v2("head-16", {
        "description": "tiny cute chibi bull calf face icon, front view, wide round face, two very short stubby cream horns, big dark eyes, "
                       "small pink snout, warm tan brown fur, bold dark brown pixel outline, centered, no text, no background",
        "image_size": {"width": 16, "height": 16},
        "no_background": True,
        "style_image": style_ref(R1 / "head-32" / "head-32-24.png", 32, 32),
        "seed": 716,
    }),
}

if __name__ == "__main__":
    for task in sys.argv[1:] or list(TASKS):
        try:
            TASKS[task]()
        except Exception as error:
            print(task, "失败：", error, flush=True)
    print("r2 跑完; spent", round(pixellab.spent_usd(), 4), flush=True)
