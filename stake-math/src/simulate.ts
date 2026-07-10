import type { BetMode, RoundRecord } from "./domain";
import { validateRoundRecord } from "./domain";
import { simulateRound } from "./engine";
import { BASEBIG_THRESHOLD, type Criteria, MODES } from "./model";

export interface Sim {
  id: number;
  payoutX: number;
  criteria: Criteria;
  record: RoundRecord;
}

/**
 * Deterministic seed for (mode, id). Distinct per mode so books never collide
 * and a given id always replays identically.
 */
function seedFor(mode: BetMode, id: number): number {
  const salt: Record<BetMode, number> = {
    base: 0x1111,
    ante: 0x2222,
    getaway: 0x3333,
    super_getaway: 0x4444,
    base_tier1: 0x5555,
    base_tier2: 0x6666,
    base_tier3: 0x7777
  };
  return (Math.imul(id, 2654435761) ^ salt[mode]) >>> 0;
}

export function simulateMode(mode: BetMode): Sim[] {
  const cfg = MODES[mode];
  const order: Criteria[] = ["wincap", "freegame", "basebig", "basegame", "zero"];
  const plan: Criteria[] = [];
  for (const crit of order) {
    const n = Math.round(cfg.sims * cfg.criteria[crit]);
    for (let i = 0; i < n; i++) plan.push(crit);
  }
  while (plan.length < cfg.sims) plan.push("basegame");
  plan.length = cfg.sims;

  const sims: Sim[] = [];
  for (let i = 0; i < plan.length; i++) {
    const id = i + 1;
    const { record } = simulateRound(mode, plan[i]!, seedFor(mode, id), id);
    validateRoundRecord(record);
    sims.push({
      id,
      payoutX: record.payoutMultiplier,
      criteria: classify(record.payoutMultiplier, record),
      record
    });
  }
  return sims;
}

function classify(payoutX: number, record: RoundRecord): Criteria {
  if (record.events.at(-1)?.type === "round_end") {
    const end = record.events.at(-1) as { capApplied?: boolean };
    if (end.capApplied) return "wincap";
  }
  if (payoutX <= 0) return "zero";
  const hasBonus = record.events.some((e) => e.type === "bonus_trigger");
  if (hasBonus) return "freegame";
  return payoutX >= BASEBIG_THRESHOLD ? "basebig" : "basegame";
}
