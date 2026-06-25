import sharp from "sharp";
import { readdir } from "fs/promises";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function main() {
  const files = await readdir(dir);
  for (const f of files) {
    if (!f.endsWith(".png")) continue;
    const image = sharp(join(dir, f));
    const meta = await image.metadata();
    console.log(`${f}: ${meta.width}x${meta.height}, channels=${meta.channels}, space=${meta.space}, hasAlpha=${meta.hasAlpha}`);
  }
}
main().catch(console.error);
