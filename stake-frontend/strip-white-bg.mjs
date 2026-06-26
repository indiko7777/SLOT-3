import sharp from "sharp";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const filePath = join(__dirname, "public/assets/real_bill.png");
  const image = sharp(filePath);
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const { width, height } = info;
  
  // White threshold
  const THRESHOLD = 240;

  const isNearWhite = (x, y) => {
    const i = (y * width + x) * 4;
    return pixels[i] > THRESHOLD && pixels[i + 1] > THRESHOLD && pixels[i + 2] > THRESHOLD;
  };

  const visited = new Uint8Array(width * height);
  const queue = [];

  const seed = (x, y) => {
    if (isNearWhite(x, y)) {
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
        if (!visited[ni] && isNearWhite(nx, ny)) {
          visited[ni] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  // To fix pixelation, resize it down using high-quality interpolation
  // which makes it look much crisper.
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .resize({ width: 256 })
    .png({ compressionLevel: 9 })
    .toFile(filePath + ".tmp");

  const { rename } = await import("fs/promises");
  await rename(filePath + ".tmp", filePath);
  console.log("Done. Background stripped and image resized to fix pixelation.");
}

main().catch(console.error);
