/**
 * Recompress the CURRENT static symbol PNGs in place: trim → fit → palette-quantize
 * under a per-tier budget. Originals are backed up once to _originals/ so this is
 * safe to re-run. Pure local work — no Higgsfield credits needed.
 *
 *   node tools/asset-pipeline/compress-symbols.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, copyFile, access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { SYMBOLS, SIZE_BUDGET_KB } from "./manifest.mjs";
import { processSymbol } from "./lib/image.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SYMBOLS_DIR = join(HERE, "..", "..", "public", "assets", "symbols");
const BACKUP_DIR = join(HERE, "_originals");

const MAX_DIM = { hero: 320, mid: 256, pip: 224 };

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

async function backupOnce(file) {
  await mkdir(BACKUP_DIR, { recursive: true });
  const dest = join(BACKUP_DIR, file);
  if (!(await exists(dest))) await copyFile(join(SYMBOLS_DIR, file), dest);
}

async function main() {
  let beforeTotal = 0;
  let afterTotal = 0;
  const rows = [];

  for (const s of SYMBOLS) {
    const src = join(SYMBOLS_DIR, s.file);
    if (!(await exists(src))) {
      rows.push([s.file, "MISSING", "", ""]);
      continue;
    }
    await backupOnce(s.file);
    // Always process from the pristine backup, so re-runs don't compound loss.
    const pristine = join(BACKUP_DIR, s.file);
    const { beforeKb, afterKb, colors } = await processSymbol(pristine, src, {
      maxDim: MAX_DIM[s.tier],
      budgetKB: SIZE_BUDGET_KB[s.tier],
    });
    beforeTotal += beforeKb;
    afterTotal += afterKb;
    const pct = ((1 - afterKb / beforeKb) * 100).toFixed(0);
    rows.push([s.file, `${beforeKb.toFixed(0)}KB`, `${afterKb.toFixed(0)}KB`, `-${pct}%  (${colors}c)`]);
  }

  const w = (a, n) => String(a).padEnd(n);
  console.log(`\n${w("file", 22)}${w("before", 10)}${w("after", 10)}saved`);
  console.log("-".repeat(56));
  for (const r of rows) console.log(`${w(r[0], 22)}${w(r[1], 10)}${w(r[2], 10)}${r[3]}`);
  console.log("-".repeat(56));
  console.log(
    `${w("TOTAL", 22)}${w(`${(beforeTotal / 1024).toFixed(2)}MB`, 10)}` +
    `${w(`${(afterTotal / 1024).toFixed(2)}MB`, 10)}` +
    `-${((1 - afterTotal / beforeTotal) * 100).toFixed(0)}%`
  );
  console.log(`\nOriginals backed up in ${BACKUP_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
