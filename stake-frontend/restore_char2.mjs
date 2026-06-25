import sharp from "sharp";
import { readdir, rename } from "fs/promises";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function processFile(f) {
  const filePath = join(dir, f);
  const image = sharp(filePath);
  const meta = await image.metadata();

  if (f === "body.png" || f === "legs.png") {
    // Leave body.png alone (user restored it).
    // Leave legs.png alone (we will recreate it entirely).
    return;
  }

  if (meta.width === 1536 && meta.height === 2752) {
    const extracted = await image.extract({ left: 0, top: 347, width: 1536, height: 2057 }).toBuffer();
    await sharp(extracted)
      .resize(1792, 2400, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toFile(filePath + ".tmp");
      
    await rename(filePath + ".tmp", filePath);
    console.log(`Restored ${f} to 1792x2400`);
  }
}

async function makeLegs() {
  const fullImagePath = join(dir, "full image girl 2.png");
  const fullImage = sharp(fullImagePath);
  const { data, info } = await fullImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  const { width, height } = info;
  
  // Make the top 50% transparent
  const cutoffY = Math.floor(height * 0.50);
  for (let y = 0; y < cutoffY; y++) {
    for (let x = 0; x < width; x++) {
      pixels[(y * width + x) * 4 + 3] = 0; // alpha = 0
    }
  }

  const legsPath = join(dir, "legs.png");
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(legsPath + ".tmp");
  
  await rename(legsPath + ".tmp", legsPath);
  console.log("Recreated legs.png from full image");
}

async function main() {
  const files = await readdir(dir);
  for (const f of files) {
    if (f.endsWith(".png")) await processFile(f);
  }
  await makeLegs();
}
main().catch(console.error);
