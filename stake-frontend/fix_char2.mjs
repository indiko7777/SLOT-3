import sharp from "sharp";
import { readdir, rename } from "fs/promises";
import { join } from "path";

const dir = "c:/Users/tengu/OneDrive/Documents/GitHub/SLOT-3/stake-frontend/public/assets/bodycharachter2";

async function processFile(f) {
  const filePath = join(dir, f);
  const image = sharp(filePath);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let pixels = new Uint8Array(data);
  const { width, height } = info;
  
  if (f === "legs.png") {
    // Remove solid background from legs.png (which has a greyish background)
    const bgR = pixels[0];
    const bgG = pixels[1];
    const bgB = pixels[2];
    const THRESHOLD = 15;
    
    const isBg = (x, y) => {
      const i = (y * width + x) * 4;
      return Math.abs(pixels[i] - bgR) < THRESHOLD &&
             Math.abs(pixels[i+1] - bgG) < THRESHOLD &&
             Math.abs(pixels[i+2] - bgB) < THRESHOLD;
    };
    
    const visited = new Uint8Array(width * height);
    const queue = [];
    const seed = (x, y) => {
      if (isBg(x, y)) {
        visited[y * width + x] = 1;
        queue.push(x, y);
      }
    };
    
    for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }
    
    let head = 0;
    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];
      pixels[(cy * width + cx) * 4 + 3] = 0; // set alpha to 0
      for (const [nx, ny] of [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]]) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = ny * width + nx;
          if (!visited[ni] && isBg(nx, ny)) {
            visited[ni] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  // Resize ALL images to 1536x2752 using contain so they match character 1's canvas size exactly
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .resize(1536, 2752, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(filePath + ".tmp");
    
  await rename(filePath + ".tmp", filePath);
  console.log(`Processed and resized ${f}`);
}

async function main() {
  const files = await readdir(dir);
  for (const f of files) {
    if (f.endsWith(".png")) {
      await processFile(f);
    }
  }
}
main().catch(console.error);
