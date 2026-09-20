import { afterEach, describe, expect, it, vi } from "vitest";
import { EventAudioBus } from "../audio";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const param = () => ({ value: 0.5, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const sources: any[] = [];
  const ctx = {
    currentTime: 10,
    createBufferSource: () => {
      const s = { connect: vi.fn((n) => n), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), playbackRate: param(), onended: null, loop: false };
      sources.push(s);
      return s;
    },
    createGain: () => ({ gain: param(), connect: vi.fn((n) => n), disconnect: vi.fn() }),
  };
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() });
  const bus = new EventAudioBus();
  // Inject Web Audio nodes so assertions inspect actual scheduled source stops.
  Object.assign(bus, { ctx, master: ctx.createGain(), buffers: new Map([
    ["money_counter_loop", { duration: 6.5 }], ["money_counter_end", { duration: 2.9 }],
    ["getaway_end", { duration: 2.3 }], ["bg_base", { duration: 30 }],
  ]) });
  return { bus, sources };
}

describe("money counter audio", () => {
  it("cuts the loop within 15 ms and limits the ending accent to 280 ms", () => {
    const { bus, sources } = setup();
    bus.startWinCounter();
    bus.stopWinCounter();
    expect(sources[0].stop).toHaveBeenCalledWith(10.015);
    expect(sources[1].start).toHaveBeenCalledWith(10, 0, 0.28);
    bus.stopWinCounter();
    expect(sources).toHaveLength(2);
  });
  it("dismissal cancels the ending accent without starting another sound", () => {
    const { bus, sources } = setup();
    bus.startWinCounter();
    bus.stopWinCounter();
    bus.cancelWinCounter();
    bus.cancelWinCounter();
    expect(sources[1].stop).toHaveBeenCalledWith(10.015);
    expect(sources).toHaveLength(2);
  });
  it("mute and cleanup never launch a completion cue", () => {
    const { bus, sources } = setup();
    bus.startWinCounter();
    bus.killAll();
    bus.stopWinCounter();
    bus.startWinCounter();
    expect(sources).toHaveLength(1);
    expect(sources[0].stop).toHaveBeenCalledWith(10.015);
  });
  it("a new count cancels a previous completion accent", () => {
    const { bus, sources } = setup();
    bus.startWinCounter();
    bus.stopWinCounter();
    bus.startWinCounter();
    expect(sources[1].stop).toHaveBeenCalledWith(10.015);
    expect(sources[2].loop).toBe(true);
  });
  it("keeps the base radio out of the bonus result and restores it on visual exit", () => {
    const { bus, sources } = setup();
    const route = bus as unknown as { route(event: { type: string }, turbo: boolean): void };
    Object.assign(bus, { inBonus: true });
    route.route({ type: "bonus_end" }, false);
    expect(sources).toHaveLength(0);
    bus.finishBonus();
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
  });
});
