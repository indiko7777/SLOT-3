"""Animation authoring library: eased motion baked into dense, import-safe keys.

Why baking: Spine 3.8 / keyframe.it importers choke on Bezier `curve` arrays,
and pure linear keys look robotic. Solution: author with easing/spring
functions, sample them every 1-3 frames, emit plain linear keys. Smooth in any
runtime, safe in any importer.

Use from generator scripts (gen_anim.py):
    import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))
    from anim_lib import *

Conventions: values are RELATIVE to setup pose (rotate/translate add, scale
multiplies). Frames are integers at 30fps; T(frame) -> seconds.
"""
import math

FPS = 30


def T(f):
    return round(round(f) / FPS, 5)


# --- easing, r in 0..1 -------------------------------------------------------
def lin(r): return r
def ease_in_quad(r): return r * r
def ease_out_quad(r): return 1 - (1 - r) ** 2
def ease_in_cubic(r): return r ** 3
def ease_out_cubic(r): return 1 - (1 - r) ** 3


def ease_out_back(r, k=1.70158):
    r -= 1
    return 1 + r * r * ((k + 1) * r + k)


def damped(r, cycles=1.4, damp=3.2):
    """Decaying cosine, 1 -> ~0. Overshoot/settle: v = target + A*damped(r)."""
    return math.exp(-damp * r) * math.cos(2 * math.pi * cycles * r)


def damped_sin(r, cycles=1.3, damp=3.0):
    """Decaying sine, 0 -> ~0. Impact jiggle that starts and ends at rest."""
    return math.exp(-damp * r) * math.sin(2 * math.pi * cycles * r)


# --- key baking --------------------------------------------------------------
def bake(f0, f1, fn, step=2):
    """Sample fn(r) at integer frames f0..f1 inclusive -> [(frame, value)]."""
    keys, f = [], f0
    while f < f1:
        keys.append((int(round(f)), fn((f - f0) / (f1 - f0))))
        f += step
    keys.append((int(round(f1)), fn(1.0)))
    return keys


def hold(f0, f1, val=0.0):
    return [(int(f0), val), (int(f1), val)]


def seg(*segments):
    """Concatenate key segments; drops duplicate boundary frames."""
    out = []
    for s in segments:
        for f, v in s:
            if out and f <= out[-1][0]:
                if f == out[-1][0]:
                    continue
                raise ValueError(f"non-monotonic keys at frame {f}")
            out.append((f, v))
    return out


# --- Spine timeline emitters -------------------------------------------------
def rot(keys):
    return [{"time": T(f), "angle": round(v, 2)} for f, v in keys]


def scale(keys):
    out = []
    for f, v in keys:
        x, y = v if isinstance(v, (tuple, list)) else (v, v)
        out.append({"time": T(f), "x": round(x, 4), "y": round(y, 4)})
    return out


def trans(keys):
    return [{"time": T(f), "x": round(v[0], 1), "y": round(v[1], 1)} for f, v in keys]


def color(keys, rgb="ffffff"):
    out = []
    for f, a in keys:
        a = max(0.0, min(1.0, a))
        out.append({"time": T(f), "color": rgb + format(round(a * 255), "02x")})
    return out
