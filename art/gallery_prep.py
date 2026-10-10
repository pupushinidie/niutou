"""给画廊准备代码画素材的各个变体预览（牌面整套、空格、危险格、毡面平铺、木边、煤油灯/风滚草的备选帧条）。
结果在 art/out/r2/gal/。用法：python art/gallery_prep.py
"""
from __future__ import annotations

import pathlib

from PIL import Image

import cards
import fx

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out" / "r2" / "gal"
PAT = Image.open(ART / "out" / "r1" / "back" / "back-s313.png")


def on_felt(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h))
    f = cards.felt("D")
    for x in range(0, w, 64):
        for y in range(0, h, 64):
            img.alpha_composite(f, (x, y))
    return img


def card_set(face: str, back_lg: Image.Image, back_sm: Image.Image) -> Image.Image:
    sample = [1, 5, 10, 11, 55, 104]
    img = on_felt(7 * 46 + 6, 58 + 38 + 14)
    img.alpha_composite(back_lg, (4, 4))
    for i, n in enumerate(sample):
        img.alpha_composite(cards.face(n, "lg", face), (4 + (i + 1) * 46, 4))
    img.alpha_composite(back_sm, (4, 66))
    for i, n in enumerate(sample):
        img.alpha_composite(cards.face(n, "sm", face), (4 + (i + 1) * 32, 66))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    card_set("B", cards.back("lg", "A", PAT), cards.back_from_pattern_sm(PAT)).save(OUT / "cards-B-pat.png")
    card_set("A", cards.back("lg", "A"), cards.back("sm", "A")).save(OUT / "cards-A.png")
    card_set("C", cards.back("lg", "C"), cards.back("sm", "C")).save(OUT / "cards-C.png")
    for name, lg, sm in (("pat", cards.back("lg", "A", PAT), cards.back_from_pattern_sm(PAT)),
                         ("A", cards.back("lg", "A"), cards.back("sm", "A")), ("B", cards.back("lg", "B"), cards.back("sm", "B"))):
        img = on_felt(42 + 28 + 12, 62)
        img.alpha_composite(lg, (2, 2))
        img.alpha_composite(sm, (50, 2))
        img.save(OUT / f"back-{name}.png")
    for st in "DBA":
        img = on_felt(42 + 28 + 14 + 16, 62)
        img.alpha_composite(cards.slot(42, 58, st), (2, 2))
        img.alpha_composite(cards.slot(28, 38, st), (50, 2))
        img.save(OUT / f"slot-{st}.png")
    for st in "DAC":
        img = on_felt(42 + 28 + 14 + 18, 62)
        img.alpha_composite(cards.danger(42, 58, "lg", st), (2, 2))
        img.alpha_composite(cards.danger(28, 38, "sm", st), (50, 2))
        img.alpha_composite(cards.danger(14, 38, "sm", st), (84, 2))
        img.save(OUT / f"danger-{st}.png")
    felts = {"D": cards.felt("D"), "A": cards.felt("A"), "s303": cards.felt_from(Image.open(ART / "out/r1/felt/felt-s303.png"))}
    for name, f in felts.items():
        img = Image.new("RGBA", (192, 128))
        for x in range(0, 192, 64):
            for y in range(0, 128, 64):
                img.alpha_composite(f, (x, y))
        img.save(OUT / f"felt-{name}.png")
    for st in "DAC":
        r = cards.rim(st)
        img = on_felt(96, 64)
        W, H = 96, 64
        for x in range(8, W - 8, 8):
            img.alpha_composite(r.crop((8, 0, 16, 8)), (x, 0))
            img.alpha_composite(r.crop((8, 16, 16, 24)), (x, H - 8))
        for y in range(8, H - 8, 8):
            img.alpha_composite(r.crop((0, 8, 8, 16)), (0, y))
            img.alpha_composite(r.crop((16, 8, 24, 16)), (W - 8, y))
        for (cx, cy), (sx, sy) in {(0, 0): (0, 0), (W - 8, 0): (16, 0), (0, H - 8): (0, 16), (W - 8, H - 8): (16, 16)}.items():
            img.alpha_composite(r.crop((sx, sy, sx + 8, sy + 8)), (cx, cy))
        img.save(OUT / f"rim-{st}.png")
    for i in (16, 41):
        fx.lamp("a", Image.open(ART / f"out/r1/lamp/lamp-{i}.png")).save(OUT / f"lamp{i}-a.png")
    fx.tumbleweed("a", Image.open(ART / "out/r1/tumbleweed/tumbleweed-2.png")).save(OUT / "tumbleweed2-a.png")
    fx.thinking("b", Image.open(ART / "out/r1/thinking/thinking-44.png")).save(OUT / "thinking44-b.png")
    fx.thinking("a", Image.open(ART / "out/r1/thinking/thinking.png")).save(OUT / "thinking0-a.png")
    print(OUT)


if __name__ == "__main__":
    main()
