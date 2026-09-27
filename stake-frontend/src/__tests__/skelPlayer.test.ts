import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Texture, type Sprite } from "pixi.js";
import { SkelPlayer, type SkelData } from "../pixi/SkelPlayer";

const SKEL = path.resolve(__dirname, "../../public/assets/skel");

function bundle(name: string): { data: SkelData; atlas: string } {
  return {
    data: JSON.parse(fs.readFileSync(path.join(SKEL, name, `${name}.json`), "utf8")) as SkelData,
    atlas: fs.readFileSync(path.join(SKEL, name, `${name}.atlas`), "utf8"),
  };
}

function player(name: string): SkelPlayer {
  const b = bundle(name);
  return new SkelPlayer(b.data, b.atlas, Texture.WHITE);
}

/** Visible sprites' pose, rounded — what is actually on screen. */
function pose(p: SkelPlayer): string {
  return (p.children as Sprite[])
    .map((s) => (s.visible ? [s.x, s.y, s.rotation, s.scale.x, s.scale.y, s.alpha].map((v) => v.toFixed(3)).join(",") : "-"))
    .join("|");
}

function run(p: SkelPlayer, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += step) p.update(Math.min(step, seconds - t));
}

describe("SkelPlayer", () => {
  it("cross-fades: the first frame of a mixed clip is exactly what was on screen", () => {
    const p = player("pistol");
    p.play("idle", { loop: true });
    run(p, 0.43);
    const before = pose(p);
    p.play("win", { mix: 0.1 });
    expect(pose(p)).toBe(before);
    // once the mix is over it is simply the new clip
    run(p, 0.3);
    const ref = player("pistol");
    ref.play("win");
    run(ref, 0.3);
    expect(pose(p)).toBe(pose(ref));
  });

  it("without a mix, a clip snaps to its own first frame (legacy behaviour)", () => {
    const p = player("pistol");
    p.play("idle", { loop: true });
    run(p, 0.43);
    p.play("win");
    const ref = player("pistol");
    ref.play("win");
    expect(pose(p)).toBe(pose(ref));
  });

  it("weight 0 leaves the setup pose; weight scales the offsets", () => {
    const setup = pose(player("brass_knuckles"));
    const p = player("brass_knuckles");
    p.play("land", { weight: 0 });
    run(p, 0.1);
    expect(pose(p)).toBe(setup);
    const half = player("brass_knuckles");
    half.play("land", { weight: 0.5 });
    run(half, 0.1);
    expect(pose(half)).not.toBe(setup);
  });

  it("fires each authored event once, in order, at any speed", () => {
    for (const speed of [1, 1.8, 3.6]) {
      const seen: string[] = [];
      const p = player("pistol");
      let done = false;
      p.play("win", { speed, onEvent: (e) => seen.push(e), onComplete: () => { done = true; } });
      run(p, 2);
      expect(done).toBe(true);
      expect(seen).toEqual(["fire", "casing", "tink"]);
    }
  });

  it("caches durations and reports clip availability", () => {
    const p = player("ammo");
    expect(p.has("land")).toBe(true);
    expect(p.has("drive_off")).toBe(false);
    expect(p.duration("win")).toBeCloseTo(1, 3);
    expect(p.duration("win")).toBe(p.duration("win"));
    p.play("hold", { loop: true });
    expect(p.current).toBe("hold");
    run(p, 3);
    expect(p.isPlaying).toBe(true);           // loops never complete
  });

  it("a destroy always ends with every sprite invisible", () => {
    for (const name of ["pistol", "ammo", "cash", "duffel", "knife", "diamond", "brass_knuckles", "bike"]) {
      const p = player(name);
      p.play("win");
      run(p, 0.2);
      p.play("destroy", { mix: 0.05 });
      run(p, p.duration("destroy") + 0.1);
      expect((p.children as Sprite[]).every((s) => !s.visible || s.alpha < 0.01), name).toBe(true);
    }
  });
});
