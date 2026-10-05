import { describe, expect, it } from "vitest";
import {
  BET_MODES,
  BONUS_CELLS,
  BONUS_START_RESPINS,
  CASCADE_LADDER,
  clusterPay,
  GOLD_BAR_VALUES,
  MAX_WIN_MULTIPLIER,
  PAYTABLE_X
} from "../domain";
import * as math from "../../../stake-math/src/model";

/**
 * The in-game paytable/rules display copies of the math model MUST equal the
 * authoritative values in stake-math. A mismatch here is exactly the "payout
 * discrepancy" class of approval rejection — this test makes drift impossible
 * to ship silently.
 */
describe("frontend display values mirror stake-math exactly", () => {
  it("the paytable matches PAYTABLE for every symbol and cluster size 5..20", () => {
    expect(Object.keys(PAYTABLE_X).sort()).toEqual([...math.PAYABLE_SYMBOLS].sort());
    for (const sym of math.PAYABLE_SYMBOLS) {
      expect([...PAYTABLE_X[sym]!], `paytable row for ${sym}`).toEqual([...math.PAYTABLE[sym]!]);
      for (let size = 4; size <= 21; size++) {
        expect(clusterPay(sym, size), `${sym} x${size}`).toBe(math.clusterPay(sym, size));
      }
    }
  });

  it("every mode's Gold Bar values match the math tables", () => {
    for (const mode of Object.keys(math.MODES) as Array<keyof typeof math.MODES>) {
      expect([...GOLD_BAR_VALUES[mode]], `gold bars for ${mode}`).toEqual(math.goldBarValues(mode));
    }
  });

  it("cascade ladder matches CASCADE_LADDER", () => {
    expect([...CASCADE_LADDER]).toEqual([...math.CASCADE_LADDER]);
  });

  it("bet mode names and costs match the math bundle", () => {
    const mathModes = Object.entries(math.MODES);
    expect(Object.keys(BET_MODES).sort()).toEqual(
      mathModes.map(([name]) => name).sort()
    );
    for (const [name, cfg] of mathModes) {
      expect(
        BET_MODES[name as keyof typeof BET_MODES].priceMultiplier,
        `cost for ${name}`
      ).toBe(cfg.cost);
    }
  });

  it("mode names contain no restricted words (social jurisdictions)", () => {
    for (const name of Object.keys(math.MODES)) {
      expect(name).not.toMatch(/buy|bet|pay/i);
    }
  });

  it("bonus constants and max win match", () => {
    expect(MAX_WIN_MULTIPLIER).toBe(math.MAX_WIN_X);
    expect(BONUS_START_RESPINS).toBe(math.BONUS_START_RESPINS);
    expect(BONUS_CELLS).toBe(math.BONUS_CELLS);
  });

  it("every mode's RTP target is 96%", () => {
    for (const mode of Object.values(BET_MODES)) {
      expect(mode.rtpTarget).toBe(math.TARGET_RTP);
    }
  });
});
