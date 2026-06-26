import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function convertToWebp(dir) {
  const files = fs.readdirSync(dir);
  let totalSaved = 0;
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      totalSaved += await convertToWebp(fullPath);
    } else if (fullPath.toLowerCase().endsWith('.png')) {
      const outPath = fullPath.replace(/\.png$/i, '.webp');
      try {
        const inStats = fs.statSync(fullPath);
        await sharp(fullPath).webp({ lossless: true }).toFile(outPath);
        const outStats = fs.statSync(outPath);
        totalSaved += (inStats.size - outStats.size);
      } catch (err) {
        console.error(`Error converting ${fullPath}:`, err);
      }
    }
  }
  return totalSaved;
}

async function main() {
  const targetDir = path.resolve('public');
  console.log(`Converting PNGs in ${targetDir} to lossless WebP...`);
  const saved = await convertToWebp(targetDir);
  console.log(`Saved ${(saved / 1024 / 1024).toFixed(2)} MB in total.`);
}

main().catch(console.error);
