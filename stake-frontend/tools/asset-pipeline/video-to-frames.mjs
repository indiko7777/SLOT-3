/**
 * Extract PNG frames from each generated animation video using the bundled
 * ffmpeg-static binary (no system ffmpeg needed). Frames land in frames/<name>/.
 *
 * Reads animated symbols from the manifest; expects raw/videos/<name>.mp4 to
 * exist (produced by fetch-generations.mjs).
 *
 *   node tools/asset-pipeline/video-to-frames.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ANIMATED } from "./manifest.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_VID = join(HERE, "raw", "videos");
const FRAMES = join(HERE, "frames");

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

async function ffmpegPath() {
  try {
    const mod = await import("ffmpeg-static");
    return mod.default;
  } catch {
    console.error(
      "ffmpeg-static not installed. Run:\n  npm install --save-dev ffmpeg-static\n" +
      "(dev-only; the binary never ships in the web bundle)."
    );
    process.exit(1);
  }
}

async function main() {
  const ffmpeg = await ffmpegPath();
  for (const s of ANIMATED) {
    const name = s.file.replace(/\.png$/, "_win");
    const src = join(RAW_VID, `${name}.mp4`);
    if (!(await exists(src))) { console.log(`· skip ${name} (no video yet)`); continue; }

    const outDir = join(FRAMES, name);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    // Sample at the target fps; the packer caps to s.animated.frames.
    await run(ffmpeg, [
      "-i", src,
      "-vf", `fps=${s.animated.fps}`,
      "-y", join(outDir, "frame_%03d.png"),
    ]);
    console.log(`✓ ${name} → frames extracted at ${s.animated.fps}fps`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
