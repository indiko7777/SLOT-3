// One-off: published probability of reaching each Heat (Wanted-star) level, plus
// the Getaway trigger composition (Wanted/Heat-5 vs scatter). Weighted by the
// optimizer weight so the numbers reflect what a player actually experiences.
import type { BetMode, GameEvent } from "../src/domain";
import { optimizeMode } from "../src/optimize";
import { simulateMode } from "../src/simulate";

function maxHeat(events: GameEvent[]): number {
  let h = 0;
  for (const e of events) if (e.type === "heat_advance") h = Math.max(h, e.to);
  return h;
}
const hasBonus = (events: GameEvent[]): boolean =>
  events.some((e) => e.type === "bonus_trigger");

for (const mode of ["base", "ante"] as BetMode[]) {
  const sims = simulateMode(mode);
  const opt = optimizeMode(mode, sims);
  const w = new Map(opt.weighted.map((x) => [x.id, x.weight]));
  const total = opt.weighted.reduce((a, x) => a + x.weight, 0);

  const atLeast = [0, 0, 0, 0, 0, 0];
  let bonusW = 0;
  let wantedBonusW = 0;
  for (const s of sims) {
    const weight = w.get(s.id) ?? 0;
    const h = maxHeat(s.record.events);
    for (let lvl = 0; lvl <= h; lvl++) atLeast[lvl]! += weight;
    if (hasBonus(s.record.events)) {
      bonusW += weight;
      if (h >= 5) wantedBonusW += weight;
    }
  }

  console.log(`\n== ${mode} : P(reach >= N stars) ==`);
  for (let lvl = 1; lvl <= 5; lvl++) {
    const p = atLeast[lvl]! / total;
    console.log(`  >= ${lvl}★  ${(p * 100).toFixed(3)}%  (1 in ${p > 0 ? Math.round(1 / p) : Infinity})`);
  }
  const bonusP = bonusW / total;
  console.log(
    `  bonus rate ${(bonusP * 100).toFixed(3)}% (1 in ${Math.round(1 / bonusP)})  ` +
      `Wanted/Heat-5 share of bonuses ${((wantedBonusW / bonusW) * 100).toFixed(1)}%`
  );
}
