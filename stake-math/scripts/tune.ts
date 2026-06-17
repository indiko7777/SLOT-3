/** Fast bonus-distribution probe for the buy modes only (no base/ante passes).
 *  Prints the freegame payout shape so volatility can be tuned in seconds.
 *    npx tsx scripts/tune.ts
 */
import { simulateRound } from "../src/engine";

const N = 8000;
for (const mode of ["buy", "super_buy"] as const) {
  const cost = mode === "buy" ? 100 : 500;
  const xs: number[] = [];
  for (let i = 1; i <= N; i++) {
    const { record } = simulateRound(mode, "freegame", (i * 2654435761) >>> 0, i);
    xs.push(record.payoutMultiplier);
  }
  xs.sort((a, b) => a - b);
  const pct = (q: number): number => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const below = (xs.filter((x) => x < cost).length / xs.length) * 100;
  const cap = (xs.filter((x) => x >= 5000).length / xs.length) * 100;
  console.log(
    `${mode} (cost ${cost}x)  mean=${mean.toFixed(1)}  ` +
      `p10=${pct(0.1).toFixed(1)} p25=${pct(0.25).toFixed(1)} p50=${pct(0.5).toFixed(1)} ` +
      `p75=${pct(0.75).toFixed(1)} p90=${pct(0.9).toFixed(0)} p99=${pct(0.99).toFixed(0)} ` +
      `max=${pct(1).toFixed(0)}  <cost=${below.toFixed(0)}%  cap=${cap.toFixed(2)}%`
  );
}
