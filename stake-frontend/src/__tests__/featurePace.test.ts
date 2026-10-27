import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEvent } from "../domain";
import { CINEMATIC_WIN_MULTIPLIER, FeaturePacer, isFeatureBeat, SKIP_PRESSES, SKIP_WINDOW_MS } from "../featurePace";
import { getTimeScale, setTimeScale, wait } from "../pixi/tween";

const ev = (e: Record<string, unknown>) => e as unknown as GameEvent;

/** Play a list of events through the pacer, recording `active` during each. */
async function playAll(pacer: FeaturePacer, events: GameEvent[]): Promise<boolean[]> {
  const seen: boolean[] = [];
  for (const e of events) await pacer.run(e, async () => { seen.push(pacer.active); });
  return seen;
}

describe("feature pacing", () => {
  it("covers the whole Getaway, from its trigger to the exit, and nothing around it", async () => {
    const pacer = new FeaturePacer();
    const seen = await playAll(pacer, [
      ev({ type: "round_start" }),
      ev({ type: "board_settle" }),
      ev({ type: "bonus_trigger" }),
      ev({ type: "bonus_spin" }),
      ev({ type: "master_key_crack" }),
      ev({ type: "bonus_end" }),
      ev({ type: "round_end", payoutMultiplier: 3 }),
      ev({ type: "round_start" }),
    ]);
    expect(seen).toEqual([false, false, true, true, true, true, true, false]);
    expect(pacer.active).toBe(false);
  });

  it("covers single base-game feature beats only while they play", async () => {
    const pacer = new FeaturePacer();
    const seen = await playAll(pacer, [
      ev({ type: "cluster_win" }),
      ev({ type: "drive_by" }),
      ev({ type: "tumble_drop" }),
      ev({ type: "heat_transform" }),
      ev({ type: "mega_wild_place" }),
      ev({ type: "round_end", payoutMultiplier: CINEMATIC_WIN_MULTIPLIER }),
    ]);
    expect(seen).toEqual([false, true, false, true, true, true]);
    expect(isFeatureBeat(ev({ type: "round_end", payoutMultiplier: CINEMATIC_WIN_MULTIPLIER - 1 }))).toBe(false);
  });

  it("skips only after a deliberate burst of presses inside the window", () => {
    const changes = vi.fn();
    const pacer = new FeaturePacer({ onChange: changes });
    expect(pacer.press(0)).toBeNull(); // nothing on screen to skip
    pacer.begin();
    expect(changes).toHaveBeenCalledTimes(1);
    // Presses spread out wider than the window never add up.
    for (let i = 0; i < 6; i++) expect(pacer.press(i * (SKIP_WINDOW_MS + 1))).toBe(SKIP_PRESSES - 1);
    expect(pacer.skipping).toBe(false);
    let left: number | null = null;
    for (let i = 0; i < SKIP_PRESSES; i++) left = pacer.press(100_000 + i * 200);
    expect(left).toBe(0);
    expect(pacer.skipping).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(pacer.press(100_900)).toBeNull(); // already skipping
    pacer.end();
    expect(pacer.active).toBe(false);
    expect(pacer.skipping).toBe(false); // the next feature plays in full again
  });

  it("nests scene-started features inside the Getaway without ending it early", async () => {
    const pacer = new FeaturePacer();
    await pacer.run(ev({ type: "bonus_trigger" }), async () => {
      pacer.begin();
      pacer.end();
      expect(pacer.active).toBe(true);
    });
    expect(pacer.active).toBe(true);
    pacer.reset();
    expect(pacer.active).toBe(false);
  });

  it("closes a single beat even when its playback throws", async () => {
    const pacer = new FeaturePacer();
    await expect(pacer.run(ev({ type: "drive_by" }), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(pacer.active).toBe(false);
  });
});

describe("time scale changes reach animations already running", () => {
  // tween.ts schedules through window.setTimeout; node has no window.
  beforeEach(() => { vi.stubGlobal("window", globalThis); });
  afterEach(() => { setTimeScale(1); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("a pending wait speeds up the moment the scale rises", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let done = false;
    void wait(1000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(400); // 600 ms of the wait left at 1x
    setTimeScale(3); // → 200 ms of real time left
    expect(getTimeScale()).toBe(3);
    await vi.advanceTimersByTimeAsync(150);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(done).toBe(true);
  });

  it("an unchanged scale keeps the original timing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    setTimeScale(2);
    let done = false;
    void wait(1000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });
});
