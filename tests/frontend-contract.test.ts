import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoots = ["src", "scripts"];

describe("frontend rendering contract", () => {
  it("does not contain CSS source files or CSS imports", () => {
    const files = sourceRoots.flatMap((dir) => walk(path.join(root, dir)));
    expect(files.filter((file) => file.endsWith(".css"))).toEqual([]);

    for (const file of files.filter((file) => /\.(ts|tsx|js|html)$/.test(file))) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(new RegExp("import\\s+[\"'][^\"']+\\.css[\"']"));
      expect(text).not.toMatch(new RegExp("<style", "i"));
    }
  });

  it("keeps the main slot frontend on PIXI modules", () => {
    const main = readFileSync(path.join(root, "src", "main.ts"), "utf8");
    const scene = readFileSync(path.join(root, "src", "pixi", "PixiGameScene.ts"), "utf8");

    expect(main).toContain("pixi.js");
    expect(scene).toContain("playEvent");
    expect(scene).toContain("BoardView");
    expect(scene).toContain("BonusView");
  });
});

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
