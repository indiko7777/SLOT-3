import { Container, FillGradient, Graphics, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { beamTexture, softGlowTexture, sparkDotTexture, streakTexture } from "./fxTextures";
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, linear, simulate, tween, wait, ambientTicker } from "./tween";
import { DISPLAY_FONT, UI_FONT } from "../typography";

/**
 * The collection reveal — every WILD unlocks one body piece of the current
 * girl, and the last piece triggers her character intro.
 *
 * PIECE:  a lock-on reticle closes around the exact spot the piece belongs
 *         while an energy orb arcs from the WILD into it; on impact the piece
 *         is revealed by a light-wipe, with a burst centred on the PIECE.
 * INTRO:  a light sweep runs up her body, a camera flash with an anamorphic
 *         flare, the world dims, two spotlights clunk on and cross on her and
 *         a GTA-style name card slams in beside her with what she unlocked.
 */

/** Where a girl is drawn: her shared canvas centred at (cx, cy) at `scale`. */
export interface CharStage { parent: Container; cx: number; cy: number; scale: number }

/** Signature colour per girl (by gallery index). */
export const GIRL_ACCENT = [0x4cc3ff, 0xff4fa8, 0xb57bff];

const boundsCache = new WeakMap<Texture, { ox: number; oy: number; w: number; h: number }>();

/**
 * Opaque bounds of a piece inside its (shared, full-body) canvas, relative to
 * the canvas centre — so effects land on the piece, not the body's middle.
 */
export function pieceBounds(tex: Texture): { ox: number; oy: number; w: number; h: number } {
  const cached = boundsCache.get(tex);
  if (cached) return cached;
  const full = { ox: 0, oy: 0, w: tex.width, h: tex.height };
  try {
    const res = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
    if (!res || typeof document === "undefined") return full;
    const k = Math.min(1, 256 / Math.max(tex.width, tex.height));
    const cw = Math.max(1, Math.round(tex.width * k)), ch = Math.max(1, Math.round(tex.height * k));
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const c = cv.getContext("2d", { willReadFrequently: true })!;
    c.drawImage(res, 0, 0, cw, ch);
    const d = c.getImageData(0, 0, cw, ch).data;
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (d[(y * cw + x) * 4 + 3]! > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return full;
    const b = {
      ox: ((x0 + x1 + 1) / 2) / k - tex.width / 2,
      oy: ((y0 + y1 + 1) / 2) / k - tex.height / 2,
      w: (x1 - x0 + 1) / k,
      h: (y1 - y0 + 1) / k,
    };
    boundsCache.set(tex, b);
    return b;
  } catch {
    return full;
  }
}

function glow(parent: Container, tint: number, x: number, y: number, w: number, h: number, add = true): Sprite {
  const g = new Sprite(softGlowTexture());
  g.anchor.set(0.5);
  g.tint = tint;
  if (add) g.blendMode = "add";
  g.position.set(x, y);
  g.width = w;
  g.height = h;
  parent.addChild(g);
  return g;
}

/** Flash, white core, ring and light shards at a point. */
export function burst(parent: Container, x: number, y: number, size: number, color: number, power = 1): void {
  const flash = glow(parent, color, x, y, size * 1.3 * power, size * 1.3 * power);
  const f0 = flash.scale.x;
  void tween(340, (p) => { flash.scale.set(f0 * (1 + 0.9 * p)); flash.alpha = 0.95 * (1 - p) * (1 - p); }, easeOutCubic).then(() => flash.destroy());
  const core = glow(parent, 0xffffff, x, y, size * 0.6 * power, size * 0.6 * power);
  const c0 = core.scale.x;
  void tween(220, (p) => { core.scale.set(c0 * (1 + 0.4 * p)); core.alpha = 1 - p; }, easeOutCubic).then(() => core.destroy());
  const ring = new Graphics().circle(0, 0, size * 0.45).stroke({ color, width: 3 });
  ring.blendMode = "add";
  ring.position.set(x, y);
  ring.scale.set(0.4);
  parent.addChild(ring);
  void tween(420, (p) => { ring.scale.set(0.4 + 1.0 * power * p); ring.alpha = 1 - p; }, easeOutCubic).then(() => ring.destroy());
  const n = Math.round(12 * power);
  const list: { s: Sprite; vx: number; vy: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const s = new Sprite(streakTexture());
    s.anchor.set(1, 0.5);
    s.blendMode = "add";
    s.tint = i % 3 === 0 ? 0xffffff : color;
    s.position.set(x, y);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = (3.5 + Math.random() * 4) * power;
    const len = 0.3 + Math.random() * 0.4;
    s.scale.set(len, 0.55);
    s.rotation = a;
    parent.addChild(s);
    list.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len });
  }
  void simulate(480, (k, t) => {
    const drag = Math.pow(0.9, k);
    for (const d of list) {
      d.s.x += d.vx * k; d.s.y += d.vy * k;
      d.vx *= drag; d.vy = d.vy * drag + 0.16 * k;
      d.s.rotation = Math.atan2(d.vy, d.vx);
      d.s.scale.x = d.len * (1 - 0.6 * t);
      d.s.alpha = 1 - t * t;
    }
  }).then(() => list.forEach((d) => d.s.destroy()));
}

/** Four corner brackets framing a rect (HUD "target lock"). */
function drawReticle(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number): void {
  const L = Math.max(10, Math.min(w, h) * 0.22);
  g.clear();
  const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
  for (const [cx, cy, sx, sy] of corners) {
    g.moveTo(cx + sx * L, cy).lineTo(cx, cy).lineTo(cx, cy + sy * L);
  }
  g.stroke({ color, width: 3, alpha, cap: "square" });
  for (const [cx, cy, sx, sy] of corners) {
    g.moveTo(cx + sx * L, cy).lineTo(cx, cy).lineTo(cx, cy + sy * L);
  }
  g.stroke({ color: 0xffffff, width: 1, alpha: alpha * 0.8, cap: "square" });
}

/**
 * Reveal one body piece on the girl. Returns the holder with the seated piece;
 * the caller destroys it once the persistent art has been repainted under it.
 */
export async function revealPiece(stage: CharStage, tex: Texture, o: {
  from?: { x: number; y: number } | null;
  accent: number;
  label: string;
  turbo: boolean;
  onLaunch?: () => void;
  onImpact?: () => void;
}): Promise<Container> {
  const { parent, cx, cy, scale } = stage;
  const b = pieceBounds(tex);
  const tx = cx + b.ox * scale, ty = cy + b.oy * scale;
  const pw = b.w * scale, ph = b.h * scale;

  const holder = new Container();
  holder.position.set(cx, cy);
  holder.scale.set(scale);
  parent.addChild(holder);

  if (!o.turbo) {
    // ── lock-on: ghost of the piece pulses where it belongs, brackets close in
    const ghost = new Sprite(tex);
    ghost.anchor.set(0.5);
    ghost.tint = o.accent;
    ghost.blendMode = "add";
    ghost.alpha = 0;
    holder.addChild(ghost);
    const ret = new Graphics();
    ret.blendMode = "add";
    parent.addChild(ret);
    const pad = 8;
    o.onLaunch?.();

    // energy orb from the WILD
    const from = o.from ?? { x: tx, y: ty - 160 };
    const orb = new Container();
    glow(orb, o.accent, 0, 0, 70, 70).alpha = 0.95;
    glow(orb, 0xffffff, 0, 0, 22, 22);
    orb.position.set(from.x, from.y);
    parent.addChild(orb);
    const ctrl = { x: (from.x + tx) / 2, y: Math.min(from.y, ty) - Math.abs(tx - from.x) * 0.35 - 60 };
    let lastTrail = 0;
    await tween(520, (p) => {
      // reticle converges (eased), ghost pulses faster as the orb closes
      const r = easeOutCubic(Math.min(1, p * 1.15));
      const grow = 1.6 - 0.6 * r;
      const w = pw * grow + pad * 2, h = ph * grow + pad * 2;
      drawReticle(ret, tx - w / 2, ty - h / 2, w, h, o.accent, Math.min(1, p * 2.5));
      ghost.alpha = (0.18 + 0.32 * p) * (0.6 + 0.4 * Math.sin(p * Math.PI * (4 + 6 * p)));
      const e = easeInCubic(p) * 0.7 + p * 0.3;
      const a = 1 - e;
      orb.x = a * a * from.x + 2 * a * e * ctrl.x + e * e * tx;
      orb.y = a * a * from.y + 2 * a * e * ctrl.y + e * e * ty;
      orb.scale.set(0.6 + 0.6 * p);
      if (p - lastTrail > 0.06) {
        lastTrail = p;
        const tr = glow(parent, o.accent, orb.x, orb.y, 40, 40);
        void tween(260, (q) => { tr.alpha = 0.8 * (1 - q); tr.scale.set(tr.scale.x * 0.97); }).then(() => tr.destroy());
      }
    }, linear);
    orb.destroy({ children: true });
    void tween(240, (p) => {
      const w = pw * (1 - 0.04 * p) + pad * 2, h = ph * (1 - 0.04 * p) + pad * 2;
      drawReticle(ret, tx - w / 2, ty - h / 2, w, h, 0xffffff, 1 - p);
      ghost.alpha = 0.5 * (1 - p);
    }, linear).then(() => { ret.destroy(); ghost.destroy(); });
  }

  // ── impact: the piece is revealed by a light-wipe, top to bottom
  o.onImpact?.();
  const piece = new Sprite(tex);
  piece.anchor.set(0.5);
  holder.addChild(piece);
  const top = b.oy - b.h / 2, left = b.ox - b.w / 2;
  const mask = new Graphics();
  holder.addChild(mask);
  piece.mask = mask;
  const edge = glow(holder, 0xffffff, b.ox, top, b.w * 1.5, Math.max(30, 34 / scale));
  const edgeTint = glow(holder, o.accent, b.ox, top, b.w * 1.9, Math.max(60, 80 / scale));
  const stamp = new Sprite(tex);
  stamp.anchor.set(0.5);
  stamp.blendMode = "add";
  stamp.alpha = 0;
  holder.addChild(stamp);
  burst(parent, tx, ty, Math.max(pw, ph) * 0.8, o.accent, o.turbo ? 0.7 : 1.15);

  await tween(o.turbo ? 120 : 340, (p) => {
    const y = top + b.h * easeInOutCubic(p);
    mask.clear().rect(left - 4, top - 4, b.w + 8, y - top + 6).fill(0xffffff);
    edge.y = y; edgeTint.y = y;
    edge.alpha = Math.sin(p * Math.PI) * 0.95;
    edgeTint.alpha = Math.sin(p * Math.PI) * 0.7;
    stamp.alpha = 0.85 * p;
  }, linear);
  piece.mask = null;
  mask.destroy();
  edge.destroy();
  edgeTint.destroy();
  void tween(o.turbo ? 160 : 460, (p) => { stamp.alpha = 0.85 * (1 - p); }, easeOutCubic).then(() => stamp.destroy());

  if (!o.turbo) {
    // "PIECE 4/8" tag rising off the spot
    const tag = new Text({
      text: o.label,
      style: new TextStyle({ fontFamily: DISPLAY_FONT, fontSize: 22, fill: 0xffffff, letterSpacing: 2, stroke: { color: 0x14081c, width: 5 }, padding: 6 }),
    });
    tag.anchor.set(0.5);
    tag.position.set(tx, ty);
    parent.addChild(tag);
    tag.scale.set(0.4);
    void tween(1050, (p) => {
      tag.scale.set(0.4 + 0.6 * easeOutBack(Math.min(1, p / 0.22)));
      tag.y = ty - 44 * easeOutCubic(p);
      tag.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }, linear).then(() => tag.destroy());
  }
  return holder;
}

/**
 * The final reveal — a GTA-style character intro. `beforeExit` runs while she
 * is still covered so the caller can repaint the next girl underneath.
 */
export async function girlIntro(o: {
  root: Container;
  width: number;
  height: number;
  stage: CharStage;
  fullTex: Texture;
  name: string;
  accent: number;
  reward: string | null;
  /** Rect for the name card (beside her in landscape, below in portrait). */
  card: { x: number; y: number; width: number; height: number };
  turbo: boolean;
  /** Her full figure now covers the stage: hide the copies underneath. */
  onCover?: () => void;
  onSweep?: () => void;
  onShutter?: () => void;
  onName?: () => void;
  beforeExit?: () => void;
}): Promise<void> {
  const { root, width: W, height: H, stage, accent } = o;
  const { cx, cy, scale } = stage;
  const fb = pieceBounds(o.fullTex);
  const figH = fb.h * scale;
  const figCX = cx + fb.ox * scale, figCY = cy + fb.oy * scale;

  const layer = new Container();
  root.addChild(layer);
  const veil = new Graphics().rect(0, 0, W, H).fill(0x05030b);
  veil.alpha = 0;
  layer.addChild(veil);
  // Her stage: two spotlights hung above her crossing on her body, a rim of
  // her signature colour behind her and a pool of light at her feet — a photo
  // shoot, not a sunburst.
  const backdrop = new Container();
  backdrop.alpha = 0;
  layer.addChild(backdrop);
  glow(backdrop, accent, figCX, figCY, figH * 0.62, figH * 1.18).alpha = 0.6;
  glow(backdrop, 0xfff3d6, figCX, figCY - figH * 0.12, figH * 0.34, figH * 0.7).alpha = 0.28;
  const feetY = figCY + figH * 0.47;
  glow(backdrop, accent, figCX, feetY, figH * 0.78, figH * 0.11).alpha = 0.7;
  glow(backdrop, 0xffffff, figCX, feetY, figH * 0.36, figH * 0.045).alpha = 0.55;
  const beams = [-1, 1].map((side) => {
    const s = new Sprite(beamTexture());
    s.anchor.set(0.5, 0);
    s.blendMode = "add";
    s.tint = side < 0 ? 0xfff1d8 : accent;
    s.position.set(figCX + side * figH * 0.42, figCY - figH * 0.82);
    s.width = figH * 0.62;
    s.height = Math.hypot(figH * 0.42, figH * 1.3);
    const base = Math.atan2(feetY - s.y, figCX - s.x) - Math.PI / 2;
    s.rotation = base;
    s.alpha = 0;
    backdrop.addChild(s);
    return { s, base, side, peak: side < 0 ? 0.5 : 0.6 };
  });

  const figure = new Container();
  figure.position.set(figCX, figCY);
  layer.addChild(figure);
  const full = new Sprite(o.fullTex);
  full.anchor.set(0.5);
  full.scale.set(scale);
  full.position.set((cx - figCX), (cy - figCY));
  figure.addChild(full);
  o.onCover?.();

  // ── 1. light sweep up the body
  if (!o.turbo) {
    o.onSweep?.();
    const shine = new Sprite(o.fullTex);
    shine.anchor.set(0.5);
    shine.scale.set(scale);
    shine.position.copyFrom(full.position);
    shine.blendMode = "add";
    figure.addChild(shine);
    const band = new Graphics();
    figure.addChild(band);
    shine.mask = band;
    const bandH = figH * 0.22;
    const top = -figH / 2, bot = figH / 2;
    await tween(620, (p) => {
      const y = bot + bandH - (bot - top + bandH * 2) * easeInOutCubic(p);
      band.clear().rect(-W, y - bandH / 2, W * 2, bandH).fill(0xffffff);
      shine.alpha = 0.9;
    }, linear);
    shine.mask = null;
    band.destroy();
    shine.destroy();
  }

  // ── 2. camera flash: world dims, she is lit on her stage
  o.onShutter?.();
  const flash = new Graphics().rect(0, 0, W, H).fill(0xffffff);
  layer.addChild(flash);
  flash.alpha = 0.85;
  void tween(o.turbo ? 120 : 200, (p) => { flash.alpha = 0.85 * (1 - p); }, linear);
  // anamorphic lens flare through her face
  const faceY = figCY - figH * 0.36;
  const flare = new Container();
  flare.position.set(figCX, faceY);
  glow(flare, accent, 0, 0, W * 1.3, Math.max(14, figH * 0.035));
  glow(flare, 0xffffff, 0, 0, W * 0.7, Math.max(5, figH * 0.012));
  glow(flare, 0xffffff, 0, 0, figH * 0.22, figH * 0.22).alpha = 0.8;
  layer.addChild(flare);
  void tween(o.turbo ? 260 : 700, (p) => { flare.alpha = 1 - p; flare.scale.set(1 + 0.25 * p, 1 - 0.5 * p); }, easeOutCubic)
    .then(() => flare.destroy({ children: true }));
  veil.alpha = 0.76;
  backdrop.alpha = 1;
  // the spotlights clunk on one after the other, with a filament flicker
  beams.forEach((b, i) => {
    void wait((o.turbo ? 40 : 150) + i * (o.turbo ? 60 : 220)).then(() => tween(o.turbo ? 80 : 200, (p) => {
      b.s.alpha = b.peak * (p < 0.35 ? (Math.floor(p * 20) % 2 ? 0.25 : 1) : 1) * Math.min(1, p * 3);
    }, linear));
  });
  const pose = o.turbo ? 1.04 : 1.08;
  void tween(o.turbo ? 160 : 460, (p) => { figure.scale.set(1 + (pose - 1) * easeOutBack(p)); }, linear);
  if (!o.turbo) void wait(260).then(() => {
    flash.alpha = 0.45;
    return tween(180, (p) => { flash.alpha = 0.45 * (1 - p); }, linear);
  }).then(() => flash.destroy());
  else void wait(200).then(() => flash.destroy());

  // drifting sparkles around her while she poses
  const sparkLayer = new Container();
  layer.addChildAt(sparkLayer, layer.getChildIndex(figure));
  let t = 0;
  let spawn = 0;
  // Out-of-focus bokeh drifting through the lights, plus a few hot glints.
  const live: { s: Sprite; vx: number; vy: number; life: number; decay: number; tw: number; peak: number; bokeh: boolean }[] = [];
  const tick = (dt: number): void => {
    t += dt;
    for (const b of beams) b.s.rotation = b.base + b.side * 0.07 * Math.sin(t * 0.9 + b.side);
    figure.scale.set(pose + 0.008 * Math.sin(t * 2.4));
    spawn -= dt;
    while (spawn <= 0 && !o.turbo) {
      spawn += 0.07;
      const bokeh = Math.random() < 0.55;
      const s = new Sprite(bokeh ? softGlowTexture() : sparkDotTexture());
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = Math.random() < 0.45 ? 0xfff1d8 : accent;
      s.position.set(figCX + (Math.random() - 0.5) * figH * 0.85, figCY + (Math.random() - 0.35) * figH * 0.8);
      const size = bokeh ? figH * (0.03 + Math.random() * 0.06) : 6 + Math.random() * 8;
      s.width = s.height = size;
      s.alpha = 0;
      sparkLayer.addChild(s);
      live.push({
        s, bokeh,
        vx: (Math.random() - 0.5) * 10,
        vy: -(bokeh ? 8 + Math.random() * 14 : 22 + Math.random() * 30),
        life: 1, decay: bokeh ? 0.45 : 0.9, tw: Math.random() * 6,
        peak: bokeh ? 0.18 + Math.random() * 0.22 : 1,
      });
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const d = live[i]!;
      d.life -= dt * d.decay;
      d.s.x += d.vx * dt;
      d.s.y += d.vy * dt;
      const env = Math.max(0, Math.min(1, (1 - d.life) * 5, d.life * 2.5));
      d.s.alpha = d.peak * env * (d.bokeh ? 1 : 0.5 + 0.5 * Math.sin(t * 9 + d.tw));
      if (d.life <= 0) { d.s.destroy(); live.splice(i, 1); }
    }
  };
  ambientTicker.add(tick);

  // ── 3. the name card
  await wait(o.turbo ? 80 : 240);
  const card = new Container();
  const cw = o.card.width, chh = o.card.height;
  card.position.set(o.card.x + cw / 2, o.card.y + chh / 2);
  layer.addChild(card);
  const slab = new Graphics();
  const sk = chh * 0.22;
  slab.poly([-cw / 2 + sk, -chh / 2, cw / 2, -chh / 2, cw / 2 - sk, chh / 2, -cw / 2, chh / 2]).fill({ color: 0x07040d, alpha: 0.86 });
  slab.rect(-cw / 2 + sk, -chh / 2 - 3, cw - sk, 3).fill({ color: accent });
  slab.rect(-cw / 2, chh / 2, cw - sk, 3).fill({ color: 0xffd36a });
  card.addChild(slab);
  const kicker = new Text({
    text: "COLLECTION COMPLETE",
    style: new TextStyle({ fontFamily: UI_FONT, fontSize: Math.max(12, chh * 0.11), fontWeight: "700", letterSpacing: 6, fill: 0xffffff }),
  });
  kicker.anchor.set(0.5);
  kicker.y = -chh * 0.3;
  card.addChild(kicker);
  const nameSize = Math.min(chh * 0.5, cw / (o.name.length * 0.62));
  const name = new Text({
    text: o.name.toUpperCase(),
    style: new TextStyle({
      fontFamily: DISPLAY_FONT, fontSize: nameSize, letterSpacing: 3, padding: 16,
      fill: new FillGradient({ start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
        { offset: 0, color: 0xffffff }, { offset: 0.45, color: 0xfff1d6 }, { offset: 0.55, color: accent }, { offset: 1, color: 0x7a2d8a },
      ] }),
      stroke: { color: 0x12061a, width: 8, join: "round" },
      dropShadow: { color: 0x000000, alpha: 0.9, blur: 0, distance: 5, angle: Math.PI / 2 },
    }),
  });
  name.anchor.set(0.5);
  name.skew.x = -0.1;
  name.y = chh * 0.02;
  card.addChild(name);
  const subText = o.reward ? `★ GOLD WANTED STAR  •  ${o.reward.toUpperCase()} UNLOCKED` : "★ GOLD WANTED STAR EARNED";
  const sub = new Text({
    text: subText,
    style: new TextStyle({ fontFamily: UI_FONT, fontSize: Math.max(11, chh * 0.1), fontWeight: "700", letterSpacing: 3, fill: 0xffe7a8 }),
  });
  sub.anchor.set(0.5);
  sub.y = chh * 0.34;
  if (sub.width > cw * 0.9) sub.scale.set((cw * 0.9) / sub.width);
  card.addChild(sub);
  const nameGlow = glow(card, accent, 0, name.y, cw * 0.9, chh * 0.9);
  card.setChildIndex(nameGlow, 1);
  nameGlow.alpha = 0;

  // slab slides in; name slams; kicker + subline follow
  card.alpha = 0;
  kicker.alpha = sub.alpha = 0;
  const startX = card.x - cw * 0.35;
  const endX = card.x;
  name.scale.set(1.7);
  name.alpha = 0;
  await tween(o.turbo ? 120 : 260, (p) => {
    card.alpha = Math.min(1, p * 2);
    card.x = startX + (endX - startX) * easeOutCubic(p);
  }, linear);
  o.onName?.();
  await tween(o.turbo ? 90 : 180, (p) => {
    name.alpha = Math.min(1, p * 3);
    name.scale.set(1.7 - 0.7 * easeInCubic(p));
  }, linear);
  name.scale.set(1);
  nameGlow.alpha = 0.9;
  void tween(520, (p) => { nameGlow.alpha = 0.9 * (1 - p) + 0.25 * p; }, easeOutCubic);
  void tween(360, (p) => { const k = Math.sin(p * Math.PI * 2.2) * Math.exp(-p * 4); name.scale.set(1 + k * 0.07, 1 - k * 0.08); }, linear);
  burst(layer, card.x, card.y + name.y, chh * 0.9, accent, o.turbo ? 0.6 : 1);
  if (!o.turbo) {
    // a glint runs across the card, clipped to the slab
    const clip = new Graphics().poly([-cw / 2 + sk, -chh / 2, cw / 2, -chh / 2, cw / 2 - sk, chh / 2, -cw / 2, chh / 2]).fill(0xffffff);
    card.addChild(clip);
    const glint = new Container();
    glow(glint, 0xffffff, 0, 0, chh * 0.32, chh * 2.4).alpha = 0.55;
    glow(glint, accent, 0, 0, chh * 0.7, chh * 2.4).alpha = 0.4;
    glint.rotation = 0.38;
    glint.mask = clip;
    card.addChild(glint);
    void wait(160).then(() => tween(560, (p) => { glint.x = -cw * 0.62 + cw * 1.24 * easeInOutCubic(p); }, linear))
      .then(() => { glint.destroy({ children: true }); clip.destroy(); });
  }
  void tween(o.turbo ? 120 : 300, (p) => { kicker.alpha = p; sub.alpha = p; kicker.y = -chh * 0.3 + 8 * (1 - p); }, easeOutCubic);

  await wait(o.turbo ? 600 : 1900);

  // ── 4. exit: the next girl is repainted underneath, then everything clears
  o.beforeExit?.();
  void tween(o.turbo ? 160 : 320, (p) => { card.alpha = 1 - p; card.x = endX + cw * 0.25 * easeInCubic(p); }, linear);
  await tween(o.turbo ? 220 : 600, (p) => {
    const e = easeInOutCubic(p);
    veil.alpha = 0.76 * (1 - e);
    backdrop.alpha = 1 - e;
    figure.alpha = 1 - e;
    sparkLayer.alpha = 1 - e;
  }, linear);
  ambientTicker.remove(tick);
  layer.destroy({ children: true });
}

/**
 * The hand-off: the next girl's silhouette is acquired as the new target —
 * brackets snap onto her, a scan line runs down her body in her colour and a
 * "NEXT TARGET" tag names her.
 */
export async function nextTarget(stage: CharStage, silTex: Texture, offset: { x: number; y: number }, name: string, accent: number): Promise<void> {
  const { parent, cx, cy, scale } = stage;
  const b = pieceBounds(silTex);
  const tx = cx + (b.ox + offset.x) * scale, ty = cy + (b.oy + offset.y) * scale;
  const w = b.w * scale + 20, h = b.h * scale + 20;
  const layer = new Container();
  parent.addChild(layer);

  const ret = new Graphics();
  ret.blendMode = "add";
  layer.addChild(ret);
  const scan = new Container();
  glow(scan, accent, 0, 0, w * 1.25, 26).alpha = 0.85;
  glow(scan, 0xffffff, 0, 0, w * 0.9, 6);
  scan.position.set(tx, ty - h / 2);
  scan.alpha = 0;
  layer.addChild(scan);

  const tag = new Container();
  const kicker = new Text({
    text: "NEXT TARGET",
    style: new TextStyle({ fontFamily: UI_FONT, fontSize: 13, fontWeight: "700", letterSpacing: 5, fill: accent, stroke: { color: 0x05030b, width: 4 } }),
  });
  kicker.anchor.set(0.5, 1);
  const label = new Text({
    text: name.toUpperCase(),
    style: new TextStyle({ fontFamily: DISPLAY_FONT, fontSize: 30, letterSpacing: 3, fill: 0xffffff, stroke: { color: 0x0a0612, width: 6 }, padding: 8 }),
  });
  label.anchor.set(0.5, 0);
  label.skew.x = -0.1;
  const plateW = Math.max(kicker.width, label.width) + 28;
  const plate = new Graphics()
    .poly([-plateW / 2 + 8, -kicker.height - 6, plateW / 2, -kicker.height - 6, plateW / 2 - 8, label.height + 4, -plateW / 2, label.height + 4])
    .fill({ color: 0x05030b, alpha: 0.6 });
  plate.rect(-plateW / 2, label.height + 4, plateW - 8, 2).fill({ color: accent });
  tag.addChild(plate, kicker, label);
  // tagged across her upper body, like a target marker (centred on the stage:
  // a pose that reaches past the panel edge would push it off-screen)
  tag.position.set(cx, ty - h * 0.2);
  label.y = 2;
  tag.alpha = 0;
  layer.addChild(tag);

  await tween(260, (p) => {
    const g = 1.35 - 0.35 * easeOutCubic(p);
    drawReticle(ret, tx - (w * g) / 2, ty - (h * g) / 2, w * g, h * g, accent, Math.min(1, p * 2));
    tag.alpha = p;
    tag.scale.set(1.2 - 0.2 * easeOutCubic(p));
  }, linear);
  scan.alpha = 1;
  await tween(560, (p) => { scan.y = ty - h / 2 + h * easeInOutCubic(p); scan.alpha = p > 0.85 ? (1 - p) / 0.15 : 1; }, linear);
  await wait(380);
  await tween(320, (p) => {
    layer.alpha = 1 - p;
    drawReticle(ret, tx - w / 2, ty - h / 2, w, h, 0xffffff, 1 - p);
  }, linear);
  layer.destroy({ children: true });
}
