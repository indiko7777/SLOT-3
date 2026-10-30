import { describe, expect, it } from "vitest";
import { Graphics, GraphicsContext } from "pixi.js";
import { applyPixiFixes } from "../pixi/pixiFixes";

applyPixiFixes();

describe("Graphics.destroy frees its own context (iPhone memory fix)", () => {
  it("with { children: true }, the form the game uses", () => {
    const g = new Graphics().rect(0, 0, 10, 10).fill(0xffffff);
    const ctx = g.context;
    g.destroy({ children: true });
    expect(ctx.destroyed).toBe(true);
  });

  it("with no options, as Pixi already did", () => {
    const g = new Graphics().circle(0, 0, 5).fill(0xff0000);
    const ctx = g.context;
    g.destroy();
    expect(ctx.destroyed).toBe(true);
  });

  it("never destroys a context it was handed (shared)", () => {
    const shared = new GraphicsContext().rect(0, 0, 4, 4).fill(0x00ff00);
    const a = new Graphics(shared);
    const b = new Graphics(shared);
    a.destroy({ children: true });
    expect(shared.destroyed).toBe(false);
    expect(b.context).toBe(shared);
    b.destroy();
    expect(shared.destroyed).toBe(false);
  });
});

describe("a destroyed Text lets go of a shared TextStyle (iPhone memory fix)", () => {
  it("removes its update listener", async () => {
    const { Text, TextStyle } = await import("pixi.js");
    const style = new TextStyle({ fontSize: 12 });
    const before = style.listenerCount("update");
    const t = new Text({ text: "WIN", style });
    expect(style.listenerCount("update")).toBe(before + 1);
    t.destroy({ children: true });
    expect(style.listenerCount("update")).toBe(before);
  });
});
