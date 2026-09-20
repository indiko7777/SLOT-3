import { afterEach, describe, expect, it, vi } from "vitest";
import { AmbientTicker } from "../pixi/tween";

afterEach(() => vi.unstubAllGlobals());

describe("ambient animation lifecycle", () => {
  it("keeps one frame scheduled through repeated HUD rebuilds", () => {
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { pending.set(++id, cb); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
    const ticker = new AmbientTicker();
    const render = vi.fn();
    for (let i = 0; i < 100; i++) {
      ticker.add(render);
      ticker.add(render);
      expect(pending.size).toBe(1);
      ticker.remove(render);
      expect(pending.size).toBe(0);
    }
    ticker.add(render);
    const [key, frame] = [...pending.entries()][0]!;
    pending.delete(key);
    frame(performance.now() + 1000);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0]).toBeLessThanOrEqual(0.1);
    expect(pending.size).toBe(1);
    ticker.clear();
    expect(pending.size).toBe(0);
  });
});
