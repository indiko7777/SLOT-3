import { describe, expect, it } from "vitest";
import { BET_MODES, MAX_WIN_MULTIPLIER, sumEventPayouts, validateRoundRecord, type BetMode } from "../src/domain";
import { createFixtureRecords } from "../src/fixtures";

const modes: BetMode[] = ["base", "ante", "buy", "super_buy"];

describe("Heat Chase deterministic event records", () => {
  it("validates every fixture round for every bet mode", () => {
    for (const mode of modes) {
      for (const record of createFixtureRecords(mode)) {
        expect(() => validateRoundRecord(record)).not.toThrow();
      }
    }
  });

  it("keeps all records inside the 5,000x max win cap", () => {
    for (const mode of modes) {
      for (const record of createFixtureRecords(mode)) {
        expect(record.payoutMultiplier).toBeLessThanOrEqual(MAX_WIN_MULTIPLIER);
      }
    }
  });

  it("covers every frontend event type from the implementation plan", () => {
    const covered = new Set(createFixtureRecords("base").flatMap((record) => record.events.map((event) => event.type)));
    expect([...covered].sort()).toEqual(
      [
        "board_settle",
        "bonus_end",
        "bonus_spin",
        "bonus_trigger",
        "cluster_win",
        "global_multiplier_apply",
        "heat_advance",
        "heat_transform",
        "master_key_crack",
        "mega_wild_place",
        "round_end",
        "round_start",
        "safe_lock",
        "scatter_tease",
        "tumble_drop",
        "tumble_remove"
      ].sort()
    );
  });

  it("keeps event payout components aligned with record totals for non-capped showcase rounds", () => {
    for (const mode of modes) {
      const records = createFixtureRecords(mode).filter((record) => record.payoutMultiplier < MAX_WIN_MULTIPLIER);
      for (const record of records) {
        const summed = sumEventPayouts(record);
        expect(summed).toBeCloseTo(record.payoutMultiplier, 4);
      }
    }
  });

  it("locks the planned buy, super buy, and ante pricing assumptions", () => {
    expect(BET_MODES.buy.priceMultiplier).toBe(100);
    expect(BET_MODES.super_buy.priceMultiplier).toBe(500);
    expect(BET_MODES.ante.priceMultiplier).toBe(1.5);
  });
});
