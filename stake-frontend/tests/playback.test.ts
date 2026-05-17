import { describe, expect, it } from "vitest";
import type { RoundRecord } from "../src/domain";
import { applyEvent, INITIAL_SNAPSHOT } from "../src/playback";

const record: RoundRecord = {
  id: 7,
  payoutMultiplier: 12,
  events: [
    { type: "round_start", mode: "base", boardSeedLabel: "x", turboProfile: "normal" },
    {
      type: "board_settle",
      board: [
        ["BRASS", "BRASS", "WATCH", "KNIFE"],
        ["BRASS", "DUFFEL", "DIAMOND", "AMMO"],
        ["BRASS", "KNIFE", "BIKE", "PISTOL"],
        ["WATCH", "BRASS", "AMMO", "DUFFEL"],
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
        [1, 0]
      ],
      baseMultiplier: 12,
      heatLevel: 0,
      appliedGlobalMultiplier: 1,
      payout: 12
    },
    { type: "round_end", payoutMultiplier: 12, capApplied: false }
  ]
};

describe("event-driven playback", () => {
  it("replays events to the record's final payout", () => {
    const finalSnapshot = record.events.reduce(
      (snapshot, event) => applyEvent(snapshot, event, record),
      INITIAL_SNAPSHOT
    );
    expect(finalSnapshot.roundWin).toBe(record.payoutMultiplier);
    expect(finalSnapshot.state).toBe("round_complete");
  });

  it("marks a capped max win", () => {
    const capped: RoundRecord = {
      id: 8,
      payoutMultiplier: 5000,
      events: [
        { type: "round_start", mode: "super_buy", boardSeedLabel: "c", turboProfile: "normal" },
        { type: "bonus_trigger", mode: "super_getaway", scatterPositions: [[0, 0], [1, 0], [2, 0]] },
        { type: "bonus_end", totalPayout: 5000, filledScreen: true },
        { type: "round_end", payoutMultiplier: 5000, capApplied: true }
      ]
    };
    const finalSnapshot = capped.events.reduce(
      (snapshot, event) => applyEvent(snapshot, event, capped),
      INITIAL_SNAPSHOT
    );
    expect(finalSnapshot.roundWin).toBe(5000);
    expect(finalSnapshot.capApplied).toBe(true);
  });
});
