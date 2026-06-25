import sharp from "sharp";
import { join } from "path";

const dir1 = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter1";
const dir2 = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const meta1 = await sharp(join(dir1, "silhouette_image1.png.png")).metadata();
  console.log(`char1 silhouette: ${meta1.width}x${meta1.height}`);
  const metaBody1 = await sharp(join(dir1, "chest1.png.png")).metadata();
  console.log(`char1 chest: ${metaBody1.width}x${metaBody1.height}`);
  
  const meta2 = await sharp(join(dir2, "silhouette.png")).metadata();
  console.log(`char2 silhouette: ${meta2.width}x${meta2.height}`);
}
main().catch(console.error);
