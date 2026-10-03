import { BlurFilter, ColorMatrixFilter, Container, Graphics, RenderTexture, Sprite, Text, type Renderer, type Filter } from "pixi.js";
import { AdvancedBloomFilter, OutlineFilter, RGBSplitFilter, ShockwaveFilter } from "pixi-filters";
import { allLoadedTextures } from "./assets";
import { allFxTextures } from "./fxTextures";
import { DISPLAY_FONT } from "../typography";

/**
 * Pay every one-off GPU cost while the loader is still on screen.
 *
 * WebGL compiles a shader the first time a filter is drawn and uploads a
 * texture the first time a sprite using it is drawn. Left to gameplay, those
 * costs land on the first spin (blur), the first big win (bloom), the first
 * dynamite (shockwave) and the Getaway intro (truck + highway art) as visible
 * 80–270 ms freezes — exactly the moments a reviewer is watching. Drawing
 * everything once into a tiny off-screen target moves them to boot.
 */
export function warmUpGpu(renderer: Renderer): void {
  const root = new Container();
  const target = RenderTexture.create({ width: 64, height: 64 });
  try {
    for (const tex of [...allLoadedTextures(), ...allFxTextures()]) {
      if (!tex || tex.destroyed || tex.width <= 0) continue;
      const s = new Sprite(tex);
      s.width = 8;
      s.height = 8;
      root.addChild(s);
    }
    const filtered = (filters: Filter[]): void => {
      const g = new Graphics().rect(0, 0, 16, 16).fill(0xffffff);
      g.filters = filters;
      root.addChild(g);
    };
    filtered([new BlurFilter({ strength: 10, quality: 3 })]);
    filtered([new BlurFilter({ strength: 10, quality: 2 })]);
    filtered([new AdvancedBloomFilter({ threshold: 0.4, bloomScale: 1, brightness: 1, blur: 8, quality: 4 })]);
    filtered([new RGBSplitFilter()]);
    filtered([new ShockwaveFilter({ center: { x: 8, y: 8 }, amplitude: 18, wavelength: 140, speed: 700, brightness: 1.1, radius: -1 })]);
    filtered([new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1 })]);
    filtered([new ColorMatrixFilter()]); // BUSTED desaturation
    // Rasterise the display face once so the first banner doesn't stall on it.
    root.addChild(new Text({ text: "BIG WIN 0123456789", style: { fontFamily: DISPLAY_FONT, fontSize: 24, fill: 0xffffff } }));
    renderer.render({ container: root, target, clear: true });
  } catch (err) {
    console.warn("[warmup] GPU warm-up skipped:", err);
  } finally {
    for (const child of root.children) {
      const f = (child as Container).filters;
      if (Array.isArray(f)) f.forEach((x) => x.destroy());
    }
    // Keep the shared textures — only the throwaway sprites/graphics go.
    root.destroy({ children: true, texture: false });
    target.destroy(true);
  }
}
