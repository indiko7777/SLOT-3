import { Container, FillGradient, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { getExtraTexture } from "./assets";
import { pieceBounds } from "./girlReveal";
import { ambientTicker, tween, easeOutCubic, easeInOutCubic } from "./tween";
import { getPrestigeTitle } from "../meta/collection";
import { DISPLAY_FONT, UI_FONT } from "../typography";

/**
 * The Beach Girl Deck as a character-select screen (GTA VI site language):
 * the girl full height on one side, her name huge in a sunset gradient on the
 * other, one thin progress line, one line of rules, the reward — and three
 * portrait tabs to switch between the crew. Her unrevealed parts are a dark
 * ghost of her real art (not a flat black cut-out); collected pieces sit on
 * top in full colour.
 *
 * Motion: she rises in, the name reveals letter by letter, the info lines
 * slide up in sequence, the bar fills; switching girls is a parallax
 * cross-slide; at rest she breathes. No masks anywhere.
 */

const WHITE = 0xfff4f8;
const LAVENDER = 0xb9acd9;
const DIM = 0x6f6488;

const NAMES = ["SAPPHIRE", "ROXY", "VEGA"];
const REWARDS = ["NEON NIGHTS SKIN", "GOLD RUSH SKIN", "DIAMOND ELITE SKIN"];
const PIECES = [8, 7, 8];
const PREFIX = ["char", "char2", "char3"];
/** Per-girl sunset pair (name gradient, bar, ambient glow). */
const NEON: Array<[string, string]> = [["#3fd4ff", "#7a7dff"], ["#ff3d8b", "#ffa14a"], ["#a35bff", "#ff4fa8"]];
const GLOW = [0x3f8dff, 0xff4f7a, 0x9a4dff];

function grad(stops: Array<[number, string]>, dir: "h" | "v" | "d" = "h"): FillGradient {
  return new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: dir === "h" ? { x: 1, y: 0 } : dir === "v" ? { x: 0, y: 1 } : { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
  });
}

function txt(text: string, size: number, fill: number | FillGradient, font = UI_FONT, weight: TextStyle["fontWeight"] = "700", spacing = 0): Text {
  return new Text({ text, style: new TextStyle({ fill, fontFamily: font, fontSize: size, fontWeight: weight, letterSpacing: spacing, padding: 6 }) });
}

const blurCache = new Map<string, Texture>();

/** Heavily blurred copy of an art texture — the coloured ambience behind her. */
function blurred(tex: Texture, key: string): Texture | null {
  const hit = blurCache.get(key);
  if (hit) return hit;
  const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src || typeof document === "undefined") return null;
  const small = document.createElement("canvas");
  small.width = 48; small.height = Math.round(48 * tex.height / tex.width);
  const s = small.getContext("2d")!;
  s.imageSmoothingQuality = "high";
  s.drawImage(src, 0, 0, small.width, small.height);
  const out = document.createElement("canvas");
  out.width = 256; out.height = Math.round(256 * tex.height / tex.width);
  const o = out.getContext("2d")!;
  o.imageSmoothingQuality = "high";
  o.filter = "blur(10px) saturate(1.6)";
  o.drawImage(small, 0, 0, out.width, out.height);
  const t = Texture.from(out);
  blurCache.set(key, t);
  return t;
}

const thumbCache = new Map<string, Texture>();

/** Head-and-shoulders portrait from a full-body art (rounded, canvas-cached). */
function portrait(tex: Texture, w: number, h: number, key: string, dark: boolean): Texture | null {
  const k = `${key}:${Math.round(w)}x${Math.round(h)}:${dark}`;
  const hit = thumbCache.get(k);
  if (hit) return hit;
  const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src || typeof document === "undefined") return null;
  const res = 2;
  const W = Math.round(w * res), H = Math.round(h * res), r = 12 * res;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r); g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath(); g.clip();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#2a1342"); bg.addColorStop(1, "#120a22");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const b = pieceBounds(tex);
  const bx = tex.width / 2 + b.ox - b.w / 2, by = tex.height / 2 + b.oy - b.h / 2;
  const cw = b.w * 0.86, ch = cw * (H / W);
  if (dark) g.filter = "brightness(0.18) saturate(0.4)";
  g.drawImage(src, bx + (b.w - cw) / 2, by - ch * 0.02, cw, ch, 0, 0, W, H);
  g.filter = "none";
  const shade = g.createLinearGradient(0, H * 0.55, 0, H);
  shade.addColorStop(0, "rgba(10,6,20,0)"); shade.addColorStop(1, "rgba(10,6,20,0.85)");
  g.fillStyle = shade; g.fillRect(0, 0, W, H);
  const t = Texture.from(c);
  thumbCache.set(k, t);
  return t;
}

interface GirlState { done: boolean; active: boolean; locked: boolean; have: number; total: number }

export class GalleryView extends Container {
  private bg = new Graphics();
  private ct = new Container();
  private ambient = new Container();
  private heroLayer = new Container();
  private info = new Container();
  private tabs = new Container();
  private isVisible = false;
  private screenW = 0;
  private screenH = 0;
  private activeIndex = 0;
  private token = 0;
  private hero: Container | null = null;
  private breathe: ((dt: number, t: number) => void) | null = null;

  private isDragging = false;
  private dragStartX = 0;
  private dragCurrentX = 0;

  constructor(private readonly runtime: any) {
    super();
    this.visible = false;
    this.eventMode = "static";
    this.interactiveChildren = true;
    this.addChild(this.bg, this.ambient, this.ct);
    this.bg.eventMode = "static";
    this.bg.on("pointertap", (e) => e.stopPropagation());
    this.setupSwipe();
  }

  show(screenWidth: number, screenHeight: number): void {
    const opening = !this.isVisible;
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    const prog = this.runtime.getGalleryProgress();
    if (opening) this.activeIndex = Math.min(2, Math.max(0, prog.mastered ? 0 : prog.completedGirls));
    this.visible = true;
    this.isVisible = true;
    this.rebuild(opening);
    if (opening) {
      this.alpha = 0;
      void tween(260, (p) => { this.alpha = p; }, easeOutCubic);
    }
  }

  hide(): void {
    this.isVisible = false;
    void tween(180, (p) => { this.alpha = 1 - p; }, easeOutCubic).then(() => {
      if (this.isVisible) return;
      this.visible = false;
      if (this.breathe) { ambientTicker.remove(this.breathe); this.breathe = null; }
    });
  }

  toggle(screenWidth: number, screenHeight: number): void {
    if (this.isVisible) this.hide();
    else this.show(screenWidth, screenHeight);
  }

  isOpen(): boolean { return this.isVisible; }

  // ── state ────────────────────────────────────────────────────────────────
  private state(i: number): GirlState {
    const prog = this.runtime.getGalleryProgress();
    const total = PIECES[i]!;
    const done = prog.mastered || i < prog.completedGirls;
    const active = !done && i === prog.completedGirls;
    return { done, active, locked: !done && !active, have: done ? total : active ? Math.min(total, prog.pieces) : 0, total };
  }

  private get portraitMode(): boolean {
    return this.screenW < 760 || this.screenH > this.screenW;
  }

  // ── build ────────────────────────────────────────────────────────────────
  private rebuild(intro: boolean): void {
    const W = this.screenW, H = this.screenH;
    for (const c of this.ct.removeChildren()) c.destroy({ children: true });
    this.heroLayer = new Container();
    this.info = new Container();
    this.tabs = new Container();
    this.hero = null;

    this.bg.clear();
    this.bg.rect(0, 0, W, H).fill(grad([[0, "#0e071a"], [1, "#05030a"]], "v"));

    this.ct.addChild(this.heroLayer, this.info, this.tabs);

    // header (top-left) + close (top-right)
    const prog = this.runtime.getGalleryProgress();
    const pad = this.portraitMode ? 18 : 40;
    const head = txt("BEACH GIRL DECK", 13, WHITE, UI_FONT, "700", 4);
    head.position.set(pad, pad - 6);
    this.ct.addChild(head);
    if (prog.prestige > 0) {
      const p = txt(getPrestigeTitle(prog.prestige), 11, grad([[0, "#ff6fae"], [1, "#ffb15c"]]), UI_FONT, "700", 3);
      p.position.set(pad + head.width + 14, pad - 4);
      this.ct.addChild(p);
    }
    const close = this.closeButton();
    close.position.set(W - pad - 4, pad + 3);
    this.ct.addChild(close);

    this.buildTabs();
    this.present(this.activeIndex, intro ? 0 : 0, intro);
  }

  /** Put girl `i` on stage. `dir` = -1/1 slides from that side; 0 = rise in. */
  private present(i: number, dir: number, intro: boolean): void {
    const token = ++this.token;
    const W = this.screenW, H = this.screenH;
    const P = this.portraitMode;
    const st = this.state(i);
    const prefix = PREFIX[i]!;
    const fullTex = getExtraTexture(`${prefix}_full`);

    // ambient: her own colours, blurred huge behind everything
    for (const c of this.ambient.removeChildren()) c.destroy();
    if (fullTex) {
      const b = blurred(fullTex, prefix);
      if (b) {
        const amb = new Sprite(b);
        amb.anchor.set(0.5);
        const s = Math.max(W / b.width, H / b.height) * 1.25;
        amb.scale.set(s);
        amb.position.set(P ? W / 2 : W * 0.34, H * 0.5);
        amb.alpha = 0;
        amb.tint = st.locked ? 0x3a2a4a : 0xffffff;
        this.ambient.addChild(amb);
        void tween(500, (p) => { if (!amb.destroyed) amb.alpha = (st.locked ? 0.18 : 0.38) * p; }, easeOutCubic);
      }
    }
    // a vignette so the ambience never fights the text
    const vig = new Graphics();
    vig.rect(0, 0, W, H).fill(grad(P
      ? [[0, "rgba(8,4,16,0.25)"], [0.55, "rgba(8,4,16,0.55)"], [1, "rgba(8,4,16,0.92)"]]
      : [[0, "rgba(8,4,16,0.1)"], [0.5, "rgba(8,4,16,0.55)"], [1, "rgba(8,4,16,0.9)"]], P ? "v" : "h"));
    this.ambient.addChild(vig);

    // hero
    const old = this.hero;
    if (old) {
      const x0 = old.x;
      void tween(260, (p) => {
        if (old.destroyed) return;
        old.alpha = 1 - p;
        old.x = x0 - dir * 70 * p;
      }, easeInOutCubic).then(() => old.destroy({ children: true }));
    }
    const hero = new Container();
    const heroH = P ? H * 0.42 : H * 0.9;
    const heroCX = P ? W / 2 : W * 0.32;
    const heroBottom = P ? H * 0.5 : H * 0.98;
    if (fullTex) {
      const b = pieceBounds(fullTex);
      const s = heroH / b.h;
      const fig = new Container();
      const base = new Sprite(fullTex);
      base.anchor.set(0.5);
      if (st.done) {
        fig.addChild(base);
      } else {
        // the unrevealed girl: a near-black figure with a neon rim in her
        // colour (her own alpha stamped 8 ways under the fill — no filters)
        const b0 = pieceBounds(fullTex);
        const t = 2.2 / (heroH / b0.h);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
          const rimS = new Sprite(fullTex);
          rimS.anchor.set(0.5);
          rimS.tint = st.locked ? 0x3a2f55 : GLOW[i]!;
          rimS.alpha = st.locked ? 0.55 : 0.95;
          rimS.position.set(dx! * t, dy! * t);
          fig.addChild(rimS);
        }
        base.tint = st.locked ? 0x0b0814 : 0x0f0a1c;
        fig.addChild(base);
        if (st.active) {
          for (let p = 1; p <= st.have; p++) {
            const pt = getExtraTexture(`${prefix}_piece_${p}`);
            if (pt) { const ps = new Sprite(pt); ps.anchor.set(0.5); fig.addChild(ps); }
          }
        }
      }
      fig.scale.set(s);
      fig.position.set(-b.ox * s, -(b.oy + b.h / 2) * s);
      hero.addChild(fig);
      // floor light
      const floor = new Graphics();
      for (let k = 6; k >= 1; k--) floor.ellipse(0, -2, b.w * s * (0.18 + k * 0.05), 3 + k * 2.2).fill({ color: GLOW[i]!, alpha: st.locked ? 0.02 : 0.05 });
      hero.addChildAt(floor, 0);
    }
    const hx = heroCX, hy = heroBottom;
    hero.position.set(hx + dir * 90, hy + (dir === 0 ? 40 : 0));
    hero.alpha = 0;
    this.heroLayer.addChild(hero);
    this.hero = hero;
    void tween(intro ? 700 : 480, (p) => {
      if (hero.destroyed) return;
      hero.alpha = Math.min(1, p * 1.4);
      hero.x = hx + dir * 90 * (1 - p);
      hero.y = hy + (dir === 0 ? 40 : 0) * (1 - p);
    }, easeOutCubic);
    if (this.breathe) ambientTicker.remove(this.breathe);
    let t = 0;
    this.breathe = (dt) => {
      if (hero.destroyed) return;
      t += dt;
      const k = 1 + 0.006 * Math.sin(t * 1.6);
      hero.scale.set(k, k);
    };
    ambientTicker.add(this.breathe);

    this.buildInfo(i, st, token);
    this.refreshTabs();
  }

  private buildInfo(i: number, st: GirlState, token: number): void {
    for (const c of this.info.removeChildren()) c.destroy({ children: true });
    const W = this.screenW, H = this.screenH;
    const P = this.portraitMode;
    const neon = NEON[i]!;
    const x = P ? 22 : W * 0.56;
    const maxW = P ? W - 44 : Math.min(470, W * 0.38);
    let y = P ? H * 0.525 : H * 0.2;

    const lines: Array<{ node: Container; delay: number }> = [];
    const add = (node: Container, delay: number): void => { this.info.addChild(node); lines.push({ node, delay }); };

    const kicker = txt(`CREW MEMBER 0${i + 1}  /  03`, P ? 11 : 12, st.locked ? DIM : LAVENDER, UI_FONT, "700", 4);
    kicker.position.set(x, y);
    add(kicker, 0);
    y += P ? 18 : 24;

    // the name, letter by letter, in her sunset gradient
    const nameSize = P ? Math.min(64, W * 0.15) : Math.min(118, W * 0.09);
    const name = new Container();
    name.position.set(x - 3, y);
    let lx = 0;
    const letters: Text[] = [];
    for (const ch of NAMES[i]!) {
      const l = txt(ch, nameSize, st.locked ? DIM : grad([[0, neon[0]], [1, neon[1]]], "d"), DISPLAY_FONT, "400", 0);
      l.position.set(lx, 0);
      lx += l.width - nameSize * 0.06 + nameSize * 0.04;
      name.addChild(l);
      letters.push(l);
    }
    if (name.width > maxW) name.scale.set(maxW / name.width);
    // Anton's em box carries ~18% empty descender below the caps
    const nameH = name.height * 0.84;
    this.info.addChild(name);
    letters.forEach((l, k) => {
      const y0 = l.y;
      l.alpha = 0;
      l.y = y0 + nameSize * 0.35;
      window.setTimeout(() => {
        if (l.destroyed || token !== this.token) return;
        void tween(560, (p) => {
          if (l.destroyed) return;
          l.alpha = Math.min(1, p * 1.6);
          l.y = y0 + nameSize * 0.35 * (1 - p);
        }, easeOutCubic);
      }, 60 + k * 50);
    });
    y += nameH + (P ? 6 : 12);

    // progress: thin line with a tick per piece
    const status = st.done ? "COMPLETE" : st.locked ? "LOCKED" : `${st.have} OF ${st.total} PIECES`;
    const statusT = txt(status, P ? 14 : 16, st.done ? 0xffd166 : st.locked ? DIM : WHITE, UI_FONT, "700", 3);
    statusT.position.set(x, y);
    add(statusT, 120);
    y += P ? 24 : 30;
    const barW = maxW;
    const bar = new Graphics();
    bar.roundRect(0, 0, barW, 4, 2).fill({ color: 0xffffff, alpha: 0.12 });
    for (let k = 1; k < st.total; k++) bar.rect((barW / st.total) * k - 1, -3, 2, 10).fill({ color: 0x0b0716, alpha: 0.9 });
    const fill = new Graphics();
    const target = st.have / st.total;
    const drawFill = (f: number): void => {
      fill.clear();
      if (f > 0) fill.roundRect(0, 0, Math.max(4, barW * f), 4, 2).fill(grad([[0, neon[0]], [1, neon[1]]]));
    };
    drawFill(0);
    const barC = new Container();
    barC.position.set(x, y);
    barC.addChild(bar, fill);
    add(barC, 160);
    window.setTimeout(() => {
      if (token !== this.token) return;
      void tween(900, (p) => { if (!fill.destroyed) drawFill(target * p); }, easeOutCubic);
    }, 260);
    y += P ? 22 : 30;

    const rule = st.done
      ? `${this.title(i)} is complete — her gold Wanted star and reward are yours.`
      : st.locked
        ? `Complete ${this.title(i - 1)} to unlock her.`
        : `Every Wild that lands reveals one piece. ${st.total - st.have} more to complete ${this.title(i)} and earn a gold Wanted star.`;
    const body = new Text({
      text: rule,
      style: new TextStyle({ fill: st.locked ? DIM : LAVENDER, fontFamily: UI_FONT, fontSize: P ? 14 : 17, fontWeight: "600", wordWrap: true, wordWrapWidth: maxW, lineHeight: P ? 19 : 24, padding: 4 }),
    });
    body.position.set(x, y);
    add(body, 200);
    y += body.height + (P ? 10 : 22);

    const rl = txt("REWARD", 11, DIM, UI_FONT, "700", 4);
    rl.position.set(x, y);
    add(rl, 240);
    const rv = txt(REWARDS[i]!, P ? 16 : 20, st.locked ? DIM : WHITE, UI_FONT, "700", 2);
    rv.position.set(x, y + 16);
    add(rv, 260);

    for (const { node, delay } of lines) {
      const y0 = node.y;
      node.alpha = 0;
      node.y = y0 + 14;
      window.setTimeout(() => {
        if (node.destroyed || token !== this.token) return;
        void tween(420, (p) => { if (!node.destroyed) { node.alpha = p; node.y = y0 + 14 * (1 - p); } }, easeOutCubic);
      }, 120 + delay);
    }
  }

  private title(i: number): string {
    const n = NAMES[i] ?? "the previous girl";
    return n.charAt(0) + n.slice(1).toLowerCase();
  }

  // ── selector tabs ────────────────────────────────────────────────────────
  private buildTabs(): void {
    const W = this.screenW, H = this.screenH;
    const P = this.portraitMode;
    const tw = P ? 64 : 86, th = P ? 78 : 108, gap = P ? 12 : 16;
    const total = tw * 3 + gap * 2;
    const x0 = P ? (W - total) / 2 : W * 0.56;
    const y0 = H - th - (P ? 18 : 40);
    for (let i = 0; i < 3; i++) {
      const st = this.state(i);
      const tab = new Container();
      tab.position.set(x0 + i * (tw + gap) + tw / 2, y0 + th / 2);
      tab.pivot.set(tw / 2, th / 2);
      const tex = getExtraTexture(`${PREFIX[i]!}_full`);
      const pt = tex ? portrait(tex, tw, th, PREFIX[i]!, st.locked) : null;
      if (pt) { const sp = new Sprite(pt); sp.width = tw; sp.height = th; tab.addChild(sp); }
      const rim = new Graphics();
      rim.label = "rim";
      tab.addChild(rim);
      const name = txt(NAMES[i]!, 10, st.locked ? DIM : WHITE, UI_FONT, "700", 2);
      name.anchor.set(0.5, 1);
      name.position.set(tw / 2, th - 7);
      tab.addChild(name);
      const badge = txt(st.done ? "★" : st.locked ? "" : `${st.have}/${st.total}`, st.done ? 14 : 10, st.done ? 0xffd166 : WHITE, UI_FONT, "700", 0.5);
      badge.anchor.set(1, 0);
      badge.position.set(tw - 7, 5);
      tab.addChild(badge);
      tab.eventMode = "static";
      tab.cursor = "pointer";
      tab.on("pointertap", (e) => { e.stopPropagation(); this.select(i); });
      tab.on("pointerover", () => { if (i !== this.activeIndex) tab.scale.set(1.04); });
      tab.on("pointerout", () => { if (i !== this.activeIndex) tab.scale.set(1); });
      this.tabs.addChild(tab);
    }
  }

  private refreshTabs(): void {
    this.tabs.children.forEach((tab, i) => {
      const c = tab as Container;
      const on = i === this.activeIndex;
      const rim = c.children.find((k) => k.label === "rim") as Graphics | undefined;
      const tw = (c.pivot.x * 2), th = (c.pivot.y * 2);
      if (rim) {
        rim.clear();
        if (on) rim.roundRect(1, 1, tw - 2, th - 2, 12).stroke({ width: 2, fill: grad([[0, NEON[i]![0]], [1, NEON[i]![1]]], "d") });
        else rim.roundRect(0.5, 0.5, tw - 1, th - 1, 12).stroke({ color: 0xffffff, width: 1, alpha: 0.14 });
      }
      const s0 = c.scale.x, a0 = c.alpha;
      const s1 = on ? 1.08 : 1, a1 = on ? 1 : 0.62;
      void tween(260, (p) => { if (!c.destroyed) { c.scale.set(s0 + (s1 - s0) * p); c.alpha = a0 + (a1 - a0) * p; } }, easeOutCubic);
    });
  }

  private select(i: number): void {
    if (i === this.activeIndex) return;
    const dir = i > this.activeIndex ? 1 : -1;
    this.activeIndex = i;
    this.present(i, dir, false);
  }

  nextCard(): void { this.select((this.activeIndex + 1) % 3); }
  prevCard(): void { this.select((this.activeIndex + 2) % 3); }

  private setupSwipe(): void {
    this.bg.on("pointerdown", (e) => { this.isDragging = true; this.dragStartX = this.dragCurrentX = e.global.x; });
    this.bg.on("pointermove", (e) => { if (this.isDragging) this.dragCurrentX = e.global.x; });
    const end = (): void => {
      if (!this.isDragging) return;
      this.isDragging = false;
      const dx = this.dragCurrentX - this.dragStartX;
      if (dx < -40) this.nextCard();
      else if (dx > 40) this.prevCard();
    };
    this.bg.on("pointerup", end);
    this.bg.on("pointerupoutside", end);
  }

  private closeButton(): Container {
    const c = new Container();
    const r = 20;
    const disc = new Graphics();
    const paint = (hover: boolean): void => {
      disc.clear();
      disc.circle(0, 0, r).fill({ color: 0xffffff, alpha: hover ? 0.16 : 0.07 });
      disc.circle(0, 0, r - 0.5).stroke({ color: 0xffffff, width: 1, alpha: hover ? 0.5 : 0.22 });
    };
    paint(false);
    const x = new Graphics();
    const s = 6;
    x.poly([-s, -s, s, s], false).stroke({ color: WHITE, width: 2, cap: "round" });
    x.poly([s, -s, -s, s], false).stroke({ color: WHITE, width: 2, cap: "round" });
    c.addChild(disc, x);
    c.eventMode = "static";
    c.cursor = "pointer";
    c.on("pointerover", () => paint(true));
    c.on("pointerout", () => paint(false));
    c.on("pointertap", (e) => { e.stopPropagation(); this.hide(); });
    return c;
  }
}
