import { describe, expect, it } from "vitest";
import { computeLayout, logicalViewport } from "../pixi/layout";

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
