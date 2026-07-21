#!/usr/bin/env python3
"""Turn the two hand-drawn truck plates into game-ready door-reveal assets.

Inputs (both 1376x768, artwork on a pure-black background):
  nodoor open.png                  the truck rear with an empty cargo opening
  armoredtruckleftandrightdoor.png both doors, flat and face-on, side by side

Outputs (RGBA webp, background AND the cargo opening fully transparent):
  truck_frame_open.webp   the doorless frame, cropped to the truck
  truck_door_l.webp       left door alone
  truck_door_r.webp       right door alone

It also prints the cargo opening as fractions of the cropped frame — those go
into TRUCK_OPENING so the reels and the doors land exactly in the hole.

Both source plates carry a small white sparkle bottom-right; it is dropped by
keeping only the largest connected blob.
"""
from collections import deque
from pathlib import Path

from PIL import Image

ASSETS = Path(__file__).resolve().parents[2] / "public" / "assets"
FRAME_SRC = ASSETS / "nodoor open.png"
DOORS_SRC = ASSETS / "armoredtruckleftandrightdoor.png"

# Background is (1,1,1). Anything this dark is background or the open cargo bay.
CUT = 30      # sum(r,g,b) at or below this -> fully transparent
SOFT = 105    # ...ramping to fully opaque here, which keeps edges anti-aliased


def keyed(img: Image.Image) -> Image.Image:
    """Black background -> alpha, with a soft edge so nothing looks cut out."""
    img = img.convert("RGBA")
    px = img.load()
    W, H = img.size
    for y in range(H):
        for x in range(W):
            r, g, b, _ = px[x, y]
            s = r + g + b
            if s <= CUT:
                px[x, y] = (r, g, b, 0)
            elif s < SOFT:
                px[x, y] = (r, g, b, int(255 * (s - CUT) / (SOFT - CUT)))
    return img


def blobs(img: Image.Image, thresh: int = 40, step: int = 2) -> list[list[tuple[int, int]]]:
    """Connected opaque islands, biggest first."""
    W, H = img.size
    a = img.split()[3].load()
    seen = [[False] * H for _ in range(W)]
    found = []
    for sx in range(0, W, step):
        for sy in range(0, H, step):
            if seen[sx][sy] or a[sx, sy] <= thresh:
                continue
            q = deque([(sx, sy)])
            seen[sx][sy] = True
            blob = []
            while q:
                x, y = q.popleft()
                blob.append((x, y))
                for dx, dy in ((step, 0), (-step, 0), (0, step), (0, -step)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[nx][ny] and a[nx, ny] > thresh:
                        seen[nx][ny] = True
                        q.append((nx, ny))
            found.append(blob)
    found.sort(key=len, reverse=True)
    return found


def drop_specks(img: Image.Image, min_frac: float = 0.25) -> Image.Image:
    """Erase islands smaller than `min_frac` of the biggest — kills the sparkle
    while KEEPING both doors (they are two separate islands)."""
    parts = blobs(img)
    if not parts:
        return img
    keep = [b for b in parts if len(b) >= len(parts[0]) * min_frac]
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for b in keep:
        xs = [p[0] for p in b]
        ys = [p[1] for p in b]
        box = (max(0, min(xs) - 3), max(0, min(ys) - 3),
               min(img.size[0], max(xs) + 4), min(img.size[1], max(ys) + 4))
        out.paste(img.crop(box), (box[0], box[1]))
    return out


def inner_hole(img: Image.Image) -> tuple[int, int, int, int]:
    """The cargo opening — the largest transparent region that does NOT touch
    the border. Flood-filling the outside first is what separates the opening
    from the transparency around the truck."""
    W, H = img.size
    a = img.split()[3].load()
    outside = [[False] * H for _ in range(W)]
    q: deque[tuple[int, int]] = deque()
    for x in range(W):
        for y in (0, H - 1):
            if a[x, y] < 40 and not outside[x][y]:
                outside[x][y] = True; q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if a[x, y] < 40 and not outside[x][y]:
                outside[x][y] = True; q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not outside[nx][ny] and a[nx, ny] < 40:
                outside[nx][ny] = True
                q.append((nx, ny))
    # There can be several enclosed gaps (under the bumper, between lights), so
    # take the LARGEST connected one — that is the cargo opening.
    seen = [[False] * H for _ in range(W)]
    best: list[tuple[int, int]] = []
    for sx in range(W):
        for sy in range(H):
            if seen[sx][sy] or outside[sx][sy] or a[sx, sy] >= 40:
                continue
            q2 = deque([(sx, sy)])
            seen[sx][sy] = True
            reg = []
            while q2:
                x, y = q2.popleft()
                reg.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if (0 <= nx < W and 0 <= ny < H and not seen[nx][ny]
                            and not outside[nx][ny] and a[nx, ny] < 40):
                        seen[nx][ny] = True
                        q2.append((nx, ny))
            if len(reg) > len(best):
                best = reg
    if not best:
        return 0, 0, W, H
    xs = [p[0] for p in best]
    ys = [p[1] for p in best]
    return min(xs), min(ys), max(xs), max(ys)


def main() -> None:
    # ── frame ─────────────────────────────────────────────────────────────
    frame = drop_specks(keyed(Image.open(FRAME_SRC)))
    frame = frame.crop(frame.getbbox())
    hx0, hy0, hx1, hy1 = inner_hole(frame)
    FW, FH = frame.size
    frame.save(ASSETS / "truck_frame_open.webp", "WEBP", quality=95, method=6)
    print(f"truck_frame_open.webp  {FW}x{FH}")
    print(f"  cargo opening x[{hx0}-{hx1}] y[{hy0}-{hy1}]  {hx1-hx0}x{hy1-hy0}")
    print("  TRUCK_OPENING = { "
          f"wFrac: {(hx1-hx0)/FW:.4f}, hFrac: {(hy1-hy0)/FH:.4f}, "
          f"cxFrac: {((hx0+hx1)/2)/FW:.4f}, cyFrac: {((hy0+hy1)/2)/FH:.4f}, "
          f"aspect: {(hx1-hx0)/(hy1-hy0):.4f} }}")

    # ── doors: split the pair at the seam ────────────────────────────────
    doors = drop_specks(keyed(Image.open(DOORS_SRC)))
    doors = doors.crop(doors.getbbox())
    DW, DH = doors.size
    a = doors.split()[3].load()
    # the seam is the emptiest column in the middle third
    mid = range(int(DW * 0.36), int(DW * 0.64))
    seam = min(mid, key=lambda x: sum(1 for y in range(DH) if a[x, y] > 120))
    left = doors.crop((0, 0, seam, DH))
    right = doors.crop((seam, 0, DW, DH))
    left = left.crop(left.getbbox())
    right = right.crop(right.getbbox())

    # The two doors are drawn slightly different widths (147 vs 162). Each one
    # gets mapped onto exactly half the opening, so unequal source widths meant
    # unequal horizontal stretch — the pair visibly did not match. Resampling
    # both to one size makes them render identically.
    tw = max(left.width, right.width)
    th = max(left.height, right.height)
    left = left.resize((tw, th), Image.LANCZOS)
    right = right.resize((tw, th), Image.LANCZOS)

    left.save(ASSETS / "truck_door_l.webp", "WEBP", quality=95, method=6)
    right.save(ASSETS / "truck_door_r.webp", "WEBP", quality=95, method=6)
    print(f"doors pair {DW}x{DH}, seam at x={seam}")
    print(f"  normalised both doors to {tw}x{th}")


if __name__ == "__main__":
    main()
