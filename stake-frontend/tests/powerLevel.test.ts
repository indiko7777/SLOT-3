import { describe, expect, it } from "vitest";
import {
  CARDS,
  NUM_CARDS,
  activeTier,
  addPoints,
  cardProgress,
  consumeHeadStart,
  effectiveTier,
  emptyPowerState,
  grandReset,
  isHeadStartActive,
  recordSpin,
  routeMode,
  sanitizePower,
  type PowerState
} from "../src/meta/powerLevel";
import { MemoryPlayerStateStore } from "../src/meta/PlayerStateStore";

const T1 = CARDS[0]!.threshold;
const T3 = CARDS[2]!.threshold;

/** Add `count` WILDs at `bet` to a state (= count × bet points). */
function addWilds(s: PowerState, bet: number, count: number): PowerState {
  let st = s;
  for (let i = 0; i < count; i++) st = addPoints(st, bet).state;
  return st;
}

describe("powerLevel: value-weighted points", () => {
  it("awards points = wilds × base bet", () => {
    let s = emptyPowerState();
    // 2 WILDs at a $2 bet → 4 points (the spec's example).
    s = addWilds(s, 2, 2);
    expect(s.points).toBe(4);
  });

  it("points are global and continuous across bet changes (never reset)", () => {
    let s = emptyPowerState();
    s = addPoints(s, 1).state; // bet $1
    s = addPoints(s, 5).state; // bet $5 — same global total keeps climbing
    expect(s.points).toBe(6);
  });
});

describe("powerLevel: card unlock + average-bet logging", () => {
  it("unlocks card 1 at its threshold and logs the phase average bet", () => {
    let s = emptyPowerState();
    // Five paid $2 spins make up the phase that earns card 1.
    for (let i = 0; i < 5; i++) s = recordSpin(s, 2);
    // Land enough WILDs (at $2 each) to cross threshold 1.
    const wilds = Math.ceil(T1 / 2);
    let unlocked = null as ReturnType<typeof addPoints>["gain"]["cardUnlocked"];
    for (let i = 0; i < wilds; i++) {
      const r = addPoints(s, 2);
      s = r.state;
      if (r.gain.cardUnlocked) unlocked = r.gain.cardUnlocked;
    }
    expect(s.cardsUnlocked).toBe(1);
    expect(unlocked?.id).toBe(0);
    // average bet = 10 wagered / 5 spins = 2, logged for tier 1.
    expect(s.avgBetByTier[1]).toBe(2);
    // phase resets after the unlock so the next card averages fresh.
    expect(s.phaseSpins).toBe(0);
    expect(s.phaseWagered).toBe(0);
  });
});

describe("powerLevel: the Active Power-Level lock", () => {
  it("head-start is active at/below the logged average bet, dimmed above it", () => {
    let s = emptyPowerState();
    s = recordSpin(s, 2);
    s = addWilds(s, 2, Math.ceil(T1 / 2)); // unlock card 1, avg bet = 2
    expect(activeTier(s)).toBe(1);

    expect(effectiveTier(s, 2)).toBe(1); // exactly at the lock → active
    expect(effectiveTier(s, 1)).toBe(1); // below → active
    expect(effectiveTier(s, 5)).toBe(0); // above → dimmed (Tier 0 for that spin)
    expect(isHeadStartActive(s, 5)).toBe(false);
  });

  it("routes eligible spins to base_tierN and over-bet spins to base", () => {
    let s = emptyPowerState();
    s = recordSpin(s, 2);
    s = addWilds(s, 2, Math.ceil(T1 / 2));
    expect(routeMode(s, 2)).toBe("base_tier1");
    expect(routeMode(s, 9)).toBe("base"); // above the lock → normal table
  });
});

describe("powerLevel: consume + grand reset lifecycle", () => {
  it("consuming a head-start returns to Tier 0 but keeps the card visible", () => {
    let s = emptyPowerState();
    s = recordSpin(s, 1);
    s = addWilds(s, 1, T1); // unlock card 1
    expect(activeTier(s)).toBe(1);

    const r = consumeHeadStart(s, 1);
    expect(r.grandReset).toBe(false);
    expect(r.consumedTier).toBe(1);
    s = r.state;
    expect(activeTier(s)).toBe(0); // head-start spent
    expect(s.cardsUnlocked).toBe(1); // …but the card stays unlocked/visible
  });

  it("does nothing when the spin had no active head-start (effTier 0)", () => {
    let s = emptyPowerState();
    s = addWilds(s, 1, T1);
    const r = consumeHeadStart(s, 0);
    expect(r.state).toBe(s);
    expect(r.consumedTier).toBe(0);
  });

  it("runs the full Sapphire → Roxy → Vega → Grand Reset arc", () => {
    let s = emptyPowerState();
    // Earn all three cards in one continuous climb (no Getaway yet).
    s = recordSpin(s, 1);
    s = addWilds(s, 1, T3);
    expect(s.cardsUnlocked).toBe(NUM_CARDS);
    expect(activeTier(s)).toBe(3); // Tier 3 head-start armed

    // Hit the Getaway on the Tier 3 head-start → the Grand Reset.
    const r = consumeHeadStart(s, 3);
    expect(r.grandReset).toBe(true);
    s = r.state;
    expect(s.points).toBe(0);
    expect(s.cardsUnlocked).toBe(0);
    expect(activeTier(s)).toBe(0);
  });

  it("grandReset wipes everything back to State 0", () => {
    let s = emptyPowerState();
    s = addWilds(s, 5, T3 / 5 + 1);
    s = grandReset(s);
    expect(s.points).toBe(0);
    expect(s.cardsUnlocked).toBe(0);
    expect(s.consumed).toBe(0);
  });
});

describe("powerLevel: persistence + sanitize", () => {
  it("round-trips through the store", () => {
    const store = new MemoryPlayerStateStore();
    let s = emptyPowerState();
    s = recordSpin(s, 3);
    s = addWilds(s, 3, 2);
    store.save(s);
    const loaded = store.load();
    expect(loaded.points).toBe(s.points);
    expect(loaded.phaseSpins).toBe(s.phaseSpins);
  });

  it("repairs corrupt/over-range state without throwing", () => {
    const repaired = sanitizePower({
      points: -5,
      cardsUnlocked: 99,
      consumed: 99,
      avgBetByTier: ["x" as unknown as number, -1, 4, 8],
      phaseSpins: -3
    } as Partial<PowerState>);
    expect(repaired.points).toBe(0);
    expect(repaired.cardsUnlocked).toBe(NUM_CARDS);
    expect(repaired.consumed).toBeLessThanOrEqual(repaired.cardsUnlocked);
    expect(repaired.phaseSpins).toBe(0);
  });

  it("cardProgress reports progress toward the next card", () => {
    let s = emptyPowerState();
    s = addPoints(s, T1 / 2).state; // halfway to card 1 (single big WILD)
    const p = cardProgress(s);
    expect(p.nextCard?.id).toBe(0);
    expect(p.into).toBe(T1 / 2);
    expect(p.needed).toBe(T1);
  });
});
