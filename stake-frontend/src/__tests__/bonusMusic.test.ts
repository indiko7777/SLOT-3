import { afterEach, describe, expect, it, vi } from "vitest";
import { EventAudioBus } from "../audio";

afterEach(() => vi.unstubAllGlobals());

const BED = { base: { duration: 125 }, groovy: { duration: 79 }, bonus: { duration: 118 } };

function setup(station = "heat") {
  const param = () => ({ value: 0.5, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const sources: any[] = [];
  const ctx = {
    currentTime: 10,
    state: "running",
    decodeAudioData: vi.fn(),
    createBufferSource: () => {
      const s = { connect: vi.fn((n) => n), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), playbackRate: param(), onended: null, loop: false, buffer: null as unknown };
      sources.push(s);
      return s;
    },
    createGain: () => ({ gain: param(), connect: vi.fn((n) => n), disconnect: vi.fn() }),
  };
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() });
  const bus = new EventAudioBus() as any;
  Object.assign(bus, {
    ctx, master: ctx.createGain(), radioStation: station, radioOverride: true,
    buffers: new Map<string, unknown>([["bg_base", BED.base], ["groovy", BED.groovy], ["bg_bonus", BED.bonus], ["getaway_intro", { duration: 10 }]]),
  });
  const loops = () => sources.filter((s) => s.loop).map((s) => s.buffer);
  return { bus, ctx, sources, loops };
}

describe("Getaway music timing", () => {
  it("stays out while the intro sting plays, then starts on the first bonus spin only", () => {
    const { bus, loops } = setup("groovy");
    bus.startLoop("groovy", "bg");
    expect(loops()).toEqual([BED.groovy]);

    bus.inBonus = true;
    bus.route({ type: "bonus_trigger", mode: "getaway", scatterPositions: [] }, false);
    expect(bus.bgLoop).toBeNull(); // the station has bowed out
    expect(loops()).not.toContain(BED.bonus); // not under the sting

    bus.route({ type: "bonus_spin", landedSymbols: [], lockedGrid: [] }, false);
    expect(bus.bgLoop.track).toBe("bg_bonus");
    const started = loops().length;

    bus.route({ type: "bonus_spin", landedSymbols: [], lockedGrid: [] }, false);
    expect(loops().length).toBe(started); // never restarted mid-bonus
  });

  it("hands back to the player's station when the bonus finishes", () => {
    const { bus } = setup("groovy");
    bus.inBonus = true;
    bus.route({ type: "bonus_trigger", mode: "getaway", scatterPositions: [] }, false);
    bus.route({ type: "bonus_spin", landedSymbols: [], lockedGrid: [] }, false);
    bus.finishBonus();
    expect(bus.bgLoop.track).toBe("groovy");
    expect(bus.inBonus).toBe(false);
    expect(bus.bonusMusicLive).toBe(false);
  });

  it("a station picked mid-bonus waits for the end of the bonus", async () => {
    const { bus } = setup("heat");
    bus.fetched = false;
    bus.approved = { init: vi.fn(async () => undefined), stopAll: vi.fn(), stop: vi.fn(), ready: false };
    bus.inBonus = true;
    bus.route({ type: "bonus_trigger", mode: "getaway", scatterPositions: [] }, false);
    bus.route({ type: "bonus_spin", landedSymbols: [], lockedGrid: [] }, false);
    bus.selectStation("groovy");
    await vi.waitFor(() => expect(bus.radioStation).toBe("groovy"));
    await new Promise((r) => setTimeout(r, 0));
    expect(bus.bgLoop.track).toBe("bg_bonus");
    bus.finishBonus();
    expect(bus.bgLoop.track).toBe("groovy");
  });

  it("radio off stays silent through the whole bonus", () => {
    const { bus } = setup("off");
    bus.inBonus = true;
    bus.route({ type: "bonus_trigger", mode: "getaway", scatterPositions: [] }, false);
    bus.route({ type: "bonus_spin", landedSymbols: [], lockedGrid: [] }, false);
    expect(bus.bgLoop).toBeNull();
    bus.finishBonus();
    expect(bus.bgLoop).toBeNull();
  });
});

describe("phone decode rule (one bed resident)", () => {
  function decoder(bus: any, ctx: any) {
    const resolvers: Array<(b: unknown) => void> = [];
    ctx.decodeAudioData.mockImplementation(() => new Promise((res) => resolvers.push(res)));
    bus.buffers = new Map();
    bus.musicRaw = new Map([["bg_base", new ArrayBuffer(8)], ["bg_bonus", new ArrayBuffer(8)]]);
    return resolvers;
  }

  it("a slow older decode never evicts the bed asked for since", async () => {
    const { bus, ctx } = setup();
    const r = decoder(bus, ctx);
    const base = bus.decodeMusic("bg_base");
    const bonus = bus.decodeMusic("bg_bonus");
    r[1]!(BED.bonus);
    await bonus;
    r[0]!(BED.base); // COASTAL HEAT finishes last
    await base;
    expect(bus.buffers.get("bg_bonus")).toBe(BED.bonus);
    expect(bus.buffers.has("bg_base")).toBe(false);
  });

  it("keeps only the newest bed once its decode lands", async () => {
    const { bus, ctx } = setup();
    const r = decoder(bus, ctx);
    const base = bus.decodeMusic("bg_base");
    r[0]!(BED.base);
    await base;
    const bonus = bus.decodeMusic("bg_bonus");
    r[1]!(BED.bonus);
    await bonus;
    expect([...bus.buffers.keys()]).toEqual(["bg_bonus"]);
  });

  it("a bonus spin before the decode lands starts the music as soon as it is ready", async () => {
    const { bus, ctx } = setup();
    const r = decoder(bus, ctx);
    bus.inBonus = true;
    bus.route({ type: "bonus_spin", landedSymbols: [], lockedGrid: [] }, false);
    expect(bus.bgLoop).toBeNull(); // no police-loop stand-in, and no error
    r[0]!(BED.bonus);
    await vi.waitFor(() => expect(bus.bgLoop?.track).toBe("bg_bonus"));
  });
});
