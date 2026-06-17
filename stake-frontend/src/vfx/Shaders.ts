/**
 * GPU win-VFX (0 MB payload). Thin wrapper over battle-tested pixi-filters,
 * exposed as transient "pulse" helpers: each attaches a filter, animates its
 * strength up and back down, then detaches + destroys it — so no filter is ever
 * left running on the display list (keeps the renderer cheap between wins).
 *
 * Every helper is guarded: if a filter can't be created on this GPU it silently
 * no-ops rather than risking a blank canvas.
 */
import { Container, Filter } from "pixi.js";
import { AdvancedBloomFilter, RGBSplitFilter, ShockwaveFilter } from "pixi-filters";
import { tween, linear } from "../pixi/tween";

/** Attach a filter, run an animation over it, then restore the prior filter chain. */
async function withFilter<T extends Filter>(
  target: Container,
  filter: T,
  run: (f: T) => Promise<void>
): Promise<void> {
  const prev = target.filters;
  const prevArr: Filter[] = prev ? (Array.isArray(prev) ? [...prev] : [prev]) : [];
  target.filters = [...prevArr, filter];
  try {
    await run(filter);
  } finally {
    // IMPORTANT: reset to the prior chain, or to `null` (NOT `[]`). In Pixi v8 an
    // empty filter array still routes the container through an empty filter pass
    // that renders nothing — blanking it. `null` disables filtering entirely.
    target.filters = prevArr.length ? prevArr : (null as unknown as Filter[]);
    try { filter.destroy(); } catch { /* already gone */ }
  }
}

/** Chromatic aberration (RGB split) — punchy glitch for high-tier wins. */
export async function pulseChromaticAberration(
  target: Container,
  opts: { intensity?: number; duration?: number } = {}
): Promise<void> {
  const { intensity = 8, duration = 420 } = opts;
  try {
    const f = new RGBSplitFilter();
    await withFilter(target, f, (flt) =>
      tween(duration, (p) => {
        const a = Math.sin(p * Math.PI) * intensity;
        flt.red = { x: -a, y: 0 };
        flt.blue = { x: a, y: 0 };
        flt.green = { x: 0, y: a * 0.25 };
      }, linear)
    );
  } catch { /* unsupported — skip */ }
}

/** Bloom/glow bloom-up then down — the "lights surge" feel on a win. */
export async function pulseBloom(
  target: Container,
  opts: { scale?: number; duration?: number } = {}
): Promise<void> {
  const { scale = 1.4, duration = 600 } = opts;
  try {
    const f = new AdvancedBloomFilter({ threshold: 0.4, bloomScale: 0, brightness: 1, blur: 8, quality: 4 });
    await withFilter(target, f, (flt) =>
      tween(duration, (p) => { flt.bloomScale = Math.sin(p * Math.PI) * scale; }, linear)
    );
  } catch { /* unsupported — skip */ }
}

/** Radial shockwave ripple from a point — the impact of a grand win. */
export async function shockwave(
  target: Container,
  center: { x: number; y: number },
  opts: { duration?: number } = {}
): Promise<void> {
  const { duration = 700 } = opts;
  try {
    const f = new ShockwaveFilter({
      center, amplitude: 18, wavelength: 140, speed: 700, brightness: 1.1, radius: -1,
    });
    await withFilter(target, f, (flt) =>
      tween(duration, (p) => { flt.time = p * 1.2; }, linear)
    );
  } catch { /* unsupported — skip */ }
}
