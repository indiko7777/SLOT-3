import sharp from "sharp";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/charachter3 body";

async function main() {
  const fullImage = sharp(join(dir, "full body and head.png"));
  const { data, info } = await fullImage.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0) { // If pixel is not fully transparent
      pixels[i] = 0;     // R
      pixels[i + 1] = 0; // G
      pixels[i + 2] = 0; // B
    }
  }

  const silPath = join(dir, "silhouette.png");
  await sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(silPath);
  
  console.log("Successfully recreated silhouette.png at 1696x2528");
}
main().catch(console.error);
