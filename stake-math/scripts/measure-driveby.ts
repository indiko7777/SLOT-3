// Published Drive-By frequency and outcome per cash mode, weighted by the
// optimizer weights (what a player actually experiences). No publish.
import type { BetMode, GameEvent } from "../src/domain";
import { optimizeMode } from "../src/optimize";
import { simulateMode } from "../src/simulate";

for (const mode of ["base", "ante", "base_tier1"] as BetMode[]) {
  const sims = simulateMode(mode);
  const opt = optimizeMode(mode, sims);
  const w = new Map(opt.weighted.map((x) => [x.id, x.weight]));
  const total = opt.weighted.reduce((a, x) => a + x.weight, 0);
  let dbW = 0, dbPayX = 0, dbBonusW = 0, dbBigW = 0;
  const counts: Record<number, number> = {};
  for (const s of sims) {
    const ev = s.record.events.find((e: GameEvent) => e.type === "drive_by") as Extract<GameEvent, { type: "drive_by" }> | undefined;
    if (!ev) continue;
    const weight = w.get(s.id) ?? 0;
    dbW += weight;
    dbPayX += weight * s.payoutX;
    counts[ev.positions.length] = (counts[ev.positions.length] ?? 0) + weight;
    if (s.record.events.some((e: GameEvent) => e.type === "bonus_trigger")) dbBonusW += weight;
    if (s.payoutX >= 10) dbBigW += weight;
  }
  const p = dbW / total;
  console.log(`${mode}: drive-by ${(p * 100).toFixed(2)}% (1 in ${Math.round(1 / p)}) · mean win ${(dbPayX / dbW).toFixed(2)}x · >=10x ${(dbBigW / dbW * 100).toFixed(1)}% · into Getaway ${(dbBonusW / dbW * 100).toFixed(2)}% · RTP ${(opt.rtp * 100).toFixed(4)}% · hit ${(opt.hitRate * 100).toFixed(1)}%`);
  console.log(`   wilds: ${Object.entries(counts).map(([k, v]) => `${k}:${(v / dbW * 100).toFixed(0)}%`).join(" ")}`);
}
