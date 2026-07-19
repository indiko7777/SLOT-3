#!/usr/bin/env python3
"""Split any flat symbol .webp into skel-pipeline layers.

  01_glow    soft aura derived from the silhouette (tinted per symbol)
  02_body    the artwork itself
  03_shine   the art's own bright highlights, lifted out as a luster layer
  04..       procedural sparkle stars placed on the art

WHY NOT SPLIT THE ARTWORK ITSELF: cutting a flat image into geometric pieces
gives no joint overlap and no fill behind occluders, so gaps tear open the
moment a part moves (skel-pipeline README, "Art rules"). Keeping the body whole
and animating it against glow/shine/sparkle layers stays seam-free, and the
per-symbol motion in symbol_motion.py is what makes each one feel specific.

Usage:
  python make_parts_generic.py <symbol_name> [--max=320]
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
SYMBOLS_SRC = HERE.parents[1] / "public" / "assets" / "symbols"

# glow tint + sparkle colours/placements, chosen to match each symbol's palette.
# (fx, sparkles) — sparkles are (size_frac, colour, x_frac, y_frac).
SYMBOL_FX = {
    "brass_knuckles": ((255, 180, 90), [(0.20, (255, 214, 140), 0.30, 0.36), (0.16, (255, 236, 200), 0.72, 0.60)]),
    "knife":          ((150, 200, 255), [(0.20, (210, 240, 255), 0.62, 0.28), (0.14, (255, 190, 140), 0.30, 0.72)]),
    "pistol":         ((150, 230, 130), [(0.22, (200, 255, 170), 0.24, 0.40), (0.15, (255, 240, 190), 0.70, 0.52)]),
    "ammo":           ((255, 200, 110), [(0.20, (255, 230, 160), 0.34, 0.34), (0.17, (140, 230, 255), 0.68, 0.62)]),
    "duffel":         ((120, 220, 230), [(0.18, (160, 240, 250), 0.30, 0.34), (0.15, (255, 150, 200), 0.66, 0.44)]),
    "cash":           ((120, 230, 140), [(0.22, (200, 255, 190), 0.28, 0.34), (0.18, (255, 240, 170), 0.70, 0.58)]),
    "diamond":        ((255, 205, 110), [(0.20, (255, 120, 230), 0.30, 0.66), (0.17, (120, 235, 255), 0.74, 0.44), (0.24, (255, 245, 200), 0.52, 0.16)]),
    "bike":           ((255, 120, 110), [(0.20, (255, 190, 150), 0.28, 0.40), (0.16, (255, 235, 180), 0.72, 0.36)]),
    "wild_symbole":   ((255, 120, 170), [(0.20, (255, 200, 220), 0.30, 0.40), (0.18, (255, 245, 210), 0.70, 0.56)]),
    "cyan_car_wild":  ((255, 110, 210), [(0.22, (255, 180, 240), 0.50, 0.26), (0.16, (170, 230, 255), 0.62, 0.66)]),
    "burner_phone":   ((120, 220, 255), [(0.18, (200, 245, 255), 0.30, 0.40), (0.16, (255, 240, 190), 0.70, 0.44)]),
    "safe":           ((255, 200, 90), [(0.20, (255, 235, 160), 0.50, 0.46), (0.15, (255, 210, 120), 0.76, 0.28)]),
    "master_key":     ((110, 225, 255), [(0.22, (190, 245, 255), 0.26, 0.48), (0.16, (255, 245, 210), 0.74, 0.52)]),
}
DEFAULT_FX = ((255, 205, 120), [(0.20, (255, 235, 180), 0.32, 0.38), (0.16, (200, 240, 255), 0.70, 0.58)])


def star(size, colour, core=(255, 255, 255)):
    """4-point sparkle with soft cross flare + hot core (drawn 4x, downsampled)."""
    s = max(8, size) * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = s / 2
    long_r, short_r = s * 0.48, s * 0.07
    for ang, rr in ((0, long_r), (90, long_r), (45, long_r * 0.42), (135, long_r * 0.42)):
        a = math.radians(ang)
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -dy, dx
        d.polygon([(c + dx * rr, c + dy * rr), (c + nx * short_r, c + ny * short_r),
                   (c - dx * rr, c - dy * rr), (c - nx * short_r, c - ny * short_r)],
                  fill=colour + (235,))
    im = im.filter(ImageFilter.GaussianBlur(s * 0.012))
    d = ImageDraw.Draw(im)
    cr = s * 0.09
    d.ellipse([c - cr, c - cr, c + cr, c + cr], fill=core + (255,))
    return im.filter(ImageFilter.GaussianBlur(s * 0.006)).resize((max(8, size),) * 2, Image.LANCZOS)


def build(name: str, max_side: int = 320) -> tuple:
    src = SYMBOLS_SRC / f"{name}.webp"
    if not src.exists():
        # raise, don't sys.exit: build_all must be able to skip a missing symbol
        # and carry on with the rest rather than killing the whole run.
        raise FileNotFoundError(f"no source art: {src}")
    art = Image.open(src).convert("RGBA")
    art = art.crop(art.getbbox())
    # fit the art into ~72% of the canvas: leaves >=15% margin all round so the
    # win pop and destroy scatter never clip (README art rule).
    scale = max_side * 0.72 / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    cw = max(64, round(art.width / 0.72) // 2 * 2)
    ch = max(64, round(art.height / 0.72) // 2 * 2)

    def blank():
        return Image.new("RGBA", (cw, ch), (0, 0, 0, 0))

    body = blank()
    ox, oy = (cw - art.width) // 2, (ch - art.height) // 2
    body.paste(art, (ox, oy), art)

    tint, sparks = SYMBOL_FX.get(name, DEFAULT_FX)

    # glow: inflated, blurred silhouette in the symbol's signature colour
    a = body.split()[3]
    big = a.resize((int(cw * 1.05), int(ch * 1.05)), Image.LANCZOS)
    pad = blank().split()[3]
    pad.paste(big, ((cw - big.width) // 2, (ch - big.height) // 2))
    soft = pad.filter(ImageFilter.GaussianBlur(max(6, int(max_side * 0.045))))
    soft = soft.point(lambda v: min(255, int(v * 0.8)))
    glow = blank()
    glow.paste(Image.new("RGBA", (cw, ch), tint + (255,)), (0, 0), soft)

    # shine: the art's own near-white highlights, lifted into their own layer
    px = body.load()
    shine = blank()
    sp = shine.load()
    for y in range(ch):
        for x in range(cw):
            r, g, b, al = px[x, y]
            if al > 40:
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                sat = max(r, g, b) - min(r, g, b)
                if lum > 190 and sat < 90:
                    sp[x, y] = (255, 252, 245, min(al, min(255, int((lum - 190) * 4.2))))
    shine = shine.filter(ImageFilter.GaussianBlur(1.1))
    if not shine.getbbox():  # dark art with no highlights -> fake a soft sheen
        sh = blank()
        d = ImageDraw.Draw(sh)
        d.ellipse([cw * 0.24, ch * 0.16, cw * 0.62, ch * 0.44], fill=(255, 252, 245, 70))
        shine = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        shine.paste(sh, (0, 0), a)
        shine = shine.filter(ImageFilter.GaussianBlur(max_side * 0.02))

    layers = {"01_glow": glow, "02_body": body, "03_shine": shine}
    for i, (frac, colour, fx, fy) in enumerate(sparks):
        size = max(10, int(max_side * frac))
        lay = blank()
        st = star(size, colour)
        lay.paste(st, (int(ox + art.width * fx - size / 2), int(oy + art.height * fy - size / 2)), st)
        layers[f"{4 + i:02d}_sparkle_{i}"] = lay

    out = HERE / "symbols" / name / "parts"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
    for lname, im in layers.items():
        im.save(out / f"{lname}.png")
    return (cw, ch), (art.width, art.height), len(layers)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    mx = 320
    for a in sys.argv[1:]:
        if a.startswith("--max="):
            mx = int(a.split("=")[1])
    if not args:
        sys.exit(__doc__)
    canvas, fit, n = build(args[0], mx)
    print(f"{args[0]}: canvas {canvas[0]}x{canvas[1]}, art {fit[0]}x{fit[1]}, {n} parts")
