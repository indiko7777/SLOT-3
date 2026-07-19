#!/usr/bin/env python3
"""Per-symbol motion personalities for the Heat Chase skeletal symbols.

Every symbol gets idle / win / drop / destroy built from the same layer set
(glow, body, shine, sparkle_N) but with motion authored for what the object IS:
a pistol recoils, a knife flips, a safe's dial spins, cash riffles, the bike
revs. Where a literal read isn't possible from a flat image, the motion still
expresses the object's weight and material (a gem is rigid, a duffel is soft).

All motion is baked into dense linear keys via anim_lib (no Bezier curves --
they break Spine 3.8 importers) at integer 30fps frames.

Contract enforced by tools/validate.py:
  idle    seamless loop: first key value == last key value on every timeline
  destroy every slot ends at alpha 00
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
from anim_lib import (bake, color, damped, damped_sin, ease_in_cubic, ease_in_quad,  # noqa: E402
                      ease_out_cubic, ease_out_quad, hold, rot, scale, seg, trans)

TAU = 2 * math.pi


def pulse(r, cycles, phase, power=8):
    """Narrow periodic flash 0..1, loop-safe over r in [0,1]."""
    return math.sin(math.pi * cycles * r + phase) ** power


def smoothstep(r):
    """Ease in AND out. Peak speed is only 1.5x the average, so a fast move
    (a knife flip) never jumps far enough in one frame to read as a teleport —
    ease_out_cubic front-loads ~19% of the whole rotation into frame 1."""
    return r * r * (3 - 2 * r)


def loopy(fn):
    """Wrap a periodic fn so it starts and ends at exactly the same value.

    Subtracting the value at r=0 is what satisfies the validator's E5 loop-
    closure check. Handles both scalar timelines (rotate/scale) and the (x, y)
    tuples used by translate timelines.
    """
    base = fn(0.0)
    if isinstance(base, (tuple, list)):
        return lambda r: tuple(v - b for v, b in zip(fn(r), base))
    return lambda r: fn(r) - base


# ── shared building blocks ───────────────────────────────────────────────────
def sparkle_idle(anim, sparks, cycles=2, amp=0.55, spin=12):
    """Staggered twinkle round shared by every symbol's idle."""
    for i, n in enumerate(sparks):
        d = 1 if i % 2 == 0 else -1
        ph = i * 2.1
        anim["bones"][n] = {
            "rotate": rot(bake(0, 72, loopy(lambda r, d=d, ph=ph: spin * d * math.sin(TAU * r + ph)), 3)),
            # step 1: the twinkle is a narrow power-8 pulse, so sampling every
            # 2 frames lets the spike jump >25% scale between keys (validator W3).
            "scale": scale(bake(0, 72, lambda r, ph=ph: 0.80 + amp * pulse(r, cycles, ph), 1)),
        }
        anim["slots"][n] = {"color": color(bake(0, 72, lambda r, ph=ph: 0.22 + 0.78 * pulse(r, cycles, ph), 2))}


def sparkle_burst(anim, sparks, dirs=None, start=5, spin=40, dist=12, dur=40):
    """Staggered outward sparkle burst shared by every symbol's win."""
    for i, n in enumerate(sparks):
        d = 1 if i % 2 == 0 else -1
        st = start + i * 2
        ux, uy = (dirs or {}).get(n, (math.cos(i * 2.4), math.sin(i * 2.4)))
        anim["bones"][n] = {
            "scale": scale(seg(
                bake(0, st, lambda r: 1 - 0.25 * r, 2),
                bake(st, st + 8, lambda r: 0.75 + 0.75 * ease_out_quad(r), 1),
                bake(st + 8, dur - 2, lambda r: 1 + 0.50 * damped(r, 1.1, 2.8), 2),
                [(dur, 1.0)])),
            "rotate": rot(seg(
                hold(0, st),
                bake(st, st + 8, lambda r, d=d: spin * d * ease_out_cubic(r), 2),
                bake(st + 8, dur, lambda r, d=d: spin * d + 12 * d * damped_sin(r, 1.0, 3.0), 2))),
            "translate": trans(seg(
                hold(0, st, (0, 0)),
                bake(st, st + 8, lambda r, ux=ux, uy=uy: (dist * ux * ease_out_quad(r), dist * uy * ease_out_quad(r)), 2),
                [(dur, (dist * ux, dist * uy))])),
        }
        anim["slots"][n] = {"color": color(seg(
            hold(0, st, 0.35),
            bake(st, st + 6, lambda r: 0.35 + 0.65 * ease_out_quad(r), 1),
            hold(st + 6, dur, 1.0)))}


def glow_flare(anim, amount=0.5, start=4, dur=40):
    anim["bones"]["glow"] = {"scale": scale(seg(
        bake(0, start, lambda r: 1 - 0.10 * ease_in_quad(r), 1),
        bake(start, start + 8, lambda r, a=amount: 0.90 + (0.10 + a) * ease_out_quad(r), 2),
        bake(start + 8, dur - 2, lambda r, a=amount: 1 + a * damped(r, 0.9, 2.6), 2),
        [(dur, 1.0)]))}
    anim["slots"]["glow"] = {"color": color(seg(
        bake(0, start, lambda r: 1 - 0.35 * r, 1),
        bake(start, start + 6, lambda r: 0.65 + 0.35 * ease_out_quad(r), 2),
        hold(start + 8, dur, 1.0)))}


def glow_breathe(anim, amp=0.07, dim=0.45):
    anim["bones"]["glow"] = {"scale": scale(bake(0, 72, lambda r: 1 + amp * math.sin(math.pi * 2 * r + 1.1) ** 2, 3))}
    anim["slots"]["glow"] = {"color": color(bake(0, 72, lambda r: 1 - dim * math.sin(math.pi * 2 * r + 1.1) ** 2, 3))}


def shine_sweep(anim, cycles=2, phase=2.0, dim=0.65, amp=0.08):
    anim["bones"]["shine"] = {"scale": scale(bake(0, 72, lambda r: 1 + amp * math.sin(math.pi * cycles * r + phase) ** 2, 3))}
    anim["slots"]["shine"] = {"color": color(bake(0, 72, lambda r: 1 - dim * math.sin(math.pi * cycles * r + phase) ** 4, 3))}


def shine_strobe(anim, start=4, dur=40, cycles=2.5):
    anim["bones"]["shine"] = {"scale": scale(seg(
        hold(0, start, 1.0),
        bake(start, start + 8, lambda r: 1 + 0.22 * ease_out_quad(r), 2),
        bake(start + 8, dur - 2, lambda r: 1 + 0.22 * damped(r, 1.0, 3.0), 2),
        [(dur, 1.0)]))}
    anim["slots"]["shine"] = {"color": color(seg(
        bake(0, start, lambda r: 1 - 0.55 * ease_in_quad(r), 1),
        bake(start, start + 12, lambda r, c=cycles: 0.45 + 0.55 * abs(math.sin(math.pi * c * r)) ** 0.5, 1),
        hold(start + 14, dur, 1.0)))}


def base_drop(body_jiggle=3.5, canvas_h=320, squash=(1.14, 0.85), parts=()):
    """Gravity fall + impact squash. `body_jiggle` in degrees tunes stiffness:
    small for rigid metal, large for soft fabric."""
    fall = 0.9 * canvas_h
    a = {"bones": {}, "slots": {}}
    a["bones"]["symbol_anchor"] = {
        "translate": trans(bake(0, 10, lambda r: (0, fall * (1 - r * r)), 2)),
        "scale": scale(seg(
            [(0, (0.98, 1.04)), (9, (0.98, 1.04)), (10, squash)],
            bake(11, 19, lambda r: (1 + (squash[0] - 1) * damped(r, 1.2, 4.0),
                                    1 - (1 - squash[1]) * damped(r, 1.2, 4.0)), 2),
            [(20, (1.0, 1.0))])),
    }
    a["bones"]["body"] = {"rotate": rot(seg(
        hold(0, 10),
        bake(10, 19, lambda r, j=body_jiggle: j * damped_sin(r, 1.3, 3.2), 2),
        [(20, 0.0)]))}
    a["slots"]["glow"] = {"color": color(seg(
        [(0, 0.35), (9, 0.35)], bake(10, 18, lambda r: 0.35 + 0.65 * ease_out_quad(r), 2), [(20, 1.0)]))}
    a["slots"]["shine"] = {"color": color(seg(
        [(0, 0.25), (9, 0.25), (10, 1.0)],
        bake(11, 19, lambda r: 1 - 0.3 * abs(damped_sin(r, 1.2, 3.0)), 2), [(20, 1.0)]))}
    for i, n in enumerate(parts):
        d = 1 if i % 2 == 0 else -1
        a["bones"][n] = {
            "translate": trans(seg(bake(0, 12, lambda r: (0, 24 * math.sin(math.pi * r)), 2), [(20, (0, 0))])),
            "rotate": rot(seg(hold(0, 10 + i), bake(10 + i, 19, lambda r, d=d: 6 * d * damped_sin(r, 1.2, 3.0), 2), [(20, 0.0)])),
        }
        a["slots"][n] = {"color": color(seg(
            [(0, 0.2), (9 + i, 0.2)], bake(10 + i, 18, lambda r: 0.2 + 0.8 * ease_out_quad(r), 2), [(20, 1.0)]))}
    return a


def base_destroy(parts, canvas_max=320, spin=190, style="scatter"):
    """Ends fully invisible (validator E6). `style` shapes the exit:
    scatter = fly apart, collapse = crush inward, sink = drop away.

    `shine` is treated as a flying shard alongside the sparkles — it must fade
    out too or E6 fails (every slot has to reach alpha 00)."""
    parts = ["shine", *parts]
    a = {"bones": {}, "slots": {}}
    a["bones"]["symbol_anchor"] = {"scale": scale(seg(
        bake(0, 4, lambda r: 1 + 0.14 * ease_out_cubic(r), 1),
        bake(4, 26, lambda r: 1.14 + 0.10 * r, 4)))}
    if style == "collapse":
        body_scale = bake(4, 26, lambda r: max(0.02, 1 - 0.98 * ease_in_quad(r)), 2)
        body_rot = bake(4, 26, lambda r, s=spin: s * ease_in_quad(r), 2)
        body_tr = None
    elif style == "sink":
        body_scale = bake(4, 26, lambda r: max(0.05, 1 - 0.55 * ease_in_quad(r)), 3)
        body_rot = bake(4, 26, lambda r: 22 * ease_in_quad(r), 3)
        body_tr = bake(4, 26, lambda r: (0, -canvas_max * 0.7 * ease_in_cubic(r)), 2)
    else:  # scatter
        body_scale = bake(4, 26, lambda r: max(0.05, 1 - 0.7 * ease_in_quad(r)), 3)
        body_rot = bake(4, 26, lambda r, s=spin: s * 0.6 * ease_in_quad(r), 3)
        body_tr = None
    a["bones"]["body"] = {"rotate": rot(seg(hold(0, 4), body_rot)),
                          "scale": scale(seg(hold(0, 4, 1.0), body_scale))}
    if body_tr:
        a["bones"]["body"]["translate"] = trans(seg(hold(0, 4, (0, 0)), body_tr))
    a["slots"]["body"] = {"color": color(seg(
        hold(0, 10, 1.0), bake(10, 22, lambda r: 1 - ease_in_quad(r), 2), [(26, 0.0)]))}
    a["bones"]["glow"] = {"scale": scale(seg(
        bake(0, 4, lambda r: 1 + 0.3 * ease_out_cubic(r), 1),
        bake(4, 24, lambda r: 1.3 + 0.9 * ease_out_quad(r), 2)))}
    a["slots"]["glow"] = {"color": color(seg(
        hold(0, 6, 1.0), bake(6, 20, lambda r: 1 - ease_in_quad(r), 2), [(26, 0.0)]))}
    for i, n in enumerate(parts):
        d = 1 if i % 2 == 0 else -1
        ang = i * 2.39996
        ux, uy = math.cos(ang), math.sin(ang)
        dist = canvas_max * 0.5
        st = i % 3
        a["bones"][n] = {
            "translate": trans(seg(hold(0, 3, (0, 0)), bake(
                3, 26, lambda r, ux=ux, uy=uy, ds=dist: (ux * ds * ease_in_cubic(r), uy * ds * ease_in_cubic(r)), 2))),
            "rotate": rot(seg(hold(0, 3), bake(3, 26, lambda r, d=d: 170 * d * ease_in_quad(r), 2))),
            "scale": scale(seg(bake(0, 4, lambda r: 1 + 0.4 * ease_out_cubic(r), 2),
                               bake(4, 26, lambda r: 1.4 - 0.9 * ease_in_quad(r), 4))),
        }
        a["slots"][n] = {"color": color(seg(
            hold(0, 8 + st * 2, 1.0), bake(8 + st * 2, 20 + st * 2, lambda r: 1 - ease_in_quad(r), 2), [(26, 0.0)]))}
    return a


# ── per-symbol idle + win ────────────────────────────────────────────────────
def _idle(anchor_scale=0.012, anchor_bob=0.0, body=None, glow=(0.07, 0.45),
          shine=(2, 2.0, 0.65, 0.08), sparks=(), spark_cycles=2, spark_amp=0.55, spark_spin=12):
    a = {"bones": {}, "slots": {}}
    anc = {"scale": scale(bake(0, 72, lambda r: 1 + anchor_scale * math.sin(TAU * r), 3))}
    if anchor_bob:
        anc["translate"] = trans(bake(0, 72, loopy(lambda r: (0, anchor_bob * math.sin(TAU * r + 0.9))), 3))
    a["bones"]["symbol_anchor"] = anc
    if body:
        a["bones"]["body"] = body
    glow_breathe(a, glow[0], glow[1])
    shine_sweep(a, shine[0], shine[1], shine[2], shine[3])
    sparkle_idle(a, sparks, spark_cycles, spark_amp, spark_spin)
    return a


def _win(anchor, body=None, glow=0.5, shine_start=4, sparks=(), dirs=None,
         spin=40, dist=12, dur=40, extra_slots=None):
    a = {"bones": {"symbol_anchor": {"scale": scale(anchor)}}, "slots": {}}
    if body:
        a["bones"]["body"] = body
    glow_flare(a, glow, 4, dur)
    shine_strobe(a, shine_start, dur)
    sparkle_burst(a, sparks, dirs, 5, spin, dist, dur)
    if extra_slots:
        a["slots"].update(extra_slots)
    return a


def pop_anchor(dip=0.08, pop=0.24, dur=40):
    return seg(
        bake(0, 4, lambda r: 1 - dip * ease_in_quad(r), 1),
        bake(4, 10, lambda r: (1 - dip) + (dip + pop) * ease_out_cubic(r), 1),
        bake(10, dur - 2, lambda r: 1 + (pop * 0.66) * damped(r, 1.3, 3.4), 2),
        [(dur, 1.0)])


def rot_keys(segments):
    return rot(seg(*segments))


MOTION = {}


def motion(name):
    def deco(fn):
        MOTION[name] = fn
        return fn
    return deco


# ---- LOW TIER --------------------------------------------------------------
@motion("brass_knuckles")
def _brass(sparks, ch, cmax):
    """Heavy knuckle-duster: rocks with weight, then THRUSTS forward like a punch."""
    idle = _idle(0.010, 1.8, body={"rotate": rot(bake(0, 72, loopy(lambda r: 2.2 * math.sin(TAU * r + 0.6)), 3))},
                 glow=(0.06, 0.40), shine=(2, 1.4, 0.55, 0.06), sparks=sparks, spark_spin=10)
    # punch: wind back (small counter-move), drive forward hard, impact shudder
    win = _win(pop_anchor(0.10, 0.26),
               body={"translate": trans(seg(
                         bake(0, 5, lambda r: (-7 * ease_in_quad(r), 3 * ease_in_quad(r)), 1),
                         bake(5, 11, lambda r: (-7 + 20 * ease_out_cubic(r), 3 - 8 * ease_out_cubic(r)), 1),
                         bake(11, 38, lambda r: (13 * damped(r, 1.4, 3.6), -5 * damped(r, 1.4, 3.6)), 2),
                         [(40, (0, 0))])),
                     "rotate": rot(seg(
                         bake(0, 5, lambda r: 5 * ease_in_quad(r), 1),
                         bake(5, 11, lambda r: 5 - 13 * ease_out_cubic(r), 1),
                         bake(11, 38, lambda r: -8 * damped(r, 1.5, 3.8), 2),
                         [(40, 0.0)]))},
               glow=0.45, sparks=sparks, dirs={sparks[0]: (1.0, -0.5)} if sparks else None, spin=30, dist=16)
    return idle, win, base_drop(2.5, ch, (1.16, 0.84), sparks), base_destroy(sparks, cmax, 170, "scatter")


@motion("knife")
def _knife(sparks, ch, cmax):
    """Switchblade: slow menacing tilt, then a fast blade FLIP with a glint."""
    idle = _idle(0.009, 2.2, body={"rotate": rot(bake(0, 72, loopy(lambda r: 3.0 * math.sin(TAU * r + 0.4)), 3))},
                 glow=(0.06, 0.42), shine=(3, 0.8, 0.75, 0.10), sparks=sparks, spark_cycles=3, spark_spin=16)
    # flip: coil back then a full 360 spin that lands clean. smoothstep (not
    # ease_out_cubic) keeps the fastest frame near 38 deg instead of 71.
    win = _win(pop_anchor(0.09, 0.20),
               body={"rotate": rot(seg(
                         bake(0, 5, lambda r: -22 * ease_in_quad(r), 1),
                         bake(5, 22, lambda r: -22 + 382 * smoothstep(r), 1),
                         bake(22, 38, lambda r: 360 + 8 * damped(r, 1.2, 3.4), 2),
                         [(40, 360.0)]))},
               glow=0.40, shine_start=14, sparks=sparks, spin=25, dist=14)
    return idle, win, base_drop(3.0, ch, (1.12, 0.88), sparks), base_destroy(sparks, cmax, 210, "scatter")


# ---- MID TIER --------------------------------------------------------------
@motion("pistol")
def _pistol(sparks, ch, cmax):
    """Firearm: steady aim, then RECOIL — slide kicks back and up, muzzle flash."""
    idle = _idle(0.010, 1.5, body={"rotate": rot(bake(0, 72, loopy(lambda r: 1.4 * math.sin(TAU * r + 0.8)), 3))},
                 glow=(0.06, 0.42), shine=(2, 1.8, 0.60, 0.07), sparks=sparks, spark_spin=8)
    # recoil: 2f snap back+up, muzzle flare, then damped return to aim
    win = _win(pop_anchor(0.07, 0.22),
               body={"translate": trans(seg(
                         hold(0, 4, (0, 0)),
                         bake(4, 7, lambda r: (-16 * ease_out_quad(r), 9 * ease_out_quad(r)), 1),
                         bake(7, 38, lambda r: (-16 * damped(r, 1.1, 3.0), 9 * damped(r, 1.1, 3.0)), 2),
                         [(40, (0, 0))])),
                     "rotate": rot(seg(
                         hold(0, 4),
                         bake(4, 7, lambda r: -14 * ease_out_quad(r), 1),
                         bake(7, 38, lambda r: -14 * damped(r, 1.2, 3.2), 2),
                         [(40, 0.0)]))},
               glow=0.55, shine_start=4,
               sparks=sparks, dirs={sparks[0]: (-1.0, 0.35)} if sparks else None, spin=20, dist=20)
    return idle, win, base_drop(2.2, ch, (1.15, 0.85), sparks), base_destroy(sparks, cmax, 160, "scatter")


@motion("ammo")
def _ammo(sparks, ch, cmax):
    """Loose cartridges: they ROLL in place, then jolt and scatter-glint on a win."""
    idle = _idle(0.011, 2.0, body={"rotate": rot(bake(0, 72, loopy(lambda r: 3.4 * math.sin(TAU * r + 1.2)), 3))},
                 glow=(0.07, 0.45), shine=(2, 2.4, 0.60, 0.08), sparks=sparks, spark_cycles=3)
    # jolt: cartridges kick up and rattle back down
    win = _win(pop_anchor(0.08, 0.24),
               body={"translate": trans(seg(
                         hold(0, 4, (0, 0)),
                         bake(4, 10, lambda r: (0, 13 * ease_out_quad(r)), 1),
                         bake(10, 38, lambda r: (0, 13 * damped(r, 1.6, 3.0)), 2),
                         [(40, (0, 0))])),
                     "rotate": rot(seg(
                         hold(0, 4),
                         bake(4, 10, lambda r: 16 * ease_out_cubic(r), 1),
                         bake(10, 38, lambda r: 16 * damped(r, 1.7, 3.2), 2),
                         [(40, 0.0)]))},
               glow=0.45, sparks=sparks, spin=45, dist=15)
    return idle, win, base_drop(4.5, ch, (1.18, 0.82), sparks), base_destroy(sparks, cmax, 240, "scatter")


@motion("duffel")
def _duffel(sparks, ch, cmax):
    """Stuffed soft bag: BREATHES as if crammed with cash, then bulges and bursts."""
    idle = _idle(0.016, 1.4,
                 body={"scale": scale(bake(0, 72, lambda r: 1 + 0.018 * math.sin(TAU * r + 0.3), 3)),
                       "rotate": rot(bake(0, 72, loopy(lambda r: 1.6 * math.sin(TAU * r + 1.4)), 3))},
                 glow=(0.06, 0.40), shine=(2, 1.0, 0.50, 0.06), sparks=sparks, spark_spin=9)
    # bulge: squash then swell fat (soft, non-rigid overshoot)
    win = _win(pop_anchor(0.10, 0.20),
               body={"scale": scale(seg(
                         bake(0, 5, lambda r: 1 - 0.06 * ease_in_quad(r), 1),
                         bake(5, 12, lambda r: 0.94 + 0.22 * ease_out_quad(r), 1),
                         bake(12, 38, lambda r: 1 + 0.16 * damped(r, 1.1, 2.4), 2),
                         [(40, 1.0)])),
                     "rotate": rot(seg(
                         hold(0, 5),
                         bake(5, 14, lambda r: 6 * ease_out_cubic(r), 2),
                         bake(14, 38, lambda r: 6 * damped(r, 1.0, 2.6), 2),
                         [(40, 0.0)]))},
               glow=0.45, sparks=sparks, spin=35, dist=14)
    return idle, win, base_drop(6.0, ch, (1.20, 0.80), sparks), base_destroy(sparks, cmax, 150, "scatter")


# ---- PREMIUM TIER ----------------------------------------------------------
@motion("cash")
def _cash(sparks, ch, cmax):
    """Banknote stack: bills RIFFLE (fan across, springy) and flutter on a win."""
    idle = _idle(0.013, 2.4,
                 body={"scale": scale(bake(0, 72, lambda r: 1 + 0.014 * math.sin(math.pi * 4 * r) ** 2, 2)),
                       "rotate": rot(bake(0, 72, loopy(lambda r: 2.0 * math.sin(TAU * r + 0.7)), 3))},
                 glow=(0.08, 0.48), shine=(2, 2.0, 0.70, 0.09), sparks=sparks, spark_cycles=3, spark_amp=0.62)
    # riffle: rapid x-squash flutter through the pop, like thumbing a stack
    win = _win(pop_anchor(0.09, 0.26),
               body={"scale": scale(seg(
                         hold(0, 4, 1.0),
                         bake(4, 20, lambda r: 1 + 0.10 * math.sin(math.pi * 5 * r) * (1 - r), 1),
                         [(40, 1.0)])),
                     "rotate": rot(seg(
                         bake(0, 4, lambda r: -4 * ease_in_quad(r), 1),
                         bake(4, 12, lambda r: -4 + 13 * ease_out_cubic(r), 1),
                         bake(12, 38, lambda r: 9 * damped(r, 1.3, 3.0), 2),
                         [(40, 0.0)]))},
               glow=0.55, sparks=sparks, spin=42, dist=16)
    return idle, win, base_drop(5.0, ch, (1.17, 0.83), sparks), base_destroy(sparks, cmax, 200, "scatter")


@motion("bike")
def _bike(sparks, ch, cmax):
    """Superbike: engine IDLE VIBRATION, then a rev + wheelie kick.

    The vibration is a fast 6-cycle micro-jitter (engine at rest), deliberately
    different from every other symbol's slow 1-cycle sway."""
    idle = _idle(0.010, 1.2,
                 body={"translate": trans(bake(0, 72, loopy(lambda r: (0, 0.9 * math.sin(TAU * 6 * r))), 1)),
                       "rotate": rot(bake(0, 72, loopy(lambda r: 1.3 * math.sin(TAU * r + 0.5)
                                                       + 0.35 * math.sin(TAU * 6 * r)), 1))},
                 glow=(0.07, 0.45), shine=(2, 1.6, 0.60, 0.08), sparks=sparks, spark_spin=11)
    # wheelie: nose lifts, front end rises, lands with suspension recovery
    win = _win(pop_anchor(0.08, 0.24),
               body={"rotate": rot(seg(
                         bake(0, 5, lambda r: 4 * ease_in_quad(r), 1),
                         bake(5, 14, lambda r: 4 - 22 * ease_out_cubic(r), 1),
                         bake(14, 38, lambda r: -18 * damped(r, 1.2, 2.8), 2),
                         [(40, 0.0)])),
                     "translate": trans(seg(
                         hold(0, 5, (0, 0)),
                         bake(5, 14, lambda r: (6 * ease_out_cubic(r), 7 * ease_out_quad(r)), 2),
                         bake(14, 38, lambda r: (6 * damped(r, 1.2, 2.8), 7 * damped(r, 1.2, 2.8)), 2),
                         [(40, (0, 0))]))},
               glow=0.55, sparks=sparks, spin=38, dist=17)
    return idle, win, base_drop(3.2, ch, (1.16, 0.84), sparks), base_destroy(sparks, cmax, 230, "scatter")


# ---- SPECIALS --------------------------------------------------------------
@motion("wild_symbole")
def _wild(sparks, ch, cmax):
    """Fabric WILD: light cloth sway with a lazy secondary flutter.

    Keeps ONE glint, but paced as a neon-sign flicker (a single slow cycle,
    modest pop) rather than a twinkling star — the cartoon version fought the
    GTA tone."""
    idle = _idle(0.014, 2.8,
                 body={"rotate": rot(bake(0, 72, loopy(lambda r: 2.4 * math.sin(TAU * r + 0.5)
                                                       + 0.8 * math.sin(TAU * 2 * r)), 2)),
                       "scale": scale(bake(0, 72, lambda r: 1 + 0.012 * math.sin(TAU * 2 * r + 1.0), 3))},
                 glow=(0.09, 0.50), shine=(2, 2.2, 0.70, 0.09), sparks=sparks,
                 spark_cycles=1, spark_amp=0.34, spark_spin=6)
    win = _win(pop_anchor(0.09, 0.28),
               body={"rotate": rot(seg(
                         bake(0, 5, lambda r: -6 * ease_in_quad(r), 1),
                         bake(5, 14, lambda r: -6 + 16 * ease_out_cubic(r), 1),
                         bake(14, 38, lambda r: 10 * damped(r, 1.0, 2.4), 2),
                         [(40, 0.0)]))},
               glow=0.60, sparks=sparks, spin=44, dist=16)
    return idle, win, base_drop(6.5, ch, (1.18, 0.82), sparks), base_destroy(sparks, cmax, 190, "scatter")


@motion("cyan_car_wild")
def _phone(sparks, ch, cmax):
    """Flip phone: sits quiet with a pulsing screen, then RINGS — buzzing hard.

    The win is a high-frequency vibrate (13 cycles) — nothing else on the board
    moves like a phone rattling on a table."""
    idle = _idle(0.010, 1.6,
                 body={"rotate": rot(bake(0, 72, loopy(lambda r: 1.8 * math.sin(TAU * r + 0.9)), 3))},
                 glow=(0.08, 0.55), shine=(4, 1.2, 0.80, 0.10), sparks=sparks, spark_cycles=4, spark_spin=14)
    # ring: violent buzz that decays, screen strobing
    win = _win(pop_anchor(0.07, 0.20),
               body={"translate": trans(seg(
                         hold(0, 3, (0, 0)),
                         bake(3, 30, lambda r: (3.5 * math.sin(TAU * 13 * r) * (1 - r),
                                                2.2 * math.sin(TAU * 9 * r + 1.1) * (1 - r)), 1),
                         [(40, (0, 0))])),
                     "rotate": rot(seg(
                         hold(0, 3),
                         bake(3, 30, lambda r: 5.0 * math.sin(TAU * 11 * r) * (1 - r), 1),
                         [(40, 0.0)]))},
               glow=0.60, shine_start=3, sparks=sparks, spin=30, dist=13)
    return idle, win, base_drop(4.0, ch, (1.14, 0.86), sparks), base_destroy(sparks, cmax, 200, "scatter")


@motion("burner_phone")
def _truck(sparks, ch, cmax):
    """Armored truck (scatter): heavy suspension BOB, then lurches forward.

    It is the bonus trigger, so the win is the most emphatic on the board."""
    idle = _idle(0.009, 2.6,
                 body={"translate": trans(bake(0, 72, loopy(lambda r: (0, 1.6 * math.sin(TAU * 2 * r))), 2)),
                       "rotate": rot(bake(0, 72, loopy(lambda r: 1.5 * math.sin(TAU * r + 0.2)), 3))},
                 glow=(0.08, 0.50), shine=(2, 1.5, 0.60, 0.08), sparks=sparks, spark_spin=10)
    # lurch: rocks back on its suspension then drives forward hard
    win = _win(pop_anchor(0.09, 0.30),
               body={"rotate": rot(seg(
                         bake(0, 6, lambda r: 5 * ease_in_quad(r), 1),
                         bake(6, 15, lambda r: 5 - 14 * ease_out_cubic(r), 1),
                         bake(15, 38, lambda r: -9 * damped(r, 1.1, 2.6), 2),
                         [(40, 0.0)])),
                     "translate": trans(seg(
                         bake(0, 6, lambda r: (-6 * ease_in_quad(r), 0), 1),
                         bake(6, 15, lambda r: (-6 + 18 * ease_out_cubic(r), 4 * ease_out_quad(r)), 2),
                         bake(15, 38, lambda r: (12 * damped(r, 1.1, 2.6), 4 * damped(r, 1.1, 2.6)), 2),
                         [(40, (0, 0))]))},
               glow=0.70, sparks=sparks, spin=40, dist=18)
    return idle, win, base_drop(3.8, ch, (1.20, 0.80), sparks), base_destroy(sparks, cmax, 175, "scatter")


# ---- BONUS -----------------------------------------------------------------
@motion("safe")
def _safe(sparks, ch, cmax):
    """Vault: barely moves (it is a block of steel) — the DIAL spins instead.

    Rigid on purpose: <1 deg of sway sells mass. The win cracks it open."""
    idle = _idle(0.007, 0.8,
                 body={"rotate": rot(bake(0, 72, loopy(lambda r: 0.8 * math.sin(TAU * r + 0.3)), 3))},
                 glow=(0.06, 0.42), shine=(2, 1.2, 0.55, 0.06), sparks=sparks, spark_cycles=2, spark_spin=26)
    # crack: dial-spin wind-up (sparkles whirl), then the door pops
    win = _win(pop_anchor(0.06, 0.22),
               body={"scale": scale(seg(
                         bake(0, 6, lambda r: 1 - 0.05 * ease_in_quad(r), 1),
                         bake(6, 13, lambda r: 0.95 + 0.17 * ease_out_cubic(r), 1),
                         bake(13, 38, lambda r: 1 + 0.10 * damped(r, 1.2, 3.0), 2),
                         [(40, 1.0)])),
                     "rotate": rot(seg(
                         hold(0, 6),
                         bake(6, 13, lambda r: 4 * ease_out_cubic(r), 1),
                         bake(13, 38, lambda r: 4 * damped(r, 1.3, 3.4), 2),
                         [(40, 0.0)]))},
               glow=0.65, sparks=sparks, spin=150, dist=13)  # spin=150: dial whirl
    return idle, win, base_drop(1.6, ch, (1.13, 0.87), sparks), base_destroy(sparks, cmax, 120, "collapse")


@motion("master_key")
def _key(sparks, ch, cmax):
    """Master key: floats with an arcane shimmer, then TURNS like in a lock."""
    idle = _idle(0.011, 3.0,
                 body={"rotate": rot(bake(0, 72, loopy(lambda r: 3.2 * math.sin(TAU * r + 1.1)), 3))},
                 glow=(0.10, 0.55), shine=(3, 1.0, 0.75, 0.10), sparks=sparks, spark_cycles=3, spark_amp=0.62, spark_spin=18)
    # turn: hesitate, then rotate 90 deg like throwing a bolt, and settle back
    win = _win(pop_anchor(0.08, 0.22),
               body={"rotate": rot(seg(
                         bake(0, 6, lambda r: -10 * ease_in_quad(r), 1),
                         bake(6, 18, lambda r: -10 + 100 * ease_out_cubic(r), 1),
                         bake(18, 34, lambda r: 90 - 90 * ease_out_quad(r), 2),
                         [(40, 0.0)]))},
               glow=0.65, shine_start=6, sparks=sparks, spin=60, dist=15)
    return idle, win, base_drop(2.8, ch, (1.14, 0.86), sparks), base_destroy(sparks, cmax, 260, "scatter")


def build_for(name, sparks, canvas_h, canvas_max):
    """Return {idle, win, drop, destroy} for `name`, falling back to a neutral
    but still eased/staggered personality for anything not listed above."""
    if name in MOTION:
        idle, win, drop, destroy = MOTION[name](sparks, canvas_h, canvas_max)
    else:
        idle = _idle(0.012, 2.0,
                     body={"rotate": rot(bake(0, 72, loopy(lambda r: 2.0 * math.sin(TAU * r + 0.6)), 3))},
                     sparks=sparks)
        win = _win(pop_anchor(), body={"rotate": rot(seg(
            bake(0, 4, lambda r: -3 * ease_in_quad(r), 1),
            bake(4, 12, lambda r: -3 + 9 * ease_out_cubic(r), 1),
            bake(12, 38, lambda r: 6 * damped(r, 1.2, 3.2), 2),
            [(40, 0.0)]))}, sparks=sparks)
        drop = base_drop(3.5, canvas_h, (1.15, 0.85), sparks)
        destroy = base_destroy(sparks, canvas_max, 190, "scatter")
    return {"idle": idle, "win": win, "drop": drop, "destroy": destroy}
