import { afterEach, describe, expect, it, vi } from "vitest";
import { createWinCount } from "../pixi/winCount";

afterEach(() => vi.unstubAllGlobals());

function setup(duration = 1000) {
  let id = 0;
  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const events: string[] = [];
  let amount = 0;
  const counter = createWinCount({
    duration,
    update: (p) => { amount = p * 1933; events.push(`value:${amount}`); },
    start: () => events.push("audio:start"),
    progress: () => events.push("audio:progress"),
    end: () => events.push("audio:end"),
    cancel: () => events.push("audio:cancel"),
  });
  const step = (time: number): void => {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(now));
  };
  return { counter, events, frames, step, amount: () => amount };
}

describe("counter visual/audio lifecycle", () => {
  it("commits the exact final value and stops audio in the same frame", async () => {
    const x = setup();
    x.step(500);
    expect(x.amount()).toBeGreaterThan(0);
    expect(x.amount()).toBeLessThan(1933);
    x.step(1000);
    await x.counter.done;
    expect(x.events.slice(-2)).toEqual(["value:1933", "audio:end"]);
    expect(x.frames.size).toBe(0);
  });
  it("skips immediately between frames and repeated taps cannot restart audio", async () => {
    const x = setup();
    x.step(150);
    x.counter.finish();
    expect(x.amount()).toBe(1933);
    expect(x.events.slice(-2)).toEqual(["value:1933", "audio:end"]);
    x.counter.finish();
    x.counter.finish();
    x.step(2000);
    await x.counter.done;
    expect(x.events.filter((e) => e === "audio:end")).toHaveLength(1);
    expect(x.frames.size).toBe(0);
  });
  it("does not start sound for turbo, zero duration or a skip during the entrance", async () => {
    const x = setup(0);
    await x.counter.done;
    x.counter.finish();
    expect(x.events).toEqual(["value:1933"]);
    expect(x.frames.size).toBe(0);
  });
  it("cancels without launching a completion cue or leaving a scheduled frame", async () => {
    const x = setup();
    x.step(200);
    x.counter.cancel();
    x.counter.finish();
    x.step(1000);
    await x.counter.done;
    expect(x.events.at(-1)).toBe("audio:cancel");
    expect(x.events).not.toContain("audio:end");
    expect(x.frames.size).toBe(0);
  });
  it("lands correctly after a background-tab frame gap", () => {
    const x = setup();
    x.step(60000);
    expect(x.events.slice(-2)).toEqual(["value:1933", "audio:end"]);
    expect(x.frames.size).toBe(0);
  });
});
