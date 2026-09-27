#!/usr/bin/env node
/**
 * Build SEMANTIC layers for a symbol (a pistol's frame / slide / casing /
 * muzzle flash, individual cartridges, loose bills…) — the replacement for
 * make_parts_generic.py's glow + whole-body + shine split on symbols whose
 * animation needs real moving parts.
 *
 *   node semantic/make_layers.mjs <name> [--debug]
 *
 * Each symbol lives in semantic/symbols/<name>.mjs and returns its layers
 * (full-canvas rasters, bottom first) plus pivots / rig / meta. Hidden areas
 * that a moving part uncovers are PAINTED, never left as holes.
 *
 * Writes symbols/<name>/parts/NN_<layer>.png, pivots.json, rig.json,
 * meta.json, and prints one JSON line: {"canvas":[w,h],"art":[w,h],"parts":n}.
 * With --debug also writes _rest.png (layers composited at rest over the
 * original) and reports the rest-pose reconstruction error.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { save, flatten, blank, over } from "./img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.resolve(HERE, "..");

async function main() {
  const name = process.argv[2];
  const debug = process.argv.includes("--debug");
  if (!name) { console.error("usage: node semantic/make_layers.mjs <name> [--debug]"); process.exit(1); }
  const mod = await import(pathToFileURL(path.join(HERE, "symbols", `${name}.mjs`)).href);
  const res = await mod.build({ debug });
  const dir = path.join(PIPE, "symbols", name);
  const parts = path.join(dir, "parts");
  fs.mkdirSync(parts, { recursive: true });
  for (const f of fs.readdirSync(parts)) if (f.endsWith(".png")) fs.unlinkSync(path.join(parts, f));
  let i = 1;
  for (const l of res.layers) {
    await save(l.raster, path.join(parts, `${String(i).padStart(2, "0")}_${l.name}.png`));
    i++;
  }
  fs.writeFileSync(path.join(dir, "pivots.json"), JSON.stringify(res.pivots || {}, null, 1));
  fs.writeFileSync(path.join(dir, "rig.json"), JSON.stringify(res.rig || {}, null, 1));
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(res.meta || {}, null, 1));
  if (res.staticArt) await save(res.staticArt, path.join(dir, "_static.png"));

  if (debug || res.checkAgainst) {
    // Rest pose = every layer that is visible at setup, excluding the aura.
    const hidden = new Set([...(res.rig?.hidden || []), ...(res.noRestCheck || [])]);
    const rest = res.layers.filter((l) => !hidden.has(l.name) && l.name !== "glow");
    const comp = blank(res.canvas[0], res.canvas[1]);
    for (const l of rest) over(comp, l.raster);
    if (res.checkAgainst) {
      const ref = res.checkAgainst;
      let maxD = 0, sum = 0, n = 0, bad = 0;
      for (let k = 0; k < ref.data.length; k += 4) {
        const ra = ref.data[k + 3] / 255, ca = comp.data[k + 3] / 255;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(ref.data[k + c] * ra - comp.data[k + c] * ca);
          maxD = Math.max(maxD, d); sum += d; n++;
        }
        const da = Math.abs(ref.data[k + 3] - comp.data[k + 3]);
        maxD = Math.max(maxD, da);
        if (da > 8) bad++;
      }
      console.error(`rest-pose reconstruction vs source: max ${maxD.toFixed(1)}/255, mean ${(sum / n).toFixed(3)}, pixels off>8: ${bad}`);
      if (debug) {
        const heat = blank(ref.w, ref.h);
        for (let k = 0; k < ref.data.length; k += 4) { const d = Math.abs(ref.data[k + 3] - comp.data[k + 3]) + Math.abs(ref.data[k] - comp.data[k]); heat.data[k] = Math.min(255, d * 4); heat.data[k + 3] = 255; }
        await save(heat, path.join(dir, "_rest_diff.png"));
      }
    }
    if (debug) {
      await save(flatten(rest.map((l) => l.raster)), path.join(dir, "_rest.png"));
      for (const l of res.layers) await save(flatten([l.raster]), path.join(dir, `_layer_${l.name}.png`));
    }
  }
  console.log(JSON.stringify({ canvas: res.canvas, art: res.art, parts: res.layers.length }));
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
