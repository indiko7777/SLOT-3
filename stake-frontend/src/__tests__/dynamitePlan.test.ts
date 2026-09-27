import { describe, expect, it } from "vitest";
import { simulateRound } from "../../../stake-math/src/engine";
import type { BonusCell, Position } from "../domain";
import { dudDynamites } from "../pixi/dynamitePlan";

const key = ([c, r]: Position): string => `${c}:${r}`;

describe("dynamite logic mirrors the math engine", () => {
  it("a dud is exactly a dynamite the engine never blows (no gold bar beside it)", () => {
    let live = 0;
    let duds = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { record } = simulateRound("getaway", "freegame", seed, seed);
      const events = record.events as Array<Record<string, unknown> & { type: string }>;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i]!;
        if (ev.type !== "bonus_spin") continue;
        const landed = (ev.landedSymbols as Array<{ symbol: string; position: Position }>)
          .filter((s) => s.symbol === "MASTER_KEY").map((s) => s.position);
        if (!landed.length) continue;
        const cracked = new Set<string>();
        for (let j = i + 1; j < events.length && events[j]!.type !== "bonus_spin"; j++) {
          if (events[j]!.type === "master_key_crack") cracked.add(key(events[j]!.keyPosition as Position));
        }
        const predicted = new Set(dudDynamites(ev.lockedGrid as BonusCell[][], landed).map(key));
        for (const p of landed) {
          expect(predicted.has(key(p)), `seed ${seed} dynamite ${key(p)}`).toBe(!cracked.has(key(p)));
          if (predicted.has(key(p))) duds++; else live++;
        }
      }
    }
    // The sample must actually exercise both outcomes.
    expect(live).toBeGreaterThan(5);
    expect(duds).toBeGreaterThan(5);
  });
});
