#!/usr/bin/env python3
"""Chroma-key a flat-green-screen symbol render into a clean transparent cutout.

Built for symbols generated on a solid #00B140 green background: keys out the
green, DESPILLS the green tint that bleeds onto the subject's edges (so no green
halo remains), soft-feathers the alpha, trims to the art, and resizes.

Because the key is a real green-screen removal (not an AI background-removal
guess), there is no dark/cyan cropping halo — the exact defect we're replacing.

Usage:
  python chroma_key.py <src> <dst.webp> [--size 512] [--thr 0.18] [--soft 0.12]
"""

import argparse
from pathlib import Path
from PIL import Image
import numpy as np


def chroma_key(src: str, dst: str, size: int, thr: float, soft: float, key: str = "green") -> None:
    img = Image.open(src).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    # "Keyness" = how strongly a pixel matches the backdrop colour. The flat
    # background scores high; the subject scores ~0 or below. Use magenta/blue
    # when the subject is itself green (e.g. a green pistol on green won't key).
    if key == "magenta":
        keyness = np.minimum(r, b) - g          # magenta = high R&B, low G
        # magenta despill: pull R and B down toward G on the fringe
        r2 = np.minimum(r, np.maximum(g, b))
        b2 = np.minimum(b, np.maximum(g, r))
        rgb = np.dstack([r2, g, b2])
    elif key == "blue":
        keyness = b - np.maximum(r, g)
        b2 = np.minimum(b, np.maximum(r, g))
        rgb = np.dstack([r, g, b2])
    else:  # green (default)
        keyness = g - np.maximum(r, b)
        g2 = np.minimum(g, np.maximum(r, b))
        rgb = np.dstack([r, g2, b])

    # Ramp: keyness >= thr -> fully transparent; <= thr-soft -> fully opaque.
    alpha = np.clip((thr - keyness) / max(soft, 1e-4), 0.0, 1.0)

    out = (np.dstack([rgb, alpha]) * 255.0).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(out, "RGBA")

    # Drop near-transparent dust, then trim to the real art.
    a = np.array(im)[:, :, 3]
    a[a < 8] = 0
    im.putalpha(Image.fromarray(a))
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)

    w, h = im.size
    s = size / max(w, h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    im.save(dst, "WEBP", quality=95, method=6)
    print(f"keyed -> {Path(dst).name} {im.size}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--thr", type=float, default=0.18)
    ap.add_argument("--soft", type=float, default=0.12)
    ap.add_argument("--key", choices=["green", "magenta", "blue"], default="green")
    a = ap.parse_args()
    chroma_key(a.src, a.dst, a.size, a.thr, a.soft, a.key)
