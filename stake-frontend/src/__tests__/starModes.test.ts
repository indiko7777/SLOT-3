import { describe, expect, it } from "vitest";
import { addWilds, consumeGetawayStars, emptyGallery } from "../meta/collection";
import { selectSpinMode, starsForMode } from "../meta/starModes";

const modes = Object.fromEntries(["base", "ante", "base_tier1", "base_tier2", "base_tier3"].map(mode => [mode, { mode, costMultiplier: mode === "ante" ? 1.5 : 1, feature: false }]));

describe("character completion and gold-star modes", () => {
  it("reveals pieces without awarding a star until the silhouette is complete", () => {
    expect(addWilds(emptyGallery(), 7).data.getawayStars).toBe(0);
    const first = addWilds(emptyGallery(), 8).data;
    expect(first.getawayStars).toBe(1);
    expect(first.currentGirl).toBe(1);
    expect(first.pieces).toBe(0);
    expect(selectSpinMode(false, first.getawayStars, modes)).toBe("base_tier1");
  });
  it("keeps the third star when the gallery advances to prestige", () => {
    const second = addWilds(emptyGallery(), 15).data;
    expect(second.getawayStars).toBe(2);
    const third = addWilds(second, 8).data;
    expect(third.prestige).toBe(1);
    expect(third.currentGirl).toBe(0);
    expect(third.getawayStars).toBe(3);
    expect(selectSpinMode(false, third.getawayStars, modes)).toBe("base_tier3");
    expect(consumeGetawayStars(third).getawayStars).toBe(0);
    expect(consumeGetawayStars(third).unlocks).toEqual(third.unlocks);
  });
  it("never invents a mode absent from authentication", () => {
    expect(selectSpinMode(false, 3, { base: modes.base! })).toBe("base");
    expect(selectSpinMode(false, 3, { base_tier1: modes.base_tier1! })).toBe("base_tier1");
    expect(selectSpinMode(true, 3, modes)).toBe("ante");
  });
  it("the current book determines its star count, including replays", () => {
    expect(starsForMode("base_tier2")).toBe(2);
    expect(starsForMode("ante")).toBe(0);
    expect(starsForMode("getaway")).toBe(0);
    expect(starsForMode("base_tier4")).toBe(0);
  });
});
