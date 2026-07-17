#!/usr/bin/env python3
"""manifest.json -> Spine 3.8-format skeleton JSON with smart pivots + eased default animations.

Usage: python make_skeleton.py path/to/symbol_dir [--no-anims]

Rig: root -> symbol_anchor -> one bone per part.
Pivots (this is what makes motion look right):
  - central parts & effect parts (glow/shine/sparkle/...): pivot at part centre
  - appendages (parts away from the symbol centre): pivot at the part's INNER
    edge, facing the symbol centre - so ears/flames/curls swing from their base
  - override any pivot in <dir>/pivots.json: {"part_name": [px_x, px_y]} in
    original canvas pixel coords (origin top-left, y down)
The attachment is offset so the world setup pose is pixel-identical either way.

Default animations (baked eased keys, 30fps, import-safe, all loop-clean):
  idle    2.0s seamless loop: breathing + phase-staggered sway + effect twinkle
  win     1.2s: anticipation dip -> overshoot pop -> damped settle; staggered
          per-part bursts; effect parts flare
  drop    0.67s: real gravity fall scaled to symbol size, impact squash,
          damped recovery, per-part impact jiggle
  destroy 0.8s: inflate then per-part scatter outward with spin + staggered fade;
          ends fully invisible
"""
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from anim_lib import (bake, color, damped, damped_sin, ease_in_cubic, ease_in_quad,
                      ease_out_cubic, ease_out_quad, hold, rot, scale, seg, trans)

EFFECT = re.compile(r"sparkle|shine|glow|glint|light|aura|star|flare|fx", re.I)


def per(i):
    """Deterministic per-part variation: direction, amplitude factor, phase."""
    d = 1 if i % 2 == 0 else -1
    v = 0.75 + ((i * 37) % 10) / 14
    ph = ((i * 53) % 100) / 100 * 0.9 - 0.45
    return d, v, ph


def pivot_for(p, canvas, overrides):
    W, H = canvas
    if p["name"] in overrides:
        px, py = overrides[p["name"]]
        return round(px - W / 2, 2), round(H / 2 - py, 2)
    cx, cy = p["x"], p["y"]
    r = math.hypot(cx, cy)
    if EFFECT.search(p["name"]) or r < 0.17 * min(W, H):
        return cx, cy  # central / effect part: centre pivot
    ux, uy = -cx / r, -cy / r  # toward symbol centre
    e = (abs(ux) * p["w"] + abs(uy) * p["h"]) / 2
    return round(cx + ux * e * 0.8, 2), round(cy + uy * e * 0.8, 2)


def default_anims(parts, canvas):
    W, H = canvas
    names = [p["name"] for p in parts]
    fx = [i for i, p in enumerate(parts) if EFFECT.search(p["name"])]

    # ---- idle: 60f seamless loop --------------------------------------------
    idle = {"bones": {"symbol_anchor": {"scale": scale(
        bake(0, 60, lambda r: 1 + 0.012 * math.sin(2 * math.pi * r), 3))}}, "slots": {}}
    for i, n in enumerate(names):
        d, v, ph = per(i)
        amp = 1.9 * d * v
        idle["bones"][n] = {"rotate": rot(bake(
            0, 60, lambda r, a=amp, p=ph: a * (math.sin(2 * math.pi * r + p) - math.sin(p)), 3))}
    for i in fx:
        d, v, _ = per(i)
        c = 2 + (i % 2)  # twinkle cycles per loop
        idle["slots"][names[i]] = {"color": color(bake(
            0, 60, lambda r, c=c, v=v: 1 - 0.3 * v * math.sin(math.pi * c * r) ** 2, 2))}
        idle["bones"][names[i]]["scale"] = scale(bake(
            0, 60, lambda r, c=c, v=v: 1 + 0.09 * v * math.sin(math.pi * c * r) ** 2, 2))

    # ---- win: 36f, anticipation -> pop -> damped settle ---------------------
    win = {"bones": {"symbol_anchor": {"scale": scale(seg(
        bake(0, 3, lambda r: 1 - 0.07 * ease_in_quad(r), 1),
        bake(3, 9, lambda r: 0.93 + 0.23 * ease_out_cubic(r), 1),
        bake(9, 34, lambda r: 1 + 0.16 * damped(r, 1.4, 3.2), 2),
        [(36, 1.0)]))}}}
    for i, n in enumerate(names):
        d, v, _ = per(i)
        st = 4 + (i % 4) * 2
        th = 11 * d * v
        win["bones"][n] = {"rotate": rot(seg(
            hold(0, st),
            bake(st, st + 5, lambda r, t=th: t * ease_out_cubic(r), 1),
            bake(st + 5, 34, lambda r, t=th: t * damped(r, 1.2, 3.5), 2),
            [(36, 0.0)]))}
    for i in fx:
        d, v, _ = per(i)
        st = 4 + (i % 4) * 2
        win["bones"][names[i]]["scale"] = scale(seg(
            hold(0, st, 1.0),
            bake(st, st + 6, lambda r, v=v: 1 + 0.5 * v * ease_out_quad(r), 1),
            bake(st + 6, 34, lambda r, v=v: 1 + 0.5 * v * damped(r, 1.2, 3.0), 2),
            [(36, 1.0)]))

    # ---- drop: 20f, gravity fall scaled to symbol, squash, recover ----------
    fall = 0.9 * H
    drop = {"bones": {"symbol_anchor": {
        "translate": trans(bake(0, 10, lambda r: (0, fall * (1 - r * r)), 2)),
        "scale": scale(seg(
            [(0, (0.97, 1.05)), (9, (0.97, 1.05)), (10, (1.13, 0.84))],
            bake(11, 19, lambda r: (1 + 0.13 * damped(r, 1.2, 4.0),
                                    1 - 0.16 * damped(r, 1.2, 4.0)), 2),
            [(20, (1.0, 1.0))]))}}}
    for i, n in enumerate(names):
        d, v, _ = per(i)
        drop["bones"][n] = {"rotate": rot(seg(
            hold(0, 10),
            bake(10, 19, lambda r, a=4.5 * d * v: a * damped_sin(r, 1.3, 3.0), 2),
            [(20, 0.0)]))}

    # ---- destroy: 24f, inflate -> scatter outward + spin + fade -------------
    destroy = {"bones": {"symbol_anchor": {"scale": scale(seg(
        bake(0, 4, lambda r: 1 + 0.12 * ease_out_cubic(r), 1),
        bake(4, 24, lambda r: 1.12 + 0.18 * r, 4)))}}, "slots": {}}
    for i, p in enumerate(parts):
        d, v, _ = per(i)
        r0 = math.hypot(p["x"], p["y"])
        if r0 < 15:
            ang = i * 2.39996  # golden angle, deterministic spread
            ux, uy = math.cos(ang), math.sin(ang)
        else:
            ux, uy = p["x"] / r0, p["y"] / r0
        dist = 0.55 * max(W, H) * (0.8 + 0.4 * v)
        spin = d * (120 + 80 * v)
        st = i % 4
        destroy["bones"][p["name"]] = {
            "translate": trans(seg(hold(0, 3, (0, 0)), bake(
                3, 24, lambda r, ux=ux, uy=uy, ds=dist: (ux * ds * ease_in_cubic(r),
                                                         uy * ds * ease_in_cubic(r)), 2))),
            "rotate": rot(seg(hold(0, 3), bake(
                3, 24, lambda r, s=spin: s * ease_in_quad(r), 3)))}
        destroy["slots"][p["name"]] = {"color": color(seg(
            hold(0, 6 + st, 1.0),
            bake(6 + st, 16 + st, lambda r: 1 - ease_in_quad(r), 2)))}

    return {"idle": idle, "win": win, "drop": drop, "destroy": destroy}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    d = Path(args[0])
    m = json.loads((d / "manifest.json").read_text())
    canvas = (m["canvas"]["w"], m["canvas"]["h"])
    overrides = {}
    if (d / "pivots.json").exists():
        overrides = json.loads((d / "pivots.json").read_text())

    bones = [{"name": "root"}, {"name": "symbol_anchor", "parent": "root"}]
    slots, skin = [], {}
    print("pivots:")
    for p in m["parts"]:
        pvx, pvy = pivot_for(p, canvas, overrides)
        ox, oy = round(p["x"] - pvx, 2), round(p["y"] - pvy, 2)
        src = ("override" if p["name"] in overrides else
               "centre" if (ox == 0 and oy == 0) else "inner-edge")
        print(f"  {p['name']:<16} ({pvx:>7.1f},{pvy:>7.1f})  {src}")
        bones.append({"name": p["name"], "parent": "symbol_anchor", "x": pvx, "y": pvy})
        slots.append({"name": p["name"], "bone": p["name"], "attachment": p["name"]})
        skin[p["name"]] = {p["name"]: {"x": ox, "y": oy, "width": p["w"], "height": p["h"]}}

    data = {
        "skeleton": {"spine": "3.8.75", "width": canvas[0], "height": canvas[1],
                     "images": "./parts", "hash": "kf"},
        "bones": bones,
        "slots": slots,
        "skins": {"default": skin},  # 3.8 object form
        "animations": {} if "--no-anims" in sys.argv else default_anims(m["parts"], canvas),
    }
    out = d / f"{d.name}.json"
    out.write_text(json.dumps(data, indent=1))
    src = d / f"{d.name}_source.json"
    src.write_text(json.dumps(data, indent=1))
    print(f"OK: {out.name} ({len(m['parts'])} parts, "
          f"anims: {', '.join(data['animations'].keys()) or 'none'})")


if __name__ == "__main__":
    main()
