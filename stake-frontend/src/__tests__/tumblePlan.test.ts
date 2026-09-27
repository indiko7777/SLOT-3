import { describe, expect, it } from "vitest";
import { fallDuration, gravityEase, planColumn, tumbleDuration, TUMBLE_TIMING, type FallSpec } from "../pixi/tumblePlan";

const ROWS = 4;
const GAP = 4;
// Logical row pitch on the smallest phone layout and a 1080p desktop layout.
const GEOMETRIES = { phone: 83, desktop: 208 };

function column(step: number) {
  const cellH = step - GAP;
  const cellY = (row: number) => GAP + row * step;
  return { cellH, cellY };
}

/** The old easeOutBounce tumble's resolve time for the same column. */
function legacyDuration(survivorYs: number[], step: number, turbo: boolean): number {
  const { cellY } = column(step);
  const newCount = ROWS - survivorYs.length;
  let last = 0;
  survivorYs.forEach((y, i) => {
    const dist = cellY(newCount + i) - y;
    if (Math.abs(dist) > 1) last = Math.max(last, turbo ? 100 : Math.min(380, 140 + dist * 0.7));
  });
  for (let i = 0; i < newCount; i++) {
    const startY = -(newCount - i) * step - GAP;
    const dist = cellY(i) - startY;
    last = Math.max(last, i * (turbo ? 10 : 25) + (turbo ? 120 : Math.min(420, 160 + dist * 0.5)));
  }
  return last;
}

/** Every removal pattern of a 4-row column (bit i = row i removed). */
function patterns(step: number): number[][] {
  const { cellY } = column(step);
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << ROWS; mask++) {
    const ys: number[] = [];
    for (let r = 0; r < ROWS; r++) if (!(mask & (1 << r))) ys.push(cellY(r));
    out.push(ys);
  }
  return out;
}

function yAt(spec: FallSpec, t: number): number {
  if (t <= spec.delay || spec.fallMs <= 0) return spec.startY;
  const r = Math.min(1, (t - spec.delay) / spec.fallMs);
  return spec.startY + (spec.targetY - spec.startY) * gravityEase(r);
}

describe("cascade tumble plan", () => {
  it("falls under one gravity: duration grows with sqrt(distance), capped", () => {
    expect(fallDuration(0, 100, false)).toBe(0);
    expect(fallDuration(400, 100, false)).toBeCloseTo(2 * fallDuration(100, 100, false), 5);
    expect(fallDuration(10_000, 100, false)).toBe(TUMBLE_TIMING.normal.maxFallMs);
    expect(fallDuration(10_000, 100, true)).toBe(TUMBLE_TIMING.turbo.maxFallMs);
    expect(gravityEase(0)).toBe(0);
    expect(gravityEase(1)).toBe(1);
    // no bounce: never overshoots the cell it lands in
    for (let r = 0; r <= 1; r += 0.05) expect(gravityEase(r)).toBeLessThanOrEqual(1);
  });

  for (const [name, step] of Object.entries(GEOMETRIES)) {
    for (const turbo of [false, true]) {
      it(`keeps ${turbo ? "turbo" : "normal"} tumble timing within 10% of the old tumble (${name})`, () => {
        const { cellY } = column(step);
        for (const ys of patterns(step)) {
          const plan = planColumn(ys, ROWS, cellY, step, GAP, turbo);
          const now = tumbleDuration([...plan.survivors, ...plan.fresh], turbo);
          const old = legacyDuration(ys, step, turbo);
          expect(now).toBeLessThanOrEqual(old * 1.1 + 1);
        }
      });
    }

    it(`never lets a symbol overlap the one below it mid-fall (${name})`, () => {
      const { cellH, cellY } = column(step);
      for (const turbo of [false, true]) {
        for (const ys of patterns(step)) {
          const plan = planColumn(ys, ROWS, cellY, step, GAP, turbo);
          // top -> bottom order: fresh symbols (row 0..) then survivors
          const stack = [...plan.fresh, ...plan.survivors];
          const end = tumbleDuration(stack, turbo);
          for (let t = 0; t <= end; t += 4) {
            for (let i = 0; i + 1 < stack.length; i++) {
              const upper = yAt(stack[i]!, t), lower = yAt(stack[i + 1]!, t);
              expect(upper + cellH).toBeLessThanOrEqual(lower + 0.5);
            }
          }
        }
      }
    });
  }

  it("releases new symbols bottom-first and lands every symbol exactly in its row", () => {
    const step = GEOMETRIES.desktop;
    const { cellY } = column(step);
    const plan = planColumn([], ROWS, cellY, step, GAP, false);
    const delays = plan.fresh.map((s) => s.delay);
    expect([...delays].sort((a, b) => b - a)).toEqual(delays);   // row 0 (top) waits longest
    plan.fresh.forEach((s, row) => expect(s.targetY).toBe(cellY(row)));
    const partial = planColumn([cellY(0), cellY(2)], ROWS, cellY, step, GAP, false);
    expect(partial.survivors.map((s) => s.targetY)).toEqual([cellY(2), cellY(3)]);
    expect(partial.survivors[1]!.fallMs).toBeGreaterThan(0);
  });
});
