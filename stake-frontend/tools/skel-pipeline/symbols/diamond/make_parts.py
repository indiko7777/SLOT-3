#!/usr/bin/env python3
"""Split the game's diamond.webp into full-canvas layer PNGs for skel-pipeline.

Recipe (README "classic gem"): glow, body, shine (luster extracted from the
art's bright facets), 3 sparkle stars colored to match the baked-in magenta /
cyan glints. Canvas has >=15% empty margin so win-pop / destroy never crop.

Run:  python make_parts.py     (re-generates parts/*.png deterministically)
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
SRC = HERE.parents[3] / "public" / "assets" / "symbols" / "diamond.webp"
PARTS = HERE / "parts"
CANVAS = (400, 352)  # content ~247x206 centered -> ~19% margin each side


def canvas_layer():
    return Image.new("RGBA", CANVAS, (0, 0, 0, 0))


def load_body():
    im = Image.open(SRC).convert("RGBA")
    im = im.crop(im.getbbox())
    max_target = 280
    if max(im.size) > max_target:
        scale = max_target / max(im.size)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    layer = canvas_layer()
    ox = (CANVAS[0] - im.width) // 2
    oy = (CANVAS[1] - im.height) // 2
    layer.paste(im, (ox, oy), im)
    return layer, (ox, oy, im.width, im.height)


def make_glow(body):
    """Warm gold aura from the body silhouette, slightly inflated + blurred."""
    a = body.split()[3]
    big = a.resize((int(CANVAS[0] * 1.06), int(CANVAS[1] * 1.06)), Image.LANCZOS)
    pad = canvas_layer().split()[3]
    pad.paste(big, ((CANVAS[0] - big.width) // 2, (CANVAS[1] - big.height) // 2))
    soft = pad.filter(ImageFilter.GaussianBlur(16))
    soft = soft.point(lambda v: min(255, int(v * 0.8)))
    glow = canvas_layer()
    gold = Image.new("RGBA", CANVAS, (255, 205, 110, 255))
    glow.paste(gold, (0, 0), soft)
    return glow


def make_shine(body):
    """Luster layer: the art's own near-white facet highlights, lifted out."""
    px = body.load()
    shine = canvas_layer()
    sp = shine.load()
    for y in range(CANVAS[1]):
        for x in range(CANVAS[0]):
            r, g, b, a = px[x, y]
            if a > 40:
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                sat = max(r, g, b) - min(r, g, b)
                if lum > 205 and sat < 70:
                    k = min(255, int((lum - 205) * 5.1))
                    sp[x, y] = (255, 252, 240, min(a, k))
    return shine.filter(ImageFilter.GaussianBlur(1.2))


def star(size, color, core=(255, 255, 255)):
    """4-point sparkle star with soft cross flare + hot core."""
    s = size * 4  # draw 4x, downsample for AA
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = s / 2
    long_r, short_r = s * 0.48, s * 0.07
    for ang, rr in ((0, long_r), (90, long_r), (45, long_r * 0.42), (135, long_r * 0.42)):
        a = math.radians(ang)
        dx, dy = math.cos(a), math.sin(a)
        nx, ny = -dy, dx
        pts = [(c + dx * rr, c + dy * rr), (c + nx * short_r, c + ny * short_r),
               (c - dx * rr, c - dy * rr), (c - nx * short_r, c - ny * short_r)]
        d.polygon(pts, fill=color + (235,))
    im = im.filter(ImageFilter.GaussianBlur(s * 0.012))
    d = ImageDraw.Draw(im)
    cr = s * 0.09
    d.ellipse([c - cr, c - cr, c + cr, c + cr], fill=core + (255,))
    im = im.filter(ImageFilter.GaussianBlur(s * 0.006))
    return im.resize((size, size), Image.LANCZOS)


def place_star(size, color, fx, fy, box):
    """Place a star at a fraction of the body content box."""
    ox, oy, w, h = box
    layer = canvas_layer()
    st = star(size, color)
    layer.paste(st, (int(ox + w * fx - size / 2), int(oy + h * fy - size / 2)), st)
    return layer


def main():
    PARTS.mkdir(exist_ok=True)
    body, box = load_body()
    layers = {
        "01_glow": make_glow(body),
        "02_body": body,
        "03_shine": make_shine(body),
        "04_sparkle_l": place_star(46, (255, 79, 216), 0.30, 0.66, box),   # magenta, lower-left facet
        "05_sparkle_r": place_star(40, (79, 232, 255), 0.74, 0.44, box),   # cyan, right facet
        "06_sparkle_top": place_star(56, (255, 240, 190), 0.52, 0.16, box),  # gold-white, crown
    }
    for name, im in layers.items():
        im.save(PARTS / f"{name}.png")
        print(f"{name}.png  bbox={im.getbbox()}")


if __name__ == "__main__":
    main()
