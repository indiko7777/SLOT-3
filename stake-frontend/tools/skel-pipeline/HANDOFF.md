# HANDOFF - full context for Claude (or any AI agent) on a new machine

Read this first, then AGENTS.md. You are picking up a finished, verified v2
pipeline. Do not re-derive decisions below unless the user asks.

## Who / goal / constraints

- User: indie slot-game developer (Stake-ecosystem RGS community).
- Goal: strong 2D skeletal animations for slot symbols from layered images,
  AI-assisted, beginner-safe.
- Constraints: 100% free. No Spine editor (won't buy). Owns DragonBones but
  finds it unusable. Game runtime: **plain PixiJS v8, NO spine plugin** -
  custom rendering, so the included player is used.

## Key decisions already made (July 2026, researched + verified)

1. **Interchange format: Spine 3.8 JSON + libGDX .atlas + packed PNG.**
   Chosen because keyframe.it.com (free browser Spine-alternative from the
   user's Discord, by "KC | 0DayGames") imports/exports exactly these bundles,
   and the schema is well understood by AI agents.
2. **Do NOT use pixi-spine or @esotericsoftware/spine-pixi.** The Spine
   Runtimes license requires every user to hold a paid Spine editor license
   (esotericsoftware.com/blog/Our-new-licensing-explained). `player/SkelPlayer.js`
   is a from-scratch implementation of the public JSON format - no licensed code.
3. **Rive rejected:** editor free, but $9/mo Cadet needed to export .riv, and
   no Spine-JSON interchange (rive.app/pricing).
4. **No Bezier `curve` arrays in JSON** - they break Spine 3.8 import and
   importer parity. Instead: eased/spring motion is BAKED into dense linear
   keys via tools/anim_lib.py (sample every 1-3 frames).
5. **Pivot correctness over mesh features.** Appendages pivot at their inner
   edge (auto-heuristic in make_skeleton.py, override via pivots.json).
   Meshes/IK/draworder timelines are intentionally unsupported at runtime;
   mesh work happens manually in keyframe.it if ever needed.
6. **Quality is gated, not advisory:** tools/validate.py must PASS (exit 0)
   after every JSON edit. AGENTS.md binds agents to it.

## Workflow (beginner path)

    pip install pillow
    # art layers -> symbols/<name>/parts/*.png (full-canvas, numeric prefixes)
    python tools/pack_atlas.py     symbols/<name>
    python tools/make_skeleton.py  symbols/<name>   # rig + eased default anims
    python tools/validate.py       symbols/<name>   # must PASS
    python tools/build_preview.py  symbols/<name>   # open preview.html

Then the agent (you) makes motion symbol-specific per AGENTS.md, writing
gen_anim.py with anim_lib helpers. Art rules that decide quality are in
README.md section 1 - check the user's art against them FIRST.

## State of this repo

- example/gem/ is a fully working worked example (generated test art).
- Everything verified: validator PASS 0 warnings; 1220 headless pose samples
  (no NaN, no teleports); idle loops exactly; destroy ends invisible;
  setup-pose reconstruction matches manifest to <0.05px; SkelPlayer.js and
  preview logic both node-checked and runtime-tested headlessly.
- v1 flaws already fixed in v2 (don't reintroduce): centre pivots on
  appendages, sparse linear keys, whole-symbol jelly wobble, hardcoded drop
  height, no art guidance, no validation gate.

## File map

    AGENTS.md                     binding animation instructions for agents
    README.md                     human guide: art rules, workflow, troubleshooting
    HANDOFF.md                    this file
    tools/pack_atlas.py           layers -> atlas + manifest (+art warnings)
    tools/make_skeleton.py        manifest -> smart-pivot rig + default anims
    tools/anim_lib.py             easing/spring/bake library
    tools/validate.py             quality gate (run after every edit)
    tools/build_preview.py        self-contained preview.html builder
    player/SkelPlayer.js          Pixi v8 runtime player (no Spine code)
    example/gem/                  worked example incl. preview.html
    reference/original_discord_AGENTS.md  the Discord workflow this evolved from
                                  (assumed Spine editor exports; ours does not)

## Useful links

- keyframe.it.com - free Spine-compatible browser editor (refinement GUI)
- rive.app/pricing - why Rive was rejected
- esotericsoftware.com/blog/Our-new-licensing-explained - runtime license issue
