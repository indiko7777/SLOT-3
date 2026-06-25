import sharp from "sharp";
import { join } from "path";
import { rename } from "fs/promises";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const filePath = join(dir, "body.png");
  const image = sharp(filePath);
  const meta = await image.metadata();

  if (meta.width === 1536 && meta.height === 2752) {
    // Un-pad it: the original size before contain was scaled by 1536/1792 = 0.85714
    // Height became 2400 * 0.85714 = 2057.14 -> 2057
    // Y offset was (2752 - 2057) / 2 = 347.5 -> 347
    const extracted = await image.extract({ left: 0, top: 347, width: 1536, height: 2057 }).toBuffer();
    
    await sharp(extracted)
      .resize(1792, 2400, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toFile(filePath + ".tmp");
      
    await rename(filePath + ".tmp", filePath);
    console.log(`Successfully restored body.png to 1792x2400`);
  } else {
    console.log(`body.png is already ${meta.width}x${meta.height}`);
  }
}
main().catch(console.error);
