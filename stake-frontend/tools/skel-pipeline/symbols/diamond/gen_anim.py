#!/usr/bin/env python3
"""Diamond-specific skeletal animations for the Heat Chase premium DIAMOND symbol.

Reads diamond_source.json (pristine rig from make_skeleton), replaces the
animations with motion authored for a rigid faceted gem, writes diamond.json.

Motion ideas (a diamond is RIGID - it must not wobble like jelly):
  idle    2.4s loop - glassy luster: shine layer glints in slow waves, the three
          sparkle stars flash in a staggered round, glow breathes. Body barely
          moves (±0.9 deg sway, 1% breathing) - a gem is hard, only light moves.
  win     1.33s - anticipation crush -> prismatic burst: pop 1.16x with sparkle
          stars exploding out+spinning, glow flaring 1.5x, shine strobing.
  drop    0.67s - gravity fall, hard landing squash (a gem is heavy for its
          size), landing glint flash on the shine layer, sparkles lag 2 frames.
  destroy 0.87s - charge-up flash then the light shatters: sparkles + shine fly
          outward like shards, body spins and collapses to nothing, glow blows
          out 2.2x and dissipates. Ends fully invisible.

Run:  python gen_anim.py   then   python ../../tools/validate.py .
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "tools"))
from anim_lib import (bake, color, damped, damped_sin, ease_in_cubic, ease_in_quad,
                      ease_out_cubic, ease_out_quad, hold, rot, scale, seg, trans)

TAU = 2 * math.pi
CANVAS_H = 352

BODY = "body"
GLOW = "glow"
SHINE = "shine"
SPARKS = ["sparkle_l", "sparkle_r", "sparkle_top"]
ALL = [GLOW, BODY, SHINE] + SPARKS


def pulse(r, cycles, phase, power=8):
    """Narrow periodic flash 0..1, loop-safe for r in [0,1]."""
    return math.sin(math.pi * cycles * r + phase) ** power


# ---- idle: 72f (2.4s) seamless glassy luster --------------------------------
def idle_anim():
    a = {"bones": {}, "slots": {}}
    # breathing + a slow float bob: alive at a glance, still a hard gem
    a["bones"]["symbol_anchor"] = {
        "scale": scale(bake(0, 72, lambda r: 1 + 0.014 * math.sin(TAU * r), 3)),
        "translate": trans(bake(0, 72, lambda r: (0, 3.5 * (math.sin(TAU * r + 0.9)
                                                            - math.sin(0.9))), 3)),
    }
    # rigid body: readable sway (still well under the 2.5 deg jelly limit)
    a["bones"][BODY] = {"rotate": rot(bake(
        0, 72, lambda r: 1.8 * (math.sin(TAU * r + 0.6) - math.sin(0.6)), 3))}
    # glow breathes opposite the body sway phase
    a["bones"][GLOW] = {"scale": scale(bake(
        0, 72, lambda r: 1 + 0.07 * math.sin(math.pi * 2 * r + 1.1) ** 2, 3))}
    a["slots"][GLOW] = {"color": color(bake(
        0, 72, lambda r: 1 - 0.45 * math.sin(math.pi * 2 * r + 1.1) ** 2, 3))}
    # luster: two slow glint waves per loop across the facets
    a["bones"][SHINE] = {"scale": scale(bake(
        0, 72, lambda r: 1 + 0.08 * math.sin(math.pi * 2 * r + 2.0) ** 2, 3))}
    a["slots"][SHINE] = {"color": color(bake(
        0, 72, lambda r: 1 - 0.65 * math.sin(math.pi * 2 * r + 2.0) ** 4, 3))}
    # sparkle stars: staggered round of bright narrow flashes, alternating spin
    for i, n in enumerate(SPARKS):
        d = 1 if i % 2 == 0 else -1
        ph = i * 2.1  # spread the flashes around the loop
        a["bones"][n] = {
            "rotate": rot(bake(0, 72, lambda r, d=d, ph=ph:
                               16 * d * (math.sin(TAU * r + ph) - math.sin(ph)), 3)),
            "scale": scale(bake(0, 72, lambda r, ph=ph:
                                0.78 + 0.62 * pulse(r, 2, ph), 1)),
        }
        a["slots"][n] = {"color": color(bake(
            0, 72, lambda r, ph=ph: 0.22 + 0.78 * pulse(r, 2, ph), 1))}
    return a


# ---- win: 40f (1.33s) anticipation crush -> prismatic burst -----------------
def win_anim():
    a = {"bones": {}, "slots": {}}
    a["bones"]["symbol_anchor"] = {"scale": scale(seg(
        bake(0, 4, lambda r: 1 - 0.08 * ease_in_quad(r), 1),
        bake(4, 10, lambda r: 0.92 + 0.24 * ease_out_cubic(r), 1),
        bake(10, 38, lambda r: 1 + 0.16 * damped(r, 1.3, 3.4), 2),
        [(40, 1.0)]))}
    # body: compression kick then damped recovery - rigid, no jelly
    a["bones"][BODY] = {"rotate": rot(seg(
        bake(0, 4, lambda r: -2.5 * ease_in_quad(r), 1),
        bake(4, 10, lambda r: -2.5 + 6.0 * ease_out_cubic(r), 1),
        bake(10, 38, lambda r: 3.5 * damped(r, 1.2, 3.6), 2),
        [(40, 0.0)]))}
    # glow flare: 1.5x bloom that breathes back down
    a["bones"][GLOW] = {"scale": scale(seg(
        bake(0, 4, lambda r: 1 - 0.10 * ease_in_quad(r), 1),
        bake(4, 12, lambda r: 0.90 + 0.60 * ease_out_quad(r), 2),
        bake(12, 38, lambda r: 1 + 0.50 * damped(r, 0.9, 2.6), 2),
        [(40, 1.0)]))}
    a["slots"][GLOW] = {"color": color(seg(
        bake(0, 4, lambda r: 1 - 0.35 * r, 1),
        bake(4, 10, lambda r: 0.65 + 0.35 * ease_out_quad(r), 2),
        hold(12, 40, 1.0)))}
    # shine: double strobe right at the pop, then settle bright
    a["bones"][SHINE] = {"scale": scale(seg(
        hold(0, 4, 1.0),
        bake(4, 12, lambda r: 1 + 0.22 * ease_out_quad(r), 2),
        bake(12, 38, lambda r: 1 + 0.22 * damped(r, 1.0, 3.0), 2),
        [(40, 1.0)]))}
    a["slots"][SHINE] = {"color": color(seg(
        bake(0, 4, lambda r: 1 - 0.55 * ease_in_quad(r), 1),
        bake(4, 16, lambda r: 0.45 + 0.55 * abs(math.sin(math.pi * 2.5 * r)) ** 0.5, 1),
        hold(18, 40, 1.0)))}
    # sparkle stars: staggered bursts, alternate spin, fly a touch outward
    dirs = {"sparkle_l": (-1.0, -0.55), "sparkle_r": (1.0, 0.35), "sparkle_top": (0.15, 1.0)}
    for i, n in enumerate(SPARKS):
        d = 1 if i % 2 == 0 else -1
        st = 5 + i * 2
        ux, uy = dirs[n]
        a["bones"][n] = {
            "scale": scale(seg(
                bake(0, st, lambda r: 1 - 0.25 * r, 2),
                bake(st, st + 8, lambda r: 0.75 + 0.75 * ease_out_quad(r), 1),
                bake(st + 8, 38, lambda r: 1 + 0.50 * damped(r, 1.1, 2.8), 2),
                [(40, 1.0)])),
            "rotate": rot(seg(
                hold(0, st),
                bake(st, st + 8, lambda r, d=d: 40 * d * ease_out_cubic(r), 2),
                bake(st + 8, 38, lambda r, d=d: 40 * d + 15 * d * damped_sin(r, 1.0, 3.0), 2),
                [(40, 40 * d)])),
            "translate": trans(seg(
                hold(0, st, (0, 0)),
                bake(st, st + 8, lambda r, ux=ux, uy=uy: (14 * ux * ease_out_quad(r),
                                                          14 * uy * ease_out_quad(r)), 2),
                bake(st + 8, 38, lambda r, ux=ux, uy=uy: (14 * ux + 5 * ux * damped_sin(r, 1.0, 3.0),
                                                          14 * uy + 5 * uy * damped_sin(r, 1.0, 3.0)), 2),
                [(40, (14 * ux, 14 * uy))])),
        }
        a["slots"][n] = {"color": color(seg(
            bake(0, st, lambda r: 0.4 + 0.0 * r, 2),
            bake(st, st + 6, lambda r: 0.4 + 0.6 * ease_out_quad(r), 1),
            hold(st + 6, 40, 1.0)))}
    return a


# ---- drop: 20f (0.67s) heavy fall, landing glint ----------------------------
def drop_anim():
    fall = 0.9 * CANVAS_H
    a = {"bones": {}, "slots": {}}
    a["bones"]["symbol_anchor"] = {
        "translate": trans(bake(0, 10, lambda r: (0, fall * (1 - r * r)), 2)),
        "scale": scale(seg(
            [(0, (0.98, 1.04)), (9, (0.98, 1.04)), (10, (1.14, 0.85))],
            bake(11, 19, lambda r: (1 + 0.14 * damped(r, 1.2, 4.0),
                                    1 - 0.16 * damped(r, 1.2, 4.0)), 2),
            [(20, (1.0, 1.0))])),
    }
    # body impact jiggle - small, a gem is stiff
    a["bones"][BODY] = {"rotate": rot(seg(
        hold(0, 10),
        bake(10, 19, lambda r: 3.5 * damped_sin(r, 1.3, 3.2), 2),
        [(20, 0.0)]))}
    # glow: dim during fall, blooms on impact
    a["slots"][GLOW] = {"color": color(seg(
        [(0, 0.35), (9, 0.35)],
        bake(10, 18, lambda r: 0.35 + 0.65 * ease_out_quad(r), 2),
        [(20, 1.0)]))}
    a["bones"][GLOW] = {"scale": scale(seg(
        hold(0, 9, 1.0),
        bake(10, 19, lambda r: 1 + 0.18 * damped(r, 1.0, 3.0), 2),
        [(20, 1.0)]))}
    # landing glint: shine strobes exactly on impact
    a["slots"][SHINE] = {"color": color(seg(
        [(0, 0.25), (9, 0.25), (10, 1.0)],
        bake(11, 19, lambda r: 1 - 0.3 * abs(damped_sin(r, 1.2, 3.0)), 2),
        [(20, 1.0)]))}
    # sparkles lag the fall by 2 frames then snap down + jiggle
    for i, n in enumerate(SPARKS):
        d = 1 if i % 2 == 0 else -1
        a["bones"][n] = {
            "translate": trans(seg(
                bake(0, 12, lambda r: (0, 26 * math.sin(math.pi * r)), 2),
                [(20, (0, 0))])),
            "rotate": rot(seg(
                hold(0, 10 + i),
                bake(10 + i, 19, lambda r, d=d: 6 * d * damped_sin(r, 1.2, 3.0), 2),
                [(20, 0.0)])),
        }
        a["slots"][n] = {"color": color(seg(
            [(0, 0.2), (9 + i, 0.2)],
            bake(10 + i, 18, lambda r: 0.2 + 0.8 * ease_out_quad(r), 2),
            [(20, 1.0)]))}
    return a


# ---- destroy: 26f (0.87s) light shatters outward, ends invisible ------------
def destroy_anim():
    a = {"bones": {}, "slots": {}}
    # charge-up: quick inflate, then held while the light escapes
    a["bones"]["symbol_anchor"] = {"scale": scale(seg(
        bake(0, 4, lambda r: 1 + 0.14 * ease_out_cubic(r), 1),
        bake(4, 26, lambda r: 1.14 + 0.10 * r, 4)))}
    # body: spins up and collapses to nothing (crushed gem)
    a["bones"][BODY] = {
        "rotate": rot(seg(hold(0, 4), bake(4, 26, lambda r: 200 * ease_in_quad(r), 2))),
        "scale": scale(seg(
            hold(0, 4, 1.0),
            bake(4, 26, lambda r: max(0.02, 1 - 0.98 * ease_in_quad(r)), 2))),
    }
    a["slots"][BODY] = {"color": color(seg(
        hold(0, 10, 1.0), bake(10, 22, lambda r: 1 - ease_in_quad(r), 2), [(26, 0.0)]))}
    # glow: blows out 2.2x and dissipates
    a["bones"][GLOW] = {"scale": scale(seg(
        bake(0, 4, lambda r: 1 + 0.3 * ease_out_cubic(r), 1),
        bake(4, 24, lambda r: 1.3 + 0.9 * ease_out_quad(r), 2)))}
    a["slots"][GLOW] = {"color": color(seg(
        hold(0, 6, 1.0), bake(6, 20, lambda r: 1 - ease_in_quad(r), 2), [(26, 0.0)]))}
    # shards: shine + sparkle stars fly outward with spin, staggered fade
    frags = {SHINE: (0.2, 1.0, 150), "sparkle_l": (-1.0, -0.6, 260),
             "sparkle_r": (1.0, -0.35, 300), "sparkle_top": (0.25, 1.0, 280)}
    for i, (n, (ux, uy, dist)) in enumerate(frags.items()):
        d = 1 if i % 2 == 0 else -1
        st = i % 3
        a["bones"][n] = {
            "translate": trans(seg(hold(0, 3, (0, 0)), bake(
                3, 26, lambda r, ux=ux, uy=uy, ds=dist: (ux * ds * ease_in_cubic(r),
                                                         uy * ds * ease_in_cubic(r)), 2))),
            "rotate": rot(seg(hold(0, 3), bake(
                3, 26, lambda r, d=d: 170 * d * ease_in_quad(r), 2))),
            "scale": scale(seg(
                bake(0, 4, lambda r: 1 + 0.4 * ease_out_cubic(r), 2),
                bake(4, 26, lambda r: 1.4 - 0.9 * ease_in_quad(r), 4))),
        }
        a["slots"][n] = {"color": color(seg(
            hold(0, 8 + st * 2, 1.0),
            bake(8 + st * 2, 20 + st * 2, lambda r: 1 - ease_in_quad(r), 2),
            [(26, 0.0)]))}
    return a


def main():
    src = json.loads((HERE / "diamond_source.json").read_text())
    src["animations"] = {
        "idle": idle_anim(),
        "win": win_anim(),
        "drop": drop_anim(),
        "destroy": destroy_anim(),
    }
    (HERE / "diamond.json").write_text(json.dumps(src, indent=1))
    print("OK: diamond.json written (idle 2.4s, win 1.33s, drop 0.67s, destroy 0.87s)")


if __name__ == "__main__":
    main()
