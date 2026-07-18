#!/usr/bin/env python3
"""Delete detached alpha blobs left behind by a sloppy background removal.

A hand-cut symbol often keeps orphan chunks of the old background — islands of
pixels not connected to the main artwork. This finds every connected component
in the alpha channel and removes the ones you name, so real detached art (a
glove, a spark, a shadow the artist drew) can be kept deliberately.

Usage:
  # 1) list the blobs and their bounding boxes
  python clean_stray_alpha.py <image> --list

  # 2) delete blobs by index (from --list), keeping everything else
  python clean_stray_alpha.py <image> --drop=2,3 [--out=<path>] [--thresh=24]

Indices are ordered largest-first, so #0 is always the main artwork.
"""
import sys
from collections import deque
from pathlib import Path

from PIL import Image


def components(im: Image.Image, thresh: int):
    a = im.split()[3].load()
    W, H = im.size
    seen = [[False] * H for _ in range(W)]
    blobs = []
    for x in range(W):
        for y in range(H):
            if seen[x][y] or a[x, y] <= thresh:
                continue
            q = deque([(x, y)])
            seen[x][y] = True
            px = []
            while q:
                cx, cy = q.popleft()
                px.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[nx][ny] and a[nx, ny] > thresh:
                        seen[nx][ny] = True
                        q.append((nx, ny))
            xs = [p[0] for p in px]
            ys = [p[1] for p in px]
            blobs.append({"px": px, "box": (min(xs), min(ys), max(xs), max(ys))})
    blobs.sort(key=lambda b: -len(b["px"]))
    return blobs


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
    thresh = int(opts.get("thresh", 24))
    im = Image.open(src).convert("RGBA")
    blobs = components(im, thresh)

    if "list" in opts or "drop" not in opts:
        print(f"{src.name}  {im.width}x{im.height}  {len(blobs)} component(s)")
        for i, b in enumerate(blobs):
            n = len(b["px"])
            print(f"  #{i}: {n:7d}px ({n / (im.width * im.height) * 100:5.2f}%)  bbox={b['box']}"
                  + ("   <- main artwork" if i == 0 else ""))
        return

    drop = {int(v) for v in opts["drop"].split(",") if v.strip()}
    if 0 in drop:
        sys.exit("refusing to delete #0 — that is the main artwork")
    px = im.load()
    removed = 0
    for i in sorted(drop):
        if i >= len(blobs):
            sys.exit(f"no component #{i} (found {len(blobs)})")
        for x, y in blobs[i]["px"]:
            px[x, y] = (0, 0, 0, 0)
            removed += 1
        print(f"  removed #{i}: {len(blobs[i]['px'])}px at {blobs[i]['box']}")

    dst = Path(opts.get("out") or src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=int(opts.get("quality", 95)), method=6)
    print(f"{dst}: {removed}px cleared, {len(components(im, thresh))} component(s) remain")


if __name__ == "__main__":
    main()
