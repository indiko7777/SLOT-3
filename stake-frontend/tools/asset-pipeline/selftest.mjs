/**
 * Pipeline self-test (no Higgsfield credits needed). Generates synthetic frames
 * with sharp, packs them via packSheet, and asserts the atlas is a valid Pixi
 * spritesheet. Validates the packer + atlas format end-to-end.
 *
 *   node tools/asset-pipeline/selftest.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { packSheet } from "./lib/sheet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "_selftest");

const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };

/** A pulsing cyan diamond frame at phase t∈[0,1) — stand-in for a real frame. */
function frameSvg(t) {
  const s = 200;
  const r = 60 + 18 * Math.sin(t * Math.PI * 2);
  const a = 0.55 + 0.45 * Math.sin(t * Math.PI * 2);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
       <g transform="translate(${s / 2},${s / 2}) rotate(${t * 360})">
         <rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}"
               transform="rotate(45)" fill="#29e6ff" fill-opacity="${a}"/>
       </g>
     </svg>`
  );
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const N = 8;
  const frames = [];
  for (let i = 0; i < N; i++) {
    frames.push(await sharp(frameSvg(i / N)).png().toBuffer());
  }

  const res = await packSheet({
    name: "selftest_win",
    frames,
    outPng: join(OUT, "selftest_win.png"),
    outJson: join(OUT, "selftest_win.json"),
    fps: 18,
  });

  const atlas = JSON.parse(await readFile(join(OUT, "selftest_win.json"), "utf8"));
  const anim = atlas.animations.selftest_win;

  assert(res.frameCount === N, `frameCount ${res.frameCount} !== ${N}`);
  assert(Object.keys(atlas.frames).length === N, "frames hash count mismatch");
  assert(Array.isArray(anim) && anim.length === N, "animations[selftest_win] missing/short");
  assert(anim.every((fn) => atlas.frames[fn]), "animation references a missing frame");
  assert(atlas.meta.image === "selftest_win.png", "meta.image wrong");
  assert(atlas.meta.size.w === res.grid.cols * res.cell.w, "meta.size.w mismatch");
  assert(atlas.meta.fps === 18, "fps hint not stored");

  // Validate the sheet PNG actually decodes at the declared size.
  const meta = await sharp(join(OUT, "selftest_win.png")).metadata();
  assert(meta.width === atlas.meta.size.w && meta.height === atlas.meta.size.h, "sheet PNG size mismatch");

  await rm(OUT, { recursive: true, force: true });
  console.log(
    `PASS — packed ${N} frames into ${res.grid.cols}x${res.grid.rows} grid, ` +
    `${atlas.meta.size.w}x${atlas.meta.size.h} sheet (${res.sheetKb.toFixed(0)}KB), valid Pixi atlas.`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
