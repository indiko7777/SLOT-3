import { describe, expect, it } from "vitest";
import { wheelGeometry } from "../radio";

// Engine review: the radio wheel was a fixed 500px square and spilled off
// Popout S (400x225) and phone portrait frames. It must fit every Engine size.
const ENGINE_SIZES: Array<[string, number, number]> = [
  ["Popout S", 400, 225],
  ["Popout L", 800, 450],
  ["Mobile L", 425, 812],
  ["Mobile M", 375, 667],
  ["Mobile S", 320, 568],
  ["iPhone 16", 393, 852],
  ["Desktop", 1920, 1080],
];

describe("radio wheel geometry", () => {
  for (const [name, vw, vh] of ENGINE_SIZES) {
    it(`fits ${name} (${vw}x${vh}) with tappable buttons`, () => {
      const g = wheelGeometry(vw, vh);
      expect(g.w).toBeLessThanOrEqual(vw);
      expect(g.h).toBeLessThanOrEqual(vh);
      expect(g.btn).toBeGreaterThanOrEqual(44);
      // Neighbouring stations (60 degrees apart) never overlap, even when selected (1.25x).
      const step = (Math.PI * 2) / 6;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i * step;
        const b = a + step;
        const dx = g.rx * (Math.cos(b) - Math.cos(a));
        const dy = g.ry * (Math.sin(b) - Math.sin(a));
        expect(Math.hypot(dx, dy)).toBeGreaterThan(g.btn * 1.125);
      }
    });
  }
  it("keeps the full-size wheel on a roomy screen", () => {
    const g = wheelGeometry(1920, 1080);
    expect(g.rx).toBe(180);
    expect(g.ry).toBe(180);
    expect(g.btn).toBe(72);
  });
});
