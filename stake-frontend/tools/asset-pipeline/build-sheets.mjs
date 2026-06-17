/**
 * Pack extracted frames into Pixi-native sprite-sheet atlases under
 * public/assets/anim/<name>.{png,json}. Each animated symbol becomes one sheet
 * that SymbolView plays as an AnimatedSprite on a win.
 *
 *   node tools/asset-pipeline/build-sheets.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readdir, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { ANIMATED } from "./manifest.mjs";
import { packSheet } from "./lib/sheet.mjs";
import { trim } from "./lib/image.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, "frames");
const ANIM_OUT = join(HERE, "..", "..", "public", "assets", "anim");

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

/** Evenly downsample a frame list to at most `max` frames (keeps a clean loop). */
function pick(list, max) {
  if (list.length <= max) return list;
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]);
  return out;
}

async function main() {
  await mkdir(ANIM_OUT, { recursive: true });
  let built = 0;

  for (const s of ANIMATED) {
    const name = s.file.replace(/\.png$/, "_win");
    const dir = join(FRAMES, name);
    if (!(await exists(dir))) { console.log(`· skip ${name} (no frames)`); continue; }

    const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    if (!files.length) { console.log(`· skip ${name} (empty)`); continue; }

    const chosen = pick(files, s.animated.frames);
    // Trim each frame so the loop is tightly centered, then pack.
    const buffers = await Promise.all(
      chosen.map(async (f) => trim(await readFile(join(dir, f))))
    );

    const res = await packSheet({
      name,
      frames: buffers,
      outPng: join(ANIM_OUT, `${name}.png`),
      outJson: join(ANIM_OUT, `${name}.json`),
      fps: s.animated.fps,
    });
    built++;
    console.log(
      `✓ ${name}: ${res.frameCount} frames, ${res.grid.cols}x${res.grid.rows} grid, ` +
      `cell ${res.cell.w}x${res.cell.h}, sheet ${res.sheetKb.toFixed(0)}KB`
    );
  }

  console.log(built ? `\nBuilt ${built} sheet(s) → ${ANIM_OUT}` : "\nNo sheets built (no frames yet).");
}

main().catch((e) => { console.error(e); process.exit(1); });
