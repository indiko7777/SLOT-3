import { describe, expect, it, vi } from "vitest";
import { runGetawayExit } from "../pixi/getawayExit";

describe("Getaway covered exit", () => {
  it("restores the base scene only after the cover, then reveals and removes the overlay", async () => {
    const order: string[] = [];
    let finishCover!: () => void;
    const cover = new Promise<void>((resolve) => { finishCover = resolve; });
    const done = runGetawayExit({
      cover: () => { order.push("cover"); return cover; },
      restore: () => { order.push("base-visible"); },
      reveal: async () => { order.push("reveal"); },
      cleanup: () => { order.push("remove-overlay"); },
    });
    expect(order).toEqual(["cover"]);
    finishCover();
    await done;
    expect(order).toEqual(["cover", "base-visible", "reveal", "remove-overlay"]);
  });
  it("restores the base and removes the blocker if the cover animation is cancelled", async () => {
    const restore = vi.fn();
    const cleanup = vi.fn();
    await expect(runGetawayExit({ cover: async () => { throw new Error("cancelled"); }, restore, reveal: vi.fn(), cleanup })).rejects.toThrow("cancelled");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("cannot restore twice or strand the overlay when reveal fails", async () => {
    const restore = vi.fn();
    const cleanup = vi.fn();
    await expect(runGetawayExit({ cover: async () => {}, restore, reveal: async () => { throw new Error("interrupted"); }, cleanup })).rejects.toThrow("interrupted");
    expect(restore).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
