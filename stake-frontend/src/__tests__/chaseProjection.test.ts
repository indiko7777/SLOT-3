import { describe, expect, it } from "vitest";
import { chaseCamera, chaseProject, CHASE_BUILDING_LINE, CHASE_CURB_HEIGHT, CHASE_ROAD_EDGE } from "../pixi/chaseProjection";

describe("Getaway street registration", () => {
  for (const [w, h] of [[1294, 902], [844, 390], [390, 844], [320, 240]]) {
    it(`keeps vertical buildings outside the road and seated on pavement at ${w}x${h}`, () => {
      const camera = chaseCamera(w, h, w * .003);
      for (const side of [-1, 1]) for (const z of [1, 12, 35, 100, 180]) {
        const foot = chaseProject(camera, side * CHASE_BUILDING_LINE, CHASE_CURB_HEIGHT, z);
        const curb = chaseProject(camera, side * CHASE_ROAD_EDGE, CHASE_CURB_HEIGHT, z);
        const top = chaseProject(camera, side * CHASE_BUILDING_LINE, 12 + CHASE_CURB_HEIGHT, z);
        // Same ground plane, and the entire wall is beyond the curb.
        expect(foot.y).toBe(curb.y);
        expect((foot.x - curb.x) * side).toBeGreaterThan(0);
        expect(top.x).toBe(foot.x);
        expect(top.y).toBeLessThan(foot.y);
        expect(Number.isFinite(top.y)).toBe(true);
      }
    });
  }
  it("makes nearer scenery move faster through perspective, with one world speed", () => {
    const camera = chaseCamera(1000, 650);
    const displacement = (z: number) => Math.abs(chaseProject(camera, 10.5, 0, z - 1).x - chaseProject(camera, 10.5, 0, z).x);
    expect(displacement(15)).toBeGreaterThan(displacement(60) * 10);
  });
});
