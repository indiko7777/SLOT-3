import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Texture } from "pixi.js";
import { SkelPlayer, type SkelData } from "../pixi/SkelPlayer";

// Real shipped bundles, served to SymbolView in place of the network loader.
vi.mock("../pixi/assets", async (orig) => {
  const actual = await orig<typeof import("../pixi/assets")>();
  const SKEL = path.resolve(__dirname, "../../public/assets/skel");
  const dirs: Record<string, string> = { PISTOL: "pistol", CASH: "cash", WILD: "wild_symbole" };
  return {
    ...actual,
    getSymbolTexture: () => null,
    createSkelSymbol: (id: string) => {
      const name = dirs[id];
      if (!name) return null;
      const data = JSON.parse(fs.readFileSync(path.join(SKEL, name, `${name}.json`), "utf8")) as SkelData;
      const atlas = fs.readFileSync(path.join(SKEL, name, `${name}.atlas`), "utf8");
      return { player: new SkelPlayer(data, atlas, Texture.WHITE), fitW: 513, fitH: 426 };
    },
  };
});

const { SymbolView } = await import("../pixi/SymbolView");

// tween()/ambientTicker schedule on requestAnimationFrame; drive it from the
// (fake) timer clock at ~60fps so awaited tweens complete in these tests.
beforeEach(() => {
  vi.stubGlobal("window", globalThis);      // window.setTimeout (hold timer, wait())
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("SymbolView clip lifecycle", () => {
  it("destroying a view mid-landing never throws (board teardown during a spin)", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = new SymbolView("PISTOL");
    view.layout(120, 100);
    view.touchdown("tumble", false);         // land clip pending, with a continuation
    expect(() => view.destroy({ children: true })).not.toThrow();
    expect(view.destroyed).toBe(true);
    // the pending continuation must not even TRY to pose the dead rig (that
    // was the live crash: setFromMatrix on destroyed sprites)
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    // a late touchdown / release / vanish on the dead view is a no-op
    expect(() => view.touchdown("reel", false)).not.toThrow();
    expect(() => view.releaseHold()).not.toThrow();
  });

  it("a vanish awaited on a view that gets destroyed still resolves", async () => {
    const view = new SymbolView("CASH");
    view.layout(120, 100);
    const done = view.vanish(false);
    view.destroy({ children: true });
    await expect(done).resolves.toBeUndefined();
  });

  it("a winner that is never removed is released back to idle by the safety timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    const view = new SymbolView("CASH");
    view.layout(120, 100);
    const win = view.winCelebrate(false);
    // drive the rig to the end of its win (the ambient ticker isn't running here)
    const skel = (view as unknown as { skel: SkelPlayer }).skel;
    for (let i = 0; i < 120; i++) skel.update(1 / 60);
    await vi.advanceTimersByTimeAsync(250);   // border fade-in tween
    await win;
    expect(skel.current).toBe("hold");
    await vi.advanceTimersByTimeAsync(3000);
    expect(skel.current).toBe("idle");
    view.destroy({ children: true });
  });

  it("the legacy WILD rig still goes win -> idle with no hold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    const view = new SymbolView("WILD");
    view.layout(120, 100);
    const win = view.winCelebrate(false);
    const skel = (view as unknown as { skel: SkelPlayer }).skel;
    for (let i = 0; i < 120; i++) skel.update(1 / 60);
    await vi.advanceTimersByTimeAsync(600);
    await win;
    expect(skel.current).toBe("idle");
    view.destroy({ children: true });
  });
});
