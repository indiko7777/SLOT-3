import type { BetMode } from "../src/domain";
import { optimizeMode } from "../src/optimize";
import { type IndexMode, publishMode, writeManifest } from "../src/publish";
import { simulateMode } from "../src/simulate";
import { verify } from "../src/verify";

const MODES: BetMode[] = ["base", "ante", "buy", "super_buy"];

const t0 = Date.now();
const indexModes: IndexMode[] = [];
const shelf: unknown[] = [];

for (const mode of MODES) {
  const s0 = Date.now();
  let sims = simulateMode(mode);
  const opt = optimizeMode(mode, sims);
  const { index, shelf: shelfEntry } = await publishMode(mode, sims, opt);
  indexModes.push(index);
  shelf.push(shelfEntry);

  const P = opt.probabilities;
  const E = opt.means;
  console.log(
    `  ${mode.padEnd(10)} sims ${String(sims.length).padStart(6)}  ` +
      `RTP ${(opt.rtp * 100).toFixed(4)}%  hit ${(opt.hitRate * 100).toFixed(2)}%  ` +
      `bonus ${(opt.bonusRate * 100).toFixed(3)}%  cap ${opt.wincapRate.toExponential(2)}  ` +
      `(${((Date.now() - s0) / 1000).toFixed(1)}s)`
  );
  console.log(
    `             P{zero ${P.zero.toFixed(4)} base ${P.basegame.toFixed(4)} ` +
      `free ${P.freegame.toExponential(2)} cap ${P.wincap.toExponential(2)}}  ` +
      `E{base ${E.basegame.toFixed(2)} free ${E.freegame.toFixed(1)} cap ${E.wincap.toFixed(0)}}`
  );

  // Free the heavy records before the next mode.
  sims = [];
}

await writeManifest(indexModes, shelf);
console.log("verifying ...");
await verify(true);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
