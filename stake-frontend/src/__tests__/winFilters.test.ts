import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Container, Filter } from "pixi.js";

const pending = vi.hoisted(() => [] as Array<() => void>);
vi.mock("../pixi/tween", () => ({
  linear: (p: number) => p,
  tween: () => new Promise<void>((resolve) => pending.push(resolve)),
}));
vi.mock("pixi-filters", () => {
  class FakeFilter { destroy = vi.fn(); }
  return { AdvancedBloomFilter: FakeFilter, RGBSplitFilter: FakeFilter, ShockwaveFilter: FakeFilter };
});
import { pulseBloom, pulseChromaticAberration } from "../vfx/Shaders";

beforeEach(() => { pending.length = 0; });

describe("overlapping win filters", () => {
  it.each([false, true])("never restores a destroyed sibling, reverse completion=%s", async (reverse) => {
    const persistent = { destroy: vi.fn() } as unknown as Filter;
    const target = { filters: [persistent], destroyed: false } as unknown as Container;
    const bloom = pulseBloom(target);
    const bloomFilter = (target.filters as Filter[])[1]!;
    const chromatic = pulseChromaticAberration(target);
    const chromaticFilter = (target.filters as Filter[])[2]!;
    pending[reverse ? 1 : 0]!();
    await (reverse ? chromatic : bloom);
    expect(target.filters).toEqual([persistent, reverse ? bloomFilter : chromaticFilter]);
    pending[reverse ? 0 : 1]!();
    await (reverse ? bloom : chromatic);
    expect(target.filters).toEqual([persistent]);
    expect(bloomFilter.destroy).toHaveBeenCalledOnce();
    expect(chromaticFilter.destroy).toHaveBeenCalledOnce();
    expect(persistent.destroy).not.toHaveBeenCalled();
  });
  it("disables filtering after the final transient effect", async () => {
    const target = { filters: null, destroyed: false } as unknown as Container;
    const effect = pulseBloom(target);
    pending[0]!();
    await effect;
    expect(target.filters).toBeNull();
  });
  it("does not reattach effects to a target destroyed during a pulse", async () => {
    const target = { filters: null, destroyed: false } as unknown as Container;
    const effect = pulseBloom(target);
    const filter = (target.filters as Filter[])[0]!;
    Object.assign(target, { destroyed: true, filters: null });
    pending[0]!();
    await effect;
    expect(target.filters).toBeNull();
    expect(filter.destroy).toHaveBeenCalledOnce();
  });
});
