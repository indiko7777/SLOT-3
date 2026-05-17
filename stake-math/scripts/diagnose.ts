import type { BetMode } from "../src/domain";
import { type Criteria } from "../src/model";
import { simulateMode } from "../src/simulate";

const MODES: BetMode[] = ["base", "ante", "buy", "super_buy"];
const CRITS: Criteria[] = ["zero", "basegame", "freegame", "wincap"];

for (const mode of MODES) {
  const sims = simulateMode(mode);
  const by: Record<Criteria, number[]> = { zero: [], basegame: [], freegame: [], wincap: [] };
  for (const s of sims) by[s.criteria].push(s.payoutX);
  const tot = sims.length;
  console.log(`\n== ${mode} (n=${tot}) ==`);
  for (const c of CRITS) {
    const arr = by[c];
    if (arr.length === 0) {
      console.log(`  ${c.padEnd(9)} n=0`);
      continue;
    }
    const sum = arr.reduce((a, b) => a + b, 0);
    const mean = sum / arr.length;
    const max = Math.max(...arr);
    const p50 = arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)]!;
    console.log(
      `  ${c.padEnd(9)} n=${String(arr.length).padStart(6)} ` +
        `cover=${((arr.length / tot) * 100).toFixed(1)}%  mean=${mean.toFixed(2)}x  ` +
        `med=${p50.toFixed(2)}x  max=${max.toFixed(0)}x`
    );
  }
  // What RTP can this engine reach if 100% of spins were each criteria?
  const m = (c: Criteria): number =>
    by[c].length ? by[c].reduce((a, b) => a + b, 0) / by[c].length : 0;
  console.log(
    `  reachable: E_base=${m("basegame").toFixed(2)} E_free=${m("freegame").toFixed(
      1
    )} E_cap=${m("wincap").toFixed(0)}`
  );
}
