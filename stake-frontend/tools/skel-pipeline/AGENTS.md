# Slot Symbol Skeletal Animation Instructions (no Spine editor)

Use these instructions whenever the user asks to animate a symbol folder
(`parts/*.png` + generated `manifest.json`, `packed.png`, `<symbol>.atlas`,
`<symbol>.json`).

## Pipeline

1. Missing `manifest.json`? -> `python tools/pack_atlas.py <symbol_dir>`
   Treat its WARN lines as action items for the user (edge cropping, too few parts).
2. Missing `<symbol>.json`? -> `python tools/make_skeleton.py <symbol_dir>`
   You get a pivot-corrected rig + eased default idle/win/drop/destroy.
3. Your job: make the motion SPECIFIC to this symbol (a crown pops differently
   than a flame). Write `gen_anim.py` in the symbol folder; never hand-edit the
   big JSON.
4. Gate + preview after EVERY edit - not optional:
       python tools/validate.py <symbol_dir>     # must PASS
       python tools/build_preview.py <symbol_dir>

## Step 0 - LOOK at the art

Open the part PNGs / preview image and identify what the object is and what
each part is. If parts are unclear, badly cut (gaps at joints, no fill behind
occluders), or the symbol touches the canvas edge, STOP and tell the user how
to fix the art first (see README "Art rules"). No animation rescues bad cuts.

## Motion authoring - HARD RULES

- Author every organic move with `tools/anim_lib.py` (import it in gen_anim.py)
  and BAKE: eases/springs sampled every 1-3 frames into plain linear keys.
  Sparse hand-placed linear keys are banned for organic motion - they read
  robotic. Bezier `curve` arrays are banned - they break importers.
- Structure every accent move as: anticipation (small counter-move, 2-4f) ->
  action (ease-out, 4-8f) -> damped settle (`damped`/`damped_sin`, 8-20f).
- Stagger: offset sibling parts 1-3 frames and alternate rotation direction
  (`per(i)` pattern). Never move all parts in sync - that is the #1 slop tell.
- Pivots before keys: appendages swing from their base, not their centre.
  make_skeleton auto-picks inner-edge pivots; fix wrong ones via `pivots.json`
  ({"part": [px, py] canvas pixels, y down}) and re-run make_skeleton, or move
  the bone yourself WITH attachment compensation: attachment.x/y must change by
  the opposite amount so the world setup pose is unchanged (validate.py E7
  catches drift).
- Banned looks: whole-symbol jelly wobble (rotate on symbol_anchor > ~2 deg),
  centre-pivot appendage rotation, uniform synchronized part motion, linear
  constant-speed moves, drop without impact squash, destroy that just fades.

## Required animations (unless told otherwise)

- `idle` 1.5-2.5s seamless loop (validate checks closure). Subtle: breathing
  scale <=1.5%, sway <=2.5 deg, effect twinkle. Must read as "alive", not busy.
- `win` 1-1.5s one-shot: anticipation dip -> overshoot pop (1.1-1.2x,
  `ease_out_cubic`/`ease_out_back`) -> damped settle; staggered part bursts;
  flare any glow/sparkle parts. Big, readable, celebratory.
- `drop` 0.5-0.8s: gravity fall (`ease_in_quad` on y, distance ~0.9x canvas
  height), impact squash (x up / y down 10-16%), damped recovery, part jiggle.
- `destroy` 0.6-1s: ends FULLY invisible (alpha 00 every slot). Scatter, spin,
  or collapse - make it specific to the symbol.
- Timing: integer 30fps frames only (`T(frame)` from anim_lib).

## Rig upgrades (when the symbol needs them)

- Chains for follow-through: split visual appendages into base/tip bones
  (tip child of base, keys lag 2-3 frames). Only when the art has such parts.
- Reparent semantically (ear_tip under ear_base under head). Recompute locals
  so world setup pose is unchanged; validate.py must still PASS.
- No meshes/deform timelines - the runtime player skips them (mesh work happens
  manually in keyframe.it). No draworder timelines. Slots/attachment + color
  timelines are fine for expression swaps and fades.

## JSON schema rules (Spine 3.8 / keyframe.it import-safe)

- Rotate keys: `angle`. Translate/scale: `x`/`y`. Colors: 8-digit hex RGBA.
- No `curve` arrays, no `c2/c3/c4`. `"curve": "stepped"` only when needed.
- `skins`: 3.8 object form `{"default": {slot: {att: {...}}}}`.
- `<symbol>_source.json` stays pristine; gen_anim.py reads it, writes `<symbol>.json`.

## Definition of done

validate.py PASSES (0 errors; explain any warnings), preview rebuilt, and you
report: what the symbol is, pivot decisions, rig changes, animation list with
durations and the motion ideas used, files changed.
