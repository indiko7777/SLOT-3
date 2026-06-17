/** Image helpers (sharp): trim transparent borders, fit to a box, quantize to a
 *  palette PNG under a size budget. Keeps the symbol folder featherweight. */
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

/** Trim fully-transparent borders so every symbol is tightly cropped + centered. */
export async function trim(buffer) {
  return sharp(buffer).trim({ threshold: 10 }).toBuffer();
}

/** Resize so the longest edge == maxDim (never upscale past source), keep aspect. */
export async function fit(buffer, maxDim) {
  return sharp(buffer)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .toBuffer();
}

/**
 * Quantize to a palette PNG, stepping colors/quality down until the output is
 * under budgetKB (or we hit the floor). Returns { buffer, kb, colors }.
 */
export async function quantizeUnder(buffer, budgetKB) {
  const ladder = [256, 200, 160, 128, 96, 64, 48];
  let best = null;
  for (const colors of ladder) {
    const out = await sharp(buffer)
      .png({ palette: true, colors, quality: 90, effort: 9, compressionLevel: 9 })
      .toBuffer();
    const kb = out.length / 1024;
    best = { buffer: out, kb, colors };
    if (kb <= budgetKB) break;
  }
  return best;
}

/**
 * Full static-symbol pipeline: read → trim → fit(maxDim) → quantizeUnder(budget)
 * → write. Returns { beforeKb, afterKb, colors }.
 */
export async function processSymbol(srcPath, outPath, { maxDim, budgetKB }) {
  const raw = await readFile(srcPath);
  const beforeKb = raw.length / 1024;
  const trimmed = await trim(raw);
  const fitted = await fit(trimmed, maxDim);
  const { buffer, kb, colors } = await quantizeUnder(fitted, budgetKB);
  await writeFile(outPath, buffer);
  return { beforeKb, afterKb: kb, colors };
}

/** Padded dimensions of a buffer. */
export async function dims(buffer) {
  const m = await sharp(buffer).metadata();
  return { w: m.width, h: m.height };
}
