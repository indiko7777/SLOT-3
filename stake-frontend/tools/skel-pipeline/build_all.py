#!/usr/bin/env python3
"""Build skeletal bundles for every Heat Chase symbol, end to end.

For each symbol:  parts -> atlas -> rig -> per-symbol motion -> validate -> ship

  python build_all.py                # every symbol
  python build_all.py pistol knife   # just these
  python build_all.py --skip=diamond # diamond keeps its hand-authored gen_anim.py

Ships the bundle to public/assets/skel/<name>/ and prints the fitW/fitH pair
that assets.ts needs (the ART size inside the padded canvas, so SymbolView
scales the art to the cell rather than the empty margin).
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_parts_generic import build as build_parts  # noqa: E402
from symbol_motion import build_for  # noqa: E402

PUBLIC_SKEL = HERE.parents[1] / "public" / "assets" / "skel"

# Every symbol that gets a skeletal bundle. EMPTY is excluded on purpose: it is
# the blank bonus-cell tile and must stay visually inert.
ALL_SYMBOLS = [
    "brass_knuckles", "knife",                      # low
    "pistol", "ammo", "duffel",                     # mid
    "cash", "diamond", "bike",                      # premium
    "wild_symbole", "cyan_car_wild", "burner_phone",  # specials / scatter
    "safe", "master_key",                           # bonus
]


def run(*args) -> str:
    r = subprocess.run([sys.executable, *[str(a) for a in args]],
                       capture_output=True, text=True, cwd=str(HERE))
    if r.returncode != 0:
        raise RuntimeError(f"{args[0]} failed:\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()


def build_symbol(name: str, max_side: int = 320) -> dict:
    d = HERE / "symbols" / name
    canvas, art, nparts = build_parts(name, max_side)

    run(HERE / "tools" / "pack_atlas.py", d)
    run(HERE / "tools" / "make_skeleton.py", d)

    # Replace the generic default animations with this symbol's personality.
    src = json.loads((d / f"{name}_source.json").read_text())
    parts = [s["name"] for s in src["slots"]]
    sparks = [p for p in parts if p.startswith("sparkle")]
    src["animations"] = build_for(name, sparks, canvas[1], max(canvas))
    (d / f"{name}.json").write_text(json.dumps(src, separators=(",", ":")))

    # run() already raises on a non-zero exit, so reaching here means the gate
    # passed; WARN lines may precede the PASS line, so don't match on prefix.
    out = run(HERE / "tools" / "validate.py", d)
    summary = next((ln for ln in out.splitlines() if ln.startswith("PASS")), "")
    if not summary:
        raise RuntimeError(f"{name}: validator did not report PASS:\n{out}")
    warns = [ln for ln in out.splitlines() if ln.startswith("WARN")]

    dst = PUBLIC_SKEL / name
    dst.mkdir(parents=True, exist_ok=True)
    for f in (f"{name}.json", f"{name}.atlas", "packed.png"):
        (dst / f).write_bytes((d / f).read_bytes())

    kb = sum((dst / f).stat().st_size for f in (f"{name}.json", f"{name}.atlas", "packed.png")) / 1024
    return {"name": name, "canvas": canvas, "fit": art, "parts": nparts,
            "kb": kb, "validate": summary, "warns": warns}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    skip = set()
    for a in sys.argv[1:]:
        if a.startswith("--skip="):
            skip |= {s.strip() for s in a.split("=")[1].split(",")}
    names = args or [n for n in ALL_SYMBOLS if n not in skip]

    results, failed, total = [], [], 0.0
    for n in names:
        try:
            r = build_symbol(n)
            results.append(r)
            total += r["kb"]
            print(f"OK  {n:16s} canvas {r['canvas'][0]}x{r['canvas'][1]:<4} "
                  f"art {r['fit'][0]}x{r['fit'][1]:<4} {r['parts']} parts  "
                  f"{r['kb']:6.1f} KB  {r['validate']}")
            for w in r["warns"]:
                print(f"       {w}")
        except FileNotFoundError as e:
            failed.append((n, "source art missing (symbol deleted from public/assets/symbols)"))
            print(f"SKIP {n}: {e}")
        except Exception as e:  # keep going; report everything at the end
            failed.append((n, str(e).split("\n")[0]))
            print(f"FAIL {n}: {str(e)[:200]}")

    print(f"\n{len(results)} built, {total:.0f} KB total")
    if failed:
        print("FAILURES:")
        for n, e in failed:
            print(f"  {n}: {e}")
    print("\n--- paste into SKEL_ASSETS in src/pixi/assets.ts ---")
    for r in results:
        print(f'  {r["name"]}: fitW: {r["fit"][0]}, fitH: {r["fit"][1]},')


if __name__ == "__main__":
    main()
