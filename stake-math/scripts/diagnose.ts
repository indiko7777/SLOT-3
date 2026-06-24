import type { BetMode } from "../src/domain";
import { type Criteria } from "../src/model";
import { simulateMode } from "../src/simulate";

const MODES: BetMode[] = ["base", "ante", "buy", "super_buy"];
const CRITS: Criteria[] = ["zero", "basegame", "basebig", "freegame", "wincap"];

for (const mode of MODES) {
  const sims = simulateMode(mode);
  const by: Record<Criteria, number[]> = { zero: [], basegame: [], basebig: [], freegame: [], wincap: [] };
  for (const s of sims) by[s.criteria].push(s.payoutX);
  const tot = sims.length;
  const cost = { base: 1, ante: 1.5, buy: 100, super_buy: 500 }[mode]!;
  const pct = (arr: number[], q: number): number =>
    arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))]!;
  console.log(`\n== ${mode} (n=${tot}, cost=${cost}x) ==`);
  for (const c of CRITS) {
    const arr = by[c];
    if (arr.length === 0) {
      console.log(`  ${c.padEnd(9)} n=0`);
      continue;
    }
    const sum = arr.reduce((a, b) => a + b, 0);
    const mean = sum / arr.length;
    const max = Math.max(...arr);
    const belowCost = (arr.filter((x) => x < cost).length / arr.length) * 100;
    console.log(
      `  ${c.padEnd(9)} n=${String(arr.length).padStart(6)} ` +
        `cover=${((arr.length / tot) * 100).toFixed(1)}%  mean=${mean.toFixed(2)}x  ` +
        `p10=${pct(arr, 0.1).toFixed(1)} p50=${pct(arr, 0.5).toFixed(1)} ` +
        `p90=${pct(arr, 0.9).toFixed(0)} p99=${pct(arr, 0.99).toFixed(0)} max=${max.toFixed(0)}  ` +
        `<cost=${belowCost.toFixed(0)}%`
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
