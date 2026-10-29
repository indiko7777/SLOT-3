import { FillGradient, type GradientOptions } from "pixi.js";

/**
 * Shared FillGradients. Every `new FillGradient` paints its own canvas and
 * uploads its own texture, and nothing in the game ever destroys one, so the
 * HUD / cards / cabinet / board redraws that rebuilt them on every spin leaked
 * a canvas + texture each time (~2 MB of heap per spin on an emulated iPhone 12,
 * thousands of canvases within minutes). The colour sets are all fixed, so one
 * gradient per distinct option set is built once and reused.
 *
 * Never `destroy()` a gradient returned from here: other graphics share it.
 */
const cache = new Map<string, FillGradient>();

export function cachedGradient(options: GradientOptions): FillGradient {
  const key = JSON.stringify(options);
  let g = cache.get(key);
  if (!g) {
    g = new FillGradient(options);
    cache.set(key, g);
  }
  return g;
}

/** Number of distinct gradients built so far (tests / leak checks). */
export function cachedGradientCount(): number {
  return cache.size;
}
