# Getaway asset pipeline

Local, dev-only tooling (sharp + ffmpeg-static) that turns Higgsfield generations
into a featherweight, Pixi-ready symbol set. **Nothing here ships in the web bundle**
— it only writes finished art into `public/assets/`.

## Files

| File | Purpose |
|---|---|
| `manifest.mjs` | Single source of truth: every symbol, its tier, size budget, Higgsfield prompt, and which symbols get a win animation. Filenames match `src/pixi/assets.ts`. |
| `lib/image.mjs` | trim → fit → palette-quantize-under-budget (sharp). |
| `lib/sheet.mjs` | Pack frames into a Pixi-native spritesheet atlas (`.png` + `.json`). |
| `compress-symbols.mjs` | Recompress the **existing** symbol PNGs in place (originals backed up to `_originals/`). |
| `import-symbols.mjs` | Process **newly generated** static symbols from `raw/symbols/` → `public/assets/symbols/`. |
| `fetch-generations.mjs` | Download generation result URLs (from `urls.json`) into `raw/`. |
| `video-to-frames.mjs` | Extract frames from `raw/videos/*.mp4` → `frames/<name>/`. |
| `build-sheets.mjs` | Pack `frames/<name>/` → `public/assets/anim/<name>.{png,json}`. |

## Full run (once Higgsfield is funded)

1. **Generate** (agent, via Higgsfield MCP):
   - For each symbol: `generate_image` with `imagePrompt(s)` → `remove_background` → collect result URL.
   - For each animated symbol: `generate_video` with `videoPrompt(s)` → collect URL.
   - Write all results to `urls.json` (`[{ key, url, type }]`).
2. **Fetch**: `node tools/asset-pipeline/fetch-generations.mjs`
3. **Static symbols**: `node tools/asset-pipeline/import-symbols.mjs`
4. **Animations**: `node tools/asset-pipeline/video-to-frames.mjs` then `node tools/asset-pipeline/build-sheets.mjs`

The frontend auto-detects `public/assets/anim/<file>_win.json`; symbols with a sheet
play it on a win, the rest use the procedural glow fallback.

## Size budgets

Per-tier (KB), enforced by the quantizer ladder: hero 120 · mid 70 · pip 45.
The existing set compressed from **4.53 MB → 0.30 MB (−93%)**.
