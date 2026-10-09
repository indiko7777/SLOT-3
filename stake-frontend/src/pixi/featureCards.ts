import { Container, FillGradient, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { DISPLAY_FONT, UI_FONT } from "../typography";

/**
 * Buy column cards, in the bet bar's Vice City language: twilight glass, a
 * thin neon gradient rim, the key-art heroine fading in from the right, a
 * bold title and the price on a sunset pill.
 *
 * Each card's backdrop (gradient + art + fades) is composed once per size on a
 * 2D canvas, so the HUD never needs a Pixi mask: the HUD layers can carry
 * filters, and a filtered container with a masked child renders blank in v8.
 */

const INK = 0x170b2a;
const WHITE = 0xfff4f8;
const LAVENDER = 0xb9acd9;

export type CardTheme = "getaway" | "super";

/** Rim / pill / label gradient per card. */
const THEME: Record<CardTheme, [string, string]> = {
  getaway: ["#22d3c5", "#ff3d8b"],
  super: ["#ff8a3d", "#ffd166"],
};

function grad(stops: Array<[number, string]>, dir: "h" | "v" | "d" = "h"): FillGradient {
  return new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: dir === "h" ? { x: 1, y: 0 } : dir === "v" ? { x: 0, y: 1 } : { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
  });
}

function roundPath(g: CanvasRenderingContext2D, W: number, H: number, r: number): void {
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath();
}

const backCache = new Map<string, Texture>();

/**
 * Card backdrop: twilight gradient, the art cover-cropped into the right
 * `artFrac` of the card and faded out toward the left and the bottom, a faint
 * sunset wash over it so photo and UI share one palette.
 */
function cardBackdrop(art: Texture | null, w: number, h: number, focus: { x: number; y: number }, radius: number, artFrac: number): Texture | null {
  const key = `${art?.uid ?? "none"}:${Math.round(w)}x${Math.round(h)}:${radius}:${artFrac}`;
  const hit = backCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const res = 2;
  const W = Math.max(4, Math.round(w * res)), H = Math.max(4, Math.round(h * res));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  roundPath(g, W, H, radius * res);
  g.clip();
  const bg = g.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, "rgba(46,20,74,0.96)");
  bg.addColorStop(1, "rgba(16,9,32,0.97)");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const src = art ? (art.source as unknown as { resource?: CanvasImageSource }).resource : null;
  if (art && src) {
    const aw = W * artFrac, ax = W - aw;
    const layer = document.createElement("canvas");
    layer.width = W; layer.height = H;
    const l = layer.getContext("2d")!;
    l.imageSmoothingQuality = "high";
    const s = Math.max(aw / art.width, H / art.height);
    const dw = art.width * s, dh = art.height * s;
    const dx = ax + Math.min(0, Math.max(aw - dw, aw / 2 - focus.x * dw));
    const dy = Math.min(0, Math.max(H - dh, H / 2 - focus.y * dh));
    l.drawImage(src, dx, dy, dw, dh);
    // fade the art into the glass: hard at the right edge, gone by its left third
    l.globalCompositeOperation = "destination-in";
    const fade = l.createLinearGradient(ax, 0, W, 0);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(0.42, "rgba(0,0,0,0.85)");
    fade.addColorStop(1, "rgba(0,0,0,1)");
    l.fillStyle = fade;
    l.fillRect(0, 0, W, H);
    g.drawImage(layer, 0, 0);
    // sunset wash + a soft floor so the price pill always reads
    g.globalCompositeOperation = "soft-light";
    const wash = g.createLinearGradient(0, 0, W, H);
    wash.addColorStop(0, "rgba(255,61,139,0.55)");
    wash.addColorStop(1, "rgba(255,154,60,0.45)");
    g.fillStyle = wash;
    g.fillRect(ax, 0, aw, H);
    g.globalCompositeOperation = "source-over";
    // keep the title side dark whatever the photo does there
    const side = g.createLinearGradient(0, 0, W * 0.78, 0);
    side.addColorStop(0, "rgba(22,10,40,0.82)");
    side.addColorStop(0.55, "rgba(22,10,40,0.45)");
    side.addColorStop(1, "rgba(22,10,40,0)");
    g.fillStyle = side;
    g.fillRect(0, 0, W, H);
    const floor = g.createLinearGradient(0, H * 0.45, 0, H);
    floor.addColorStop(0, "rgba(16,9,32,0)");
    floor.addColorStop(1, "rgba(16,9,32,0.78)");
    g.fillStyle = floor;
    g.fillRect(0, 0, W, H);
  }
  // top catch-light
  const sheen = g.createLinearGradient(0, 0, 0, H * 0.35);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H * 0.35);

  const t = Texture.from(c);
  backCache.set(key, t);
  return t;
}

function txt(text: string, size: number, fill: number | FillGradient, font = UI_FONT, weight: TextStyle["fontWeight"] = "700", spacing = 0): Text {
  return new Text({
    text,
    style: new TextStyle({ fill, fontFamily: font, fontSize: size, fontWeight: weight, letterSpacing: spacing, padding: 4 }),
  });
}

function shrink(t: Text, max: number): void {
  if (t.width > max) t.scale.set((t.scale.x * max) / t.width);
}

/** Price on a sunset pill. Returns the pill's width. */
function pricePill(parent: Container, x: number, y: number, h: number, text: string, theme: CardTheme, maxW: number): number {
  const label = txt(text, Math.round(h * 0.6), INK, UI_FONT, "700", 0.2);
  label.anchor.set(0, 0.5);
  shrink(label, maxW - h * 0.9);
  const w = Math.min(maxW, label.width + h * 0.9);
  const pill = new Graphics();
  pill.roundRect(x, y, w, h, h / 2).fill(grad([[0, THEME[theme][0]], [1, THEME[theme][1]]]));
  pill.roundRect(x + 1, y + 1, w - 2, h * 0.45, h / 2).fill({ color: 0xffffff, alpha: 0.18 });
  label.position.set(x + h * 0.45, y + h / 2 + 0.5);
  parent.addChild(pill, label);
  return w;
}

export interface FeatureCardOpts {
  x: number; y: number; w: number; h: number;
  art: Texture | null;
  focus: { x: number; y: number };
  theme: CardTheme;
  kicker: string;
  title: string;
  price: string;
  priceNote: string;
  disabled: boolean;
  compact: boolean;
  onTap: () => void;
}

/** An illustrated buy card. Returns its container (already positioned). */
export function featureCard(o: FeatureCardOpts): Container {
  const card = new Container();
  const radius = o.compact ? 10 : 14;
  const face = new Container();
  const [c0, c1] = THEME[o.theme];

  const back = cardBackdrop(o.art, o.w, o.h, o.focus, radius, o.compact ? 0.6 : 0.68);
  if (back) {
    const sp = new Sprite(back);
    sp.width = o.w; sp.height = o.h;
    face.addChild(sp);
  }
  const rim = new Graphics();
  const paintRim = (hover: boolean): void => {
    rim.clear();
    rim.roundRect(0.75, 0.75, o.w - 1.5, o.h - 1.5, radius).stroke({ width: hover ? 2.2 : 1.4, fill: grad([[0, c0], [1, c1]], "d"), alpha: hover ? 1 : 0.85 });
  };
  paintRim(false);
  face.addChild(rim);

  const pad = o.compact ? 9 : 14;
  if (o.compact) {
    const title = txt(o.title.toUpperCase(), 13, WHITE, DISPLAY_FONT, "400", 0.6);
    title.style.dropShadow = { color: 0x0b0716, alpha: 0.7, blur: 4, distance: 1, angle: Math.PI / 2 };
    title.position.set(pad, 3);
    shrink(title, o.w * 0.62);
    face.addChild(title);
    pricePill(face, pad, o.h - 22, 17, o.price, o.theme, o.w - pad * 2);
  } else {
    const kicker = txt(o.kicker.toUpperCase(), 9.5, grad([[0, c0], [1, c1]]), UI_FONT, "700", 2.4);
    kicker.position.set(pad, pad - 3);
    const title = txt(o.title.toUpperCase(), 22, WHITE, DISPLAY_FONT, "400", 0.8);
    title.style.dropShadow = { color: 0x0b0716, alpha: 0.7, blur: 6, distance: 1, angle: Math.PI / 2 };
    title.position.set(pad, pad + 10);
    shrink(title, o.w - pad * 2);
    face.addChild(kicker, title);
    const pillH = 24;
    const pw = pricePill(face, pad, o.h - pad - pillH + 2, pillH, o.price, o.theme, o.w * 0.6);
    const note = txt(o.priceNote, 10.5, LAVENDER, UI_FONT, "700", 0.8);
    note.anchor.set(0, 0.5);
    note.position.set(pad + pw + 8, o.h - pad - pillH / 2 + 2);
    note.style.dropShadow = { color: 0x0b0716, alpha: 0.8, blur: 3, distance: 0, angle: 0 };
    face.addChild(note);
  }
  card.addChild(face);

  card.position.set(o.x, o.y);
  card.eventMode = "static";
  card.cursor = o.disabled ? "default" : "pointer";
  if (o.disabled) card.alpha = 0.45;
  face.pivot.set(o.w / 2, o.h / 2);
  face.position.set(o.w / 2, o.h / 2);
  card.on("pointerover", () => { if (!o.disabled) { paintRim(true); face.scale.set(1.025); face.y = o.h / 2 - 2; } });
  card.on("pointerout", () => { paintRim(false); face.scale.set(1); face.y = o.h / 2; });
  card.on("pointerdown", () => { if (!o.disabled) face.scale.set(0.975); });
  card.on("pointerupoutside", () => face.scale.set(1));
  card.on("pointerup", () => { face.scale.set(1); if (!o.disabled) o.onTap(); });
  return card;
}

export interface AnteCardOpts {
  x: number; y: number; w: number; h: number;
  on: boolean;
  title: string;
  detail: string;
  cost: string;
  disabled: boolean;
  compact: boolean;
  onTap: () => void;
}

/** The ante switch: the same twilight glass with a gradient toggle. */
export function anteCard(o: AnteCardOpts): Container {
  const card = new Container();
  const radius = o.compact ? 10 : 14;
  const back = cardBackdrop(null, o.w, o.h, { x: 0.5, y: 0.5 }, radius, 0);
  if (back) {
    const sp = new Sprite(back);
    sp.width = o.w; sp.height = o.h;
    card.addChild(sp);
  }
  const rim = new Graphics();
  if (o.on) rim.roundRect(0.75, 0.75, o.w - 1.5, o.h - 1.5, radius).stroke({ width: 1.6, fill: grad([[0, "#22d3c5"], [1, "#ff3d8b"]], "d") });
  else rim.roundRect(0.5, 0.5, o.w - 1, o.h - 1, radius).stroke({ color: 0xffffff, width: 1, alpha: 0.16 });
  card.addChild(rim);

  const pad = o.compact ? 9 : 14;
  // toggle: gradient track when on, dim glass when off
  const tw = o.compact ? 30 : 42, th = o.compact ? 16 : 22;
  const tx = o.w - pad - tw, ty = o.compact ? o.h - th - 6 : (o.h - th) / 2;
  const sw = new Graphics();
  if (o.on) sw.roundRect(tx, ty, tw, th, th / 2).fill(grad([[0, "#22d3c5"], [1, "#ff3d8b"]]));
  else sw.roundRect(tx, ty, tw, th, th / 2).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ color: 0xffffff, width: 1, alpha: 0.2 });
  sw.circle(o.on ? tx + tw - th / 2 : tx + th / 2, ty + th / 2, th / 2 - 3).fill(WHITE);
  card.addChild(sw);

  if (o.compact) {
    const title = txt(o.title.toUpperCase(), 14, WHITE, DISPLAY_FONT, "400", 0.6);
    title.position.set(pad, 4);
    shrink(title, o.w - pad * 2);
    const cost = txt(o.cost, 11, o.on ? 0x22d3c5 : LAVENDER, UI_FONT, "700");
    cost.position.set(pad, o.h - 20);
    card.addChild(title, cost);
  } else {
    const title = txt(o.title.toUpperCase(), 18, WHITE, DISPLAY_FONT, "400", 0.8);
    title.position.set(pad, o.h / 2 - 20);
    shrink(title, o.w - pad * 3 - tw);
    const cost = txt(o.cost, 10.5, o.on ? 0x22d3c5 : LAVENDER, UI_FONT, "700", 0.8);
    cost.position.set(pad, o.h / 2 + 3);
    shrink(cost, o.w - pad * 3 - tw);
    card.addChild(title, cost);
  }

  card.position.set(o.x, o.y);
  card.eventMode = "static";
  card.cursor = o.disabled ? "default" : "pointer";
  if (o.disabled) card.alpha = 0.45;
  card.on("pointerup", () => { if (!o.disabled) o.onTap(); });
  return card;
}
