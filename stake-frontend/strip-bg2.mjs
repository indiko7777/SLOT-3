import sharp from "sharp";
import { join } from "path";
import { copyFile } from "fs/promises";

async function main() {
  const sourcePath = "C:\\Users\\tengu\\.gemini\\antigravity-ide\\brain\\b7c43b8d-e2d7-44fa-bf62-86d7905c44c6\\gta_money_bill_1782480289647.png";
  const targetPath = "public/assets/real_bill.png";
  
  // Start from the original high-res image
  const image = sharp(sourcePath);
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const { width, height } = info;
  
  // The generator background is a literal checkerboard of white and grey.
  // It has low saturation and is relatively bright.
  const isBgColor = (x, y) => {
    const i = (y * width + x) * 4;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    
    // Background is grayscale/very low saturation, and not dark.
    // The bill is green, so it will have a higher saturation (max - min is larger).
    return (max - min < 45) && min > 100;
  };

  const visited = new Uint8Array(width * height);
  const queue = [];

  const seed = (x, y) => {
    if (!visited[y * width + x] && isBgColor(x, y)) {
      visited[y * width + x] = 1;
      queue.push(x, y);
    }
  };

  // Seed from borders
  for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }

  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    pixels[(cy * width + cx) * 4 + 3] = 0; // Make transparent

    // Use 8-way flood fill to cross checkerboard corners
    const neighbors = [
      [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
      [cx + 1, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const ni = ny * width + nx;
        if (!visited[ni] && isBgColor(nx, ny)) {
          visited[ni] = 1;
          queue.push(nx, ny);
        }
      }
    }
  }

  // Defringe: if a pixel is transparent, make its color white so that interpolation doesn't bleed grey borders
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
    }
  }

  // Now resize to crisp 256px wide image and save
  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .resize({ width: 256 })
    .png({ compressionLevel: 9 })
    .toFile(targetPath);

  console.log("Background removed properly and replaced real_bill.png");
}

main().catch(console.error);
