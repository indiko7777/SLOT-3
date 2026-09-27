import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FoleyGate, hasFoley } from "../audio/SymbolFoley";

describe("symbol foley gate", () => {
  it("a whole cluster firing the same cue on one frame sounds once", () => {
    const g = new FoleyGate();
    const hits = [0, 0, 1, 2, 3].map((t) => g.allow("fire", false, 1000 + t));
    expect(hits).toEqual([true, false, false, false, false]);
    expect(g.allow("fire", false, 1000 + 200)).toBe(true);
  });

  it("drops pure-detail cues in turbo but keeps the signature ones", () => {
    const g = new FoleyGate();
    expect(g.allow("tink", true, 0)).toBe(false);
    expect(g.allow("rattle", true, 0)).toBe(false);
    expect(g.allow("fire", true, 0)).toBe(true);
  });

  it("caps the number of voices in a burst (a 20-symbol reel landing)", () => {
    const g = new FoleyGate(70, 6, 120);
    const cues = ["impact", "thud", "tick", "ping", "jolt", "punch", "chime", "swish"];
    const allowed = cues.filter((c, i) => g.allow(c, false, 5000 + i));
    expect(allowed.length).toBe(6);
  });

  it("every cue authored in the shipped clips has a voice", () => {
    // read straight from the shipped bundles, so a new cue can't ship silent
    const dirs: Record<string, string> = {
      PISTOL: "pistol", AMMO: "ammo", CASH: "cash", DUFFEL: "duffel", KNIFE: "knife",
      DIAMOND: "diamond", BRASS: "brass_knuckles", BIKE: "bike", PHONE_SCATTER: "burner_phone",
    };
    let checked = 0;
    for (const [id, dir] of Object.entries(dirs)) {
      const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/assets/skel", dir, `${dir}.json`), "utf8"));
      for (const anim of Object.values(data.animations as Record<string, { events?: Array<{ name: string }> }>)) {
        for (const e of anim.events ?? []) { expect(hasFoley(id, e.name), `${id}:${e.name}`).toBe(true); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
