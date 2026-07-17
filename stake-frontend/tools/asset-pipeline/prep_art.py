#!/usr/bin/env python3
"""Normalize symbol / logo art: trim dead transparent margin, resize, re-encode.

WHY THIS EXISTS
The game scales sprites by their FULL canvas size (SymbolView.fitInCell uses
texture.width/height; HudView + BonusView do the same for the logo). Any
transparent margin baked into the file is therefore counted as part of the
symbol — art with a fat margin renders visibly smaller than art that is tightly
cropped. Symbols must all share one fill ratio or the board looks inconsistent.
Reference (good): diamond 97x95%, cash 98x97%, knife 99x98%.

USAGE
  python prep_art.py <image> [--fill=0.97] [--max=512] [--quality=88]
                            [--shade=1.0] [--out=<path>]

  --fill     fraction of the canvas the ART must occupy after trimming (0.97)
  --max      long side in px of the output (512 = symbol spec; logo uses 1024)
  --shade    brightness multiply, <1 darkens (used for the bonus watermark logo)
  --out      write elsewhere instead of overwriting in place

Run this on every new/regenerated symbol before dropping it in public/assets.
"""
import sys
from pathlib import Path

from PIL import Image


def prep(src: Path, dst: Path, fill: float, max_side: int, quality: int, shade: float) -> None:
    im = Image.open(src).convert("RGBA")
    before_size, before_bytes = im.size, src.stat().st_size

    box = im.getbbox()
    if not box:
        sys.exit(f"{src.name}: fully transparent")
    art = im.crop(box)  # dead margin gone — art now fills the canvas exactly

    if shade != 1.0:
        r, g, b, a = art.split()
        pt = lambda v: max(0, min(255, int(v * shade)))  # noqa: E731
        art = Image.merge("RGBA", (r.point(pt), g.point(pt), b.point(pt), a))

    # scale so the ART's long side hits max_side, then pad back out to the small
    # uniform margin `fill` asks for (keeps win-pop from clipping at the edge)
    scale = max_side * fill / max(art.size)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)

    cw, ch = round(art.width / fill), round(art.height / fill)
    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    out.paste(art, ((cw - art.width) // 2, (ch - art.height) // 2), art)

    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, "WEBP", quality=quality, method=6)

    fb = out.getbbox()
    print(f"{src.name:26s} {before_size[0]}x{before_size[1]} -> {out.size[0]}x{out.size[1]}   "
          f"fill {(fb[2]-fb[0])/out.width*100:.0f}%x{(fb[3]-fb[1])/out.height*100:.0f}%   "
          f"{before_bytes/1024:.1f} KB -> {dst.stat().st_size/1024:.1f} KB")


def main() -> None:
    args, opts = [], {}
    for a in sys.argv[1:]:
        if a.startswith("--"):
            k, _, v = a[2:].partition("=")
            opts[k] = v
        else:
            args.append(a)
    if not args:
        sys.exit(__doc__)
    src = Path(args[0])
    prep(src, Path(opts.get("out") or src),
         float(opts.get("fill", 0.97)), int(opts.get("max", 512)),
         int(opts.get("quality", 88)), float(opts.get("shade", 1.0)))


if __name__ == "__main__":
    main()
