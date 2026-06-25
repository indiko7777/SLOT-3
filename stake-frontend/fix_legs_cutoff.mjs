import sharp from "sharp";
import { join } from "path";
import { rename } from "fs/promises";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const fullImage = sharp(join(dir, "full image girl 2.png"));
  const { data, info } = await fullImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  
  // body.png ends at 1013, so we cut off at 950 to ensure a clean overlap behind the body.
  const cutoffY = 950;
  for (let y = 0; y < cutoffY; y++) {
    for (let x = 0; x < info.width; x++) {
      pixels[(y * info.width + x) * 4 + 3] = 0; // alpha = 0
    }
  }

  const legsPath = join(dir, "legs.png");
  await sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(legsPath + ".tmp");
  
  await rename(legsPath + ".tmp", legsPath);
  console.log("Successfully recreated legs.png with cutoff=950");
}
main().catch(console.error);
