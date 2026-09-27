import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Texture, type Sprite } from "pixi.js";
import { SkelPlayer, type SkelData } from "../pixi/SkelPlayer";

/**
 * Contract for the skeletal symbol bundles the game ships
 * (public/assets/skel, built by tools/skel-pipeline). The pipeline's own gate
 * (validate.py) checks the JSON when it is built; this pins what the RUNTIME
 * relies on, so a stale or hand-edited bundle fails CI instead of the reels.
 */
const SKEL = path.resolve(__dirname, "../../public/assets/skel");
const SYMBOLS = path.resolve(__dirname, "../../public/assets/symbols");
const SEMANTIC = ["pistol", "ammo", "cash", "duffel", "knife", "diamond", "brass_knuckles", "bike"];
const LOW = ["knife", "brass_knuckles"];
const PREMIUM = ["cash", "diamond", "bike"];

function load(name: string) {
  const data = JSON.parse(fs.readFileSync(path.join(SKEL, name, `${name}.json`), "utf8")) as SkelData & {
    events?: Record<string, unknown>;
    animations: Record<string, { events?: Array<{ name: string }> }>;
  };
  const atlas = fs.readFileSync(path.join(SKEL, name, `${name}.atlas`), "utf8");
  return { data, atlas };
}

function pose(p: SkelPlayer): string {
  return (p.children as Sprite[])
    .map((s) => (s.visible ? [s.x, s.y, s.rotation, s.scale.x, s.scale.y, s.alpha].map((v) => v.toFixed(2)).join(",") : "-"))
    .join("|");
}

describe("semantic skeletal bundles", () => {
  for (const name of SEMANTIC) {
    it(`${name}: ships the full clip set, declared events and atlas regions`, () => {
      const { data, atlas } = load(name);
      for (const clip of ["idle", "win", "hold", "land", "destroy"]) expect(data.animations[clip], clip).toBeTruthy();
      const declared = new Set(Object.keys(data.events ?? {}));
      for (const [clip, a] of Object.entries(data.animations)) {
        for (const e of a.events ?? []) expect(declared.has(e.name), `${clip}:${e.name}`).toBe(true);
      }
      const regions = new Set(atlas.split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => l && !l.includes(":")));
      const skin = (data.skins as { default: Record<string, Record<string, { path?: string }>> }).default;
      for (const [slot, atts] of Object.entries(skin)) {
        for (const [att, a] of Object.entries(atts)) expect(regions.has(a.path ?? att), `${slot}/${att}`).toBe(true);
      }
    });

    it(`${name}: land starts and ends at rest; win hands over to hold without a snap`, () => {
      const { data, atlas } = load(name);
      const rest = pose(new SkelPlayer(data, atlas, Texture.WHITE));
      const p = new SkelPlayer(data, atlas, Texture.WHITE);
      p.play("land");
      expect(pose(p)).toBe(rest);
      for (let t = 0; t < p.duration("land") + 0.05; t += 1 / 60) p.update(1 / 60);
      expect(pose(p)).toBe(rest);

      const w = new SkelPlayer(data, atlas, Texture.WHITE);
      w.play("win");
      for (let t = 0; t < w.duration("win") + 0.05; t += 1 / 60) w.update(1 / 60);
      const h = new SkelPlayer(data, atlas, Texture.WHITE);
      h.play("hold", { loop: true });
      expect(pose(w)).toBe(pose(h));
    });
  }

  it("keeps the tier hierarchy: low tier wins are the snappiest, premium the longest", () => {
    const dur = (n: string) => {
      const { data, atlas } = load(n);
      return new SkelPlayer(data, atlas, Texture.WHITE).duration("win");
    };
    const lowMax = Math.max(...LOW.map(dur));
    const premiumMin = Math.min(...PREMIUM.map(dur));
    expect(lowMax).toBeLessThan(premiumMin);
    for (const n of SEMANTIC) expect(dur(n)).toBeLessThanOrEqual(1.4);
  });

  it("the armored truck gained a landing without touching its other clips", () => {
    const { data } = load("burner_phone");
    for (const clip of ["idle", "win", "destroy", "drive_off", "land"]) expect(data.animations[clip], clip).toBeTruthy();
    expect(data.animations.hold).toBeUndefined();     // stays on the legacy win flow
  });
});

describe("WILD and CAR_WILD are untouched", () => {
  // The owner likes these exactly as they are. Any rebuild or edit must be a
  // deliberate decision, so their shipped files are pinned byte-for-byte.
  const sha = (buf: Buffer | string) => crypto.createHash("sha256").update(buf).digest("hex");
  const text = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const PINS: Record<string, string> = {
    "skel/wild_symbole/wild_symbole.json": "ad6e95820e65c94ac69d0326cd3cacdb0e19f0e20e0b65e1ca8233c7cc1c5942",
    "skel/wild_symbole/wild_symbole.atlas": "1cf84bd47009a33c5eecac5d94f22eb96226b8adb8e516036a0c87c10b18dd73",
    "skel/wild_symbole/packed.webp": "a03c03f6f1dc5ff9a521dc7efd8d9ee1a9a4f3c60120baa3c242aa09a0975b77",
    "skel/cyan_car_wild/cyan_car_wild.json": "772c3371c16a66b6c19af9798adb6535faf52924941fe8fe0cdc614d260ff8fd",
    "skel/cyan_car_wild/cyan_car_wild.atlas": "d2aae5236ce51591c6c3b33a309e532d28bc183d4fbf5ebd9d4a3cc4d36604d3",
    "skel/cyan_car_wild/packed.webp": "ae4fc7ff76827f04939340607babe48eba914f12f84eaeb9065f15b3fb2747a9",
    "symbols/wild_symbole.webp": "b163b557c0d37a4e7657b1dbedced180c13a750335efd7e65100450d34ca2a6b",
    "symbols/cyan_car_wild.webp": "2e1918b9fb90b88439c375fbc1f6a76ac041a929cf0f10cde5c5e84f7de31b2d",
  };
  for (const [rel, want] of Object.entries(PINS)) {
    it(rel, () => {
      const file = path.resolve(SKEL, "..", rel);
      const got = /\.(json|atlas)$/.test(rel) ? sha(text(file)) : sha(fs.readFileSync(file));
      expect(got).toBe(want);
    });
  }

  it("their rigs have no hold / land clip, so they keep the legacy flow", () => {
    for (const n of ["wild_symbole", "cyan_car_wild"]) {
      const { data } = load(n);
      expect(data.animations.hold).toBeUndefined();
      expect(data.animations.land).toBeUndefined();
    }
  });

  it("reel-strip art exists for every re-authored symbol", () => {
    for (const f of ["ammo.webp", "cash.webp", "knife.webp", "diamond.webp"]) {
      expect(fs.statSync(path.join(SYMBOLS, f)).size).toBeGreaterThan(5_000);
    }
  });
});
