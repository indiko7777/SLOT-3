import { Container, FillGradient, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { softGlowTexture } from "./fxTextures";
import type { Rect } from "./types";
import { UI_FONT } from "../typography";

/**
 * The bet bar ("Poor bet UI bar", three review rounds running), in the game's
 * Vice City palette: twilight glass, a sunset stripe, and one hero control —
 * the pink→orange→violet SPIN disc with a turning arrow mark.
 *
 *   [≡][♪][i]   BALANCE        WIN        [−] BET [+]   [AUTO] ( ⟳ ) [⚡]
 *
 * Minimal on purpose: no plates or boxes round the read-outs, one icon
 * language (white, 2px, round caps), colour only where it means something —
 * the spin disc, the win, and an active AUTO / TURBO ring.
 */

export const BAR = {
  ink: 0x0b0716,
  key: 0x1d1533,
  keyHover: 0x2c2150,
  keyOn: 0x2b1233,
  stroke: 0xffffff,
  cream: 0xfff4f8,
  label: 0xb9acd9,
  pink: 0xff3d8b,
  orange: 0xff9a3c,
  gold: 0xffd166,
  violet: 0x8b3dff,
  teal: 0x22d3c5,
} as const;

/** GTA VI sunset: hot pink → orange → gold, along `dir` in the shape's own space. */
function sunset(dir: "h" | "v" | "d" = "h", stops: Array<[number, string]> = [[0, "#ff3d8b"], [0.55, "#ff8a3d"], [1, "#ffd166"]]): FillGradient {
  return new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: dir === "h" ? { x: 1, y: 0 } : dir === "v" ? { x: 0, y: 1 } : { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: stops.map(([offset, color]) => ({ offset, color })),
  });
}

export type BarAction = "menu" | "mute" | "info" | "minus" | "plus" | "spin" | "autoplay" | "turbo";

export interface BarState {
  muted: boolean;
  playing: boolean;
  locked: boolean;
  replay: boolean;
  autoRemaining: number;
  turbo: "off" | "turbo" | "super";
  canMinus: boolean;
  canPlus: boolean;
  labels: { balance: string; bet: string; win: string };
  balance: string;
  bet: string;
}

export interface BarRefs {
  root: Container;
  balance: Text;
  bet: Text;
  win: Text;
  winLabel: Text;
  message: Text;
  /** Per-frame animation for the spin mark / pulses (hand to the ambient loop). */
  tick: (dt: number, elapsed: number) => void;
}

// ───────────────────────────────── text ─────────────────────────────────

function label(text: string, size: number): Text {
  const t = new Text({
    text: text.toUpperCase(),
    style: new TextStyle({ fill: sunset("h", [[0, "#ff6fae"], [1, "#ffb15c"]]), fontFamily: UI_FONT, fontSize: size, fontWeight: "700", letterSpacing: size * 0.22 }),
  });
  t.anchor.set(0.5, 0.5);
  return t;
}

function value(text: string, size: number, color: number = BAR.cream): Text {
  const t = new Text({
    text,
    style: new TextStyle({ fill: color, fontFamily: UI_FONT, fontSize: size, fontWeight: "700", letterSpacing: 0.3, padding: 4 }),
  });
  t.anchor.set(0.5, 0.5);
  return t;
}

/** Shrink (never grow) a text so it fits `max` px. Re-run after text changes. */
export function fitWidth(t: Text, max: number, base = 1): void {
  (t as Text & { maxW?: number }).maxW = max;
  t.scale.set(base);
  if (t.width > max) t.scale.set((base * max) / t.width);
}

// ───────────────────────────────── icons ────────────────────────────────

/** Points along an arc for an OPEN polyline. Never `g.arc()` on this bar: it
 *  appends to the running path and trails a stray line from the last shape. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 18): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}

/** Arrowhead at the END of an arc running clockwise (screen space). */
function arrowHead(g: Graphics, cx: number, cy: number, r: number, a: number, size: number, color: number): void {
  const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
  const tx = -Math.sin(a), ty = Math.cos(a); // tangent (clockwise)
  const nx = Math.cos(a), ny = Math.sin(a);  // radial
  g.poly([
    px + tx * size * 1.05, py + ty * size * 1.05,
    px + nx * size * 0.78 - tx * size * 0.15, py + ny * size * 0.78 - ty * size * 0.15,
    px - nx * size * 0.78 - tx * size * 0.15, py - ny * size * 0.78 - ty * size * 0.15,
  ]).fill(color);
}

/** The spin mark: two chasing arrows. Drawn centred on (0,0). */
function spinMark(g: Graphics, r: number, color: number): void {
  const w = Math.max(2.5, r * 0.2);
  for (const base of [0, Math.PI]) {
    const a0 = base - Math.PI * 0.86, a1 = base - Math.PI * 0.2;
    g.poly(arc(0, 0, r, a0, a1), false).stroke({ color, width: w, cap: "round", join: "round" });
    arrowHead(g, 0, 0, r, a1, w * 1.35, color);
  }
}

function boltPts(cx: number, cy: number, s: number): number[] {
  // 24-unit bolt, centred.
  const P = [13, 2, 4, 13.5, 11, 13.5, 9.5, 22, 20, 9.5, 13, 9.5, 14.5, 2];
  const out: number[] = [];
  for (let i = 0; i < P.length; i += 2) out.push(cx + (P[i]! - 12) * s, cy + (P[i + 1]! - 12) * s);
  return out;
}

/** Icons are drawn centred on (0,0) at a nominal 24-unit box scaled by `s`. */
function icon(g: Graphics, kind: BarAction | "stop", s: number, color: number, st: BarState): void {
  const w = 2 * s;
  switch (kind) {
    case "menu":
      for (const y of [-6, 0, 6]) g.roundRect(-8 * s, y * s - w / 2, 16 * s, w, w / 2).fill(color);
      break;
    case "info":
      g.circle(0, 0, 9.5 * s).stroke({ color, width: w * 0.85 });
      g.circle(0, -4.6 * s, 1.5 * s).fill(color);
      g.roundRect(-1.1 * s, -1.6 * s, 2.2 * s, 7.6 * s, 1.1 * s).fill(color);
      break;
    case "mute": {
      g.poly([-8.5 * s, -3.2 * s, -4.6 * s, -3.2 * s, -0.6 * s, -7.2 * s, -0.6 * s, 7.2 * s, -4.6 * s, 3.2 * s, -8.5 * s, 3.2 * s]).fill(color);
      if (st.muted) {
        g.poly([2.8 * s, -4 * s, 9 * s, 4 * s], false).stroke({ color, width: w, cap: "round" });
        g.poly([9 * s, -4 * s, 2.8 * s, 4 * s], false).stroke({ color, width: w, cap: "round" });
      } else {
        g.poly(arc(-0.8 * s, 0, 5 * s, -Math.PI / 3.2, Math.PI / 3.2, 10), false).stroke({ color, width: w * 0.9, cap: "round" });
        g.poly(arc(-0.8 * s, 0, 9 * s, -Math.PI / 3.2, Math.PI / 3.2, 14), false).stroke({ color, width: w * 0.9, cap: "round" });
      }
      break;
    }
    case "minus":
      g.roundRect(-6.5 * s, -w * 0.6, 13 * s, w * 1.2, w * 0.6).fill(color);
      break;
    case "plus":
      g.roundRect(-6.5 * s, -w * 0.6, 13 * s, w * 1.2, w * 0.6).fill(color);
      g.roundRect(-w * 0.6, -6.5 * s, w * 1.2, 13 * s, w * 0.6).fill(color);
      break;
    case "autoplay": {
      // a looping arrow round a play triangle
      g.poly(arc(0, 0, 8.6 * s, -Math.PI * 0.35, Math.PI * 1.35, 26), false).stroke({ color, width: w * 0.95, cap: "round" });
      arrowHead(g, 0, 0, 8.6 * s, Math.PI * 1.35, w * 1.25, color);
      g.poly([-2.4 * s, -4 * s, 4.4 * s, 0, -2.4 * s, 4 * s]).fill(color);
      break;
    }
    case "turbo":
      if (st.turbo === "super") {
        g.poly(boltPts(-3.2 * s, 0, s * 0.82)).fill(color);
        g.poly(boltPts(4 * s, 0, s * 0.82)).fill({ color, alpha: 0.75 });
      } else {
        g.poly(boltPts(0, 0, s)).fill(color);
      }
      break;
    case "stop":
      g.roundRect(-5.5 * s, -5.5 * s, 11 * s, 11 * s, 2 * s).fill(color);
      break;
    default:
      break;
  }
}

// ──────────────────────────────── controls ──────────────────────────────

interface KeyOpts {
  r: number;
  action: BarAction;
  st: BarState;
  disabled?: boolean;
  on?: boolean;
  /** Hairline colour for keys that should read as part of a group (bet −/+). */
  ring?: number;
  onTap: (a: BarAction) => void;
}

/** A round glass key: twilight disc, hairline rim (a sunset ring when ON), white icon. */
function keycap(o: KeyOpts): Container {
  const c = new Container();
  const disc = new Graphics();
  const paint = (hover: boolean): void => {
    disc.clear();
    disc.circle(0, 0, o.r).fill({ color: o.on ? BAR.keyOn : hover ? BAR.keyHover : BAR.key, alpha: 0.9 });
    if (o.on) disc.circle(0, 0, o.r - 1).stroke({ width: 2, fill: sunset("d") });
    else disc.circle(0, 0, o.r - 0.5).stroke({ color: o.ring ?? BAR.stroke, width: o.ring ? 1.4 : 1, alpha: hover ? 0.9 : o.ring ? 0.6 : 0.12 });
  };
  paint(false);
  c.addChild(disc);
  const ico = new Graphics();
  icon(ico, o.action, o.r / 18, o.on ? BAR.gold : BAR.cream, o.st);
  c.addChild(ico);
  c.eventMode = "static";
  c.cursor = o.disabled ? "default" : "pointer";
  if (o.disabled) c.alpha = 0.35;
  c.on("pointerover", () => { if (!o.disabled) paint(true); });
  c.on("pointerout", () => { paint(false); c.scale.set(1); });
  c.on("pointerdown", () => { if (!o.disabled) c.scale.set(0.92); });
  c.on("pointerupoutside", () => c.scale.set(1));
  c.on("pointerup", () => { c.scale.set(1); if (!o.disabled) o.onTap(o.action); });
  return c;
}

interface SpinParts { root: Container; mark: Graphics; disc: Container; halo: Sprite }

function spinButton(R: number, st: BarState, onTap: (a: BarAction) => void): SpinParts {
  const root = new Container();
  const auto = st.autoRemaining > 0;
  const live = (!st.playing || auto) && !st.replay;

  // soft pink bloom behind the disc (breathes while the button is live)
  const halo = new Sprite(softGlowTexture());
  halo.anchor.set(0.5);
  halo.blendMode = "add";
  halo.tint = BAR.pink;
  halo.width = halo.height = R * 3.4;
  halo.alpha = 0.55;
  halo.visible = live;
  root.addChild(halo);

  const disc = new Container();
  const g = new Graphics();
  g.circle(0, 0, R + 3.5).fill({ color: BAR.ink, alpha: 0.95 });
  g.circle(0, 0, R).fill(live
    ? sunset("d", [[0, "#ffc35a"], [0.42, "#ff4f8b"], [1, "#7d3cff"]])
    : sunset("d", [[0, "#4b3d5e"], [1, "#221a33"]]));
  g.circle(0, 0, R - 1.2).stroke({ color: 0xffffff, width: 2, alpha: live ? 0.9 : 0.2 });
  // glossy lens across the top half
  g.ellipse(0, -R * 0.44, R * 0.7, R * 0.34).fill({ color: 0xffffff, alpha: live ? 0.18 : 0.05 });
  disc.addChild(g);

  const mark = new Graphics();
  if (auto) icon(mark, "stop", R / 26, 0xffffff, st);
  else spinMark(mark, R * 0.46, 0xffffff);
  mark.alpha = live ? 1 : 0.5;
  disc.addChild(mark);

  if (auto) {
    const n = Number.isFinite(st.autoRemaining) ? String(st.autoRemaining) : "∞";
    const t = value(n, Math.round(R * 0.3), 0xffffff);
    t.position.set(0, R * 0.5);
    disc.addChild(t);
    mark.position.set(0, -R * 0.1);
  }
  root.addChild(disc);

  root.eventMode = "static";
  root.cursor = live ? "pointer" : "default";
  if (st.replay) root.alpha = 0.45;
  if (live) {
    root.on("pointerover", () => disc.scale.set(1.05));
    root.on("pointerout", () => disc.scale.set(1));
    root.on("pointerdown", () => disc.scale.set(0.93));
    root.on("pointerupoutside", () => disc.scale.set(1));
    root.on("pointerup", () => { disc.scale.set(1); onTap("spin"); });
  }
  return { root, mark, disc, halo };
}

// The spin mark keeps one continuous angle across HUD rebuilds, so it never
// snaps back to 0 when the bar is redrawn between spins.
let markAngle = 0;

// ──────────────────────────────── layout ────────────────────────────────

export function buildControlBar(rect: Rect, st: BarState, onTap: (a: BarAction) => void): BarRefs {
  const root = new Container();
  const portrait = rect.height > 110;

  // ── console body: twilight glass under a sunset stripe ──
  const body = new Graphics();
  body.rect(rect.x, rect.y, rect.width, rect.height).fill(sunset("v", [[0, "rgba(30,14,52,0.93)"], [1, "rgba(9,6,18,0.97)"]]));
  body.rect(rect.x, rect.y, rect.width, 3).fill(sunset("h", [[0, "#22d3c5"], [0.3, "#8b3dff"], [0.6, "#ff3d8b"], [0.85, "#ff8a3d"], [1, "#ffd166"]]));
  body.rect(rect.x, rect.y + 2, rect.width, 14).fill(sunset("v", [[0, "rgba(255,90,140,0.14)"], [1, "rgba(255,90,140,0)"]]));
  root.addChild(body);
  // a low sunset glow pooled under the spin cluster (landscape) / centre (portrait)
  const pool = new Sprite(softGlowTexture());
  pool.anchor.set(0.5);
  pool.blendMode = "add";
  pool.tint = 0xff4f8b;
  pool.alpha = 0.22;
  pool.width = Math.min(520, rect.width * 0.5);
  pool.height = rect.height * 1.6;
  pool.position.set(portrait ? rect.x + rect.width / 2 : rect.x + rect.width - 140, rect.y + rect.height * 0.85);
  root.addChild(pool);
  const pool2 = new Sprite(softGlowTexture());
  pool2.anchor.set(0.5);
  pool2.blendMode = "add";
  pool2.tint = 0x6a3dff;
  pool2.alpha = 0.18;
  pool2.width = Math.min(460, rect.width * 0.45);
  pool2.height = rect.height * 1.5;
  pool2.position.set(rect.x + rect.width * (portrait ? 0.2 : 0.18), rect.y + rect.height * 0.9);
  root.addChild(pool2);


  const lockBet = st.locked || st.replay;
  const tap = onTap;

  const balanceLabel = label(st.labels.balance, portrait ? 10 : 11);
  const balance = value(st.replay ? "—" : st.balance, portrait ? 17 : 21);
  const betLabel = label(st.labels.bet, portrait ? 10 : 11);
  const bet = value(st.bet, portrait ? 17 : 21, BAR.cream);
  const winLabel = label(st.labels.win, portrait ? 10 : 11);
  const win = value("", portrait ? 24 : 32, BAR.gold);
  win.style.fill = sunset("v", [[0, "#ffe48a"], [0.55, "#ffb04a"], [1, "#ff4f8b"]]);
  win.style.dropShadow = { color: 0xff3d8b, alpha: 0.35, blur: 10, distance: 0, angle: 0 };
  const message = value("", portrait ? 15 : 17, BAR.cream);
  message.alpha = 0.78;

  let spin: SpinParts;

  if (!portrait) {
    const cy = rect.y + rect.height / 2 + 1;
    const pad = 18;

    // utilities
    const kr = 19;
    [["menu", 0], ["mute", 1], ["info", 2]].forEach(([a, i]) => {
      const k = keycap({ r: kr, action: a as BarAction, st, onTap: tap });
      k.position.set(rect.x + pad + kr + (i as number) * (kr * 2 + 8), cy);
      root.addChild(k);
    });
    const utilEnd = rect.x + pad + kr * 6 + 16;

    // right cluster: AUTO · SPIN · TURBO
    const R = 40;
    const sk = 21;
    const turboX = rect.x + rect.width - pad - sk;
    const spinX = turboX - sk - 14 - R;
    const autoX = spinX - R - 14 - sk;
    const autoOn = st.autoRemaining > 0;
    const auto = keycap({ r: sk, action: "autoplay", st, onTap: tap, on: autoOn, disabled: st.replay || (st.playing && !autoOn) });
    auto.position.set(autoX, cy);
    root.addChild(auto);
    const turbo = keycap({ r: sk, action: "turbo", st, onTap: tap, on: st.turbo !== "off", disabled: st.replay });
    turbo.position.set(turboX, cy);
    root.addChild(turbo);
    spin = spinButton(R, st, tap);
    spin.root.position.set(spinX, cy);
    root.addChild(spin.root);
    const capY = cy + sk + 9;
    for (const [x, t] of [[autoX, "AUTO"], [turboX, st.turbo === "super" ? "TURBO+" : "TURBO"]] as const) {
      const l = label(t, 8.5);
      l.position.set(x, capY);
      l.alpha = 0.9;
      root.addChild(l);
    }

    // BET module: [−] BET [+]
    const betW = 210, betH = 58;
    const betX = autoX - sk - 22 - betW;
    const minus = keycap({ r: 17, action: "minus", st, onTap: tap, ring: BAR.pink, disabled: lockBet || !st.canMinus });
    minus.position.set(betX + 17, cy);
    const plus = keycap({ r: 17, action: "plus", st, onTap: tap, ring: BAR.pink, disabled: lockBet || !st.canPlus });
    plus.position.set(betX + betW - 17, cy);
    root.addChild(minus, plus);
    betLabel.position.set(betX + betW / 2, cy - 14);
    bet.position.set(betX + betW / 2, cy + 8);
    fitWidth(bet, betW - 90);

    // BALANCE
    const balW = 200;
    const balX = utilEnd + 14;
    balanceLabel.position.set(balX + balW / 2, cy - 14);
    balance.position.set(balX + balW / 2, cy + 8);
    fitWidth(balance, balW - 20);

    // WIN — centred in what's left between the two
    const winX0 = balX + balW + 16, winX1 = betX - 16;
    const wcx = (winX0 + winX1) / 2;
    winLabel.position.set(wcx, cy - 17);
    win.position.set(wcx, cy + 8);
    message.position.set(wcx, cy + 1);
    (win as Text & { maxW?: number }).maxW = winX1 - winX0;
    (message as Text & { maxW?: number }).maxW = winX1 - winX0;
    root.addChild(balanceLabel, balance, betLabel, bet, winLabel, win, message);
  } else {
    // ── portrait: read-outs on top, controls below ──
    const pad = 10;
    const rowH = 50;
    const top = rect.y + 12;
    const colW = (rect.width - pad * 2 - 12) / 3;
    const cols = [rect.x + pad, rect.x + pad + colW + 6, rect.x + pad + (colW + 6) * 2];
    balanceLabel.position.set(cols[0]! + colW / 2, top + 14);
    balance.position.set(cols[0]! + colW / 2, top + 33);
    fitWidth(balance, colW - 12);
    winLabel.position.set(cols[1]! + colW / 2, top + 14);
    win.position.set(cols[1]! + colW / 2, top + 33);
    win.style.fontSize = 19;
    (win as Text & { maxW?: number }).maxW = colW - 12;
    message.style.fontSize = 13;
    message.position.set(cols[1]! + colW / 2, top + rowH / 2);
    (message as Text & { maxW?: number }).maxW = colW - 10;
    betLabel.position.set(cols[2]! + colW / 2, top + 14);
    bet.position.set(cols[2]! + colW / 2, top + 33);
    fitWidth(bet, colW - 12);

    const rowY = top + rowH + (rect.y + rect.height - (top + rowH)) / 2 + 2;
    const R = Math.min(40, Math.max(32, rect.width * 0.1));
    const cx = rect.x + rect.width / 2;
    const half = rect.width / 2 - pad;
    const k = Math.max(15, Math.min(21, (half - R - 12) / 6.4));
    // three keys a side, spread evenly from the spin disc to the bar edge:
    //   [≡] [AUTO] [−]  ( SPIN )  [+] [⚡] [♪]      (ⓘ lives in the ≡ menu)
    const gap = (half - R - k * 6) / 3;
    const dist = [R + gap + k, R + gap * 2 + k * 3, R + gap * 3 + k * 5];
    const side: Array<[BarAction, number, number]> = [
      ["minus", -1, 0], ["autoplay", -1, 1], ["menu", -1, 2],
      ["plus", 1, 0], ["turbo", 1, 1], ["mute", 1, 2],
    ];
    for (const [a, dir, i] of side) {
      const disabled = a === "minus" ? lockBet || !st.canMinus
        : a === "plus" ? lockBet || !st.canPlus
        : a === "autoplay" ? st.replay || (st.playing && st.autoRemaining <= 0)
        : a === "turbo" ? st.replay : false;
      const on = a === "autoplay" ? st.autoRemaining > 0 : a === "turbo" ? st.turbo !== "off" : false;
      const key = keycap({ r: k, action: a, st, onTap: tap, disabled, on, ring: a === "minus" || a === "plus" ? BAR.pink : undefined });
      key.position.set(cx + dir * dist[i]!, rowY);
      root.addChild(key);
    }
    spin = spinButton(R, st, tap);
    spin.root.position.set(cx, rowY);
    root.addChild(spin.root);
    root.addChild(balanceLabel, balance, betLabel, bet, winLabel, win, message);
  }

  const playing = st.playing && st.autoRemaining <= 0;
  const tick = (dt: number, elapsed: number): void => {
    // Idle: the arrows turn slowly and the halo breathes. Spinning: they race.
    markAngle += dt * (playing ? 9 : st.autoRemaining > 0 ? 1.6 : 0.55);
    if (st.autoRemaining <= 0) spin.mark.rotation = markAngle;
    if (spin.halo.visible) {
      const p = 0.5 + 0.5 * Math.sin(elapsed * 2.2);
      spin.halo.alpha = 0.32 + p * 0.3;
    }
  };

  return { root, balance, bet, win, winLabel, message, tick };
}
