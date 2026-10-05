import { describe, expect, it } from "vitest";
import { validateRoundRecord } from "../src/domain";
import { quantize, simulateRound } from "../src/engine";
import { CASCADE_LADDER, type Criteria, clusterPay, MODES, PAYTABLE, TARGET_RTP } from "../src/model";
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

const onGrid = (x: number): boolean => Math.abs(x * 100 - Math.round(x * 100)) < 1e-9;

describe("quantize", () => {
  it("snaps to the 0.01x grid without moving on-grid values", () => {
    expect(quantize(0.1 + 0.2)).toBe(0.3);
    expect(quantize(3 * 1.15)).toBe(3.45);
    for (const x of [0, 0.05, 0.11, 37.8, 4999.99]) expect(quantize(x)).toBe(x);
  });
});

describe("paytable", () => {
  it("has a 0.01x-grid value for every cluster size 5..20, non-decreasing", () => {
    for (const [sym, row] of Object.entries(PAYTABLE)) {
      expect(row, sym).toHaveLength(16);
      row!.forEach((v, i) => {
        expect(onGrid(v), `${sym}@${i + 5}`).toBe(true);
        if (i > 0) expect(v).toBeGreaterThanOrEqual(row![i - 1]!);
      });
    }
  });
  it("every gold bar value is on the 0.01x grid", () => {
    for (const [mode, cfg] of Object.entries(MODES))
      for (const s of cfg.safeValues) expect(onGrid(s.value), `${mode} ${s.value}`).toBe(true);
  });
});

describe("engine", () => {
  it("produces deterministic, schema-valid rounds on the 0.01x grid", () => {
    for (const crit of ["zero", "basegame", "freegame", "wincap"] as Criteria[]) {
      const a = simulateRound("base", crit, 999, 1);
      const b = simulateRound("base", crit, 999, 1);
      expect(JSON.stringify(a.record)).toEqual(JSON.stringify(b.record));
      expect(() => validateRoundRecord(a.record)).not.toThrow();
      expect(onGrid(a.record.payoutMultiplier)).toBe(true);
      expect(a.record.payoutMultiplier).toBeLessThanOrEqual(5000);
    }
  });

  it("every cluster win is EXACTLY paytable value x cascade rung, and wins sum to the total", () => {
    // Engine review: "frontend math must match exactly what is written in game
    // info and what is returned by RGS". No rescaling, ever (the cap aside).
    const crits: Criteria[] = ["basegame", "basebig", "freegame", "wincap", "zero"];
    let clusters = 0;
    for (const mode of ["base", "ante", "base_tier2", "getaway", "super_getaway"] as const) {
      for (let seed = 1; seed <= 600; seed++) {
        const { record } = simulateRound(mode, crits[seed % crits.length]!, seed * 104729, seed);
        const end = record.events.at(-1) as { type: string; capApplied: boolean };
        let sum = 0;
        for (const ev of record.events) {
          if (ev.type === "cluster_win") {
            clusters++;
            expect(ev.baseMultiplier).toBe(clusterPay(ev.symbol, ev.positions.length));
            expect(CASCADE_LADDER).toContain(ev.appliedGlobalMultiplier);
            if (!end.capApplied)
              expect(ev.payout).toBe(quantize(ev.baseMultiplier * ev.appliedGlobalMultiplier));
            sum = quantize(sum + ev.payout);
          } else if (ev.type === "bonus_end") sum = quantize(sum + ev.totalPayout);
        }
        expect(sum).toBe(record.payoutMultiplier);
      }
    }
    expect(clusters).toBeGreaterThan(500);
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
    }
  });

  it("solves a buy mode via the wincap rate", () => {
    const sims: Sim[] = [];
    let id = 1;
    for (let i = 0; i < 1200; i++) sims.push(synthSim(id++, 5 + (i % 80) * 1, "freegame"));
    for (let i = 0; i < 200; i++) sims.push(synthSim(id++, 5000, "wincap"));
    const opt = optimizeMode("getaway", sims);
    expect(Math.abs(opt.rtp - TARGET_RTP)).toBeLessThan(0.005);
  });
});
