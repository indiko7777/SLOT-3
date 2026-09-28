/** Shared world coordinates keep walls, palms and pavement on the same ground. */
export const CHASE_CAMERA_HEIGHT = 3;
export const CHASE_CURB_HEIGHT = .18;
export const CHASE_ROAD_EDGE = 7.5;
export const CHASE_BUILDING_LINE = 10.5;

export function chaseCamera(w: number, h: number, drift = 0) {
  return { cx: w / 2 + drift, horizon: h * .4, focal: Math.min(w * .88, h * 1.45) };
}

export function chaseProject(camera: ReturnType<typeof chaseCamera>, x: number, y: number, z: number) {
  const scale = camera.focal / Math.max(.75, z);
  return { x: camera.cx + x * scale, y: camera.horizon + (CHASE_CAMERA_HEIGHT - y) * scale, scale };
}
