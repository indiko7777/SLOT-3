import { describe, expect, it } from "vitest";
import { PrecomputedBookOutcomeProvider } from "../src/rgs";

describe("precomputed book outcome provider", () => {
  it("returns validated records without sharing mutable references", async () => {
    const provider = new PrecomputedBookOutcomeProvider();
    const first = await provider.requestOutcome({ mode: "base", stakeMultiplier: 1 });
    first.events.length = 0;

    const second = await provider.requestOutcome({ mode: "base", stakeMultiplier: 1 });
    expect(second.events.length).toBeGreaterThan(0);
    expect(second.events.at(-1)?.type).toBe("round_end");
  });

  it("keeps mode books separate for buy and super buy", async () => {
    const provider = new PrecomputedBookOutcomeProvider();
    const buy = await provider.requestOutcome({ mode: "buy", stakeMultiplier: 100 });
    const superBuy = await provider.requestOutcome({ mode: "super_buy", stakeMultiplier: 500 });

    expect(buy.id).toBeGreaterThanOrEqual(3000);
    expect(superBuy.id).toBeGreaterThanOrEqual(4000);
  });
});
