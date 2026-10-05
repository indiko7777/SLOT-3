import { Container, FillGradient, Graphics, Sprite, Texture } from "pixi.js";
import type { Rect } from "./types";

/**
 * The reel cabinet, dressed like an Ocean Drive Art Deco hotel — not a
 * cyberpunk neon box: a cream stucco bezel with big streamlined corners,
 * coral-pink and teal pinstripes, Streamline Moderne "speed lines" on the
 * rails, and one soft pink neon tube around the window, the way the hotels
 * light up at sunset. The window itself is warm smoked glass showing the
 * street blurred behind it.
 *
 *  BACK  (background layer, under the reels): shadow, glass, bezel.
 *  FRONT (over the reel edge): the neon tube and the deco trim.
 *
 * No masks anywhere: the background layer can take a filter, and a filtered
 * container with a masked subtree renders blank.
 */

const CREAM_HI = "#fff7ec";
const CREAM = "#f3e3cf";
const SAND = "#dcc3a8";
const CORAL = 0xff6f96;
const TEAL = 0x2fb7ad;
const NEON_PINK = 0xff5fa2;

interface Geo { F: Rect; B: Rect; R: number; r: number; ring: number }

/**
 * The stucco bezel grows OUTWARD past the layout frame (into the free street
 * around it) so it reads as architecture, not a hairline: ~10px on the sides
 * and bottom, less on top where the WANTED stars sit.
 */
function geo(frame: Rect, board: Rect): Geo {
  const base = Math.max(8, Math.min(board.x - frame.x, board.y - frame.y));
  const side = Math.max(1, Math.min(2, frame.x - 4));
  const top = Math.min(side, 1);
  const F = { x: frame.x - side, y: frame.y - top, width: frame.width + side * 2, height: frame.height + top + side };
  const ring = base + side;
  return { F, B: board, R: Math.max(12, ring * 0.95), r: Math.max(4, base * 0.4), ring };
}

function grad(dir: "v" | "h", stops: [number, string][]): FillGradient {
  return new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: dir === "v" ? { x: 0, y: 1 } : { x: 1, y: 0 },
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
    textureSpace: "local",
  });
}

// ── frosted glass: the city behind the reels, heavily blurred ──────────────

const frostCache = new Map<string, Texture>();

/**
 * Blur the part of the (cover-fitted) background that sits behind the board.
 * Canvas `filter: blur()` where supported; otherwise a double down/up-sample,
 * which reads the same under the tint.
 */
function frostTexture(bg: Texture, view: { w: number; h: number }, rect: Rect): Texture | null {
  const key = `${bg.uid}:${view.w}x${view.h}:${rect.x},${rect.y},${rect.width},${rect.height}`;
  const hit = frostCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const src = (bg.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src) return null;
  const s = Math.max(view.w / bg.width, view.h / bg.height);
  const ox = view.w / 2 - (bg.width * s) / 2, oy = view.h / 2 - (bg.height * s) / 2;
  const sx = (rect.x - ox) / s, sy = (rect.y - oy) / s, sw = rect.width / s, sh = rect.height / s;
  const W = Math.max(8, Math.round(rect.width / 2)), H = Math.max(8, Math.round(rect.height / 2));
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const c = out.getContext("2d")!;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  const canFilter = "filter" in c && (() => { c.filter = "blur(2px)"; const ok = c.filter === "blur(2px)"; c.filter = "none"; return ok; })();
  if (canFilter) {
    c.filter = `blur(${Math.round(W / 40)}px)`;
    const pad = 0.08;
    c.drawImage(src, sx - sw * pad, sy - sh * pad, sw * (1 + pad * 2), sh * (1 + pad * 2), -W * pad, -H * pad, W * (1 + pad * 2), H * (1 + pad * 2));
    c.filter = "none";
  } else {
    const small = document.createElement("canvas");
    small.width = Math.max(4, Math.round(W / 10)); small.height = Math.max(4, Math.round(H / 10));
    const sc = small.getContext("2d")!;
    sc.imageSmoothingEnabled = true;
    sc.drawImage(src, sx, sy, sw, sh, 0, 0, small.width, small.height);
    for (let i = 0; i < 2; i++) {
      c.drawImage(small, 0, 0, W, H);
      sc.drawImage(out, 0, 0, small.width, small.height);
    }
    c.drawImage(small, 0, 0, W, H);
  }
  const tex = Texture.from(out);
  frostCache.set(key, tex);
  return tex;
}

/** Everything that sits UNDER the reels. */
export function drawCabinetBack(parent: Container, frame: Rect, board: Rect, bg: Texture | null, view: { w: number; h: number }): void {
  const { F, B, R, r, ring } = geo(frame, board);

  // soft contact shadow on the street
  const shadow = new Graphics();
  for (let k = 9; k >= 1; k--) {
    const e = k * Math.max(2.5, ring * 0.22);
    shadow.roundRect(F.x - e, F.y - e + ring * 0.6, F.width + e * 2, F.height + e * 2, R + e).fill({ color: 0x1c0c14, alpha: 0.05 });
  }
  parent.addChild(shadow);

  // smoked glass window
  const frost = bg ? frostTexture(bg, view, B) : null;
  if (frost) {
    const pane = new Sprite(frost);
    pane.position.set(B.x, B.y);
    pane.width = B.width; pane.height = B.height;
    parent.addChild(pane);
  }
  const glass = new Graphics();
  glass.rect(B.x, B.y, B.width, B.height).fill(grad("v", [
    [0, "rgba(10,24,34,0.82)"], [0.6, "rgba(10,18,30,0.85)"], [1, "rgba(22,14,26,0.88)"],
  ]));
  // the sunset warming the bottom of the glass
  glass.rect(B.x, B.y + B.height * 0.62, B.width, B.height * 0.38).fill(grad("v", [[0, "rgba(255,140,90,0)"], [1, "rgba(255,140,90,0.08)"]]));
  parent.addChild(glass);

  // cream stucco bezel with streamlined corners
  const bezel = new Graphics();
  bezel.roundRect(F.x, F.y, F.width, F.height, R).fill(grad("v", [
    [0, CREAM_HI], [0.12, CREAM], [0.85, "#ead6c0"], [1, SAND],
  ]));
  bezel.roundRect(B.x - 1, B.y - 1, B.width + 2, B.height + 2, r).cut();
  // outer edge shadow line + top catch-light
  bezel.roundRect(F.x + 0.5, F.y + 0.5, F.width - 1, F.height - 1, R).stroke({ width: 1.5, color: 0x9c7c68, alpha: 0.85 });
  bezel.roundRect(F.x + 2, F.y + 2, F.width - 4, F.height - 4, R - 2).stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
  // recessed lip around the window
  bezel.roundRect(B.x - 2.5, B.y - 2.5, B.width + 5, B.height + 5, r + 2).stroke({ width: 3, color: 0x3a2630, alpha: 0.9 });
  parent.addChild(bezel);
}

/**
 * Everything ABOVE the reel edge. Returns a per-frame tick (the neon's slow
 * breathing and the odd old-tube stutter) for the caller's ambient loop.
 */
export function drawCabinetFront(parent: Container, frame: Rect, board: Rect): (dt: number, elapsed: number) => void {
  const { F, B, R, r, ring } = geo(frame, board);
  const root = new Container();
  parent.addChild(root);

  // painted bands on the stucco: a solid coral band, then a teal pinstripe
  const trim = new Graphics();
  const i1 = Math.max(2.5, ring * 0.18);
  const bandW = Math.max(2, ring * 0.13);
  trim.roundRect(F.x + i1, F.y + i1, F.width - i1 * 2, F.height - i1 * 2, R - i1).stroke({ width: bandW, color: CORAL, alpha: 1 });
  trim.roundRect(F.x + i1 - bandW / 2, F.y + i1 - bandW / 2, F.width - i1 * 2 + bandW, F.height - i1 * 2 + bandW, R - i1 + bandW / 2).stroke({ width: 0.8, color: 0x8a3a52, alpha: 0.5 });
  const i2 = i1 + bandW + Math.max(2, ring * 0.12);
  trim.roundRect(F.x + i2, F.y + i2, F.width - i2 * 2, F.height - i2 * 2, R - i2).stroke({ width: Math.max(1.2, ring * 0.06), color: TEAL, alpha: 1 });

  // Streamline Moderne "wings": three racing stripes wrapping out of the
  // frame near the top on both sides, like the eyebrows on an Ocean Drive
  // hotel corner. Only where there's street to spare beside the frame.
  const gap = Math.max(3, ring * 0.16);
  const barH = Math.max(2.5, ring * 0.12);
  const room = F.x - 6;
  if (room >= 24) {
    const len = Math.min(46, room - 6);
    const y0 = F.y + R + ring * 0.4;
    [CORAL, TEAL, CORAL].forEach((col, i) => {
      const l = len * (1 - i * 0.24);
      const y = y0 + i * (barH + gap);
      trim.roundRect(F.x - l, y, l + 2, barH, barH / 2).fill({ color: col });
      trim.roundRect(F.x + F.width - 2, y, l + 2, barH, barH / 2).fill({ color: col });
    });
  }
  root.addChild(trim);

  // one soft pink neon tube around the window
  const neon = new Graphics();
  neon.blendMode = "add";
  const o = Math.max(1.5, ring * 0.12);
  const nx = B.x - o, ny = B.y - o, nw = B.width + o * 2, nh = B.height + o * 2, nr = r + o;
  neon.roundRect(nx, ny, nw, nh, nr).stroke({ width: Math.max(5, ring * 0.45), color: NEON_PINK, alpha: 0.12 });
  neon.roundRect(nx, ny, nw, nh, nr).stroke({ width: Math.max(1.6, ring * 0.11), color: NEON_PINK, alpha: 0.9 });
  neon.roundRect(nx, ny, nw, nh, nr).stroke({ width: 0.8, color: 0xffffff, alpha: 0.6 });
  root.addChild(neon);

  let flickerAt = 14 + Math.random() * 10;
  return (_dt, t) => {
    let k = 0.92 + 0.08 * Math.sin(t * 1.1);
    if (t > flickerAt) {
      const ft = t - flickerAt;
      if (ft < 0.36) k *= [1, 0.45, 1, 0.6, 1, 1][Math.floor(ft / 0.06)] ?? 1;
      else flickerAt = t + 14 + Math.random() * 14;
    }
    neon.alpha = k;
  };
}
