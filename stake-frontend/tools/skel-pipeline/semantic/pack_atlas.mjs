#!/usr/bin/env node
/**
 * Node port of tools/pack_atlas.py (identical output format) for machines
 * without Pillow:  parts/*.png (full-canvas layers) -> packed.png +
 * <symbol>.atlas + manifest.json.
 *
 *   node semantic/pack_atlas.mjs symbols/<name> [--pad=2]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, save, bbox, crop, blank, over, resize } from "./img.mjs";

/**
 * rig.json may list `"lowres": {"part": 0.5}`: that part's atlas region is
 * stored at reduced resolution while the manifest keeps its full size, so the
 * attachment (width/height = full size) scales it back up at runtime. For
 * parts only ever seen in fast motion — a thrown banknote — it halves the
 * bundle for no visible cost.
 */
export async function packAtlas(dir, pad = 2) {
  const rigFile = path.join(dir, "rig.json");
  const lowres = fs.existsSync(rigFile) ? (JSON.parse(fs.readFileSync(rigFile, "utf8")).lowres || {}) : {};
  const partsDir = path.join(dir, "parts");
  const files = fs.readdirSync(partsDir).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) throw new Error(`no PNGs in ${partsDir}`);
  let canvas = null;
  const parts = [];
  for (const f of files) {
    const im = await load(path.join(partsDir, f));
    canvas = canvas || [im.w, im.h];
    if (im.w !== canvas[0] || im.h !== canvas[1]) throw new Error(`${f}: size ${im.w}x${im.h} != ${canvas}`);
    const box = bbox(im);
    if (!box) throw new Error(`${f} is fully transparent`);
    const full = crop(im, box);
    const name = f.replace(/\.png$/, "").replace(/^\d+[_-]?/, "");
    const k = lowres[name];
    const img = k && k < 1 ? await resize(full, Math.max(1, Math.round(full.w * k)), Math.max(1, Math.round(full.h * k))) : full;
    parts.push({
      name,
      img, w: full.w, h: full.h, rw: img.w, rh: img.h,
      // Spine coords: origin = canvas centre, y up
      x: Math.round(((box[0] + box[2]) / 2 - canvas[0] / 2) * 100) / 100,
      y: Math.round((canvas[1] / 2 - (box[1] + box[3]) / 2) * 100) / 100,
    });
    if (box[0] <= 0 || box[1] <= 0 || box[2] >= canvas[0] || box[3] >= canvas[1]) {
      console.log(`WARN: ${f} touches the canvas edge - win/destroy overshoot will crop it.`);
    }
  }
  const names = parts.map((p) => p.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) throw new Error(`duplicate part names: ${dupes}`);

  // shelf packing, tallest first, power-of-two sheet (same as pack_atlas.py)
  const order = parts.map((_, i) => i).sort((a, b) => parts[b].rh - parts[a].rh);
  const area = parts.reduce((s, p) => s + (p.rw + pad) * (p.rh + pad), 0);
  let W = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(8, Math.sqrt(area)))));
  let pos, H;
  for (;;) {
    if (parts.some((p) => p.rw + 2 * pad > W)) { W *= 2; continue; }
    let x = pad, y = pad, shelf = 0;
    pos = {};
    for (const i of order) {
      const p = parts[i];
      if (x + p.rw + pad > W) { x = pad; y = y + shelf + pad; shelf = 0; }
      pos[i] = [x, y];
      shelf = Math.max(shelf, p.rh);
      x += p.rw + pad;
    }
    H = y + shelf + pad;
    if (H <= 2 * W) break;
    W *= 2;
  }
  H = 1 << Math.ceil(Math.log2(H));

  const sheet = blank(W, H);
  parts.forEach((p, i) => over(sheet, p.img, pos[i][0], pos[i][1]));
  await save(sheet, path.join(dir, "packed.png"));

  const base = path.basename(dir);
  const lines = ["packed.png", `size: ${W},${H}`, "format: RGBA8888", "filter: Linear,Linear", "repeat: none"];
  parts.forEach((p, i) => {
    lines.push(p.name, "  rotate: false", `  xy: ${pos[i][0]}, ${pos[i][1]}`, `  size: ${p.rw}, ${p.rh}`,
      `  orig: ${p.rw}, ${p.rh}`, "  offset: 0, 0", "  index: -1");
  });
  fs.writeFileSync(path.join(dir, `${base}.atlas`), lines.join("\n") + "\n");
  const manifest = {
    canvas: { w: canvas[0], h: canvas[1] }, png: "packed.png", atlas: `${base}.atlas`,
    parts: parts.map((p) => ({ name: p.name, x: p.x, y: p.y, w: p.w, h: p.h })),
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`OK: ${parts.length} parts -> packed.png ${W}x${H}, ${base}.atlas, manifest.json`);
  return manifest;
}

const self = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const dir = process.argv[2];
  const padArg = process.argv.find((a) => a.startsWith("--pad="));
  if (!dir) { console.error("usage: node pack_atlas.mjs symbols/<name> [--pad=2]"); process.exit(1); }
  packAtlas(dir, padArg ? +padArg.split("=")[1] : 2).catch((e) => { console.error(e.message || e); process.exit(1); });
}
