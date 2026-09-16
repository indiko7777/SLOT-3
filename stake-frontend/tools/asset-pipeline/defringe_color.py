#!/usr/bin/env python3
"""Colored-halo defringe (alpha-aware edge-color bleed).

Background-removal / AI-upscale tools often leave a COLORED halo (commonly a
cyan or magenta rim) on the semi-transparent alpha edge of a cut-out symbol.
`defringe_assets.py` only clears *dark* halos; this fixes *colored* ones.

Method: treat solidly-opaque pixels (alpha >= known_thresh) as ground truth and
iteratively bleed their RGB outward into the semi-transparent fringe, so each
soft edge pixel takes the colour of the real art it borders instead of the
halo colour. Alpha is preserved (the soft edge stays soft), only the RGB under
low-alpha pixels is corrected — so the cyan/magenta ring becomes the symbol's
own edge colour and reads as a normal antialiased edge, not "AI slop".

Optionally drops the very faintest residual ring (alpha < --thin) to nothing.

Usage:
  python defringe_color.py <file_or_glob>... [--known 200] [--iters 14] [--thin 10]
"""

import sys
import glob
import argparse
from pathlib import Path
from PIL import Image
import numpy as np

NEIGHBORS = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def defringe(path: Path, known_thresh: int, iters: int, thin: int) -> bool:
    img = Image.open(path).convert("RGBA")
    arr = np.array(img).astype(np.float32)
    rgb = arr[:, :, :3]
    a = arr[:, :, 3]

    known = a >= known_thresh
    if known.sum() == 0 or known.all():
        return False

    filled = rgb.copy()
    kmask = known.copy()
    for _ in range(iters):
        if kmask.all():
            break
        acc = np.zeros_like(filled)
        cnt = np.zeros(filled.shape[:2], np.float32)
        for dy, dx in NEIGHBORS:
            sr = np.roll(np.roll(filled, dy, 0), dx, 1)
            sk = np.roll(np.roll(kmask, dy, 0), dx, 1).astype(np.float32)
            acc += sr * sk[:, :, None]
            cnt += sk
        newly = (~kmask) & (cnt > 0)
        if not newly.any():
            break
        filled[newly] = acc[newly] / cnt[newly][:, None]
        kmask[newly] = True

    out_a = a.copy()
    if thin > 0:
        out_a[(out_a > 0) & (out_a < thin)] = 0

    res = np.dstack([filled, out_a]).clip(0, 255).astype(np.uint8)
    out = Image.fromarray(res, "RGBA")
    if path.suffix.lower() == ".webp":
        out.save(path, "WEBP", quality=95, method=6)
    else:
        out.save(path, "PNG", compress_level=6)
    print(f"defringed {path.name}: bled edge colour into fringe (known>={known_thresh}, iters={iters})")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--known", type=int, default=200)
    ap.add_argument("--iters", type=int, default=14)
    ap.add_argument("--thin", type=int, default=10)
    args = ap.parse_args()
    for pat in args.paths:
        for p in glob.glob(pat, recursive=True):
            fp = Path(p)
            if fp.is_file() and fp.suffix.lower() in (".png", ".webp"):
                defringe(fp, args.known, args.iters, args.thin)


if __name__ == "__main__":
    main()
