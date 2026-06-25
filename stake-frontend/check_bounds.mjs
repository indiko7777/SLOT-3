import sharp from "sharp";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function getBoundingBox(f) {
  const image = sharp(join(dir, f));
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function main() {
  const silBox = await getBoundingBox("silhouette.png");
  console.log(`silhouette.png bounding box: ${silBox.w}x${silBox.h} (at ${silBox.minX},${silBox.minY})`);
  const fullBox = await getBoundingBox("full image girl 2.png");
  console.log(`full image girl 2.png bounding box: ${fullBox.w}x${fullBox.h} (at ${fullBox.minX},${fullBox.minY})`);
}
main().catch(console.error);
