import sharp from "sharp";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const image = sharp(join(dir, "body.png"));
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  
  let maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        if (y > maxY) maxY = y;
      }
    }
  }
  
  console.log(`body.png maxY = ${maxY}`);
}
main().catch(console.error);
