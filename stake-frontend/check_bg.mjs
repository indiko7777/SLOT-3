import sharp from "sharp";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  for (const f of ["body.png", "legs.png"]) {
    const { data } = await sharp(join(dir, f)).raw().toBuffer({ resolveWithObject: true });
    console.log(`${f} top-left pixel: ${data[0]}, ${data[1]}, ${data[2]}`);
  }
}
main().catch(console.error);
