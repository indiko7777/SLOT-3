import { afterEach, describe, expect, it, vi } from "vitest";
import { EventAudioBus } from "../audio";
import { playFoley } from "../audio/SymbolFoley";

vi.mock("../audio/SymbolFoley", async (original) => ({
  ...await original<typeof import("../audio/SymbolFoley")>(), playFoley: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup() {
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn() });
  vi.stubGlobal("performance", { now: () => 1000 });
  const bus = new EventAudioBus();
  const ctx = { currentTime: 1, state: "running" };
  const master = { gain: { cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } };
  Object.assign(bus, { ctx, master });
  return { bus, ctx, master };
}

describe("production symbol audio routing", () => {
  it("routes a cluster's authored impact once through the master output", () => {
    const { bus, ctx, master } = setup();
    for (let i = 0; i < 20; i++) bus.symbolFoley("PISTOL", "fire", false);
    expect(playFoley).toHaveBeenCalledTimes(1);
    expect(playFoley).toHaveBeenCalledWith(ctx, master, "PISTOL", "fire", .38);
  });
  it("honors mute, hidden tabs, suspended audio and unknown cues", () => {
    const { bus, ctx } = setup();
    bus.setMuted(true);
    bus.symbolFoley("CASH", "riffle", false);
    bus.setMuted(false);
    ctx.state = "suspended";
    bus.symbolFoley("CASH", "riffle", false);
    ctx.state = "running";
    Object.assign(document, { hidden: true });
    bus.symbolFoley("CASH", "riffle", false);
    Object.assign(document, { hidden: false });
    bus.symbolFoley("CASH", "missing", false);
    expect(playFoley).not.toHaveBeenCalled();
  });
  it("keeps the turbo signature but drops paper detail and caps mixed clusters", () => {
    const { bus } = setup();
    bus.symbolFoley("CASH", "flutter", true);
    expect(playFoley).not.toHaveBeenCalled();
    for (const [id, cue] of [["BRASS", "punch"], ["KNIFE", "swish"], ["DUFFEL", "thump"], ["DIAMOND", "chime"], ["BIKE", "rev"]]) {
      bus.symbolFoley(id, cue, true);
    }
    expect(playFoley).toHaveBeenCalledTimes(4);
  });
});

