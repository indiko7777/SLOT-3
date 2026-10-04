import { Texture } from "pixi.js";

/**
 * Small procedural textures shared by the VFX. Drawn once on a 2D canvas and
 * reused by every effect as tinted, additive Sprites — far cheaper to render
 * than rebuilding Graphics geometry each frame, and they batch together.
 */

let glow: Texture | null = null;
let dot: Texture | null = null;
let streak: Texture | null = null;
let rays: Texture | null = null;

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Texture {
  // No DOM (unit tests under node): a plain white stand-in keeps logic testable.
  if (typeof document === "undefined") return Texture.WHITE;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext("2d")!);
  return Texture.from(canvas);
}

/** Soft white radial falloff — light blooms, flashes, cell glows. */
export function softGlowTexture(): Texture {
  return (glow ??= canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }));
}

/** Hot spark dot: white core, quick falloff. */
export function sparkDotTexture(): Texture {
  return (dot ??= canvasTexture(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.9)");
    g.addColorStop(0.55, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }));
}

/** Horizontal light streak (stretched along x) — spark trails, glints. */
export function streakTexture(): Texture {
  return (streak ??= canvasTexture(64, 16, (ctx) => {
    const gx = ctx.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, "rgba(255,255,255,0)");
    gx.addColorStop(0.7, "rgba(255,255,255,0.85)");
    gx.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = gx;
    ctx.beginPath();
    ctx.ellipse(32, 8, 32, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }));
}

/** Sunburst: 18 soft wedges fading out from the centre — big-win backdrop. */
export function raysTexture(): Texture {
  return (rays ??= canvasTexture(512, 512, (ctx) => {
    const c = 256;
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2 / n) * 0.42;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, "rgba(255,255,255,0.0)");
      g.addColorStop(0.12, "rgba(255,255,255,0.55)");
      g.addColorStop(0.55, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
  }));
}

let beam: Texture | null = null;

/**
 * Spotlight cone: narrow and hot at the top (the lamp), widening and fading
 * towards the bottom, with soft edges. Anchor at (0.5, 0) to hang from the lamp.
 */
export function beamTexture(): Texture {
  return (beam ??= canvasTexture(256, 512, (ctx) => {
    const W = 256, H = 512, top = 6;
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const half = top + (W / 2 - top) * t;
      const a = 0.9 * Math.pow(1 - t, 1.35) * Math.min(1, t * 14);
      const g = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.28, `rgba(255,255,255,${(a * 0.55).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`);
      g.addColorStop(0.72, `rgba(255,255,255,${(a * 0.55).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(W / 2 - half, y, half * 2, 1);
    }
  }));
}

export function allFxTextures(): Texture[] {
  return [softGlowTexture(), sparkDotTexture(), streakTexture(), raysTexture(), beamTexture()];
}
