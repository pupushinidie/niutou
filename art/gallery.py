"""画廊拍板 JSON：每样素材一题，选项是候选图（放大的预览），推荐项 = selection.json 里定稿用的那张。

预览图在 art/out/gallery/<题>/<n>.png（小图放大到 ~128px，左半夜间底、右半白天底），
JSON 写到 ~/projects/pipeline/games/niutou/assets/gallery-decision.json（blocking: false，由制作人发布）。
用法：python art/gallery.py
"""
from __future__ import annotations

import json
import pathlib

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
GAL = OUT / "gallery"
SEL = json.loads((ART / "selection.json").read_text())
DEST = pathlib.Path.home() / "projects/pipeline/games/niutou/assets/gallery-decision.json"
NIGHT, DAY = (30, 19, 19, 255), (244, 236, 220, 255)


def preview(src: pathlib.Path, frames: int = 1) -> Image.Image:
    img = Image.open(src).convert("RGBA")
    if img.width >= 256 and frames == 1:  # 场景、封面、图集：放大 2 倍（图集 1 倍）
        k = 1 if img.width > 400 and img.height > 400 else 2
        return img.resize((img.width * k, img.height * k), Image.NEAREST)
    k = max(1, 128 // max(img.width // frames, img.height))
    big = img.resize((img.width * k, img.height * k), Image.NEAREST)
    pad = 8
    canvas = Image.new("RGBA", (big.width * 2 + pad * 3, big.height + pad * 2), NIGHT)
    ImageDraw.Draw(canvas).rectangle([canvas.width // 2, 0, canvas.width, canvas.height], fill=DAY)
    canvas.alpha_composite(big, (pad, pad))
    canvas.alpha_composite(big, (big.width + pad * 2, pad))
    return canvas


def main() -> None:
    questions = []
    for q in SEL.get("_gallery", []):
        qid = q["id"]
        folder = GAL / qid
        folder.mkdir(parents=True, exist_ok=True)
        options = []
        for n, opt in enumerate(q["options"]):
            src = OUT / opt["src"]
            pic = folder / f"{n}.png"
            preview(src, q.get("frames", 1)).save(pic)
            o = {"value": opt["src"], "label": opt.get("label", f"候选 {n + 1}"), "images": [str(pic)]}
            if opt.get("note"):
                o["description"] = opt["note"]
            if n == 0:
                o["recommended"] = True
            options.append(o)
        questions.append({
            "id": qid, "type": "choice", "question": q["question"],
            "help": q.get("help", ""), "options": options, "allowOther": True, "required": False,
        })
    data = {
        "id": "gallery",
        "title": "谁是牛头王 · 美术画廊（正式美术定稿）",
        "stage": "art",
        "blocking": False,
        "intro": ("每样素材一题，第一个、标「推荐」的是美术自己挑定、已经导出进定稿的那张，**不用答也会按推荐上线**。"
                  "想换哪张随时点；都不满意就选「其他」写备注，会重画。小图预览左半是夜间底、右半是白天底，已放大。"),
        "questions": questions,
    }
    DEST.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(questions)} 题 → {DEST}")


if __name__ == "__main__":
    main()
