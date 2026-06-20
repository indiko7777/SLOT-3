import { describe, expect, it } from "vitest";
import {
  MAX_WIN_MULTIPLIER,
  type RoundRecord,
  sumEventPayouts,
  validateRoundRecord
} from "../src/domain";

const winRound: RoundRecord = {
  id: 42,
  payoutMultiplier: 3.5,
  events: [
    { type: "round_start", mode: "base", boardSeedLabel: "t", turboProfile: "normal" },
    {
      type: "board_settle",
      board: [
        ["BRASS", "BRASS", "CASH", "KNIFE"],
        ["BRASS", "DUFFEL", "DIAMOND", "AMMO"],
        ["BRASS", "KNIFE", "BIKE", "PISTOL"],
        ["CASH", "BRASS", "AMMO", "DUFFEL"],
        ["DIAMOND", "CASH", "PISTOL", "BIKE"]
      ]
    },
    {
      type: "cluster_win",
      winId: "w1",
      symbol: "BRASS",
      positions: [
        [0, 0],
        [0, 1],
        [1, 0],
        [2, 0],
        [3, 1]
      ],
      baseMultiplier: 3.5,
      heatLevel: 0,
      appliedGlobalMultiplier: 1,
      payout: 3.5
    },
    { type: "round_end", payoutMultiplier: 3.5, capApplied: false }
  ]
};

describe("domain schema", () => {
  it("accepts a well-formed round record", () => {
    expect(() => validateRoundRecord(winRound)).not.toThrow();
  });

  it("sums event payouts to the round payout", () => {
    expect(sumEventPayouts(winRound)).toBeCloseTo(3.5, 4);
  });

  it("rejects a payout above the 5,000x cap", () => {
    expect(() =>
      validateRoundRecord({
        id: 2,
        payoutMultiplier: MAX_WIN_MULTIPLIER + 1,
        events: [
          { type: "round_start", mode: "base", boardSeedLabel: "t", turboProfile: "normal" },
          { type: "round_end", payoutMultiplier: MAX_WIN_MULTIPLIER + 1, capApplied: false }
        ]
      })
    ).toThrow();
  });

  it("rejects a record with no round_end", () => {
    expect(() =>
      validateRoundRecord({
        id: 1,
        payoutMultiplier: 0,
        events: [
          { type: "round_start", mode: "base", boardSeedLabel: "t", turboProfile: "normal" }
        ]
      })
    ).toThrow();
  });
});
