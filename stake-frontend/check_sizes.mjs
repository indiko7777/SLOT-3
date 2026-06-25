import sharp from "sharp";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const meta = await sharp(join(dir, "body.png")).metadata();
  console.log(`body.png: ${meta.width}x${meta.height}`);
  const metaLegs = await sharp(join(dir, "legs.png")).metadata();
  console.log(`legs.png: ${metaLegs.width}x${metaLegs.height}`);
  const metaSil = await sharp(join(dir, "silhouette.png")).metadata();
  console.log(`silhouette.png: ${metaSil.width}x${metaSil.height}`);
}
main().catch(console.error);
