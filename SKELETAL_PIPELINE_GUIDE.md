# Skeletal Symbol Animation — Full Setup Guide

Hand this file to any Claude conversation. It is the complete, self-contained spec for the
2D skeletal-animation pipeline in this repo: what it is, how to run it, how to add a new
animated symbol, how it plugs into the game, and every gotcha learned the hard way.

**One-line summary:** flat symbol PNG → auto-split into layers → packed atlas + Spine-3.8
JSON rig → per-symbol motion baked in → validated → played in plain PixiJS v8 by our own
`SkelPlayer`. No Spine editor, no `pixi-spine`, no licensing, no pre-rendered video.

---

## 0. Why this exists (don't re-litigate)

- **Free & license-clean.** Interchange format is Spine-3.8-style JSON + libGDX `.atlas` +
  packed PNG, but it is played by `src/pixi/SkelPlayer.ts` — a from-scratch reader of the
  public JSON format. We deliberately do **not** use `pixi-spine` / `@esotericsoftware/spine-pixi`
  (their runtime licence would require every user to hold a paid Spine editor licence).
- **Tiny.** A whole symbol (idle+win+drop+destroy) is ~100–200 KB (one atlas PNG + JSON),
  versus tens of MB for frame-by-frame sprite sheets. Motion is keyframe data, not frames,
  so it stays smooth at any framerate/scale.
- **No rigging by hand.** Layer position on the canvas *is* the pose. Pivots are auto-chosen.

---

## 1. Prerequisites

```bash
pip install pillow
```
Python 3.9+ and Pillow. That is the entire toolchain. (Node/PixiJS is only the runtime side,
already in the app.) All pipeline commands run from `stake-frontend/tools/skel-pipeline/`.

---

## 2. Where everything lives

```
stake-frontend/
  tools/skel-pipeline/
    build_all.py              ← ONE command: builds every symbol end-to-end
    make_parts_generic.py     ← flat symbol.webp → layered parts (glow/body/shine/sparkles)
    symbol_motion.py          ← THE creative file: per-symbol idle/win/drop/destroy motion
    tools/
      pack_atlas.py           ← parts/*.png → packed.png + <name>.atlas + manifest.json
      make_skeleton.py        ← manifest → smart-pivot Spine-3.8 rig (+ default anims)
      anim_lib.py             ← easing/spring/bake helpers (import in symbol_motion)
      validate.py             ← QUALITY GATE. Must PASS or the build aborts.
      build_preview.py        ← optional self-contained preview.html (offline scrubber)
    player/SkelPlayer.js      ← reference runtime (the TS port below is what the game uses)
    symbols/<name>/           ← per-symbol working dir (parts/, manifest, atlas, json)
    AGENTS.md / README.md     ← original pipeline docs (binding motion rules)

  src/pixi/
    SkelPlayer.ts             ← TypeScript runtime player (Pixi v8, ~300 lines, no Spine)
    assets.ts                 ← SKEL_ASSETS map + createSkelSymbol() loader
    SymbolView.ts             ← per-cell: plays idle on loop, win on win, destroy on vanish

  public/assets/skel/<name>/  ← SHIPPED bundle: <name>.json + <name>.atlas + packed.png
  public/assets/symbols/<name>.webp  ← the flat source art the pipeline reads
```

---

## 3. The build — one command

From `stake-frontend/tools/skel-pipeline/`:

```bash
python build_all.py                 # every symbol in ALL_SYMBOLS
python build_all.py pistol knife    # just these
python build_all.py --skip=safe     # skip some
```

Pillow is optional: without it `build_all.py` uses the Node twins of the packer/shipper
(`semantic/pack_atlas.mjs`, `semantic/ship.mjs`, byte-identical output) and reuses the generic
parts already in `symbols/<name>/parts`. Motion, rig and validation are plain Python.

### Semantic rigs (real moving parts) — pistol, ammo, cash, duffel, knife, diamond

These don't use the glow/body/shine split. `semantic/make_layers.mjs <name>` (Node + sharp) runs
`semantic/symbols/<name>.mjs`, which cuts or paints REAL parts and paints whatever a moving part
uncovers (never holes): the pistol's slide on its seam with barrel/guide rod/spring painted
beneath; one vector cartridge per layer; a fan of real `real_bill.webp` notes in a money clip;
the duffel's loot/pocket/handle/zipper with painted insides; the knife's blade + glint flipbook;
the diamond split into its own facets (light bands + shards). Each module also writes
`rig.json` (group bones, reparenting, hidden FX slots, `lowres` parts, `shipLossy`),
`pivots.json` and `meta.json` (geometry the motion reads). `--debug` writes `_rest.png`,
`_layer_*.png` and a rest-pose reconstruction check against the source (must be ~0).

Semantic clips (see `src/pixi/symbolFlow.ts`): `idle`, `win` (ends on `hold`'s first pose),
`hold` (loop shown until the symbol is destroyed or released), `land` (touchdown impact — starts
and ends at rest; BoardView owns the fall), `destroy`. Clip `events` (e.g. `fire`, `rattle`,
`flick`) drive the synthesized foley in `src/audio/SymbolFoley.ts`.

Inspect any clip offline: `node semantic/render.mjs symbols/<name> <clip> --every=2` writes a
contact sheet (same pose maths as SkelPlayer) — the in-app browser pauses rAF when hidden.

**Do not rebuild `wild_symbole` / `cyan_car_wild`** — the owner wants them exactly as they are;
their shipped files are hash-pinned in `src/__tests__/skelBundles.test.ts`.

For each symbol `build_all.py` chains, and **aborts if any step fails**:

1. `make_parts_generic.build(name)` — reads `public/assets/symbols/<name>.webp`, trims it,
   scales the art to **72% of a ~320px canvas** (≥15% transparent margin so win-pop / destroy
   never clip), and writes layers to `symbols/<name>/parts/`:
   `01_glow`, `02_body`, `03_shine`, and `04_sparkle_*` (only if that symbol opts into sparkles).
2. `tools/pack_atlas.py` → `packed.png` + `<name>.atlas` + `manifest.json`.
3. `tools/make_skeleton.py` → `<name>_source.json` (pristine rig, smart pivots).
4. `symbol_motion.build_for(name, ...)` replaces the default anims with the symbol's
   **personality** and writes `<name>.json`.
5. `tools/validate.py` — the gate. Must print `PASS`.
6. Ships `<name>.json` + `<name>.atlas` + `packed.png` to `public/assets/skel/<name>/`.

At the end it prints the `fitW / fitH` line for each symbol — **you paste that into
`SKEL_ASSETS` in `assets.ts`** (see §7). `fitW/fitH` = the ART content size inside the padded
canvas; the game scales the player so the art (not the empty margin) fills the cell.

---

## 4. Art input rules — THIS decides final quality

The pipeline is lossless; blurry output = blurry input. For each symbol drop **one flat PNG/webp**
at `public/assets/symbols/<name>.webp`:

- **~512 px on the long side**, background fully transparent (alpha 0, not "nearly black" — a dark
  halo reads as a grey box in-game), hard clean edges.
- **Face-on, centred, no baked perspective/rotation.** The pipeline adds motion; pre-angled art
  can't be posed.
- **No baked text, drop shadows, or ground shadow** — the engine lights it.
- Keep source masters OUTSIDE the repo (budget). Re-encode to webp q85–88.

That is all the pipeline needs — it splits the single flat image itself. Do **not** hand-cut a
flat image into geometric pieces: a flat image has no joint overlap and no fill behind occluders,
so pieces tear open when they move. The body stays whole; personality comes from motion.

---

## 5. `symbol_motion.py` — the creative core (add a personality)

Motion is authored per symbol so each reads as *what it is*. Current personalities:

| symbol | idle | win |
|---|---|---|
| pistol | steady aim, muzzle micro-drift | **shot** — slide cycles on its rail, muzzle flash, casing ejects on an arc, smoke; destroy: slide locks back and strips off |
| knife | slow menacing tilt | **flip** with a slash arc, glint rolls heel→tip; destroy: edge-on into a line of light |
| brass_knuckles | heavy rock | **punch** — loaded wind-up, dead stop, ground-pivot squash; destroy: dead weight drop |
| ammo | rounds rock out of phase | **jolt** — every cartridge hops/rattles on its own beat; destroy: rounds eject on separate arcs |
| duffel | breathes (stuffed) | **heave** — loot spills up and drops back, handle flops; destroy: bursts, loot blows out |
| cash | notes breathe apart | **fan snaps open**, notes thumb-flicked off ("make it rain", paper physics); destroy: clip pops, fan bursts into falling notes |
| bike | 6-cycle engine idle vibration | **rev + wheelie** about the rear tyre, suspension takes the drop; destroy: rides off right |
| diamond | faint light drifts through facets | jeweller's tilt, refraction wave across facets, table flash; destroy: shatters along its facets |
| wild | cloth sway | flutter pop |
| cyan_car_wild (phone) | quiet, screen pulse | **ring** — 13-cycle buzz |
| burner_phone (truck) | suspension bob | **lurch** forward |
| safe | rigid (<1°), dial idle | **crack** — dial whirl, door pop |
| master_key | arcane float | **turn** 90° like a lock |

The semantic personalities (pistol … diamond, brass, bike) take a 4th `ctx` argument and return
the clip dict directly (`idle/win/hold/land/destroy`); the truck adds a `land` clip only.

**To add/edit a personality**, register a function with `@motion("<name>")` returning
`(idle, win, drop, destroy)` — or a 5th element, a dict of extra one-shots (e.g. the truck's
`drive_off`). Anything not registered falls back to a neutral-but-eased default. Build motion
with `anim_lib` helpers (`bake`, `damped`, `ease_out_cubic`, `seg`, `rot`, `scale`, `trans`,
`hold`, `color`) — **never hand-place sparse linear keys** (reads robotic) and **never emit
Bezier `curve` arrays** (break the Spine-3.8 importer). Eases are sampled into dense linear keys.

### Motion contract (validate.py enforces it)
- `idle` — seamless loop, first key value == last per timeline (E5). Subtle: breathing ≤1.5%,
  sway ≤2.5° (rotating the whole symbol >~2° reads as jelly).
- `win` — ~1.3s one-shot: anticipation → overshoot pop → damped settle, staggered parts.
- `drop` — gravity fall + impact squash + damped recover.
- `destroy` — **must end fully invisible: every slot alpha `00`** (E6), or the build fails.
- Integer 30fps frames only. Sparkles need step=1 sampling (a narrow power-8 pulse trips W3 at
  step 2). Fast spins need `smoothstep`, not `ease_out_cubic` (front-loads too much → W3 teleport).

---

## 6. `sparkles` — off by default

In `make_parts_generic.py`, `SYMBOL_FX` maps each name to `(glow_tint, [sparkles])`. Sparkles
(twinkling stars) are **empty `[]` for almost everything** — on a gun/knife/bag they read as
cartoon and fight the GTA tone. Only things that genuinely catch light keep them (diamond keeps 3,
wild keeps 1 tuned as a slow neon flicker). Add a sparkle as `(size_frac, (r,g,b), x_frac, y_frac)`.

---

## 7. Game integration (3 touch-points)

**a) `src/pixi/assets.ts` — register the bundle.** Add one line to `SKEL_ASSETS`, using the
`fitW/fitH` that `build_all.py` printed:
```ts
const SKEL_ASSETS: Partial<Record<SymbolId, { dir: string; fitW: number; fitH: number }>> = {
  PISTOL: { dir: "skel/pistol", fitW: 230, fitH: 191 },
  // ...
};
```
The loader fetches `<dir>/<name>.json`, `.atlas`, `packed.png`; a missing bundle logs a warning
and the symbol falls back to its static sprite. `createSkelSymbol(id)` returns a fresh
`SkelPlayer` per cell (cheap — instances share one base texture).

**b) `src/pixi/SymbolView.ts` — already wired, no change needed per symbol.** On construct it
calls `createSkelSymbol(id)`; if present it adds the player, plays `idle` looped on the shared
`ambientTicker`, and swaps `win`/`destroy` for the static-sprite pop on wins/vanish. `fitW/fitH`
drives the scale so the art fills the cell.

**c) Nothing else.** The reels already render `SymbolView`s, so a newly registered symbol just
works.

`SkelPlayer.ts` supports: bone rotate/translate/scale, slot color (alpha+tint), attachment
swaps, stepped keys, slot draw order. **Not** supported: meshes/deform, IK, draworder timelines,
Bezier curve arrays — keep JSON inside that subset.

---

## 8. Add a brand-new animated symbol — checklist

1. Put flat art at `public/assets/symbols/<name>.webp` (§4 rules).
2. (Optional) add a `@motion("<name>")` personality in `symbol_motion.py`; else it uses the
   neutral default.
3. (Optional) add sparkles/glow tint in `make_parts_generic.py` `SYMBOL_FX`.
4. Add `<name>` to `ALL_SYMBOLS` in `build_all.py` (EMPTY is excluded on purpose).
5. `python build_all.py <name>` → confirm it prints `PASS` and a `fitW/fitH` line.
6. Paste that `fitW/fitH` into `SKEL_ASSETS` in `assets.ts`.
7. `npx tsc --noEmit && npm run build`, then run the game and watch idle/win.

---

## 9. Gotchas (all learned the hard way — read before debugging)

- **`fitW/fitH` is the ART content size, not the canvas.** Wrong value = symbol renders too
  small/large in its cell. Always paste the number `build_all.py` prints.
- **`--noupscale` for low-res source.** `prep_art.py --noupscale` re-encodes without enlarging;
  upscaling a 200px symbol just makes a bigger blurry symbol. Regenerate art instead.
- **Some modules overwrite their own static art** (`public/assets/symbols/{ammo,cash,knife,
  diamond}.webp` are written by their semantic modules). The knife and diamond read their
  pristine originals from `semantic/symbols/{knife,diamond}.source.webp`, so rebuilds are
  idempotent — never delete those.
- **`destroy` must reach alpha 00 on every slot** or `validate.py` E6 fails the build. If you add
  a layer (e.g. shine as a flying shard), fade it too.
- **Tint must stay 0–255 per channel.** `(ch<<16)|(ch<<8)|ch` with `ch=256` produces `0x1010100`,
  which Pixi rejects and throws mid-tween (froze the truck doors). Clamp shade to `[0,1]` and
  guard negative angles with `Math.max(0, …)`.
- **mock-rgs caches books at boot.** After any math/asset change that the RGS serves, **restart
  the dev server** — HMR alone won't reload it.
- **Preview pane pauses `requestAnimationFrame`.** When verifying in the in-app browser, animation
  frames don't run and canvas screenshots time out; verify geometry/state via `javascript_tool`
  probes and numeric checks, and let the human judge feel.
- **Reels use the skeletal atlases, not the flat webp,** once a bundle is registered. If art looks
  stale after regenerating, hard-reload (there's a `CACHE_BUST` query on the skel fetches).

---

## 10. Verify

```bash
cd stake-frontend/tools/skel-pipeline
python tools/validate.py symbols/<name>      # must print PASS (0 errors)
python tools/build_preview.py symbols/<name> # open symbols/<name>/preview.html to scrub
cd ../.. && npx tsc --noEmit && npm run build # green
```
`validate.py` gates: E1 3.8 skin form · E2 no curve arrays · E3 angle/hex/monotonic · E4 integer
30fps frames · E5 idle loop closes · E6 destroy ends invisible · E7 setup-pose reconstruction
≤0.05px · E8 atlas coverage. Warnings W1–W3 (size mismatch, part count, teleporty jumps) are
advisory — explain them, don't ignore silently.
