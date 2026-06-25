import sharp from "sharp";
import { readdir } from "fs/promises";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const files = await readdir(dir);
  for (const f of files) {
    if (f.endsWith(".png")) {
      const meta = await sharp(join(dir, f)).metadata();
      console.log(`${f}: ${meta.width}x${meta.height}`);
    }
  }
}
main().catch(console.error);
