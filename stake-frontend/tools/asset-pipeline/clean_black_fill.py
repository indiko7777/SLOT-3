#!/usr/bin/env python3
"""Erase leftover pure-black background trapped INSIDE the artwork.

Background removal usually clears the outside of a symbol but misses regions
fully enclosed by the art — the hole inside a strap loop, a handle, a trigger
guard. Those stay filled with the original black background and read as an ugly
dark blob in-game. clean_stray_alpha.py cannot help: the fill touches the art,
so it is part of the same alpha component.

This finds connected regions of near-black pixels and clears the ones you name.
Real art survives because painted darks are never pure black: on the duffel the
trapped fill measured luminance 0-4 while the darkest fabric was 22 and the
glove 16. Always run --list first and check the luminance column.

Usage:
  python clean_black_fill.py <image> --list [--maxlum=12]
  python clean_black_fill.py <image> --drop=0,2 [--maxlum=12] [--feather] [--out=<path>]

  --maxlum   luminance ceiling counted as "background black" (default 12)
  --minpx    ignore components smaller than this when listing (default 12)
  --feather  also soften the 1px rim left around a cleared region (recommended:
             kills the dark halo the antialiased edge leaves behind)
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def luminance(p) -> float:
    return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]


def black_components(im: Image.Image, maxlum: float, minpx: int):
    px = im.load()
    W, H = im.size
    seen = [[False] * H for _ in range(W)]
    out = []
    for x in range(W):
        for y in range(H):
            if seen[x][y]:
                continue
            p = px[x, y]
            if p[3] < 200 or luminance(p) > maxlum:
                seen[x][y] = True
                continue
            q = deque([(x, y)])
            seen[x][y] = True
            pix, lums = [], []
            while q:
                cx, cy = q.popleft()
                pix.append((cx, cy))
                lums.append(luminance(px[cx, cy]))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[nx][ny]:
                        np_ = px[nx, ny]
                        if np_[3] >= 200 and luminance(np_) <= maxlum:
                            seen[nx][ny] = True
                            q.append((nx, ny))
            if len(pix) >= minpx:
                xs = [p2[0] for p2 in pix]
                ys = [p2[1] for p2 in pix]
                out.append({"px": pix, "box": (min(xs), min(ys), max(xs), max(ys)),
                            "lum": sum(lums) / len(lums)})
    out.sort(key=lambda b: -len(b["px"]))
    return out


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
    maxlum = float(opts.get("maxlum", 12))
    minpx = int(opts.get("minpx", 12))
    im = Image.open(src).convert("RGBA")
    comps = black_components(im, maxlum, minpx)

    if "list" in opts or "drop" not in opts:
        print(f"{src.name}  {im.width}x{im.height}  {len(comps)} near-black region(s) "
              f"(lum<={maxlum}, >={minpx}px)")
        for i, b in enumerate(comps):
            n = len(b["px"])
            w = b["box"][2] - b["box"][0] + 1
            h = b["box"][3] - b["box"][1] + 1
            print(f"  #{i}: {n:6d}px  {w:3d}x{h:<3d}  avg-lum {b['lum']:5.2f}  bbox={b['box']}")
        return

    drop = {int(v) for v in opts["drop"].split(",") if v.strip()}
    px = im.load()
    cleared = 0
    for i in sorted(drop):
        if i >= len(comps):
            sys.exit(f"no region #{i} (found {len(comps)})")
        for x, y in comps[i]["px"]:
            px[x, y] = (0, 0, 0, 0)
            cleared += 1
        print(f"  cleared #{i}: {len(comps[i]['px'])}px at {comps[i]['box']}")

    if "feather" in opts:
        # The antialiased rim around a cleared fill is still background-dark.
        # Fade it proportional to darkness so no black halo outlines the hole.
        # STRICTLY LOCAL: only pixels that touched a cleared pixel are eligible,
        # otherwise this would erode the symbol's own bold dark outline everywhere.
        W, H = im.size
        rim_ceiling = maxlum * 2.5
        cleared_px = {p for i in sorted(drop) for p in comps[i]["px"]}
        candidates = set()
        for cx, cy in cleared_px:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in cleared_px:
                    candidates.add((nx, ny))
        edits = []
        for x, y in candidates:
            p = px[x, y]
            if p[3] == 0 or luminance(p) > rim_ceiling:
                continue
            edits.append((x, y, int(p[3] * min(1.0, luminance(p) / rim_ceiling))))
        for x, y, a in edits:
            p = px[x, y]
            px[x, y] = (p[0], p[1], p[2], a)
        print(f"  feathered {len(edits)} rim px (local to cleared regions only)")

    dst = Path(opts.get("out") or src)
    im.save(dst, "WEBP", quality=int(opts.get("quality", 95)), method=6)
    print(f"{dst}: {cleared}px cleared")


if __name__ == "__main__":
    main()
