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
import inspect
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
from anim_lib import (T, bake, color, damped, damped_sin, ease_in_cubic, ease_in_quad,  # noqa: E402
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


def glow_flare(anim, amount=0.5, start=4, dur=40, name="glow"):
    anim["bones"][name] = {"scale": scale(seg(
        bake(0, start, lambda r: 1 - 0.10 * ease_in_quad(r), 1),
        bake(start, start + 8, lambda r, a=amount: 0.90 + (0.10 + a) * ease_out_quad(r), 2),
        bake(start + 8, dur - 2, lambda r, a=amount: 1 + a * damped(r, 0.9, 2.6), 2),
        [(dur, 1.0)]))}
    anim["slots"][name] = {"color": color(seg(
        bake(0, start, lambda r: 1 - 0.35 * r, 1),
        bake(start, start + 6, lambda r: 0.65 + 0.35 * ease_out_quad(r), 2),
        hold(start + 8, dur, 1.0)))}


def glow_breathe(anim, amp=0.07, dim=0.45, name="glow"):
    anim["bones"][name] = {"scale": scale(bake(0, 72, lambda r: 1 + amp * math.sin(math.pi * 2 * r + 1.1) ** 2, 3))}
    anim["slots"][name] = {"color": color(bake(0, 72, lambda r: 1 - dim * math.sin(math.pi * 2 * r + 1.1) ** 2, 3))}


def shine_sweep(anim, cycles=2, phase=2.0, dim=0.65, amp=0.08, name="shine"):
    anim["bones"][name] = {"scale": scale(bake(0, 72, lambda r: 1 + amp * math.sin(math.pi * cycles * r + phase) ** 2, 3))}
    anim["slots"][name] = {"color": color(bake(0, 72, lambda r: 1 - dim * math.sin(math.pi * cycles * r + phase) ** 4, 3))}


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
    drop = base_drop(3.8, ch, (1.20, 0.80), sparks)
    destroy = base_destroy(sparks, cmax, 175, "scatter")

    # drive_off (30f, one-shot): the rev BEFORE the getaway. Played when 3+
    # scatters trigger the bonus, while the game tweens the whole symbol off the
    # board — so this stays IN PLACE: squat onto the suspension, nose up, and a
    # high-frequency engine shudder that builds instead of decaying. The exit
    # motion itself belongs to the container, not the rig.
    rev = {"bones": {}, "slots": {}}
    rev["bones"]["body"] = {
        "rotate": rot(seg(
            bake(0, 5, lambda r: 3.5 * ease_out_quad(r), 1),           # squat back
            bake(5, 30, lambda r: 3.5 - 9.5 * ease_out_cubic(r)        # nose lifts
                 + 1.8 * math.sin(TAU * 11 * r) * r, 1))),             # shudder builds
        "translate": trans(seg(
            bake(0, 5, lambda r: (-5 * ease_out_quad(r), 0), 1),       # rock back
            bake(5, 30, lambda r: (-5 + 3 * ease_out_quad(r),
                                   1.2 * math.sin(TAU * 13 * r) * r), 1))),
    }
    rev["bones"]["glow"] = {"scale": scale(seg(
        bake(0, 12, lambda r: 1 + 0.55 * ease_out_quad(r), 2),
        bake(12, 30, lambda r: 1.55 + 0.25 * math.sin(TAU * 3 * r) ** 2, 2)))}
    rev["slots"]["glow"] = {"color": color(seg(
        bake(0, 8, lambda r: 0.6 + 0.4 * ease_out_quad(r), 2), hold(10, 30, 1.0)))}
    rev["slots"]["shine"] = {"color": color(bake(
        0, 30, lambda r: 0.5 + 0.5 * abs(math.sin(TAU * 4 * r)), 1))}
    # land (14f, one-shot): a loaded armoured truck coming to rest in a
    # cascade — the suspension takes the weight (squat, rebound, settle) and
    # the box rocks once. `base` pivots at the ground (rig.json), so it squats
    # INTO the road. Additive: idle / win / destroy / drive_off are unchanged.
    L = 14
    susp = lambda f: (1.0 if f <= 0 else
                      1 - 0.075 * math.sin(math.pi * min(1.0, f / 5)) if f <= 5 else
                      1 + 0.022 * damped_sin((f - 5) / (L - 5), 1.0, 3.6) * (1 - (f - 5) / (L - 5)))
    land = {"bones": {
        "base": {"scale": scale([(f, (1 + (1 - susp(f)) * 0.25, susp(f))) for f in range(L + 1)])},
        "body": {"rotate": rot([(f, 1.1 * damped_sin(f / L, 1.1, 3.4) * (1 - f / L)) for f in range(L + 1)])},
    }, "slots": {}, "events": [{"time": 0.0, "name": "thud"}]}
    extra = {"drive_off": rev, "land": land}

    return idle, win, drop, destroy, extra


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


# ══ SEMANTIC PERSONALITIES ══════════════════════════════════════════════════
# Rigs built from real moving parts (semantic/make_layers.mjs). Clip contract,
# matched by the runtime (src/pixi/symbolFlow.ts):
#   idle     seamless loop
#   win      anticipation -> signature action -> settles INTO hold's first pose
#   hold     short seamless loop: the presented pose while the win is read,
#            kept until destroy (removed) or released back to idle (survived)
#   land     touchdown impact; starts AND ends at rest — the board already did
#            the fall, so the clip never moves the symbol down itself
#   destroy  signature exit; every slot ends at alpha 00
# Authored at real time (the runtime plays them 1x, turbo 1.8x). Timing
# hierarchy: low tier snappy, premium longer and more elegant.
#
# Channels are written as functions of the FRAME (pw() pieces them together)
# and sampled per frame, so choreography can ask "where is the muzzle at f7?"
# and hand that to a part that is not attached to the gun (the casing, smoke).

def pw(*segs):
    """Piecewise function of frame f from contiguous (f0, f1, g(r)) pieces."""
    def fn(f):
        for f0, f1, g in segs:
            if f <= f1:
                r = 0.0 if f1 == f0 else max(0.0, min(1.0, (f - f0) / (f1 - f0)))
                return g(r)
        return segs[-1][2](1.0)
    return fn


def _sample(fn, n, step=1, f0=0):
    keys = [(f, fn(f)) for f in range(f0, n, step)]
    keys.append((n, fn(n)))
    return keys


def R(fn, n, step=1, f0=0):
    return rot(_sample(fn, n, step, f0))


def TR(fn, n, step=1, f0=0):
    return trans(_sample(fn, n, step, f0))


def SC(fn, n, step=1, f0=0):
    return scale(_sample(fn, n, step, f0))


def A(fn, n, step=1, f0=0):
    return color(_sample(fn, n, step, f0))


def events(*pairs):
    return [{"time": T(f), "name": name} for f, name in pairs]


def lerp(a, b, r):
    return a + (b - a) * r


def ease_in_out(r):
    return r * r * (3 - 2 * r)


def rot_about(p, c, deg):
    """Rotate point p about c by deg (Spine: CCW positive, y up)."""
    a = math.radians(deg)
    dx, dy = p[0] - c[0], p[1] - c[1]
    return (c[0] + dx * math.cos(a) - dy * math.sin(a), c[1] + dx * math.sin(a) + dy * math.cos(a))


def seal_destroy(anim, slots, end):
    """E6: every slot must END invisible. Slots a destroy never touched (e.g.
    FX that are hidden at rest) get an explicit 0 -> 0 alpha key."""
    for s in slots:
        if s not in anim["slots"]:
            anim["slots"][s] = {"color": color([(0, 0.0), (end, 0.0)])}


def blank_anim():
    return {"bones": {}, "slots": {}}


# ---- PISTOL (mid) ----------------------------------------------------------
@motion("pistol")
def _pistol(sparks, ch, cmax, ctx):
    """Semi-auto pistol. Parts: gun group (pivot at the grip) > frame, slide,
    barrel_tip, flash; casing and smoke live in world space.

    win      aim-settle -> SHOT: 1-frame muzzle flash, slide cycles back along
             the rail and slams home, muzzle flips up about the grip, a brass
             casing ejects from the port on a real arc, smoke curls off the
             muzzle -> rigid settle into the held aim.
    land     rigid mechanical clack: tiny squash, slide rattles on its rails.
    destroy  the slide slams back and LOCKS (empty), then the gun comes apart:
             slide flies off the rear, the frame — barrel and spring exposed —
             drops away muzzle-first."""
    meta, slots = ctx["meta"], ctx["slots"]
    ax, ay = meta["axis"]            # rearward along the rail (Spine, y up)
    D = meta["travel"]
    grip, muzzle, port = meta["grip"], meta["muzzle"], meta["port"]

    def along(d):
        return (ax * d, ay * d)

    out = {}

    # ── idle 72f: steady aim, muzzle micro-drift ──
    idle = blank_anim()
    idle["bones"]["symbol_anchor"] = {
        "scale": scale(bake(0, 72, lambda r: 1 + 0.008 * math.sin(TAU * r), 3)),
        "translate": trans(bake(0, 72, loopy(lambda r: (0, 1.4 * math.sin(TAU * r + 0.9))), 3))}
    idle["bones"]["gun"] = {"rotate": rot(bake(0, 72, loopy(
        lambda r: 1.2 * math.sin(TAU * r + 0.8) + 0.22 * math.sin(TAU * 3 * r)), 2))}
    glow_breathe(idle, 0.06, 0.42)
    shine_sweep(idle, 2, 1.8, 0.60, 0.0, name="slide_shine")
    out["idle"] = idle

    # ── win 32f ──
    N, F = 32, 5                     # F = the shot
    HOLD_GLOW = 1.04
    gun_rot = pw((0, F, lambda r: 2.2 * ease_in_quad(r)),                   # muzzle dips: aiming in
                 (F, F + 2, lambda r: lerp(2.2, -13.0, ease_out_quad(r))),  # muzzle flip
                 (F + 2, 24, lambda r: -13.0 * damped(r, 1.1, 4.4)),        # rigid return
                 (24, N, lambda r: 0.0))
    gun_tr = pw((0, F, lambda r: (-3.0 * ease_in_quad(r), -1.0 * ease_in_quad(r))),
                (F, F + 2, lambda r: (lerp(-3, 15, ease_out_quad(r)), lerp(-1, 5, ease_out_quad(r)))),
                (F + 2, 24, lambda r: (15 * damped(r, 1.0, 4.4), 5 * damped(r, 1.0, 4.4))),
                (24, N, lambda r: (0.0, 0.0)))
    slide_d = pw((0, F, lambda r: 0.0),
                 (F, F + 2, lambda r: D * ease_out_quad(r)),                # cycles back
                 (F + 2, F + 3, lambda r: D),
                 (F + 3, F + 6, lambda r: D * (1 - ease_in_quad(r))),       # spring slams it home
                 (F + 6, F + 10, lambda r: -2.6 * damped_sin(r, 1.0, 3.2)),  # battery clack
                 (F + 10, N, lambda r: 0.0))

    def gun_world(p, f, slide=0.0):
        q = (p[0] + ax * slide, p[1] + ay * slide)
        q = rot_about(q, grip, gun_rot(f))
        t = gun_tr(f)
        return (q[0] + t[0], q[1] + t[1])

    win = blank_anim()
    win["bones"]["symbol_anchor"] = {"scale": SC(pw(
        (0, F, lambda r: 1 - 0.02 * ease_in_quad(r)),
        (F, F + 2, lambda r: lerp(0.98, 1.04, ease_out_quad(r))),
        (F + 2, 16, lambda r: 1 + 0.04 * damped(r, 0.8, 4.0)),
        (16, N, lambda r: 1.0)), N)}
    win["bones"]["gun"] = {"rotate": R(gun_rot, N), "translate": TR(gun_tr, N)}
    win["bones"]["slide"] = {"translate": TR(lambda f: along(slide_d(f)), N)}
    win["slots"]["barrel_tip"] = {"color": A(lambda f: 1.0 if slide_d(f) > 0.5 else 0.0, N)}
    # muzzle flash: 1 frame to full, 3 frames of life, scaled out of the bore
    win["slots"]["flash"] = {"color": color([(0, 0.0), (F, 0.0), (F + 1, 1.0), (F + 2, 1.0), (F + 4, 0.0), (N, 0.0)])}
    win["bones"]["flash"] = {"scale": scale([(0, 0.5), (F, 0.5), (F + 1, 1.12), (F + 2, 1.0), (F + 4, 0.72), (N, 0.72)]),
                             "rotate": rot([(0, 0.0), (F + 1, 3.0), (F + 2, -2.0), (F + 4, 0.0), (N, 0.0)])}
    # casing: ejected from wherever the port IS at the moment the slide opens
    c0f = F + 1
    c0 = gun_world(port, c0f, slide_d(c0f))
    cdx, cdy = c0[0] - port[0], c0[1] - port[1]
    cEnd = 20

    def casing_pos(f):
        r = max(0.0, min(1.0, (f - c0f) / (cEnd - c0f)))
        return (cdx + 128 * r, cdy + 250 * r - 300 * r * r)

    win["bones"]["casing"] = {
        "translate": TR(lambda f: casing_pos(f) if f >= c0f else (cdx, cdy), N),
        "rotate": R(lambda f: -980 * smoothstep(max(0.0, min(1.0, (f - c0f) / (cEnd - c0f)))), N)}
    win["slots"]["casing"] = {"color": color([(0, 0.0), (c0f - 1, 0.0), (c0f, 1.0), (cEnd - 4, 1.0), (cEnd, 0.0), (N, 0.0)])}
    # smoke curls off wherever the muzzle has flipped to
    for name, delay, drift, grow, peak in (("smoke_a", 1, (-30, 30), 1.9, 0.8), ("smoke_b", 4, (-10, 44), 2.2, 0.6)):
        s0f = F + delay
        m0 = gun_world(muzzle, s0f)
        odx, ody = m0[0] - muzzle[0], m0[1] - muzzle[1]
        win["bones"][name] = {
            "translate": TR(lambda f, s0f=s0f, odx=odx, ody=ody, drift=drift: (
                odx + drift[0] * ease_out_cubic(max(0.0, min(1.0, (f - s0f) / (N - s0f)))),
                ody + drift[1] * ease_out_quad(max(0.0, min(1.0, (f - s0f) / (N - s0f))))), N, 2),
            "scale": SC(lambda f, s0f=s0f, grow=grow: lerp(0.55, grow, ease_out_cubic(max(0.0, min(1.0, (f - s0f) / (N - s0f))))), N, 2),
            "rotate": R(lambda f, s0f=s0f: 24 * max(0.0, min(1.0, (f - s0f) / (N - s0f))), N, 2)}
        win["slots"][name] = {"color": color([(0, 0.0), (s0f, 0.0), (s0f + 2, peak), (s0f + 10, peak * 0.6), (N - 2, 0.0), (N, 0.0)])}
    win["bones"]["glow"] = {"scale": SC(pw(
        (0, F, lambda r: 1 - 0.05 * r),
        (F, F + 3, lambda r: lerp(0.95, 1.14, ease_out_quad(r))),
        (F + 3, 26, lambda r: lerp(1.14, HOLD_GLOW, ease_in_out(r))),
        (26, N, lambda r: HOLD_GLOW)), N, 2)}
    win["slots"]["glow"] = {"color": color([(0, 1.0), (F, 0.6), (F + 2, 0.85), (N, 0.85)])}
    win["slots"]["slide_shine"] = {"color": color([(0, 1.0), (F, 0.5), (F + 1, 1.0), (F + 3, 0.35), (F + 8, 1.0), (N, 1.0)])}
    win["events"] = events((F, "fire"), (c0f, "casing"), (cEnd - 1, "tink"))
    out["win"] = win

    # ── hold 30f: steady presented aim, lit ──
    hold_ = blank_anim()
    hold_["bones"]["gun"] = {"rotate": rot(bake(0, 30, loopy(lambda r: 0.55 * math.sin(TAU * r)), 2))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    hold_["slots"]["glow"] = {"color": color(bake(0, 30, lambda r: 0.85 - 0.15 * math.sin(math.pi * r) ** 2, 2))}
    hold_["slots"]["slide_shine"] = {"color": color(bake(0, 30, lambda r: 1 - 0.45 * math.sin(math.pi * r) ** 2, 2))}
    out["hold"] = hold_

    # ── land 10f: rigid mechanical clack ──
    L = 10
    land = blank_anim()
    land["bones"]["symbol_anchor"] = {"scale": SC(lambda f: (1 + 0.035 * damped_sin(f / L, 1.5, 6.5),
                                                             1 - 0.06 * damped_sin(f / L, 1.5, 6.5)), L)}
    land["bones"]["gun"] = {"rotate": R(lambda f: 2.0 * damped_sin(f / L, 2.2, 6.0), L)}
    land["bones"]["slide"] = {"translate": TR(lambda f: along(-4.5 * damped_sin(max(0.0, f - 1) / (L - 1), 2.0, 5.0)), L)}
    land["events"] = events((0, "impact"))
    out["land"] = land

    # ── destroy 18f: slide locks back, the gun comes apart ──
    N2 = 18
    # lock back (f0-2), a beat of "click, empty" (f2-4), then the slide pops
    # off the rear rails while the frame drops away muzzle-first.
    lock = pw((0, 2, lambda r: D * ease_out_quad(r)), (2, 4, lambda r: D),
              (4, N2, lambda r: D + 2.6 * D * ease_out_cubic(r)))

    def pop(f):
        return math.sin(math.pi * 0.85 * max(0.0, min(1.0, (f - 4) / (N2 - 4))))

    dst = blank_anim()
    dst["bones"]["slide"] = {
        "translate": TR(lambda f: (along(lock(f))[0] - ay * 58 * pop(f), along(lock(f))[1] + ax * 58 * pop(f)), N2),
        "rotate": R(pw((0, 4, lambda r: 0.0), (4, N2, lambda r: -28 * ease_out_quad(r))), N2)}
    dst["bones"]["gun"] = {
        "translate": TR(pw((0, 2, lambda r: (5 * ease_out_quad(r), 2 * ease_out_quad(r))),
                           (2, 4, lambda r: (5.0, 2.0)),
                           (4, N2, lambda r: (lerp(5, -26, ease_in_quad(r)), lerp(2, -200, ease_in_quad(r))))), N2),
        "rotate": R(pw((0, 2, lambda r: -3.5 * ease_out_quad(r)),
                       (2, 4, lambda r: -3.5),
                       (4, N2, lambda r: lerp(-3.5, 58, ease_in_quad(r)))), N2)}
    dst["slots"]["barrel_tip"] = {"color": color([(0, 0.0), (1, 1.0), (10, 1.0), (16, 0.0), (N2, 0.0)])}
    for s, f0, f1 in (("slide", 10, 16), ("slide_shine", 6, 11), ("frame", 10, 17)):
        dst["slots"][s] = {"color": color([(0, 1.0), (f0, 1.0), (f1, 0.0), (N2, 0.0)])}
    # the aura simply goes out with the gun — no generic flare
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (7, 0.0), (N2, 0.0)])}
    dst["events"] = events((1, "slidelock"), (4, "strip"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- AMMO (mid) ------------------------------------------------------------
def _hop(f, start, height, dur, bounces=((0.3, 0.55), (0.1, 0.35))):
    """Height (Spine y, up) of a hard little cylinder dropped on a table:
    one hop of `height` over `dur` frames, then decaying bounces (fraction of
    height, fraction of dur). 0 before `start` and after the last bounce."""
    t = f - start
    if t <= 0:
        return 0.0
    segs = [(height, dur)] + [(height * h, dur * d) for h, d in bounces]
    for h, d in segs:
        if t <= d:
            r = t / d
            return 4 * h * r * (1 - r)
        t -= d
    return 0.0


def _hop_end(start, dur, bounces=((0.3, 0.55), (0.1, 0.35))):
    return start + dur * (1 + sum(d for _, d in bounces))


@motion("ammo")
def _ammo(sparks, ch, cmax, ctx):
    """Loose 9mm rounds, each its own layer — they never move as one picture.

    win      the pile settles, then JOLTS: every round hops on its own beat,
             height and tilt, and rattles down in decaying clinks.
    land     independent chatter: each round bounces a few px out of phase.
    destroy  the rounds eject outward on separate ballistic arcs, spinning at
             different rates."""
    meta, slots = ctx["meta"], ctx["slots"]
    rounds = meta["rounds"]
    names = [r_["name"] for r_ in rounds]
    cx = sum(r_["centre"][0] for r_ in rounds) / len(rounds)
    cy = sum(r_["centre"][1] for r_ in rounds) / len(rounds)
    out = {}

    # ── idle 72f: rounds rock in place, out of phase ──
    idle = blank_anim()
    idle["bones"]["symbol_anchor"] = {"scale": scale(bake(0, 72, lambda r: 1 + 0.008 * math.sin(TAU * r), 3))}
    for i, n in enumerate(names):
        amp = 1.3 if rounds[i]["standing"] else 0.7
        ph = i * 1.7
        idle["bones"][n] = {
            "rotate": rot(bake(0, 72, loopy(lambda r, a=amp, ph=ph: a * math.sin(TAU * r + ph)), 3)),
            "translate": trans(bake(0, 72, loopy(lambda r, ph=ph: (0, 0.9 * math.sin(TAU * 2 * r + ph))), 3))}
    glow_breathe(idle, 0.06, 0.40)
    out["idle"] = idle

    # ── win 30f ──
    N, J = 30, 4                       # J = the jolt
    HOLD_GLOW = 1.04
    # per round: (start offset, hop height, hop frames, tilt deg, drift x)
    plan = {
        "round_front": (0, 44, 7, -13, -6),
        "round_mid": (1, 56, 8, 17, 4),
        "round_back": (2, 36, 7, -12, 7),
        "round_stand": (3, 64, 9, 19, -4),
    }
    win = blank_anim()
    win["bones"]["symbol_anchor"] = {"scale": SC(pw(
        (0, J, lambda r: (1 + 0.02 * ease_in_quad(r), 1 - 0.035 * ease_in_quad(r))),
        (J, J + 3, lambda r: (lerp(1.02, 0.99, ease_out_quad(r)), lerp(0.965, 1.03, ease_out_quad(r)))),
        (J + 3, 16, lambda r: (1 - 0.01 * damped(r, 1, 3), 1 + 0.03 * damped(r, 1, 3))),
        (16, N, lambda r: (1.0, 1.0))), N)}
    rattle_frames = []
    for n in names:
        off, h, d, tilt, dx = plan.get(n, (0, 30, 7, 8, 0))
        st = J + off
        end = _hop_end(st, d)
        rattle_frames.append(round(st + d))
        pre = pw((0, J, lambda r: -3.0 * ease_in_quad(r)), (J, N, lambda r: 0.0))
        win["bones"][n] = {
            "translate": TR(lambda f, st=st, h=h, d=d, dx=dx, pre=pre, end=end:
                            (dx * math.sin(math.pi * max(0.0, min(1.0, (f - st) / (end - st)))),
                             (pre(f) if f < st else 0.0) + _hop(f, st, h, d)), N),
            "rotate": R(lambda f, st=st, d=d, tilt=tilt, end=end:
                        0.0 if f <= st else (
                            tilt * math.sin(math.pi * min(1.0, (f - st) / d)) if f <= st + d
                            else -0.45 * tilt * damped_sin(min(1.0, (f - st - d) / max(1.0, N - st - d)), 2.2, 4.0)
                            * (1 - min(1.0, (f - st - d) / max(1.0, N - st - d)))), N)}
    win["bones"]["glow"] = {"scale": SC(pw(
        (0, J, lambda r: 1 - 0.04 * r),
        (J, J + 4, lambda r: lerp(0.96, 1.12, ease_out_quad(r))),
        (J + 4, 24, lambda r: lerp(1.12, HOLD_GLOW, ease_in_out(r))),
        (24, N, lambda r: HOLD_GLOW)), N, 2)}
    win["slots"]["glow"] = {"color": color([(0, 1.0), (J, 0.6), (J + 3, 0.85), (N, 0.85)])}
    win["events"] = events((J, "jolt"), *[(f, "rattle") for f in sorted(set(rattle_frames))])
    out["win"] = win

    # ── hold 30f: presented, the standing round still quivering faintly ──
    hold_ = blank_anim()
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    hold_["slots"]["glow"] = {"color": color(bake(0, 30, lambda r: 0.85 - 0.15 * math.sin(math.pi * r) ** 2, 2))}
    if "round_stand" in names:
        hold_["bones"]["round_stand"] = {"rotate": rot(bake(0, 30, loopy(lambda r: 0.7 * math.sin(TAU * r)), 2))}
    out["hold"] = hold_

    # ── land 12f: every round chatters on its own ──
    L = 12
    land = blank_anim()
    land["bones"]["symbol_anchor"] = {"scale": SC(lambda f: (1 + 0.03 * damped_sin(f / L, 1.2, 6) * (1 - f / L),
                                                             1 - 0.05 * damped_sin(f / L, 1.2, 6) * (1 - f / L)), L)}
    for i, n in enumerate(names):
        delay = (0, 1, 2, 1)[i % 4]
        hgt = (5.0, 7.0, 4.0, 8.0)[i % 4]
        land["bones"][n] = {
            "translate": TR(lambda f, dl=delay, hg=hgt: (0.0, 0.0 if f >= L else _hop(f, dl, hg, 3, ((0.35, 0.8),))), L),
            "rotate": R(lambda f, dl=delay, i=i: 0.0 if f <= dl or f >= L else
                        (2.6 if i % 2 else -2.6) * damped_sin((f - dl) / (L - dl), 2.4, 5.0), L)}
    land["events"] = events((0, "impact"))
    out["land"] = land

    # ── destroy 18f: rounds eject on separate arcs ──
    N2 = 18
    dst = blank_anim()
    dst["bones"]["symbol_anchor"] = {"scale": SC(pw((0, 3, lambda r: (1 + 0.02 * r, 1 - 0.04 * r)),
                                                    (3, 5, lambda r: (lerp(1.02, 1.0, r), lerp(0.96, 1.0, r))),
                                                    (5, N2, lambda r: (1.0, 1.0))), N2)}
    spins = (-300, 270, -220, 340)
    for i, (n, rd) in enumerate(zip(names, rounds)):
        vx = rd["centre"][0] - cx
        vy = rd["centre"][1] - cy
        m = math.hypot(vx, vy) or 1.0
        ux, uy = vx / m, vy / m
        dist = 190 + 40 * (i % 2)
        lift = 120 + 30 * ((i + 1) % 2)
        st = 3 + (i % 3)

        def path(f, ux=ux, uy=uy, dist=dist, lift=lift, st=st):
            if f <= st:
                return (0.0, -4.0 * f / st)
            r = (f - st) / (N2 - st)
            return (ux * dist * ease_out_quad(r), uy * dist * 0.5 * r + lift * r - 1.35 * lift * r * r)

        dst["bones"][n] = {
            "translate": TR(path, N2),
            "rotate": R(lambda f, sp=spins[i % 4], st=st: 0.0 if f <= st else sp * ease_out_quad((f - st) / (N2 - st)), N2),
            "scale": SC(lambda f, st=st: 1.0 if f <= st else lerp(1.0, 0.8, (f - st) / (N2 - st)), N2, 2)}
        dst["slots"][n] = {"color": color([(0, 1.0), (st + 5, 1.0), (N2 - 1, 0.0), (N2, 0.0)])}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (6, 0.0), (N2, 0.0)])}
    dst["events"] = events((3, "scatter"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- CASH (premium) --------------------------------------------------------
def pinned(c, p, ang, sx=1.0, sy=1.0, d=(0.0, 0.0)):
    """Translate for a bone pivoting at p so that its point c travels by d
    while the bone rotates `ang` (deg) and scales (sx, sy) — i.e. the part
    spins/flips about ITS OWN centre even though the bone pivots elsewhere."""
    ox, oy = (c[0] - p[0]) * sx, (c[1] - p[1]) * sy
    a = math.radians(ang)
    rx, ry = ox * math.cos(a) - oy * math.sin(a), ox * math.sin(a) + oy * math.cos(a)
    return (d[0] + (c[0] - p[0]) - rx, d[1] + (c[1] - p[1]) - ry)


def _flutter(f, st, dur, phase, drift, rise, sway=22, spin=26, flips=1.3, lean=0.0):
    """A banknote let go in the air: rises/drifts, pendulum-sways side to side
    with the matching tilt, and tumbles (scaleX through a flip).
    Returns (dx, dy, ang, sx) for frame f."""
    if f <= st:
        return 0.0, 0.0, 0.0, 1.0
    r = min(1.0, (f - st) / dur)
    osc = math.sin(math.pi * 2.2 * r + phase)
    dx = drift * ease_out_quad(r) + sway * osc * r
    dy = rise * ease_out_quad(r) - 0.35 * rise * r * r
    ang = lean * r + spin * osc * min(1.0, r * 3)
    sx = 0.3 + 0.7 * abs(math.cos(math.pi * flips * r + phase * 0.3))
    return dx, dy, ang, sx


def _paper(n, v0x, v0y, seed, g=1.55, drag=0.13, sway=11.0, sway_hz=1.25,
           spin0=0.0, tilt=1.6, flip_hz=0.55):
    """A banknote in the air, simulated frame by frame (30fps, Spine y up).

    It leaves the hand fast, drag bleeds that off within a few frames, then it
    falls slowly at paper's terminal velocity while it pendulum-sways side to
    side. Like a leaf, it TILTS into each swing (the rotation follows the sway
    velocity) and it tumbles about its long axis (scaleX through ~0 and back),
    catching the light as it turns. Returns per-frame (dx, dy, ang, sx, shade)
    for frames 0..n since release."""
    x = y = 0.0
    vx, vy = v0x, v0y
    ph = seed * 1.7
    fph = seed * 2.3
    ang = 0.0
    out = []
    for t in range(n + 1):
        ramp = min(1.0, t / 7.0)                       # flutter builds as it slows
        sx_off = sway * ramp * math.sin(TAU * sway_hz * t / 30 + ph)
        sv = sway * ramp * math.cos(TAU * sway_hz * t / 30 + ph)
        ang += spin0 * math.exp(-t / 6.0)              # the flick's own spin dies off
        a = ang + tilt * sv * 0.35
        c = math.cos(TAU * flip_hz * t / 30 + fph)
        sx = 0.22 + 0.78 * abs(c)
        shade = 0.72 + 0.28 * abs(c)                   # edge-on = darker
        out.append((x + sx_off, y, a, sx, shade))
        vy -= g
        vx *= 1 - drag
        vy *= 1 - drag
        x += vx
        y += vy
    return out


def _tint(shade):
    v = max(0, min(255, round(255 * shade)))
    return format(v, "02x") * 3


@motion("cash")
def _cash(sparks, ch, cmax, ctx):
    """A fan of real $1000 notes in a gold money clip. Rig: `fan` (pivot at the
    clip) > bill_0..4 (each pivots at the clip, so fanning is a rotation about
    the grip) + clip; throw_0..3 are hidden copies lying on the front note.

    win      the fan pinches, then SNAPS open (outer notes first, springy
             paper overshoot); three notes are thumb-flicked off the front —
             "make it rain" — each a simulated sheet of paper: fast off the
             hand, drag, then a slow swaying tumble down past the fan.
    land     the notes' tips carry on after the fan stops: they flare open and
             spring back, outer notes lagging; the clip clacks.
    destroy  the clip pops off and the whole fan bursts into falling notes."""
    meta, slots = ctx["meta"], ctx["slots"]
    bills = meta["bills"]
    throws = meta["throws"]
    out = {}

    def dirn(b):
        return 1.0 if b["fan"] > 0 else -1.0 if b["fan"] < 0 else 0.0

    def outer(b):
        return abs(b["fan"]) / 54.0                     # 0 centre .. 1 outermost

    # ── idle 72f: the notes breathe apart and together ──
    idle = blank_anim()
    idle["bones"]["symbol_anchor"] = {"scale": scale(bake(0, 72, lambda r: 1 + 0.008 * math.sin(TAU * r), 3))}
    for k, b in enumerate(bills):
        d, o = dirn(b), outer(b)
        idle["bones"][b["name"]] = {"rotate": rot(bake(0, 72, loopy(
            lambda r, d=d, o=o, k=k: d * o * 1.6 * math.sin(TAU * r + 0.5) + 0.35 * math.sin(TAU * 2 * r + k)), 2))}
    glow_breathe(idle, 0.06, 0.42)
    out["idle"] = idle

    # ── win 40f ──
    N, OPEN = 40, 5
    HOLD_GLOW = 1.04
    win = blank_anim()
    win["bones"]["clip"] = {"scale": SC(pw(
        (0, OPEN, lambda r: (1 + 0.03 * ease_in_quad(r), 1 - 0.07 * ease_in_quad(r))),
        (OPEN, OPEN + 3, lambda r: (lerp(1.03, 0.98, ease_out_quad(r)), lerp(0.93, 1.05, ease_out_quad(r)))),
        (OPEN + 3, 18, lambda r: (1 - 0.02 * damped(r, 1.2, 4) * (1 - r), 1 + 0.05 * damped(r, 1.2, 4) * (1 - r))),
        (18, N, lambda r: (1.0, 1.0))), N)}
    for k, b in enumerate(bills):
        d, o = dirn(b), outer(b)
        st = OPEN + round((1 - o) * 2)                  # outer notes lead
        spread = d * (6 + 9 * o)

        def ang(f, d=d, o=o, st=st, spread=spread):
            if f <= OPEN:
                return -d * 5 * o * ease_in_quad(f / OPEN)          # pinch closed
            if f <= st:
                return -d * 5 * o
            if f <= st + 4:
                return lerp(-d * 5 * o, spread, ease_out_cubic((f - st) / 4))
            r = min(1.0, (f - st - 4) / (30 - st - 4))
            return spread * damped(r, 1.5, 3.3) * (1 - r)
        win["bones"][b["name"]] = {"rotate": R(ang, N)}
    # three notes flicked off the front
    flicks = ((throws[0], 9, -1), (throws[1], 13, 1), (throws[2], 17, -1))
    for j, (name, st, side) in enumerate(flicks):
        path = _paper(N - st, side * (13 + 2 * j), 27 - 2 * j, seed=j + 1, spin0=-side * 8, drag=0.105, sway=13)
        T_ = lambda f, st=st, path=path: path[max(0, min(len(path) - 1, f - st))]
        win["bones"][name] = {
            "translate": TR(lambda f, T_=T_, st=st: (T_(f)[0], T_(f)[1]) if f >= st else (0.0, 0.0), N),
            "rotate": R(lambda f, T_=T_, st=st: T_(f)[2] if f >= st else 0.0, N),
            "scale": SC(lambda f, T_=T_, st=st: (T_(f)[3], 1.0) if f >= st else (1.0, 1.0), N)}
        # visible from its release, tinted darker as it turns edge-on, gone
        # just before the clip ends (the hold starts with it hidden)
        keys = [{"time": T(0), "color": "ffffff00"}, {"time": T(st - 1), "color": "ffffff00"}]
        for f in range(st, N + 1):
            a = 0.0 if f >= N - 1 else (1.0 if f < N - 7 else (N - 1 - f) / 6.0)
            keys.append({"time": T(f), "color": (_tint(T_(f)[4]) if a > 0 else "ffffff") + format(round(a * 255), "02x")})
        win["slots"][name] = {"color": keys}
    win["bones"]["glow"] = {"scale": SC(pw(
        (0, OPEN, lambda r: 1 - 0.04 * r), (OPEN, OPEN + 5, lambda r: lerp(0.96, 1.12, ease_out_quad(r))),
        (OPEN + 5, 30, lambda r: lerp(1.12, HOLD_GLOW, ease_in_out(r))), (30, N, lambda r: HOLD_GLOW)), N, 2)}
    win["slots"]["glow"] = {"color": color([(0, 1.0), (OPEN, 0.65), (OPEN + 4, 0.85), (N, 0.85)])}
    win["events"] = events((OPEN, "riffle"), (9, "flick"), (13, "flick"), (17, "flick"))
    out["win"] = win

    # ── hold 30f ──
    hold_ = blank_anim()
    for k, b in enumerate(bills):
        d, o = dirn(b), outer(b)
        hold_["bones"][b["name"]] = {"rotate": rot(bake(0, 30, lambda r, d=d, o=o: d * o * 1.4 * math.sin(math.pi * r) ** 2, 2))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    hold_["slots"]["glow"] = {"color": color(bake(0, 30, lambda r: 0.85 - 0.14 * math.sin(math.pi * r) ** 2, 2))}
    out["hold"] = hold_

    # ── land 14f: the tips carry on, flare open, spring back ──
    L = 14
    land = blank_anim()
    land["bones"]["clip"] = {"scale": SC(lambda f: (1 + 0.04 * damped_sin(f / L, 1.2, 6) * (1 - f / L),
                                                    1 - 0.08 * damped_sin(f / L, 1.2, 6) * (1 - f / L)), L)}
    for k, b in enumerate(bills):
        d, o = dirn(b), outer(b)
        dl = 1 + round(o * 2)
        land["bones"][b["name"]] = {"rotate": R(lambda f, d=d, o=o, dl=dl: 0.0 if f <= dl or f >= L else
                                                d * (1.5 + 5 * o) * damped_sin((f - dl) / (L - dl), 1.3, 3.2) * (1 - (f - dl) / (L - dl)), L)}
    land["events"] = events((0, "impact"))
    out["land"] = land

    # ── destroy 28f: clip pops, the fan bursts into falling notes ──
    N2, POP = 28, 3
    dst = blank_anim()
    dst["bones"]["clip"] = {
        "translate": TR(pw((0, POP, lambda r: (0.0, 3 * r)), (POP, N2, lambda r: (60 * ease_out_quad(r), 3 + 40 * r - 190 * r * r))), N2),
        "rotate": R(pw((0, POP, lambda r: 0.0), (POP, N2, lambda r: -140 * ease_out_quad(r))), N2)}
    dst["slots"]["clip"] = {"color": color([(0, 1.0), (POP + 8, 1.0), (POP + 15, 0.0), (N2, 0.0)])}
    pivot = meta["pivot"]
    for k, b in enumerate(bills):
        d, o = dirn(b), outer(b)
        st = POP + (k % 3)
        a = math.radians(b["fan"])                       # Spine CCW from up
        ux, uy = -math.sin(a), math.cos(a)               # direction the note points
        path = _paper(N2 - st, ux * 30 + d * 4, 16 + uy * 18, seed=k + 3, spin0=d * 7, sway=15, drag=0.1)
        c = b["centre"]
        T_ = lambda f, st=st, path=path: path[max(0, min(len(path) - 1, f - st))]
        dst["bones"][b["name"]] = {
            # the note pivots at the clip: pin its CENTRE to the paper path
            "translate": TR(lambda f, T_=T_, st=st, c=c: pinned(c, pivot, T_(f)[2], T_(f)[3], 1.0, (T_(f)[0], T_(f)[1])) if f >= st else (0.0, 0.0), N2),
            "rotate": R(lambda f, T_=T_, st=st: T_(f)[2] if f >= st else 0.0, N2),
            "scale": SC(lambda f, T_=T_, st=st: (T_(f)[3], 1.0) if f >= st else (1.0, 1.0), N2)}
        dst["slots"][b["name"]] = {"color": [{"time": T(f), "color": _tint(T_(f)[4] if f >= st else 1.0)
                                              + format(round(255 * (1.0 if f < N2 - 7 else max(0.0, (N2 - 1 - f) / 6.0))), "02x")}
                                             for f in range(0, N2 + 1)]}
    for j, name in enumerate(throws):
        st = POP + 1 + j
        side = -1 if j % 2 == 0 else 1
        path = _paper(N2 - st, side * (9 + 5 * j), 32 - 3 * j, seed=j + 9, spin0=-side * 9, sway=15, drag=0.1)
        T_ = lambda f, st=st, path=path: path[max(0, min(len(path) - 1, f - st))]
        dst["bones"][name] = {
            "translate": TR(lambda f, T_=T_, st=st: (T_(f)[0], T_(f)[1]) if f >= st else (0.0, 0.0), N2),
            "rotate": R(lambda f, T_=T_, st=st: T_(f)[2] if f >= st else 0.0, N2),
            "scale": SC(lambda f, T_=T_, st=st: (T_(f)[3], 1.0) if f >= st else (1.0, 1.0), N2)}
        dst["slots"][name] = {"color": [{"time": T(f), "color": _tint(T_(f)[4] if f >= st else 1.0)
                                         + format(round(255 * (0.0 if f < st or f >= N2 - 1 else (1.0 if f < N2 - 7 else (N2 - 1 - f) / 6.0))), "02x")}
                                        for f in range(0, N2 + 1)]}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (7, 0.0), (N2, 0.0)])}
    dst["events"] = events((POP, "snap"), (POP + 2, "flutter"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- DUFFEL (mid) ----------------------------------------------------------
@motion("duffel")
def _duffel(sparks, ch, cmax, ctx):
    """Stuffed loot bag. The bag body squashes about the floor it sits on; the
    loot in the opening, the pocket bills, the flopping handle and the zipper
    tab are separate parts that LAG it.

    win      squash down, then the bag heaves: loot jumps out of the opening
             (coins and notes spilling up and dropping back in), the handle
             flops, the tab swings — soft, heavy settle.
    land     soft squash; the handle and loot answer a couple of frames late.
    destroy  the bag swells, bursts open — loot, coins and notes blow out on
             separate arcs — and the empty bag slumps flat."""
    meta, slots = ctx["meta"], ctx["slots"]
    pops = meta["pops"]
    out = {}

    # ── idle 72f: breathing, crammed full ──
    idle = blank_anim()
    idle["bones"]["bagroot"] = {
        "scale": scale(bake(0, 72, lambda r: (1 + 0.010 * math.sin(TAU * r), 1 + 0.016 * math.sin(TAU * r)), 3)),
        "rotate": rot(bake(0, 72, loopy(lambda r: 1.2 * math.sin(TAU * r + 1.4)), 3))}
    idle["bones"]["loot"] = {"translate": trans(bake(0, 72, loopy(lambda r: (0, 1.8 * math.sin(TAU * r - 0.5))), 3))}
    idle["bones"]["handle"] = {"scale": scale(bake(0, 72, lambda r: (1.0, 1 + 0.03 * math.sin(TAU * r - 0.9)), 3))}
    idle["bones"]["zipper_pull"] = {"rotate": rot(bake(0, 72, loopy(lambda r: 4 * math.sin(TAU * r - 1.2)), 3))}
    glow_breathe(idle, 0.06, 0.40)
    out["idle"] = idle

    # ── win 32f ──
    N, K = 32, 4                       # K = the heave
    HOLD_GLOW = 1.05
    win = blank_anim()
    bag_s = pw((0, K, lambda r: (lerp(1, 1.07, ease_in_quad(r)), lerp(1, 0.88, ease_in_quad(r)))),
               (K, K + 4, lambda r: (lerp(1.07, 0.95, ease_out_quad(r)), lerp(0.88, 1.12, ease_out_quad(r)))),
               (K + 4, 26, lambda r: (1 - 0.05 * damped(r, 1.2, 3.0) * (1 - r), 1 + 0.12 * damped(r, 1.2, 3.0) * (1 - r))),
               (26, N, lambda r: (1.0, 1.0)))
    win["bones"]["bagroot"] = {"scale": SC(bag_s, N),
                               "rotate": R(pw((0, K, lambda r: -1.5 * ease_in_quad(r)), (K, 24, lambda r: -1.5 + 1.5 * ease_in_out(r) + 2.5 * damped_sin(r, 1.3, 3.2) * (1 - r)),
                                              (24, N, lambda r: 0.0)), N)}
    win["bones"]["loot"] = {"translate": TR(lambda f: (0.0, -3.0 * ease_in_quad(min(1.0, f / K)) if f <= K else _hop(f, K, 15, 8, ((0.25, 0.6),))), N)}
    win["bones"]["pocket_loot"] = {"translate": TR(lambda f: (0.0, 0.0 if f <= K + 1 else _hop(f, K + 1, 9, 6, ((0.3, 0.6),))), N)}
    win["bones"]["handle"] = {"scale": SC(pw((0, K + 1, lambda r: (1.0, lerp(1, 0.86, ease_in_quad(r)))),
                                             (K + 1, K + 6, lambda r: (1.0, lerp(0.86, 1.12, ease_out_quad(r)))),
                                             (K + 6, 28, lambda r: (1.0, 1 + 0.12 * damped(r, 1.5, 3.4) * (1 - r))),
                                             (28, N, lambda r: (1.0, 1.0))), N)}
    win["bones"]["zipper_pull"] = {"rotate": R(lambda f: 0.0 if f <= K else 16 * damped_sin(min(1.0, (f - K) / (N - K)), 2.2, 3.6) * (1 - min(1.0, (f - K) / (N - K))), N)}
    # spilled loot: pops up out of the opening and drops back inside
    for i, p in enumerate(pops):
        st = K + 1 + (i % 3)
        h = (46, 58, 38, 52, 44)[i % 5]
        d = 11 + (i % 2) * 2
        dx = (-18, 16, -10, 6, 20)[i % 5]
        spin = (-40, 30, 220, -260, 180)[i % 5] if p["kind"] == "coin" else (-22, 18)[i % 2]
        end = st + d
        win["bones"][p["name"]] = {
            "translate": TR(lambda f, st=st, h=h, d=d, dx=dx: (dx * min(1.0, max(0.0, (f - st) / d)), _hop(f, st, h, d, ())), N),
            "rotate": R(lambda f, st=st, d=d, sp=spin: sp * min(1.0, max(0.0, (f - st) / d)) * (1 if f <= st + d else 1.0), N)}
        win["slots"][p["name"]] = {"color": color([(0, 0.0), (st, 0.0), (st + 1, 1.0), (end, 1.0), (end + 1, 0.0), (N, 0.0)])}
    win["bones"]["glow"] = {"scale": SC(pw((0, K, lambda r: 1 - 0.04 * r), (K, K + 5, lambda r: lerp(0.96, 1.14, ease_out_quad(r))),
                                           (K + 5, 26, lambda r: lerp(1.14, HOLD_GLOW, ease_in_out(r))), (26, N, lambda r: HOLD_GLOW)), N, 2)}
    win["slots"]["glow"] = {"color": color([(0, 1.0), (K, 0.7), (K + 4, 0.9), (N, 0.9)])}
    win["events"] = events((K, "thump"), (K + 2, "jingle"))
    out["win"] = win

    # ── hold 30f: presented, full to bursting ──
    hold_ = blank_anim()
    hold_["bones"]["bagroot"] = {"scale": scale(bake(0, 30, lambda r: (1 + 0.012 * math.sin(math.pi * r) ** 2, 1 + 0.02 * math.sin(math.pi * r) ** 2), 2))}
    hold_["bones"]["loot"] = {"translate": trans(bake(0, 30, lambda r: (0, 2.5 * math.sin(math.pi * r) ** 2), 2))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    hold_["slots"]["glow"] = {"color": color(bake(0, 30, lambda r: 0.9 - 0.15 * math.sin(math.pi * r) ** 2, 2))}
    out["hold"] = hold_

    # ── land 16f: soft squash, the handle and loot answer late ──
    L = 16
    land = blank_anim()
    land["bones"]["bagroot"] = {"scale": SC(lambda f: (1 + 0.07 * damped_sin(f / L, 0.9, 3.6) * (1 - f / L),
                                                       1 - 0.11 * damped_sin(f / L, 0.9, 3.6) * (1 - f / L)), L)}
    land["bones"]["handle"] = {"scale": SC(lambda f: (1.0, 1.0 if f <= 2 else 1 - 0.14 * damped_sin((f - 2) / (L - 2), 1.3, 3.0) * (1 - (f - 2) / (L - 2))), L)}
    land["bones"]["loot"] = {"translate": TR(lambda f: (0.0, 0.0 if f <= 1 else -5 * damped_sin((f - 1) / (L - 1), 1.2, 3.4) * (1 - (f - 1) / (L - 1))), L)}
    land["bones"]["zipper_pull"] = {"rotate": R(lambda f: 0.0 if f <= 1 else 10 * damped_sin((f - 1) / (L - 1), 1.8, 3.0) * (1 - (f - 1) / (L - 1)), L)}
    land["events"] = events((0, "thud"))
    out["land"] = land

    # ── destroy 20f: swell, burst, slump ──
    N2, B = 20, 4
    dst = blank_anim()
    dst["bones"]["bagroot"] = {"scale": SC(pw((0, B, lambda r: (lerp(1, 1.09, ease_in_quad(r)), lerp(1, 1.08, ease_in_quad(r)))),
                                              (B, N2, lambda r: (lerp(1.09, 1.22, ease_out_quad(r)), lerp(1.08, 0.5, ease_in_quad(r))))), N2)}
    dst["bones"]["loot"] = {"translate": TR(pw((0, B, lambda r: (0.0, 4 * r)), (B, N2, lambda r: (0.0, lerp(4, 160, ease_out_quad(r)) - 60 * r * r))), N2),
                            "rotate": R(pw((0, B, lambda r: 0.0), (B, N2, lambda r: 12 * ease_out_quad(r))), N2)}
    dst["slots"]["loot"] = {"color": color([(0, 1.0), (B + 5, 1.0), (N2 - 3, 0.0), (N2, 0.0)])}
    dst["bones"]["pocket_loot"] = {"translate": TR(pw((0, B + 1, lambda r: (0.0, 0.0)), (B + 1, N2, lambda r: (40 * ease_out_quad(r), 90 * ease_out_quad(r) - 70 * r * r))), N2),
                                   "rotate": R(pw((0, B + 1, lambda r: 0.0), (B + 1, N2, lambda r: -30 * ease_out_quad(r))), N2)}
    dst["slots"]["pocket_loot"] = {"color": color([(0, 1.0), (B + 5, 1.0), (N2 - 3, 0.0), (N2, 0.0)])}
    for i, p in enumerate(pops):
        ang = (-150, -35, -115, -70, -20)[i % 5]
        a = math.radians(ang + 180)
        dist = 150 + 30 * (i % 3)
        st = B + (i % 2)
        spin = (-360, 300, 540, -480, 420)[i % 5] if p["kind"] == "coin" else (-60, 55)[i % 2]
        dst["bones"][p["name"]] = {
            "translate": TR(lambda f, st=st, a=a, dist=dist: (0.0, 0.0) if f <= st else (
                math.cos(a) * dist * ease_out_quad((f - st) / (N2 - st)),
                abs(math.sin(a)) * dist * ease_out_quad((f - st) / (N2 - st)) + 70 * ((f - st) / (N2 - st)) - 110 * ((f - st) / (N2 - st)) ** 2), N2),
            "rotate": R(lambda f, st=st, sp=spin: 0.0 if f <= st else sp * ease_out_quad((f - st) / (N2 - st)), N2)}
        dst["slots"][p["name"]] = {"color": color([(0, 0.0), (st, 0.0), (st + 1, 1.0), (N2 - 4, 1.0), (N2, 0.0)])}
    dst["bones"]["handle"] = {"scale": SC(pw((0, B, lambda r: (1.0, 1.0)), (B, N2, lambda r: (1.0, lerp(1.0, 0.4, ease_out_quad(r))))), N2)}
    dst["bones"]["zipper_pull"] = {"rotate": R(lambda f: 0.0 if f <= B else 40 * damped_sin((f - B) / (N2 - B), 1.2, 2.0), N2)}
    for s_, f0, f1 in (("bag", B + 4, N2 - 2), ("handle", B + 2, B + 10), ("zipper_pull", B + 3, B + 11), ("interior", B + 2, B + 8), ("pocket_in", B + 2, B + 8)):
        dst["slots"][s_] = {"color": color([(0, 1.0), (f0, 1.0), (f1, 0.0), (N2, 0.0)])}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (B + 4, 0.0), (N2, 0.0)])}
    dst["events"] = events((B, "burst"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- KNIFE (low) -----------------------------------------------------------
@motion("knife")
def _knife(sparks, ch, cmax, ctx):
    """Folding knife. The `knife` group bone lies ALONG the knife (tip ->
    butt), so its local Y is the blade's thickness axis.

    win      coil, then the signature FLIP — a full turn tossed in the air with
             a slash arc trailing the tip — caught with a click, then a glint
             rolls down the steel from heel to tip and flares at the point.
             Low tier: quick.
    land     a sharp little twang; the blade catches the light.
    destroy  turns EDGE-ON (collapses along its own thickness axis) into a hot
             line of light, which slices out. No particles."""
    meta, slots = ctx["meta"], ctx["slots"]
    ng = meta["glints"]
    out = {}

    # ── idle 72f: slow menacing tilt (the concept that worked) ──
    idle = blank_anim()
    idle["bones"]["symbol_anchor"] = {
        "scale": scale(bake(0, 72, lambda r: 1 + 0.009 * math.sin(TAU * r), 3)),
        "translate": trans(bake(0, 72, loopy(lambda r: (0, 2.2 * math.sin(TAU * r + 0.9))), 3))}
    idle["bones"]["knife"] = {"rotate": rot(bake(0, 72, loopy(lambda r: 2.6 * math.sin(TAU * r + 0.4)), 3))}
    glow_breathe(idle, 0.06, 0.42)
    # a faint glimmer travels the blade once per loop
    idle["slots"]["glint_2"] = {"color": color(bake(0, 72, lambda r: 0.32 * math.sin(math.pi * r) ** 16, 2))}
    out["idle"] = idle

    # ── win 24f ──
    N, T0, CATCH, G0 = 24, 3, 12, 13
    HOLD_GLOW = 1.04
    spin = pw((0, T0, lambda r: -16 * ease_in_quad(r)),
              (T0, CATCH, lambda r: lerp(-16, 364, smoothstep(r))),
              (CATCH, 19, lambda r: 360 + 4 * damped(r, 1.4, 4.0) * (1 - r)),
              (19, N, lambda r: 360.0))
    win = blank_anim()
    win["bones"]["knife"] = {
        "rotate": R(spin, N),
        "translate": TR(pw((0, T0, lambda r: (0.0, -3 * ease_in_quad(r))),
                           (T0, CATCH, lambda r: (0.0, lerp(-3, 0, r) + 30 * math.sin(math.pi * r))),
                           (CATCH, CATCH + 3, lambda r: (0.0, -2.5 * math.sin(math.pi * r))),
                           (CATCH + 3, N, lambda r: (0.0, 0.0))), N),
        "scale": SC(pw((0, CATCH, lambda r: (1.0, 1.0)),
                       (CATCH, CATCH + 4, lambda r: (1 + 0.03 * math.sin(math.pi * r), 1 - 0.05 * math.sin(math.pi * r))),
                       (CATCH + 4, N, lambda r: (1.0, 1.0))), N)}
    win["slots"]["slash"] = {"color": color([(0, 0.0), (T0 + 1, 0.0), (T0 + 2, 0.95), (CATCH - 3, 0.7), (CATCH, 0.0), (N, 0.0)])}
    for n in range(ng):
        f = G0 + n
        win["slots"][f"glint_{n}"] = {"color": color([(0, 0.0), (f - 1, 0.0), (f, 1.0), (f + 1, 0.35), (f + 2, 0.0), (N, 0.0)])}
    tf = G0 + ng - 1
    win["slots"]["tip_flare"] = {"color": color([(0, 0.0), (tf, 0.0), (tf + 1, 1.0), (tf + 3, 0.6), (min(N, tf + 5), 0.0), (N, 0.0)])}
    win["bones"]["tip_flare"] = {"scale": scale([(0, 0.4), (tf, 0.4), (tf + 1, 1.15), (min(N, tf + 5), 0.7), (N, 0.7)]),
                                 "rotate": rot([(0, 0.0), (tf, 0.0), (min(N, tf + 5), 25.0), (N, 25.0)])}
    win["bones"]["glow"] = {"scale": SC(pw((0, CATCH, lambda r: 1.0), (CATCH, CATCH + 4, lambda r: lerp(1, 1.1, ease_out_quad(r))),
                                           (CATCH + 4, N, lambda r: lerp(1.1, HOLD_GLOW, ease_in_out(r)))), N, 2)}
    win["events"] = events((T0, "swish"), (CATCH, "catch"), (G0 + 1, "shing"))
    out["win"] = win

    # ── hold 30f: the blade held up, a slow glimmer ──
    hold_ = blank_anim()
    hold_["bones"]["knife"] = {"rotate": rot(bake(0, 30, loopy(lambda r: 0.6 * math.sin(TAU * r)), 2))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.025 * math.sin(math.pi * r) ** 2, 2))}
    hold_["slots"]["glint_3"] = {"color": color(bake(0, 30, lambda r: 0.3 * math.sin(math.pi * r) ** 2, 2))}
    out["hold"] = hold_

    # ── land 10f: sharp twang, the blade catches the light ──
    L = 10
    land = blank_anim()
    land["bones"]["knife"] = {"rotate": R(lambda f: 2.4 * damped_sin(f / L, 3.2, 6.5) * (1 - f / L), L)}
    land["bones"]["symbol_anchor"] = {"scale": SC(lambda f: (1 + 0.02 * damped_sin(f / L, 1.5, 7) * (1 - f / L),
                                                             1 - 0.035 * damped_sin(f / L, 1.5, 7) * (1 - f / L)), L)}
    land["slots"]["glint_2"] = {"color": color([(0, 0.0), (1, 0.55), (3, 0.0), (L, 0.0)])}
    land["events"] = events((0, "tick"))
    out["land"] = land

    # ── destroy 16f: edge-on into a line of light ──
    N2, E0, EL = 16, 3, 10
    dst = blank_anim()
    dst["bones"]["knife"] = {
        "rotate": R(pw((0, E0, lambda r: -7 * ease_out_quad(r)), (E0, EL, lambda r: lerp(-7, 12, ease_in_out(r))), (EL, N2, lambda r: 12.0)), N2),
        "scale": SC(pw((0, E0, lambda r: (1 + 0.03 * r, 1 + 0.05 * r)),
                       (E0, EL, lambda r: (lerp(1.03, 1.06, r), lerp(1.05, 0.03, ease_in_quad(r)))),
                       (EL, N2, lambda r: (lerp(1.06, 1.15, r), 0.03))), N2)}
    for s_ in ("handle", "blade"):
        dst["slots"][s_] = {"color": color([(0, 1.0), (EL - 2, 1.0), (EL + 1, 0.0), (N2, 0.0)])}
    dst["slots"]["edge_flash"] = {"color": color([(0, 0.0), (EL - 3, 0.0), (EL - 1, 1.0), (EL + 2, 0.8), (N2 - 1, 0.0), (N2, 0.0)])}
    # the flash rides its own axis bone (`edgeline`), turning with the knife
    # but never collapsing with it: it grows along the blade, thin and hot
    dst["bones"]["edgeline"] = {
        "rotate": R(pw((0, E0, lambda r: -7 * ease_out_quad(r)), (E0, EL, lambda r: lerp(-7, 12, ease_in_out(r))), (EL, N2, lambda r: 12.0)), N2),
        "scale": SC(lambda f: (lerp(0.75, 1.12, min(1.0, max(0.0, (f - (EL - 3)) / 6))),
                               lerp(0.9, 0.45, min(1.0, max(0.0, (f - (EL - 3)) / 6)))), N2)}
    dst["slots"]["glint_4"] = {"color": color([(0, 0.0), (1, 0.0), (2, 0.9), (4, 0.0), (N2, 0.0)])}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (EL - 2, 0.0), (N2, 0.0)])}
    dst["events"] = events((E0, "shing"), (EL - 1, "slice"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- DIAMOND (premium) -----------------------------------------------------
@motion("diamond")
def _diamond(sparks, ch, cmax, ctx):
    """A cut stone. Its body is RIGID (it is split into shards along its own
    facets, but they move as one until it breaks); the performance is LIGHT
    moving through the real facets — controlled and expensive, no twinkle
    stars.

    idle     near-still; a faint band of light drifts across the facets.
    win      a jeweller's tilt: the stone lifts and turns a few degrees while a
             wave of refraction crosses the facets left to right, then the
             table flashes white (the fire moment) and it settles.
    land     precise and crystalline: almost no squash, a tight micro-shiver,
             a clean ping of light off the table.
    destroy  charges with light, then SHATTERS along its facets — angular
             shards flying outward, spinning."""
    meta, slots = ctx["meta"], ctx["slots"]
    shards = meta["shards"]
    nl = meta["lights"]
    lights = [f"light_{b}" for b in range(nl)]
    out = {}

    # ── idle 72f ──
    idle = blank_anim()
    idle["bones"]["symbol_anchor"] = {
        "scale": scale(bake(0, 72, lambda r: 1 + 0.01 * math.sin(TAU * r), 3)),
        "translate": trans(bake(0, 72, loopy(lambda r: (0, 3.0 * math.sin(TAU * r + 0.9))), 3))}
    idle["bones"]["gem"] = {"rotate": rot(bake(0, 72, loopy(lambda r: 0.9 * math.sin(TAU * r + 0.6)), 3))}
    glow_breathe(idle, 0.05, 0.40)
    for b, n in enumerate(lights):
        ph = b / nl
        idle["slots"][n] = {"color": color(bake(0, 72, lambda r, ph=ph: 0.26 * math.exp(-((((r - ph) + 0.5) % 1 - 0.5) ** 2) / 0.006), 2))}
    out["idle"] = idle

    # ── win 40f ──
    N, LIFT, FIRE = 40, 5, 17
    HOLD_GLOW = 1.05
    win = blank_anim()
    win["bones"]["gem"] = {
        "rotate": R(pw((0, LIFT, lambda r: -1.8 * ease_in_quad(r)),
                       (LIFT, 20, lambda r: lerp(-1.8, 3.0, ease_in_out(r))),
                       (20, 34, lambda r: lerp(3.0, 0.0, ease_in_out(r))),
                       (34, N, lambda r: 0.0)), N),
        "translate": TR(pw((0, LIFT, lambda r: (0.0, -2.5 * ease_in_quad(r))),
                           (LIFT, 16, lambda r: (0.0, lerp(-2.5, 11, ease_out_cubic(r)))),
                           (16, 34, lambda r: (0.0, lerp(11, 0, ease_in_out(r)))),
                           (34, N, lambda r: (0.0, 0.0))), N),
        "scale": SC(pw((0, LIFT, lambda r: 1 - 0.02 * ease_in_quad(r)),
                       (LIFT, 16, lambda r: lerp(0.98, 1.05, ease_out_cubic(r))),
                       (16, 34, lambda r: lerp(1.05, 1.0, ease_in_out(r))),
                       (34, N, lambda r: 1.0)), N)}
    for b, n in enumerate(lights):
        f0 = LIFT + 1 + b * 2
        win["slots"][n] = {"color": color([(0, 0.0), (f0, 0.0), (f0 + 2, 0.92), (f0 + 5, 0.3), (f0 + 9, 0.0), (N, 0.0)])}
    win["slots"]["table_fire"] = {"color": color([(0, 0.0), (FIRE - 1, 0.0), (FIRE, 1.0), (FIRE + 3, 0.55), (FIRE + 10, 0.0), (N, 0.0)])}
    win["bones"]["table_fire"] = {"scale": scale([(0, 1.0), (FIRE, 1.0), (FIRE + 2, 1.04), (FIRE + 10, 1.0), (N, 1.0)])}
    win["bones"]["glow"] = {"scale": SC(pw((0, FIRE, lambda r: 1 + 0.04 * r), (FIRE, FIRE + 4, lambda r: lerp(1.04, 1.16, ease_out_quad(r))),
                                           (FIRE + 4, 34, lambda r: lerp(1.16, HOLD_GLOW, ease_in_out(r))), (34, N, lambda r: HOLD_GLOW)), N, 2)}
    win["events"] = events((LIFT + 1, "chime"), (FIRE, "fire"))
    out["win"] = win

    # ── hold 30f: slow turn, a soft band of light breathing ──
    hold_ = blank_anim()
    hold_["bones"]["gem"] = {"rotate": rot(bake(0, 30, loopy(lambda r: 1.0 * math.sin(TAU * r)), 2))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    for b, n in enumerate(lights):
        # a soft band travels across the facets; zero at both loop ends so it
        # hands over cleanly from the win (lights out) and closes the loop
        c = 0.2 + 0.6 * b / max(1, nl - 1)
        hold_["slots"][n] = {"color": color(bake(0, 30, lambda r, c=c: 0.24 * math.sin(math.pi * r) ** 2
                                                  * math.exp(-((r - c) ** 2) / 0.012), 2))}
    out["hold"] = hold_

    # ── land 12f: crystalline ping ──
    L = 12
    land = blank_anim()
    land["bones"]["symbol_anchor"] = {"scale": SC(lambda f: (1 + 0.012 * damped_sin(f / L, 1.4, 7) * (1 - f / L),
                                                             1 - 0.02 * damped_sin(f / L, 1.4, 7) * (1 - f / L)), L)}
    land["bones"]["gem"] = {"rotate": R(lambda f: 0.7 * damped_sin(f / L, 3.6, 7.5) * (1 - f / L), L)}
    land["slots"]["table_fire"] = {"color": color([(0, 0.0), (1, 0.65), (5, 0.0), (L, 0.0)])}
    land["events"] = events((0, "ping"))
    out["land"] = land

    # ── destroy 18f: charge with light, shatter along the facets ──
    N2, S0 = 18, 4
    dst = blank_anim()
    dst["bones"]["gem"] = {"scale": SC(pw((0, S0, lambda r: 1 + 0.035 * ease_in_quad(r)), (S0, N2, lambda r: 1.035)), N2)}
    # the light is INSIDE the stone: it peaks as it charges and is gone the
    # instant the stone breaks (lights stay on the gem bone, not the shards)
    for b, n in enumerate(lights):
        dst["slots"][n] = {"color": color([(0, 0.0), (S0 - 1, 0.85), (S0, 0.95), (S0 + 1, 0.0), (N2, 0.0)])}
    dst["slots"]["table_fire"] = {"color": color([(0, 0.0), (S0 - 1, 0.7), (S0, 1.0), (S0 + 1, 0.0), (N2, 0.0)])}
    for i, sh in enumerate(shards):
        cx, cy = sh["centre"]
        m = math.hypot(cx, cy) or 1.0
        ux, uy = cx / m, cy / m
        dist = 150 + 45 * ((i * 7) % 3)
        spin = (-150, 120, -90, 170, -60, 140, -120, 80, -170, 100)[i % 10]
        st = S0 + (i % 2)
        dst["bones"][sh["name"]] = {
            "translate": TR(lambda f, ux=ux, uy=uy, dist=dist, st=st: (0.0, 0.0) if f <= st else (
                ux * dist * ease_out_cubic((f - st) / (N2 - st)),
                uy * dist * ease_out_cubic((f - st) / (N2 - st)) - 60 * ((f - st) / (N2 - st)) ** 2), N2),
            "rotate": R(lambda f, sp=spin, st=st: 0.0 if f <= st else sp * ease_out_quad((f - st) / (N2 - st)), N2),
            "scale": SC(lambda f, st=st: 1.0 if f <= st else lerp(1.0, 0.82, (f - st) / (N2 - st)), N2, 2)}
        dst["slots"][sh["name"]] = {"color": color([(0, 1.0), (st + 4, 1.0), (N2 - 1, 0.0), (N2, 0.0)])}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (S0, 1.0), (S0 + 2, 0.0), (N2, 0.0)])}
    dst["events"] = events((S0, "shatter"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- BRASS KNUCKLES (low) --------------------------------------------------
@motion("brass_knuckles")
def _brass(sparks, ch, cmax, ctx):
    """Cast-metal knuckle duster: HEAVY. `base` pivots at the floor, so every
    squash sits on the ground instead of shrinking about the middle.

    win      wind back (slow, loaded) -> the PUNCH: 3 frames of drive, a dead
             stop with a hard squash along the blow, then a heavy settle with
             barely any rebound. Low tier: quick, no scale-up pop.
    land     hard compression, very little rebound.
    destroy  dead weight: a tiny lift as it lets go, then it drops out."""
    slots = ctx["slots"]
    out = {}

    # ── idle 72f: the heavy rock (kept) ──
    idle = _idle(0.010, 1.8, body={"rotate": rot(bake(0, 72, loopy(lambda r: 2.2 * math.sin(TAU * r + 0.6)), 3))},
                 glow=(0.06, 0.40), shine=(2, 1.4, 0.55, 0.06), sparks=())
    out["idle"] = idle

    # ── win 26f ──
    N, HIT = 26, 8
    HOLD_GLOW = 1.04
    win = blank_anim()
    win["bones"]["body"] = {
        "translate": TR(pw((0, 5, lambda r: (-13 * ease_in_quad(r), 4.5 * ease_in_quad(r))),
                           (5, HIT, lambda r: (lerp(-13, 26, ease_out_cubic(r)), lerp(4.5, -6, ease_out_cubic(r)))),
                           (HIT, 19, lambda r: (26 * (1 - r) ** 2.4 - 2.0 * math.sin(math.pi * r) * (1 - r), -6 * (1 - r) ** 2.4)),
                           (19, N, lambda r: (0.0, 0.0))), N),
        "rotate": R(pw((0, 5, lambda r: 7 * ease_in_quad(r)),
                       (5, HIT, lambda r: lerp(7, -10, ease_out_cubic(r))),
                       (HIT, 19, lambda r: -10 * (1 - r) ** 2.2 + 1.4 * math.sin(math.pi * r) * (1 - r)),
                       (19, N, lambda r: 0.0)), N)}
    win["bones"]["base"] = {"scale": SC(pw((0, 5, lambda r: (1 - 0.025 * ease_in_quad(r), 1 + 0.02 * ease_in_quad(r))),
                                          (5, HIT, lambda r: (lerp(0.975, 1.0, r), lerp(1.02, 1.0, r))),
                                          (HIT, HIT + 1, lambda r: (lerp(1.0, 1.09, r), lerp(1.0, 0.92, r))),
                                          (HIT + 1, HIT + 5, lambda r: (lerp(1.09, 1.0, ease_out_quad(r)), lerp(0.92, 1.0, ease_out_quad(r)))),
                                          (HIT + 5, N, lambda r: (1.0, 1.0))), N)}
    win["bones"]["glow"] = {"scale": SC(pw((0, HIT, lambda r: 1 - 0.04 * r), (HIT, HIT + 3, lambda r: lerp(0.96, 1.12, ease_out_quad(r))),
                                           (HIT + 3, 22, lambda r: lerp(1.12, HOLD_GLOW, ease_in_out(r))), (22, N, lambda r: HOLD_GLOW)), N, 2)}
    win["slots"]["glow"] = {"color": color([(0, 1.0), (HIT, 0.8), (HIT + 2, 1.0), (N, 1.0)])}
    win["slots"]["shine"] = {"color": color([(0, 1.0), (5, 0.55), (HIT, 0.55), (HIT + 1, 1.0), (HIT + 3, 0.6), (HIT + 8, 1.0), (N, 1.0)])}
    win["events"] = events((HIT, "punch"))
    out["win"] = win

    # ── hold 30f ──
    hold_ = blank_anim()
    hold_["bones"]["body"] = {"rotate": rot(bake(0, 30, loopy(lambda r: 0.8 * math.sin(TAU * r)), 2))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    out["hold"] = hold_

    # ── land 10f: hard compression, little rebound ──
    L = 10
    land = blank_anim()
    land["bones"]["base"] = {"scale": SC(pw((0, 2, lambda r: (lerp(1, 1.1, ease_out_quad(r)), lerp(1, 0.86, ease_out_quad(r)))),
                                          (2, 6, lambda r: (lerp(1.1, 0.99, ease_in_out(r)), lerp(0.86, 1.012, ease_in_out(r)))),
                                          (6, L, lambda r: (lerp(0.99, 1.0, r), lerp(1.012, 1.0, r)))), L)}
    land["bones"]["body"] = {"rotate": R(lambda f: 1.3 * damped_sin(f / L, 1.2, 6) * (1 - f / L), L)}
    land["events"] = events((0, "thud"))
    out["land"] = land

    # ── destroy 16f: dead weight ──
    N2 = 16
    dst = blank_anim()
    dst["bones"]["base"] = {
        "translate": TR(pw((0, 2, lambda r: (0.0, 6 * ease_out_quad(r))), (2, N2, lambda r: (0.0, lerp(6, -0.85 * cmax, ease_in_cubic(r))))), N2),
        "scale": SC(pw((0, 2, lambda r: (1.0, 1.0)), (2, N2, lambda r: (lerp(1, 0.95, r), lerp(1, 1.06, r)))), N2)}
    dst["bones"]["body"] = {"rotate": R(pw((0, 2, lambda r: 0.0), (2, N2, lambda r: 14 * ease_in_quad(r))), N2)}
    dst["slots"]["body"] = {"color": color([(0, 1.0), (8, 1.0), (15, 0.0), (N2, 0.0)])}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (6, 0.0), (N2, 0.0)])}
    dst["slots"]["shine"] = {"color": color([(0, 1.0), (5, 0.0), (N2, 0.0)])}
    dst["events"] = events((2, "drop"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


# ---- BIKE (premium) --------------------------------------------------------
@motion("bike")
def _bike(sparks, ch, cmax, ctx):
    """Superbike. Two pivots: `ground` (the contact line — suspension squash
    compresses INTO the road) and `chassis` (the rear tyre's contact patch —
    a wheelie lifts the front wheel while the rear stays planted).

    win      revs (vibration builds, rear squats) -> WHEELIE about the rear
             tyre, balancing -> front drops -> the suspension takes the hit
             (compress, rebound, settle) -> idles.
    land     visible suspension compression and rebound, front-end dip.
    destroy  rides off: throttle squat, launch to the RIGHT (the way it
             faces — the old exit reversed off to the left) with the nose up."""
    slots = ctx["slots"]
    out = {}

    def vib(f, amp, cyc=9):
        return amp * math.sin(TAU * cyc * f / 30)

    # ── idle 72f: engine at rest (kept), plus a suspension bob ──
    idle = _idle(0.010, 1.2,
                 body={"translate": trans(bake(0, 72, loopy(lambda r: (0, 0.9 * math.sin(TAU * 6 * r))), 1)),
                       "rotate": rot(bake(0, 72, loopy(lambda r: 1.3 * math.sin(TAU * r + 0.5)
                                                       + 0.35 * math.sin(TAU * 6 * r)), 1))},
                 glow=(0.07, 0.45), shine=(2, 1.6, 0.60, 0.08), sparks=())
    idle["bones"]["ground"] = {"scale": scale(bake(0, 72, lambda r: (1.0, 1 + 0.006 * math.sin(TAU * 2 * r)), 3))}
    out["idle"] = idle

    # ── win 40f ──
    N, W0, UP, DROP, HIT = 40, 6, 14, 24, 28
    HOLD_GLOW = 1.05
    wheelie = pw((0, W0, lambda r: -1.2 * ease_in_quad(r)),
                 (W0, UP, lambda r: lerp(-1.2, 15, ease_out_cubic(r))),
                 (UP, DROP, lambda r: 15 + 1.6 * math.sin(TAU * 1.5 * r) * (1 - r)),
                 (DROP, HIT, lambda r: 15 * (1 - ease_in_quad(r))),
                 (HIT, 36, lambda r: -2.4 * damped_sin(r, 1.0, 3.5) * (1 - r)),
                 (36, N, lambda r: 0.0))
    susp = pw((0, W0, lambda r: 1 - 0.05 * ease_in_quad(r)),
              (W0, UP, lambda r: lerp(0.95, 1.02, ease_out_quad(r))),
              (UP, HIT, lambda r: lerp(1.02, 1.0, r)),
              (HIT, HIT + 2, lambda r: lerp(1.0, 0.88, ease_out_quad(r))),
              (HIT + 2, N, lambda r: 1 - 0.12 * damped(r, 1.1, 3.8) * (1 - r)))
    win = blank_anim()
    win["bones"]["chassis"] = {"rotate": R(wheelie, N)}
    win["bones"]["ground"] = {"scale": SC(lambda f: (1.0 + (1 - susp(f)) * 0.3, susp(f)), N),
                              "translate": TR(pw((0, W0, lambda r: (0.0, 0.0)), (W0, DROP, lambda r: (7 * ease_out_quad(r), 0.0)),
                                                 (DROP, N, lambda r: (7 * (1 - ease_in_out(r)), 0.0))), N)}
    # engine: vibration builds on the rev, rides through, fades to idle
    env = pw((0, W0, lambda r: 0.6 + 1.4 * r), (W0, DROP, lambda r: 2.0), (DROP, 36, lambda r: lerp(2.0, 0.3, r)), (36, N, lambda r: lerp(0.3, 0.0, r)))
    win["bones"]["body"] = {"translate": TR(lambda f: (0.0, vib(f, env(f), 9) * (1 if f < N else 0)), N),
                            "rotate": R(lambda f: vib(f, 0.3 * env(f), 7) * (1 if f < N else 0), N)}
    win["bones"]["glow"] = {"scale": SC(pw((0, W0, lambda r: 1.0), (W0, UP, lambda r: lerp(1, 1.12, ease_out_quad(r))),
                                           (UP, 34, lambda r: lerp(1.12, HOLD_GLOW, ease_in_out(r))), (34, N, lambda r: HOLD_GLOW)), N, 2)}
    win["slots"]["shine"] = {"color": color([(0, 1.0), (W0, 0.6), (UP, 1.0), (HIT, 0.6), (HIT + 3, 1.0), (N, 1.0)])}
    win["events"] = events((1, "rev"), (W0, "wheelie"), (HIT, "thud"))
    out["win"] = win

    # ── hold 30f: idling, ready ──
    hold_ = blank_anim()
    hold_["bones"]["body"] = {"translate": trans(bake(0, 30, lambda r: (0, 0.6 * math.sin(TAU * 6 * r)), 1))}
    hold_["bones"]["glow"] = {"scale": scale(bake(0, 30, lambda r: HOLD_GLOW + 0.03 * math.sin(math.pi * r) ** 2, 2))}
    out["hold"] = hold_

    # ── land 14f: suspension compression / rebound ──
    L = 14
    land_s = pw((0, 2, lambda r: lerp(1.0, 0.87, ease_out_quad(r))),
                (2, 6, lambda r: lerp(0.87, 1.05, ease_in_out(r))),
                (6, 10, lambda r: lerp(1.05, 0.985, ease_in_out(r))),
                (10, L, lambda r: lerp(0.985, 1.0, ease_in_out(r))))
    land = blank_anim()
    land["bones"]["ground"] = {"scale": SC(lambda f: (1 + (1 - land_s(f)) * 0.3, land_s(f)), L)}
    land["bones"]["chassis"] = {"rotate": R(pw((0, 3, lambda r: -2.6 * ease_out_quad(r)), (3, 8, lambda r: lerp(-2.6, 1.0, ease_in_out(r))),
                                              (8, L, lambda r: lerp(1.0, 0.0, ease_in_out(r)))), L)}
    land["bones"]["body"] = {"translate": TR(lambda f: (0.0, vib(f, 0.8 * (1 - f / L), 9)), L)}
    land["events"] = events((0, "thud"))
    out["land"] = land

    # ── destroy 18f: rides off to the right ──
    N2, GO = 18, 4
    dst = blank_anim()
    dst["bones"]["ground"] = {
        "translate": TR(pw((0, GO, lambda r: (-4 * ease_in_quad(r), 0.0)), (GO, N2, lambda r: (lerp(-4, 1.05 * cmax, ease_in_cubic(r)), 6 * r))), N2),
        "scale": SC(pw((0, GO, lambda r: (1.0, 1 - 0.06 * ease_in_quad(r))), (GO, N2, lambda r: (lerp(1.0, 1.14, r), lerp(0.94, 0.98, r)))), N2)}
    dst["bones"]["chassis"] = {"rotate": R(pw((0, GO, lambda r: 3 * ease_in_quad(r)), (GO, N2, lambda r: lerp(3, 10, ease_out_quad(r)))), N2)}
    dst["bones"]["body"] = {"translate": TR(lambda f: (0.0, vib(f, 1.6, 11) * (1 - f / N2)), N2)}
    dst["slots"]["body"] = {"color": color([(0, 1.0), (10, 1.0), (N2 - 1, 0.0), (N2, 0.0)])}
    dst["slots"]["glow"] = {"color": color([(0, 1.0), (8, 0.0), (N2, 0.0)])}
    dst["slots"]["shine"] = {"color": color([(0, 1.0), (7, 0.0), (N2, 0.0)])}
    dst["events"] = events((1, "vroom"))
    seal_destroy(dst, slots, N2)
    out["destroy"] = dst
    return out


def build_for(name, sparks, canvas_h, canvas_max, ctx=None):
    """Return {idle, win, drop, destroy, ...extras} for `name`, falling back to
    a neutral but still eased/staggered personality for anything not listed
    above. A motion fn may return a 5th element: a dict of extra one-shot
    animations (e.g. the truck's drive_off) merged into the bundle as-is.

    Semantic personalities take a 4th `ctx` argument (slots, bones, manifest,
    meta.json from semantic/make_layers.mjs) and return the finished dict of
    clips directly: idle / win / hold / land / destroy."""
    extra = {}
    if name in MOTION:
        fn = MOTION[name]
        if len(inspect.signature(fn).parameters) >= 4:
            return fn(sparks, canvas_h, canvas_max, ctx or {})
        result = fn(sparks, canvas_h, canvas_max)
        idle, win, drop, destroy = result[:4]
        if len(result) > 4:
            extra = result[4]
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
    return {"idle": idle, "win": win, "drop": drop, "destroy": destroy, **extra}
