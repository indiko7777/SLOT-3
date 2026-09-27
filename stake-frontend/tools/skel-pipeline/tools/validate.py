#!/usr/bin/env python3
"""Quality gate for a symbol's skeleton JSON. Run after EVERY edit; exit 1 = fix it.

Usage: python validate.py path/to/symbol_dir [--loop idle,win]

Checks (errors fail the build):
  E1 JSON parses; skins in 3.8 object form
  E2 no Bezier `curve` arrays / c2-c4 fields (break Spine 3.8 & importer parity)
  E3 rotate keys use `angle`; colors are 8-digit hex; times non-decreasing
  E4 all key times land on integer 30fps frames
  E5 looping anims (default: idle) close: first == last value per timeline
  E6 destroy ends with every slot invisible (alpha 00) or scaled to zero
  E7 setup pose: reconstructed world centre of every part == manifest (<=0.05px)
  E8 every attachment has an atlas region; duplicate region names
  Semantic rigs (they ship a `hold` clip — see src/pixi/symbolFlow.ts):
  E9  `win` ends exactly on `hold`'s first pose (no snap into the held pose)
  E10 `land` starts and ends at the setup pose (the board owns the fall)
  E11 win / hold / land / destroy all present
  E12 every event key names an event declared at the top level
Warnings:
  W1 attachment size != atlas region size
  W2 <3 or >14 parts
  W3 consecutive keys jump >60 deg or >25% scale in <=2 frames (teleporty motion)
"""
import json
import math
import sys
from pathlib import Path

FPS = 30
errs, warns = [], []


def E(m): errs.append(m)
def W(m): warns.append(m)


def scan_curves(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "curve" and not isinstance(v, str):
                E(f"E2 curve array at {path}")
            if k in ("c2", "c3", "c4"):
                E(f"E2 {k} at {path}")
            if k == "rotation" and "animations" in path and "bones" in path:
                E(f"E3 rotate key uses 'rotation' (must be 'angle') at {path}")
            scan_curves(v, f"{path}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            scan_curves(v, f"{path}[{i}]")


def main():
    d = Path(sys.argv[1])
    loops = ["idle"]
    for a in sys.argv[2:]:
        if a.startswith("--loop"):
            loops = a.split("=")[1].split(",")

    data = json.loads((d / f"{d.name}.json").read_text())
    manifest = json.loads((d / "manifest.json").read_text())

    if not (isinstance(data.get("skins"), dict) and "default" in data["skins"]):
        E("E1 skins must be 3.8 object form: {\"default\": {...}}")
    skin = data.get("skins", {}).get("default", {})
    anims = data.get("animations", {})
    scan_curves(anims, "animations")

    # timelines: times, frames, colors, closure, jumps
    def walk_timelines(anim, name):
        found = []
        for section in ("bones", "slots"):
            for tgt, tls in anim.get(section, {}).items():
                for tln, keys in tls.items():
                    if not isinstance(keys, list):
                        continue
                    found.append((f"{name}/{tgt}/{tln}", keys))
        return found

    for an, anim in anims.items():
        for path, keys in walk_timelines(anim, an):
            prev = -1
            for k in keys:
                t = k.get("time", 0)
                if t < prev:
                    E(f"E3 non-monotonic time in {path}")
                prev = t
                f = t * FPS
                if abs(f - round(f)) > 1e-3:
                    E(f"E4 fractional frame {f:.2f} in {path}")
                if "color" in path and len(k.get("color", "")) != 8:
                    E(f"E3 bad color '{k.get('color')}' in {path}")
            # W3 jumps
            for a, b in zip(keys, keys[1:]):
                df = (b.get("time", 0) - a.get("time", 0)) * FPS
                if 0 < df <= 2 and a.get("curve") != "stepped":
                    if "angle" in b and abs(b["angle"] - a.get("angle", 0)) > 60:
                        W(f"W3 {path}: {abs(b['angle']-a.get('angle',0)):.0f} deg in {df:.0f}f")
                    if "x" in b and "angle" not in b and "color" not in a:
                        try:
                            if abs(float(b["x"]) - float(a.get("x", 1))) > 0.25 and "scale" in path:
                                W(f"W3 {path}: scale jump in {df:.0f}f")
                        except (TypeError, ValueError):
                            pass

    # E5 loop closure
    for ln in loops:
        if ln not in anims:
            continue
        for path, keys in walk_timelines(anims[ln], ln):
            first = {k: v for k, v in keys[0].items() if k not in ("time", "curve")}
            last = {k: v for k, v in keys[-1].items() if k not in ("time", "curve")}
            for k in first:
                a, b = first[k], last.get(k)
                if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                    if abs(a - b) > 1e-3:
                        E(f"E5 {path} does not close: {a} vs {b}")
                elif a != b:
                    E(f"E5 {path} does not close: {a} vs {b}")

    # E6 destroy invisible
    if "destroy" in anims:
        slot_names = [s["name"] for s in data["slots"]]
        dst = anims["destroy"].get("slots", {})
        anchor_scale = anims["destroy"].get("bones", {}).get("symbol_anchor", {}).get("scale", [])
        anchor_zero = anchor_scale and abs(anchor_scale[-1].get("x", 1)) < 1e-3
        for n in slot_names:
            keys = dst.get(n, {}).get("color", [])
            if not (keys and keys[-1]["color"].endswith("00")) and not anchor_zero:
                E(f"E6 destroy leaves '{n}' visible")

    # E9-E12 semantic clip contract
    setup_color = {s["name"]: s.get("color", "ffffffff") for s in data["slots"]}

    def rest_value(path):
        # path like "<anim>/<target>/<timeline>"
        _, tgt, tl = path.split("/")
        if tl == "rotate":
            return {"angle": 0}
        if tl == "translate":
            return {"x": 0, "y": 0}
        if tl == "scale":
            return {"x": 1, "y": 1}
        if tl == "color":
            return {"color": setup_color.get(tgt, "ffffffff")}
        return None

    def same(a, b, tol=0.02):
        # scale keys carry 4 decimals: hold them to that, not the 0.02 that
        # suits translate px / angle degrees
        for k, v in a.items():
            if k in ("time", "curve"):
                continue
            w = b.get(k)
            if isinstance(v, (int, float)) and isinstance(w, (int, float)):
                d = abs(v - w)
                if k == "angle":  # a full turn (360) is the same pose as 0
                    d = abs(((v - w) + 180) % 360 - 180)
                if d > tol:
                    return False
            elif isinstance(v, str) and isinstance(w, str) and k == "color":
                if any(abs(int(v[i:i + 2], 16) - int(w[i:i + 2], 16)) > 2 for i in range(0, 8, 2)):
                    return False
            elif v != w:
                return False
        return True

    if "hold" in anims:
        for need in ("win", "land", "destroy"):
            if need not in anims:
                E(f"E11 semantic rig (has hold) is missing '{need}'")
        if "win" in anims:
            hold_tl = {p.split("/", 1)[1]: k for p, k in walk_timelines(anims["hold"], "hold")}
            win_tl = {p.split("/", 1)[1]: k for p, k in walk_timelines(anims["win"], "win")}

            def alpha_of(tl, slot, idx):
                keys = tl.get(f"{slot}/color")
                c = keys[idx]["color"] if keys else setup_color.get(slot, "ffffffff")
                return int(c[6:8], 16)

            for key, keys in win_tl.items():
                tgt, tln = key.split("/")
                # A part that is invisible on both sides of the hand-off (an
                # ejected casing, spent smoke) may reset its transform freely.
                if tln in ("translate", "rotate", "scale") and tgt in setup_color \
                        and alpha_of(win_tl, tgt, -1) == 0 and alpha_of(hold_tl, tgt, 0) == 0:
                    continue
                target = hold_tl[key][0] if key in hold_tl else rest_value("win/" + key)
                tol = 0.0006 if tln == "scale" else 0.02
                if target is not None and "attachment" not in key and not same(keys[-1], target, tol):
                    E(f"E9 win/{key} ends at {keys[-1]} but hold starts at {target}")
            for key, keys in hold_tl.items():
                tol = 0.0006 if key.endswith("/scale") else 0.02
                if key not in win_tl and not same(keys[0], rest_value("hold/" + key), tol):
                    E(f"E9 hold/{key} starts off the setup pose the win leaves ({keys[0]})")
    # E10 applies to ANY rig that ships a land clip (the truck has no hold)
    if "land" in anims:
        for path, keys in walk_timelines(anims["land"], "land"):
            rv = rest_value(path)
            if rv is None:
                continue
            tol = 0.0006 if path.endswith("/scale") else 0.02
            if not same(keys[0], rv, tol):
                E(f"E10 {path} does not start at rest: {keys[0]}")
            if not same(keys[-1], rv, tol):
                E(f"E10 {path} does not end at rest: {keys[-1]}")
    declared = set((data.get("events") or {}).keys())
    for an, anim in anims.items():
        for e in anim.get("events", []):
            if e.get("name") not in declared:
                E(f"E12 {an} event '{e.get('name')}' is not declared in top-level events")
            f = e.get("time", 0) * FPS
            if abs(f - round(f)) > 1e-3:
                E(f"E4 fractional event frame {f:.2f} in {an}")

    # E7 setup pose reconstruction (bone world matrix o attachment offset)
    bones = {}
    for b in data["bones"]:
        parent = bones.get(b.get("parent"))
        r = -b.get("rotation", 0) * math.pi / 180
        sx, sy = b.get("scaleX", 1), b.get("scaleY", 1)
        l = [math.cos(r) * sx, math.sin(r) * sx, -math.sin(r) * sy, math.cos(r) * sy,
             b.get("x", 0), -b.get("y", 0)]
        if parent:
            p = parent
            l = [p[0]*l[0]+p[2]*l[1], p[1]*l[0]+p[3]*l[1],
                 p[0]*l[2]+p[2]*l[3], p[1]*l[2]+p[3]*l[3],
                 p[0]*l[4]+p[2]*l[5]+p[4], p[1]*l[4]+p[3]*l[5]+p[5]]
        bones[b["name"]] = l
    slot_bone = {s["name"]: s["bone"] for s in data["slots"]}
    for p in manifest["parts"]:
        atts = skin.get(p["name"], {})
        att = atts.get(p["name"])
        bone = bones.get(slot_bone.get(p["name"]))
        if att is None or bone is None:
            E(f"E7 missing slot/attachment/bone for '{p['name']}'")
            continue
        ax, ay = att.get("x", 0), -att.get("y", 0)
        wx = bone[0]*ax + bone[2]*ay + bone[4]
        wy = bone[1]*ax + bone[3]*ay + bone[5]
        dx, dy = wx - p["x"], wy - (-p["y"])
        if abs(dx) > 0.05 or abs(dy) > 0.05:
            E(f"E7 setup pose drift '{p['name']}': ({dx:.2f},{dy:.2f})px")
        if abs(att.get("width", 0) - p["w"]) > 0.5 or abs(att.get("height", 0) - p["h"]) > 0.5:
            W(f"W1 '{p['name']}' attachment size != part size")

    # E8 atlas coverage
    atlas = (d / manifest["atlas"]).read_text().splitlines()
    regions = [ln.strip() for ln in atlas[1:] if ln.strip() and ":" not in ln]
    if len(regions) != len(set(regions)):
        E("E8 duplicate atlas region names")
    for sn, atts in skin.items():
        for an_ in atts:
            if (atts[an_].get("path") or an_) not in regions:
                E(f"E8 no atlas region for attachment '{an_}'")

    n = len(manifest["parts"])
    if n < 3:
        W(f"W2 only {n} parts - motion will look stiff; split the art more")
    if n > 14:
        W(f"W2 {n} parts - consider merging slivers")

    for w in warns:
        print("WARN", w)
    if errs:
        print("\n".join("ERROR " + e for e in errs))
        sys.exit(f"FAILED: {len(errs)} error(s)")
    print(f"PASS: {len(anims)} animations, {n} parts, "
          f"{len(warns)} warning(s)")


if __name__ == "__main__":
    main()
