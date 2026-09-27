import { describe, expect, it } from "vitest";
import { REEL_LAND_WEIGHT, SymbolFlow } from "../pixi/symbolFlow";

const SEMANTIC = { hasHold: true, hasLand: true };
const LEGACY = { hasHold: false, hasLand: false };

describe("skeletal clip flow — semantic rigs", () => {
  it("win -> hold -> destroy: no drop back to idle before removal", () => {
    const f = new SymbolFlow(SEMANTIC);
    expect(f.win(false, 1)?.clip).toBe("win");
    const next = f.winEnded(1);
    expect(next?.clip).toBe("hold");
    expect(next?.loop).toBe(true);
    expect(f.state).toBe("hold");
    const d = f.vanish(false, 1);
    expect(d?.clip).toBe("destroy");
    expect(d?.mix).toBeGreaterThan(0);          // cross-fades out of the held pose
    expect(d?.speed).toBe(1);                   // authored at real time
    expect(f.state).toBe("destroy");
  });

  it("a winner that is NOT removed is released back to idle", () => {
    const f = new SymbolFlow(SEMANTIC);
    f.win(false, 1);
    f.winEnded(1);
    const idle = f.release();
    expect(idle?.clip).toBe("idle");
    expect(idle?.mix).toBeGreaterThan(0);
    expect(f.state).toBe("idle");
    expect(f.release()).toBeNull();             // idempotent
  });

  it("a release that arrives mid-win skips the hold", () => {
    const f = new SymbolFlow(SEMANTIC);
    f.win(false, 1);
    expect(f.release()).toBeNull();
    expect(f.winEnded(1)?.clip).toBe("idle");
    expect(f.state).toBe("idle");
  });

  it("landing never interrupts a win, a hold or a destroy", () => {
    const f = new SymbolFlow(SEMANTIC);
    f.win(false, 1);
    expect(f.land("tumble", false, 1)).toBeNull();
    f.winEnded(1);
    expect(f.land("tumble", false, 1)).toBeNull();
    f.vanish(false, 1);
    expect(f.land("reel", false, 1)).toBeNull();
    expect(f.win(false, 1)).toBeNull();         // destroy is terminal
    expect(f.vanish(false, 1)).toBeNull();
  });

  it("tumble landings are full strength with sound; reel stops are softened and silent", () => {
    const f = new SymbolFlow(SEMANTIC);
    const tumble = f.land("tumble", false, 1)!;
    expect(tumble.clip).toBe("land");
    expect(tumble.weight).toBe(1);
    expect(tumble.events).toBe(true);
    expect(f.landEnded()?.clip).toBe("idle");
    const reel = f.land("reel", false, 1)!;
    expect(reel.weight).toBe(REEL_LAND_WEIGHT);
    expect(reel.events).toBe(false);
  });

  it("turbo and the global time scale speed every clip up", () => {
    const f = new SymbolFlow(SEMANTIC);
    const normal = f.win(false, 1)!.speed;
    const g = new SymbolFlow(SEMANTIC);
    const turbo = g.win(true, 2)!.speed;
    expect(turbo).toBeGreaterThan(normal * 3);
  });
});

describe("skeletal clip flow — legacy rigs (WILD, CAR_WILD) keep their exact behaviour", () => {
  it("win returns straight to idle with no hold and no mix", () => {
    const f = new SymbolFlow(LEGACY);
    const w = f.win(false, 1)!;
    expect(w.speed).toBe(1);
    expect(w.mix).toBe(0);
    const next = f.winEnded(1)!;
    expect(next.clip).toBe("idle");
    expect(next.mix).toBe(0);
    expect(f.state).toBe("idle");
  });

  it("destroy still plays at the old 2x / 4x", () => {
    expect(new SymbolFlow(LEGACY).vanish(false, 1)!.speed).toBe(2);
    expect(new SymbolFlow(LEGACY).vanish(true, 1)!.speed).toBe(4);
    expect(new SymbolFlow(LEGACY).win(true, 1)!.speed).toBe(2);
  });

  it("has no authored landing", () => {
    expect(new SymbolFlow(LEGACY).land("tumble", false, 1)).toBeNull();
  });
});
