import { describe, expect, it } from "vitest";
import { computeLayout, logicalViewport, wantedStarsGeometry, COUNTER_FONT_SIZE } from "../pixi/layout";

describe("device layouts", () => {
  for (const [width, height] of [[1440,900],[980,600],[844,390],[667,375],[390,844],[360,640],[320,568],[320,240]]) {
    it(`keeps the board and controls within ${width}x${height}`, () => {
      const logical = logicalViewport(width!, height!);
      const layout = computeLayout(logical.width, logical.height);
      for (const rect of [layout.board, layout.bottomBar, layout.leftPanel, layout.artPanel, layout.starsBar, layout.collectionBar].filter(Boolean)) {
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.y).toBeGreaterThanOrEqual(0);
        expect(rect!.width).toBeGreaterThan(0);
        expect(rect!.height).toBeGreaterThan(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(logical.width + 0.01);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(logical.height + 0.01);
      }
      expect(layout.board.y + layout.board.height).toBeLessThan(layout.bottomBar.y);
      if (layout.collectionBar) expect(layout.collectionBar.y + layout.collectionBar.height).toBeLessThan(layout.board.y);
      expect(logical.width * logical.scale).toBeCloseTo(width!);
      expect(logical.height * logical.scale).toBeCloseTo(height!);
    });
  }
});

describe("wanted stars sit on top of the reel frame", () => {
  type R = { x: number; y: number; width: number; height: number };
  const overlap = (a: R, b: R) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // Real rendered widths are smaller than these estimates, so passing here
  // means no overlap on screen.
  const counterW = (size: number) => size * 2.6 + 6;           // "[8/8]", Impact, 1.5px tracking
  const labelW = (size: number) => "WANTED LEVEL · 5 STAR MODE".length * size * 0.66;

  const SIZES = [
    [1920, 1080], [1440, 900], [1366, 768], [1280, 720], [1024, 768], [980, 600], [2560, 1080],
    [844, 390], [667, 375], [568, 320], [390, 844], [414, 896], [360, 640], [320, 568],
    [768, 1024], [820, 1180], [320, 240], [480, 270], [640, 360],
  ];
  for (const [w, h] of SIZES) {
    it(`${w}x${h}`, () => {
      const v = logicalViewport(w!, h!);
      const L = computeLayout(v.width, v.height);
      const bar = L.starsBar!;
      expect(bar).toBeTruthy();
      // directly above the frame, same width, on screen
      expect(bar.y + bar.height).toBeLessThanOrEqual(L.boardFrame.y);
      expect(L.boardFrame.y - (bar.y + bar.height)).toBeLessThanOrEqual(6);
      expect(bar.x).toBeCloseTo(L.boardFrame.x);
      expect(bar.width).toBeCloseTo(L.boardFrame.width);
      expect(bar.y).toBeGreaterThanOrEqual(0);

      const g = wantedStarsGeometry(bar);
      const first = g.centers[0]!, last = g.centers[4]!;
      const starsBox: R = { x: first.x - g.starR, y: first.y - g.starR, width: last.x - first.x + 2 * g.starR, height: 2 * g.starR };
      const cs = COUNTER_FONT_SIZE;
      const counterBox: R = { x: g.counterX - counterW(cs), y: g.counterY - cs * 0.6, width: counterW(cs), height: cs * 1.2 };
      const lw = labelW(g.labelSize);
      const labelBox: R = { x: g.labelX - lw / 2, y: g.labelY, width: lw, height: g.labelSize * 1.2 };

      // everything inside the strip
      for (const b of [starsBox, counterBox, labelBox]) {
        expect(b.x).toBeGreaterThanOrEqual(bar.x - 0.01);
        expect(b.x + b.width).toBeLessThanOrEqual(bar.x + bar.width + 0.01);
        expect(b.y).toBeGreaterThanOrEqual(bar.y - 0.01);
        expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height + 0.01);
      }
      // original look: stars up to R 22, 13px label — only the position moved
      expect(g.starR).toBeCloseTo(Math.min(22, bar.width / 11));
      // centred over the reels, and never touching the [n/8] counter
      expect((first.x + last.x) / 2).toBeCloseTo(bar.x + bar.width / 2);
      expect(overlap(starsBox, counterBox)).toBe(false);
      expect(overlap(labelBox, counterBox)).toBe(false);
      expect(g.starR).toBeGreaterThanOrEqual(8);
      // and the strip itself collides with no other panel
      for (const other of [L.collectionBar, L.leftPanel, L.artPanel, L.bottomBar].filter(Boolean)) {
        expect(overlap(bar, other!)).toBe(false);
      }
    });
  }
});
