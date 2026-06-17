/**
 * Import freshly generated (and background-removed) static symbols from
 * raw/symbols/ into public/assets/symbols/, applying the same trim → fit →
 * quantize pipeline so new art stays within budget.
 *
 *   node tools/asset-pipeline/import-symbols.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { SYMBOLS, SIZE_BUDGET_KB } from "./manifest.mjs";
import { processSymbol } from "./lib/image.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw", "symbols");
const OUT = join(HERE, "..", "..", "public", "assets", "symbols");
const MAX_DIM = { hero: 320, mid: 256, pip: 224 };

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

async function main() {
  let imported = 0;
  for (const s of SYMBOLS) {
    const src = join(RAW, s.file);
    if (!(await exists(src))) { console.log(`· skip ${s.file} (not generated yet)`); continue; }
    const { beforeKb, afterKb, colors } = await processSymbol(src, join(OUT, s.file), {
      maxDim: MAX_DIM[s.tier],
      budgetKB: SIZE_BUDGET_KB[s.tier],
    });
    imported++;
    console.log(`✓ ${s.file}: ${beforeKb.toFixed(0)}KB → ${afterKb.toFixed(0)}KB (${colors}c)`);
  }
  console.log(imported ? `\nImported ${imported} symbol(s).` : "\nNothing to import.");
}

main().catch((e) => { console.error(e); process.exit(1); });
