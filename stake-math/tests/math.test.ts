import { describe, expect, it } from "vitest";
import { validateRoundRecord } from "../src/domain";
import { quantize, simulateRound } from "../src/engine";
import { type Criteria, TARGET_RTP } from "../src/model";
import { optimizeMode } from "../src/optimize";
import { Rng } from "../src/rng";
import type { Sim } from "../src/simulate";

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    const c = new Rng(124);
    const seqA = Array.from({ length: 8 }, () => a.nextUint32());
    const seqB = Array.from({ length: 8 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(Array.from({ length: 8 }, () => c.nextUint32()));
  });
});

describe("quantize", () => {
  it("snaps to the Stake 0.1x grid (payout %% 10 == 0 in hundredths)", () => {
    for (const x of [0, 0.04, 0.06, 0.12, 1.249, 37.77, 4999.95]) {
      const q = quantize(x);
      expect(Math.round(q * 100) % 10).toBe(0);
    }
  });
});

describe("engine", () => {
  it("produces deterministic, schema-valid rounds with quantized payouts", () => {
    for (const crit of ["zero", "basegame", "freegame", "wincap"] as Criteria[]) {
      const a = simulateRound("base", crit, 999, 1);
      const b = simulateRound("base", crit, 999, 1);
      expect(JSON.stringify(a.record)).toEqual(JSON.stringify(b.record));
      expect(() => validateRoundRecord(a.record)).not.toThrow();
      expect(Math.round(a.record.payoutMultiplier * 100) % 10).toBe(0);
      expect(a.record.payoutMultiplier).toBeLessThanOrEqual(5000);
    }
  });
});

function synthSim(id: number, payoutX: number, criteria: Criteria): Sim {
  return {
    id,
    payoutX,
    criteria,
    record: {
      id,
      payoutMultiplier: payoutX,
      events: [
        { type: "round_start", mode: "base", boardSeedLabel: "s", turboProfile: "normal" },
        { type: "round_end", payoutMultiplier: payoutX, capApplied: payoutX >= 5000 }
      ]
    }
  };
}

describe("cascade / heat_transform", () => {
  it("never transforms a cell that the same cascade just removed", () => {
    // Regression: if heat_transform targets a just-won (removed) cell, the
    // renderer refills the hole and the winning cluster appears to switch symbol
    // instead of disappearing. The transform must only touch SURVIVING symbols.
    const key = (p: [number, number]) => `${p[0]}:${p[1]}`;
    const crits: Criteria[] = ["basegame", "basebig", "freegame", "wincap"];
    let transforms = 0;
    let overlaps = 0;
    for (const mode of ["base", "base_tier3"] as const) {
      for (let seed = 1; seed <= 3000; seed++) {
        const { record } = simulateRound(mode, crits[seed % crits.length]!, seed * 7919, seed);
        let removed = new Set<string>();
        for (const ev of record.events) {
          if (ev.type === "tumble_remove") removed = new Set(ev.positions.map(key));
          else if (ev.type === "heat_transform") {
            transforms++;
            for (const p of ev.positions) if (removed.has(key(p))) overlaps++;
          }
        }
      }
    }
    expect(transforms).toBeGreaterThan(0); // the pattern is actually exercised
    expect(overlaps).toBe(0);
  });
});

describe("optimizer", () => {
  it("hits 96% RTP within tolerance for a cash-mode sim set", () => {
    const sims: Sim[] = [];
    let id = 1;
    for (let i = 0; i < 2000; i++) sims.push(synthSim(id++, 0, "zero"));
    for (let i = 0; i < 1500; i++) sims.push(synthSim(id++, 0.2 + (i % 30) * 0.1, "basegame"));
    for (let i = 0; i < 200; i++) sims.push(synthSim(id++, 8 + (i % 40) * 4, "basebig"));
    for (let i = 0; i < 600; i++) sims.push(synthSim(id++, 10 + (i % 50) * 5, "freegame"));
    for (let i = 0; i < 80; i++) sims.push(synthSim(id++, 5000, "wincap"));

    const opt = optimizeMode("base", sims);
    expect(Math.abs(opt.rtp - TARGET_RTP)).toBeLessThan(0.005);
    for (const w of opt.weighted) {
      expect(Number.isInteger(w.weight)).toBe(true);
      expect(w.weight).toBeGreaterThanOrEqual(0);
      expect(w.payoutCents % 10).toBe(0);
    }
  });

  it("solves a buy mode via the wincap rate", () => {
    const sims: Sim[] = [];
    let id = 1;
    for (let i = 0; i < 1200; i++) sims.push(synthSim(id++, 5 + (i % 80) * 1, "freegame"));
    for (let i = 0; i < 200; i++) sims.push(synthSim(id++, 5000, "wincap"));
    const opt = optimizeMode("buy", sims);
    expect(Math.abs(opt.rtp - TARGET_RTP)).toBeLessThan(0.005);
  });
});
