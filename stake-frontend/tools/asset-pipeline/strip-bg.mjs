/**
 * strip-bg.mjs — one-time background removal for symbol PNGs.
 *
 * Reads every PNG in public/assets/symbols/, removes the black border
 * via BFS flood-fill (or full-image keying for brass_knuckles), writes
 * the result back as RGBA PNG.  Files that already have their own alpha
 * channel (WILD etc.) are skipped.
 *
 * Usage:  node tools/asset-pipeline/strip-bg.mjs
 */

import sharp from "sharp";
import { readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYMBOLS_DIR = join(__dirname, "../../public/assets/symbols");
const THRESHOLD = 35; // r,g,b each < THRESHOLD → "near black"

async function processFile(filePath, fileName) {
  const image = sharp(filePath);
  const meta = await image.metadata();

  // colorType 6 = RGBA — already has its own alpha channel, skip.
  // (We detect this via the PNG ihdr colorType stored in meta.palette etc.)
  // Sharp exposes it indirectly: if the image has an alpha channel already
  // AND the first pixel is transparent, nothing to do.
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const { width, height } = info;

  // If top-left pixel is already transparent the file has its own alpha.
  const topLeftAlpha = pixels[3];
  if (topLeftAlpha < 200) {
    console.log(`skip  ${fileName}  (already transparent)`);
    return;
  }

  const isNearBlack = (x, y) => {
    const i = (y * width + x) * 4;
    return pixels[i] < THRESHOLD && pixels[i + 1] < THRESHOLD && pixels[i + 2] < THRESHOLD;
  };

  const isKnuckles = fileName.includes("brass_knuckles");

  if (isKnuckles) {
    // All near-black pixels removed globally (rings inside the knuckles too).
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < THRESHOLD && pixels[i + 1] < THRESHOLD && pixels[i + 2] < THRESHOLD) {
        pixels[i + 3] = 0;
      }
    }
  } else {
    // BFS flood-fill from every border pixel that is near-black.
    const visited = new Uint8Array(width * height);
    const queue = [];

    const seed = (x, y) => {
      if (isNearBlack(x, y)) {
        visited[y * width + x] = 1;
        queue.push(x, y);
      }
    };

    for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }

    let head = 0;
    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];
      pixels[(cy * width + cx) * 4 + 3] = 0;

      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = ny * width + nx;
          if (!visited[ni] && isNearBlack(nx, ny)) {
            visited[ni] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  // Write processed RGBA pixels back to the same file.
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(filePath + ".tmp");

  // Atomic replace (rename is atomic on same FS).
  const { rename } = await import("fs/promises");
  await rename(filePath + ".tmp", filePath);

  console.log(`done  ${fileName}  (${width}x${height})`);
}

async function main() {
  const files = (await readdir(SYMBOLS_DIR))
    .filter((f) => f.toLowerCase().endsWith(".png"))
    // Skip the original with-space filename.
    .filter((f) => f !== "wild symbole.png");

  for (const f of files) {
    await processFile(join(SYMBOLS_DIR, f), f);
  }
  console.log("All done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
