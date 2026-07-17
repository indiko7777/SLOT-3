#!/usr/bin/env python3
"""Pack full-canvas layer PNGs -> packed.png + <symbol>.atlas (Spine/libGDX format) + manifest.json.

Usage:
  python pack_atlas.py path/to/symbol_dir [--pad=2]

Expects symbol_dir/parts/*.png. Every PNG must be the SAME canvas size, with the
part already positioned where it sits on the symbol (export each layer full-canvas
from Photoshop / Photopea / Krita). Order = sorted filename; use numeric prefixes
(01_shadow.png .. 09_front.png). FIRST file draws BEHIND, last on top.
Part name = filename minus numeric prefix and extension.

This replaces the "arrange images in Spine and export" step - no Spine needed.
Requires: pip install pillow
"""
import json
import math
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required: pip install pillow")


def main():
    pad = 2
    args = []
    for a in sys.argv[1:]:
        if a.startswith("--pad"):
            pad = int(a.split("=")[1]) if "=" in a else 2
        else:
            args.append(a)
    if not args:
        sys.exit(__doc__)
    d = Path(args[0])
    files = sorted((d / "parts").glob("*.png"))
    if not files:
        sys.exit(f"no PNGs in {d / 'parts'}")

    canvas = None
    parts = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        canvas = canvas or im.size
        if im.size != canvas:
            sys.exit(f"{f.name}: size {im.size} != {canvas}; all layers must share one canvas")
        box = im.getbbox()
        if not box:
            sys.exit(f"{f.name} is fully transparent")
        crop = im.crop(box)
        parts.append({
            "name": re.sub(r"^\d+[_\-]?", "", f.stem),
            "img": crop, "w": crop.width, "h": crop.height,
            # Spine coords: origin = canvas centre, y up
            "x": round((box[0] + box[2]) / 2 - canvas[0] / 2, 2),
            "y": round(canvas[1] / 2 - (box[1] + box[3]) / 2, 2),
        })
        if box[0] <= 0 or box[1] <= 0 or box[2] >= canvas[0] or box[3] >= canvas[1]:
            print(f"WARN: {f.name} touches the canvas edge - win/destroy overshoot will "
                  f"crop it. Re-export with >=15% empty margin around the whole symbol.")

    names = [p["name"] for p in parts]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        sys.exit(f"duplicate part names after prefix strip: {sorted(dupes)} - rename the files")
    if len(parts) < 3:
        print("WARN: fewer than 3 parts - animation will look stiff; split the art more")

    # shelf packing, tallest first, power-of-two sheet
    order = sorted(range(len(parts)), key=lambda i: -parts[i]["h"])
    area = sum((p["w"] + pad) * (p["h"] + pad) for p in parts)
    W = max(64, 1 << math.ceil(math.log2(max(8, math.sqrt(area)))))
    while True:
        if any(p["w"] + 2 * pad > W for p in parts):
            W *= 2
            continue
        x, y, shelf, pos = pad, pad, 0, {}
        for i in order:
            p = parts[i]
            if x + p["w"] + pad > W:
                x, y, shelf = pad, y + shelf + pad, 0
            pos[i] = (x, y)
            shelf = max(shelf, p["h"])
            x += p["w"] + pad
        H = y + shelf + pad
        if H <= 2 * W:
            break
        W *= 2
    H = 1 << math.ceil(math.log2(H))

    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, p in enumerate(parts):
        sheet.paste(p["img"], pos[i])
    sheet.save(d / "packed.png")

    lines = ["packed.png", f"size: {W},{H}", "format: RGBA8888",
             "filter: Linear,Linear", "repeat: none"]
    for i, p in enumerate(parts):
        lines += [p["name"], "  rotate: false", f"  xy: {pos[i][0]}, {pos[i][1]}",
                  f"  size: {p['w']}, {p['h']}", f"  orig: {p['w']}, {p['h']}",
                  "  offset: 0, 0", "  index: -1"]
    (d / f"{d.name}.atlas").write_text("\n".join(lines) + "\n")

    manifest = {"canvas": {"w": canvas[0], "h": canvas[1]}, "png": "packed.png",
                "atlas": f"{d.name}.atlas",
                "parts": [{k: p[k] for k in ("name", "x", "y", "w", "h")} for p in parts]}
    (d / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"OK: {len(parts)} parts -> packed.png {W}x{H}, {d.name}.atlas, manifest.json")


if __name__ == "__main__":
    main()
