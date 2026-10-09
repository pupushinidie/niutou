"""谁是牛头王 出图第一轮候选。结果在 art/out/r1/（不进仓库）。

风格照 art/spec.md：西部酒馆，暖色，1px 深棕描边，不画字、不画人、不画牛头骨。
- 场景：/create-image-pixen 512×288（夜间新种子 + bitforge 把 s32 墙上的两个牛头骨重画掉；白天新种子；首页门口）
- 小图（≤42px）：/generate-image-v2 一次 64 个候选
- 毡面、牌背图案、通缉令、封面：/create-image-pixflux
PixelLab 全站排队，一次一个，按顺序跑。

用法：python art/r1.py [名字 ...]（不写就全跑；已经出过的跳过）
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw

import pixellab

OUT = pixellab.ART / "out" / "r1"
RAW = pathlib.Path.home() / "projects/pipeline/games/niutou/assets/raw/scenes"

NO = ", no people, no text, no letters, no signs, no writing, no skulls, no animal heads or horns on the walls"
ICON = ", cute cartoon pixel art game icon, warm wild west colors, bold dark brown pixel outline, light from top left, centered, no text, no letters, no frame, no background"

SCENES: dict[str, tuple[str, tuple[int, ...]]] = {
    "night": (
        "interior of a cozy wild west saloon at night, a big empty green felt card table in the foreground, warm glowing kerosene lamps, "
        "dark wooden bar counter with glass bottles, swinging saloon doors, plain wooden plank walls decorated with horseshoes, "
        "cowboy hats on wall hooks and a coiled rope lasso, a piano in the corner, dusty floorboards, cheerful and funny mood, wide view" + NO,
        (32, 35, 36, 37, 38, 39),
    ),
    "day": (
        "a dusty wild west frontier town at noon seen from a wooden saloon porch, a big empty green felt card table on the porch "
        "in the foreground, friendly longhorn cattle in a wooden corral, tall cacti, red desert mesas, water tower, tumbleweed, "
        "bright blue sky with a few white clouds, cheerful mood, wide view, no people, no text, no letters, no signs, no writing",
        (45, 46, 47, 48),
    ),
    "hero": (
        "front of a small wooden wild west saloon building at dusk with swinging doors, warm lamp light glowing from the windows, "
        "hitching post, water trough, cactus, distant red desert mesas and an orange and purple sunset sky, cozy, wide view"
        ", no people, no text, no letters, no signs, no writing, no skulls",
        (71, 72, 73),
    ),
}

# 夜间 s32 去牛头骨：两个 200×200 窗口，白色区域重画
INPAINT = {
    "s32-fix-left": ((40, 0), (42, 4, 115, 72), "a brown cowboy hat hanging on a wooden peg on the plank wall, warm lamp light"),
    "s32-fix-right": ((312, 0), (74, 28, 170, 108), "a large iron horseshoe and a coiled rope lasso hanging on the warm lit plaster wall"),
}

# 名字: (描述, 宽, 高, 透明)
SPRITES: dict[str, tuple[str, int, int, bool]] = {
    "head-32": ("cute cartoon bull calf face, front view, round chubby face, two short stubby cream horns, big friendly shiny eyes, "
                "pink snout with two nostrils, warm brown fur, a little tuft of hair on top" + ICON, 32, 32, True),
    "head-16": ("tiny cute brown bull calf face, front view, round face, two small cream horns, pink snout, big eyes" + ICON, 16, 16, True),
    "king-bull": ("cute cartoon bull calf face wearing a small tilted golden crown, front view, round chubby face, short cream horns, "
                  "smug funny proud expression, pink snout, warm brown fur" + ICON, 40, 40, True),
    "sheriff-star": ("a shiny golden brass sheriff badge, five-pointed star with small round balls on each tip, plain smooth surface, "
                     "no engraving, no letters" + ICON, 32, 32, True),
    "ready": ("a single small face-down playing card with a dark wine red back, with a bright green check mark over its corner" + ICON, 16, 16, True),
    "lasso": ("a coiled brown rope lasso loop, wild west" + ICON, 16, 16, True),
    "thinking": ("a small wooden hourglass with golden sand running, wild west" + ICON, 16, 16, True),
    "calf-run": ("cute cartoon brown bull calf running to the right, side view, full body, four short legs mid stride, tiny cream horns, "
                 "game sprite, bold dark brown pixel outline, no background, no text", 32, 32, True),
    "tumbleweed": ("a round dry tumbleweed, a ball of tangled light brown twigs, game sprite, bold dark brown pixel outline, no background", 24, 24, True),
    "lamp": ("a small brass kerosene oil lamp with a clear glass chimney and a warm glowing yellow flame, front view, game sprite, "
             "bold dark brown pixel outline, no background", 16, 32, True),
}

AVATAR = ("cute cartoon {animal} head and shoulders portrait, wearing a brown cowboy hat and a {color} neckerchief, front view, "
          "friendly smile, wild west, round game avatar icon, bold dark brown pixel outline, light from top left, no text, no background")
AVATARS = [  # seat 0–9，和 spec 第 2 节一致
    ("fox", "red", "orange fox"),
    ("bear", "blue", "brown bear"),
    ("rabbit", "green", "brown and white rabbit with long ears"),
    ("raccoon", "yellow", "raccoon"),
    ("cat", "purple", "grey tabby cat"),
    ("dog", "orange", "golden brown terrier dog"),
    ("owl", "cyan", "brown owl"),
    ("horse", "pink", "grey dappled horse"),
    ("goat", "white", "tan goat with small horns and a little beard"),
    ("pig", "dark grey", "pink pig"),
]

FLUX: dict[str, tuple[str, int, int, bool, tuple[int, ...]]] = {
    "felt": ("seamless tileable green felt card table cloth texture, flat top-down, subtle fabric fibers and soft noise, "
             "uniform, no pattern, no border, no lighting gradient", 64, 64, False, (301, 302, 303)),
    "back": ("ornate playing card back design, deep wine red background with symmetrical gold filigree lattice and corner flourishes, "
             "a small cute brown bull calf face medallion in the center, flat front view, no text, no letters", 40, 56, False, (311, 312, 313)),
    "poster": ("an old blank parchment wanted poster nailed to a board with four nails, torn rough edges, an empty square frame in the "
               "middle, completely blank, no text, no letters, no writing", 64, 80, True, (321, 322, 323)),
    "cover": ("a wild west saloon card table with green felt seen from slightly above, plain colorful playing cards laid in four rows "
              "and a fanned hand of cards, a cute brown bull calf peeking over the table edge with big eyes, a brass kerosene lamp, "
              "cowboy hat on a chair, warm lamp light, cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, "
              "crisp clean pixels, no text, no letters, no numbers, no logo, no people", 384, 192, False, (811, 812, 813)),
}


def scene(name: str) -> None:
    prompt, seeds = SCENES[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / "scenes" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT / "scenes", endpoint="/create-image-pixen")
        print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def inpaint() -> None:
    folder = OUT / "scenes"
    folder.mkdir(parents=True, exist_ok=True)
    full = Image.open(RAW / "saloon-night-s32.png").convert("RGBA")
    for name, ((ox, oy), box, prompt) in INPAINT.items():
        for seed in (901, 902):
            target = f"{name}-{seed}"
            if (folder / f"{target}.png").exists():
                continue
            window = full.crop((ox, oy, ox + 200, oy + 200))
            window.save(folder / f"{name}-window.png")
            mask = Image.new("RGB", (200, 200), "black")
            ImageDraw.Draw(mask).rectangle(box, fill="white")
            mask.save(folder / f"{name}-mask.png")
            pixellab.generate_image(target, {
                "description": prompt + ", interior of a wild west saloon at night, no skulls, no animal heads, no horns, no text",
                "image_size": {"width": 200, "height": 200},
                "inpainting_image": pixellab.b64_image(folder / f"{name}-window.png"),
                "mask_image": pixellab.b64_image(folder / f"{name}-mask.png"),
                "no_background": False,
                "seed": seed,
            }, folder, endpoint="/create-image-bitforge")
            print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def v2(name: str, prompt: str, width: int, height: int, transparent: bool, seed: int = 701) -> None:
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    pixellab.generate_async(name, {
        "description": prompt,
        "image_size": {"width": width, "height": height},
        "no_background": transparent,
        "seed": seed,
    }, folder, endpoint="/generate-image-v2")
    print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


def flux(name: str) -> None:
    prompt, width, height, transparent, seeds = FLUX[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / name / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": width, "height": height},
            "no_background": transparent,
            "seed": seed,
        }, OUT / name)
        print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)


JOBS = (
    ["scene:night", "inpaint", "scene:day", "scene:hero"]
    + ["v2:head-32", "v2:head-16"]
    + [f"avatar:{i}" for i in range(10)]
    + [f"v2:{k}" for k in ("king-bull", "sheriff-star", "ready", "lasso", "thinking", "calf-run", "tumbleweed", "lamp")]
    + [f"flux:{k}" for k in FLUX]
)


def run(job: str) -> None:
    kind, _, arg = job.partition(":")
    if kind == "scene":
        scene(arg)
    elif kind == "inpaint":
        inpaint()
    elif kind == "v2":
        v2(arg, *SPRITES[arg])
    elif kind == "avatar":
        i = int(arg)
        key, color, animal = AVATARS[i]
        v2(f"avatar-{i}-{key}", AVATAR.format(animal=animal, color=color), 32, 32, True)
    elif kind == "flux":
        flux(arg)


if __name__ == "__main__":
    for job in sys.argv[1:] or JOBS:
        try:
            run(job)
        except Exception as error:  # 一项失败不影响后面的
            print(job, "失败：", error, flush=True)
    print("全部跑完; spent", round(pixellab.spent_usd(), 4), flush=True)
