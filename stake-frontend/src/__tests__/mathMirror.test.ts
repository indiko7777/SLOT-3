import { describe, expect, it } from "vitest";
import {
  BET_MODES,
  BONUS_CELLS,
  BONUS_RESPINS_ON_LOCK,
  BONUS_START_RESPINS,
  CASCADE_LADDER,
  CLUSTER_PAY_X,
  CLUSTER_SIZE_FACTORS,
  clusterSizeFactor,
  MAX_WIN_MULTIPLIER
} from "../domain";
import * as math from "../../../stake-math/src/model";

/**
 * The in-game paytable/rules display copies of the math model MUST equal the
 * authoritative values in stake-math. A mismatch here is exactly the "payout
 * discrepancy" class of approval rejection — this test makes drift impossible
 * to ship silently.
 */
describe("frontend display values mirror stake-math exactly", () => {
  it("cluster pays match CLUSTER_PAY", () => {
    for (const sym of math.PAYABLE_SYMBOLS) {
      expect(CLUSTER_PAY_X[sym], `pay for ${sym}`).toBe(math.CLUSTER_PAY[sym]);
    }
  });

  it("cluster size factors match clusterSizeFactor for every size 5..20", () => {
    for (let size = 5; size <= 20; size++) {
      expect(CLUSTER_SIZE_FACTORS[size - 5], `factor for size ${size}`).toBe(
        math.clusterSizeFactor(size)
      );
      expect(clusterSizeFactor(size)).toBe(math.clusterSizeFactor(size));
    }
    expect(clusterSizeFactor(4)).toBe(0);
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
    expect(BONUS_RESPINS_ON_LOCK).toBe(math.BONUS_RESPINS_ON_LOCK);
    expect(BONUS_CELLS).toBe(math.BONUS_CELLS);
  });

  it("every mode's RTP target is 96%", () => {
    for (const mode of Object.values(BET_MODES)) {
      expect(mode.rtpTarget).toBe(math.TARGET_RTP);
    }
  });
});
