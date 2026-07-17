# slot-anim-pipeline

Free, AI-driven 2D skeletal animation for slot symbols. No Spine, no
DragonBones, no subscriptions. Art layers in -> Spine-3.8-format JSON + atlas
out -> played in plain Pixi v8 by the included `SkelPlayer.js` (written from
scratch, zero Spine-runtime code, so no Spine license entanglement).

Quality is enforced, not hoped for: smart pivots, an easing/spring library that
bakes into import-safe keys, and a validator that fails the build on the
classic slop patterns.

## Quickstart

    pip install pillow

    python tools/pack_atlas.py     symbols/<name>
    python tools/make_skeleton.py  symbols/<name>
    python tools/validate.py       symbols/<name>
    python tools/build_preview.py  symbols/<name>

Open `symbols/<name>/preview.html` (double-click, works offline): you already
have eased idle / win / drop / destroy with correct pivots, gravity, squash,
scatter. Then let an AI agent make them symbol-specific (step 3 below).

## 1. Art rules (THIS decides your final quality)

Put every layer as a full-canvas PNG in `symbols/<name>/parts/`. Same canvas
size for all. Numeric prefix = draw order: `01_glow.png` (back) ...
`06_sparkle.png` (front). Position on canvas IS the pose - no rigging needed.

- **4-8 parts** for a typical symbol. Classic gem recipe: glow, body, shine,
  2 sparkles. Classic character head: hair_back, head, ear_l, ear_r, brows,
  eyes, mouth, accessory.
- **Overlap joints 10-20%.** Where an ear meets the head, the ear PNG must
  extend INTO the head area. Non-overlapping cuts = visible gaps when parts move.
- **Paint fill behind occluders.** If a part sits on top of another (mouth on
  face), the face layer must be complete underneath. Photopea: select the hole,
  Edit > Fill > Content-Aware (free).
- **>=15% empty margin** around the whole symbol on the canvas, or win-pop and
  destroy-scatter get cropped. `pack_atlas.py` warns if you break this.
- **Unique names** after the prefix (`01_body`, `02_body` = error).
- Name parts semantically: `ear_l`, `flame_tip`, `letter_K` - the AI reads
  names to decide motion.
- Hard edges beat soft AI-fuzz. Clean cutout edges in Photopea (Select >
  Subject, then refine) before splitting; transparent halos look terrible in motion.

**Getting layers out for free:** Photopea.com (free, browser Photoshop) - open
your art, cut each part to its own layer (Lasso > Layer Via Cut), then for each
layer: hide all others, File > Export as > PNG (keeps full canvas). Krita:
Tools > Scripts > Export Layers, "adjust to layer content" OFF.

**AI-generating the art:** prompt for "single slot machine symbol, centered,
flat plain background, nothing cropped" - then background-remove and split.
Even better: after generating the assembled symbol, ask the image model for the
occluded parts separately ("same ear, full shape, isolated") so overlaps are real.

## 2. Build + preview (the four commands above)

`make_skeleton.py` prints its pivot table. Appendages automatically pivot at
their inner edge (base), not their centre. Wrong pivot? Create `pivots.json`:
`{"flame": [150, 210]}` (canvas pixels, y down), re-run make_skeleton.

## 3. Make it symbol-specific with AI

Point Claude Code / Cowork / codex at the repo and say:

    Animate symbols/<name> per AGENTS.md. It's a <what it is>.
    idle subtle, win explosive, destroy shatters outward.

AGENTS.md forces the agent to: look at your art first, use the easing library
(baked springs, never robotic linear keys), stagger parts, respect pivots, and
pass `validate.py` before claiming done. If validate fails, the agent keeps fixing.

## 4. Optional visual polish (free GUI)

https://www.keyframe.it.com - free browser editor, imports/exports these exact
Spine bundles (`<name>.json` + `.atlas` + `packed.png`), has AI rigging/
animation assist and a one-click slot pack (idle/win/drop/destroy). Nudge
timing there, re-export, run `validate.py` + `build_preview.py` again.

## 5. Play it in your game (Pixi v8, no plugins)

    import { SkelPlayer } from './player/SkelPlayer.js';
    const sym = await SkelPlayer.load({ json:'gem.json', atlas:'gem.atlas', png:'packed.png' });
    app.stage.addChild(sym);                       // origin = symbol centre
    app.ticker.add(tk => sym.update(tk.deltaMS / 1000));
    sym.play('drop', { onComplete: () => sym.play('idle', { loop: true }) });

Playing any animation resets to setup pose first, so a destroyed symbol reused
from a pool just needs `play('drop')`.

## Troubleshooting

| Symptom | Cause -> fix |
|---|---|
| Gaps open at joints | No overlap in the cuts -> re-export layers with 10-20% overlap |
| Hole appears behind a moving part | Occluded area never painted -> content-aware fill that layer |
| Part swings like a fridge magnet | Wrong pivot -> `pivots.json`, re-run make_skeleton |
| Symbol crops during win/destroy | No canvas margin -> re-export with >=15% margin |
| Motion feels robotic | Sparse linear keys -> author via anim_lib `bake`+`damped` |
| Everything wobbles together | No stagger -> offset starts 1-3f, alternate directions |
| Preview fine, game flipped/misplaced | You changed atlas or JSON by hand -> run validate.py |

## Why this stack (July 2026)

- **Spine editor**: replaced by pack_atlas + make_skeleton (layer position = pose).
- **pixi-spine / @esotericsoftware/spine-pixi**: avoided deliberately - the Spine
  Runtimes license requires every user to hold a paid Spine editor license.
  `SkelPlayer.js` implements the public JSON format from scratch. (Not legal
  advice; it's the conservative position.)
- **Rive**: free editor, but $9/mo to export `.riv`, and no Spine-JSON interchange.
- **DragonBones**: free but abandoned - what you're escaping.
- **keyframe.it.com**: free Spine-compatible browser editor - your refinement GUI.

## Files

    tools/pack_atlas.py      layers -> packed.png + .atlas + manifest.json (+art warnings)
    tools/make_skeleton.py   manifest -> smart-pivot rig + eased default anims
    tools/anim_lib.py        easing/spring/bake library (used by generators & agents)
    tools/validate.py        quality gate - run after every edit
    tools/build_preview.py   -> self-contained preview.html (scrubber, offline)
    player/SkelPlayer.js     Pixi v8 runtime player (~300 lines, yours, MIT-free)
    AGENTS.md                binding instructions for AI agents
    example/gem/             worked example incl. preview.html

Supported at runtime: bone rotate/translate/scale, slot color (alpha+tint),
attachment swaps, stepped keys, slot draw order. Not supported: meshes/deform,
IK, draworder timelines, Bezier curve arrays.
