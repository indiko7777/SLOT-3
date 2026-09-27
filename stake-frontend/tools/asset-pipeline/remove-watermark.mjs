#!/usr/bin/env node
/**
 * Paint out the four-point "sparkle" glyph an AI image generator stamped in
 * the bottom-right corner of two runtime backgrounds (asset audit):
 *
 *   vault_bonus.webp       near-black vault wall   -> diffusion fill + matched grain
 *   getaway_highway.webp   motion-blurred road     -> interpolate ALONG the streaks
 *
 * The glyph is covered by a diamond (|dx|+|dy| <= r) that contains the
 * concave star. The highway fill walks each masked pixel along the measured
 * streak direction to the first clean pixel on either side and blends them,
 * so the blur streaks run straight through where the glyph was.
 *
 *   node tools/asset-pipeline/remove-watermark.mjs [--check]
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, "../../package.json"));
const sharp = require("sharp");
const fs = require("node:fs");
// never let sharp keep a handle on an input: we overwrite it in place (Windows)
sharp.cache(false);
const ASSETS = path.resolve(HERE, "../../public/assets");

const JOBS = [
  { file: "vault_bonus.webp", cx: 1841, cy: 993, r: 40, mode: "diffuse" },
  { file: "getaway_highway.webp", cx: 2928, cy: 1104, r: 56, mode: "streak" },
];

async function load(file) {
  const { data, info } = await sharp(fs.readFileSync(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Float32Array(data) };
}

function inMask(job, x, y) {
  return Math.abs(x - job.cx) + Math.abs(y - job.cy) <= job.r;
}

/** Dominant streak direction from the structure tensor in a ring. */
function streakDir(img, job) {
  let jxx = 0, jyy = 0, jxy = 0;
  const L = (x, y) => { const i = (y * img.w + x) * 3; return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; };
  for (let y = job.cy - job.r * 2; y <= job.cy + job.r * 2; y++) for (let x = job.cx - job.r * 2; x <= job.cx + job.r * 2; x++) {
    if (x < 1 || y < 1 || x >= img.w - 1 || y >= img.h - 1 || inMask(job, x, y)) continue;
    const gx = L(x + 1, y) - L(x - 1, y), gy = L(x, y + 1) - L(x, y - 1);
    jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
  }
  // gradient orientation; streaks run perpendicular to it
  const g = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
  return [Math.cos(g + Math.PI / 2), Math.sin(g + Math.PI / 2)];
}

function fillStreak(img, job) {
  const [ux, uy] = streakDir(img, job);
  const out = new Float32Array(img.data);
  const sample = (x, y) => {
    const xi = Math.max(0, Math.min(img.w - 1, Math.round(x))), yi = Math.max(0, Math.min(img.h - 1, Math.round(y)));
    const i = (yi * img.w + xi) * 3;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  for (let y = job.cy - job.r; y <= job.cy + job.r; y++) for (let x = job.cx - job.r; x <= job.cx + job.r; x++) {
    if (!inMask(job, x, y)) continue;
    let a = 1, b = 1;
    while (inMask(job, Math.round(x - ux * a), Math.round(y - uy * a))) a++;
    while (inMask(job, Math.round(x + ux * b), Math.round(y + uy * b))) b++;
    a += 2; b += 2;   // step past the anti-aliased rim
    const ca = sample(x - ux * a, y - uy * a), cb = sample(x + ux * b, y + uy * b);
    const t = a / (a + b);
    const i = (y * img.w + x) * 3;
    for (let c = 0; c < 3; c++) out[i + c] = ca[c] + (cb[c] - ca[c]) * t;
  }
  img.data = out;
  return [ux, uy];
}

function fillDiffuse(img, job) {
  const pts = [];
  for (let y = job.cy - job.r; y <= job.cy + job.r; y++) for (let x = job.cx - job.r; x <= job.cx + job.r; x++) if (inMask(job, x, y)) pts.push([x, y]);
  // seed the hole with the average of the clean ring around it (the glyph's
  // own bright values would otherwise take thousands of passes to wash out)
  const ring = [0, 0, 0];
  let rn = 0;
  for (let y = job.cy - job.r - 6; y <= job.cy + job.r + 6; y++) for (let x = job.cx - job.r - 6; x <= job.cx + job.r + 6; x++) {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h || inMask(job, x, y)) continue;
    if (Math.abs(x - job.cx) + Math.abs(y - job.cy) > job.r + 6) continue;
    for (let c = 0; c < 3; c++) ring[c] += img.data[(y * img.w + x) * 3 + c];
    rn++;
  }
  for (const [x, y] of pts) for (let c = 0; c < 3; c++) img.data[(y * img.w + x) * 3 + c] = ring[c] / rn;
  for (let it = 0; it < 600; it++) {
    for (const [x, y] of pts) {
      const s = [0, 0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = Math.min(img.w - 1, Math.max(0, x + dx)), yy = Math.min(img.h - 1, Math.max(0, y + dy));
        const k = yy * img.w + xx;
        for (let c = 0; c < 3; c++) s[c] += img.data[k * 3 + c];
      }
      for (let c = 0; c < 3; c++) img.data[(y * img.w + x) * 3 + c] = s[c] / 4;
    }
  }
  // the wall has a faint grain: match it so the patch is not glassy-smooth
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (const [x, y] of pts) {
    const g = rnd() * 3.2;
    for (let c = 0; c < 3; c++) img.data[(y * img.w + x) * 3 + c] += g;
  }
}

async function main() {
  const check = process.argv.includes("--check");
  for (const job of JOBS) {
    const file = path.join(ASSETS, job.file);
    const img = await load(file);
    let note = "";
    if (job.mode === "streak") note = ` streak dir (${fillStreak(img, job).map((v) => v.toFixed(2)).join(", ")})`;
    else fillDiffuse(img, job);
    const buf = Buffer.from(img.data.map((v) => Math.max(0, Math.min(255, Math.round(v)))));
    const out = sharp(buf, { raw: { width: img.w, height: img.h, channels: 3 } });
    if (check) {
      const left = job.cx - job.r * 2, top = job.cy - job.r * 2;
      await out.extract({ left, top, width: Math.min(job.r * 4, img.w - left), height: Math.min(job.r * 4, img.h - top) })
        .png().toFile(path.join(HERE, `_wm_${job.file}.png`));
    } else {
      fs.writeFileSync(file, await out.webp({ quality: 86, effort: 6 }).toBuffer());
    }
    console.log(`${job.file}: glyph at (${job.cx}, ${job.cy}) r${job.r} painted out (${job.mode})${note}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
