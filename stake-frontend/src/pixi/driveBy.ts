import { Container, FillGradient, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { getExtraTexture } from "./assets";
import { softGlowTexture, streakTexture, sparkDotTexture } from "./fxTextures";
import { ambientTicker, getTimeScale, tween, easeInCubic, easeOutCubic, easeOutBack } from "./tween";
import { DISPLAY_FONT, UI_FONT } from "../typography";
import type { Rect } from "./types";

/**
 * DRIVE-BY — the getaway car tears across the reels and throws Body Armor
 * wilds into them. One timeline (ms, at time-scale 1):
 *
 *   0      TITLE     "DRIVE-BY" streaks in over a dimmed board, then out
 *   420    LIGHTS    headlight glare blooms at the right edge, a light wash
 *                    rolls across the reels toward the player
 *   780    PASS      the car enters at full speed (motion blur, neon after-
 *                    images, tail-light trails, rolling wheels), drops into
 *                    slow motion as it crosses the reels — each wild is thrown
 *                    from the window as it passes that column — then rips out
 *                    to the left
 *   +      LANDINGS  every wild slams into its cell (flash, ring, sparks)
 *
 * The car is a photoreal side-profile render split into body + two rims, so
 * the wheels genuinely roll at the car's speed. No screen shake (house rule);
 * the weight comes from speed, light and sound.
 */

export interface DriveByTarget {
  x: number;
  y: number;
  /** Swap the cell to the wild — called on the impact frame. */
  land: () => void;
}

export interface DriveByOpts {
  layer: Container;
  board: Rect;
  screenW: number;
  cell: number;
  targets: DriveByTarget[];
  turbo: boolean;
  wildTexture: Texture | null;
  onCue?: (cue: DriveByCue) => void;
}

export type DriveByCue =
  | { kind: "title" }
  | { kind: "pass"; start: number; pass: number; end: number }
  | { kind: "impact"; index: number; pan: number };

// body texture geometry (public/assets/driveby/car_body.webp is 1400×418)
const BODY_W = 1400, BODY_H = 418;
const RIMS = [{ key: "driveby_rim_f", x: 317.9, y: 316.2 }, { key: "driveby_rim_r", x: 1147.2, y: 313.7 }];
const HEADLIGHT = { x: 70, y: 245 };   // front (left) lamp, body px
const TAIL = { x: 1385, y: 222 };      // rear (right) lamp
const WINDOW = { x: 560, y: 120 };     // where the wilds leave the car

const PINK = 0xff3d8b, TEAL = 0x22d3c5, WARM = 0xfff1d6;

const rimBlurCache = new Map<Texture, Texture>();

/** Rotational motion blur of a rim: the rim drawn ~16 times over a small arc. */
function rimBlur(tex: Texture): Texture | null {
  const hit = rimBlurCache.get(tex);
  if (hit) return hit;
  const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src || typeof document === "undefined") return null;
  const S = tex.width;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  const n = 16;
  g.globalAlpha = 1.6 / n;
  for (let i = 0; i < n; i++) {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(((i / (n - 1)) - 0.5) * 0.9);
    g.drawImage(src, -S / 2, -S / 2, S, S);
    g.restore();
  }
  const t = Texture.from(c);
  rimBlurCache.set(tex, t);
  return t;
}

const TRAIL = 220; // body px of motion streak behind the car in the blurred copy
let bodyBlurTex: Texture | null = null;

/** The body smeared along its direction of travel (streak trailing to the
 *  right, behind a car driving left) — drawn once, crossfaded by speed, so
 *  the pass costs no live filter. */
function bodyBlur(tex: Texture): Texture | null {
  if (bodyBlurTex) return bodyBlurTex;
  const src = (tex.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!src || typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = BODY_W + TRAIL; c.height = BODY_H;
  const g = c.getContext("2d")!;
  const n = 22;
  for (let i = n - 1; i >= 0; i--) {
    const k = i / (n - 1);
    g.globalAlpha = i === 0 ? 1 : 0.13 * Math.pow(1 - k, 1.4);
    g.drawImage(src, k * TRAIL, 0, BODY_W, BODY_H);
  }
  bodyBlurTex = Texture.from(c);
  return bodyBlurTex;
}

/** Build the drive-by's canvas textures ahead of time (call after assets load). */
export function prewarmDriveBy(): Texture[] {
  const out: Texture[] = [];
  const body = getExtraTexture("driveby_car");
  if (body) { const b = bodyBlur(body); if (b) out.push(b); }
  for (const r of RIMS) { const t = getExtraTexture(r.key); const b = t ? rimBlur(t) : null; if (b) out.push(b); }
  return out;
}

/** Fast at the edges, slow-motion while crossing the reels (normalised 0..1). */
function ramp(t: number, a: number): number {
  return t + (a * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
}

export async function playDriveBy(o: DriveByOpts): Promise<void> {
  const body = getExtraTexture("driveby_car");
  if (!body) {
    // no art (failed load): wilds still arrive, cleanly
    for (const t of o.targets) t.land();
    return;
  }
  const ts = getTimeScale();
  const turbo = o.turbo;
  const K = turbo ? 0.55 : 1;            // timeline compression
  const B = o.board;
  const root = new Container();
  o.layer.addChild(root);

  // ── scale & placement ─────────────────────────────────────────────────
  const carW = Math.min(B.width * 1.08, o.screenW * 0.9);
  const s = carW / BODY_W;
  const carH = BODY_H * s;
  const laneY = B.y + B.height * 0.64;         // car centre line
  const xStart = o.screenW + carW * 0.62;
  const xEnd = -carW * 0.62;

  // ── board dim (mood for the title / headlights) ───────────────────────
  const dim = new Graphics();
  dim.roundRect(B.x - 6, B.y - 6, B.width + 12, B.height + 12, 14).fill({ color: 0x07030f, alpha: 1 });
  dim.alpha = 0;
  root.addChild(dim);

  // ── light wash that rolls over the reels ahead of the car ─────────────
  const wash = new Sprite(softGlowTexture());
  wash.anchor.set(0.5);
  wash.blendMode = "add";
  wash.tint = WARM;
  wash.width = carW * 1.4;
  wash.height = B.height * 0.9;
  wash.alpha = 0;
  root.addChild(wash);

  // ── shadow + neon underglow (under the car) ───────────────────────────
  const shadow = new Sprite(softGlowTexture());
  shadow.anchor.set(0.5);
  shadow.tint = 0x000000;
  shadow.width = carW * 1.05;
  shadow.height = carH * 0.42;
  shadow.alpha = 0;
  root.addChild(shadow);
  const under = new Sprite(softGlowTexture());
  under.anchor.set(0.5);
  under.blendMode = "add";
  under.tint = PINK;
  under.width = carW * 1.1;
  under.height = carH * 0.5;
  under.alpha = 0;
  root.addChild(under);

  // ── headlight beam (points left, ahead of the car) + flares ───────────
  const beam = new Sprite(streakTexture());
  beam.anchor.set(1, 0.5);
  beam.blendMode = "add";
  beam.tint = WARM;
  beam.width = carW * 0.95;
  beam.height = carH * 0.55;
  beam.alpha = 0;
  root.addChild(beam);

  // ── neon after-images (behind the car) ────────────────────────────────
  const ghostTex = bodyBlur(body) ?? body;
  const ghosts: Sprite[] = [PINK, TEAL, PINK].map((tint, i) => {
    const g = new Sprite(ghostTex);
    g.anchor.set(ghostTex === body ? 0.5 : (BODY_W / 2) / (BODY_W + TRAIL), 0.5);
    g.scale.set(s);
    g.blendMode = "add";
    g.tint = tint;
    g.alpha = 0;
    (g as Sprite & { lag: number }).lag = (i + 1) * 0.55;
    root.addChild(g);
    return g;
  });

  // ── tail-light trails ─────────────────────────────────────────────────
  const tailTrail = new Sprite(streakTexture());
  tailTrail.anchor.set(0, 0.5);
  tailTrail.blendMode = "add";
  tailTrail.tint = 0xff2a3d;
  tailTrail.height = carH * 0.1;
  tailTrail.alpha = 0;
  tailTrail.scale.x = -1; // fade toward the right (behind)
  root.addChild(tailTrail);

  // ── the car: body + rolling rims, blurred by speed ────────────────────
  const car = new Container();
  const bodySp = new Sprite(body);
  bodySp.anchor.set(0.5);
  const blurTex = bodyBlur(body);
  const bodyFast = blurTex ? new Sprite(blurTex) : null;
  if (bodyFast) {
    // anchor so the streak's leading copy sits exactly on the crisp body
    bodyFast.anchor.set((BODY_W / 2) / (BODY_W + TRAIL), 0.5);
    bodyFast.alpha = 0;
    car.addChild(bodyFast);
  }
  car.addChild(bodySp);
  const rims = RIMS.map((r) => {
    const tex = getExtraTexture(r.key);
    const crisp = tex ? new Sprite(tex) : null;
    const blurTex = tex ? rimBlur(tex) : null;
    const blurred = blurTex ? new Sprite(blurTex) : null;
    for (const sp of [crisp, blurred]) {
      if (!sp) continue;
      sp.anchor.set(0.5);
      sp.position.set(r.x - BODY_W / 2, r.y - BODY_H / 2);
      car.addChild(sp);
    }
    return { crisp, blurred, radius: (tex?.width ?? 160) / 2 };
  });
  const lamp = new Sprite(softGlowTexture());
  lamp.anchor.set(0.5);
  lamp.blendMode = "add";
  lamp.tint = WARM;
  lamp.position.set(HEADLIGHT.x - BODY_W / 2, HEADLIGHT.y - BODY_H / 2);
  lamp.width = lamp.height = 120;
  car.addChild(lamp);
  const tailGlow = new Sprite(softGlowTexture());
  tailGlow.anchor.set(0.5);
  tailGlow.blendMode = "add";
  tailGlow.tint = 0xff2a3d;
  tailGlow.position.set(TAIL.x - BODY_W / 2, TAIL.y - BODY_H / 2);
  tailGlow.width = 90; tailGlow.height = 60;
  car.addChild(tailGlow);
  car.scale.set(s);
  car.position.set(xStart, laneY);
  car.visible = false;
  root.addChild(car);

  // ── glare at the right edge before the car shows ──────────────────────
  const flare = new Container();
  flare.position.set(Math.min(o.screenW - 10, B.x + B.width + carW * 0.08), laneY + (HEADLIGHT.y - BODY_H / 2) * s);
  const flareCore = new Sprite(softGlowTexture());
  flareCore.anchor.set(0.5);
  flareCore.blendMode = "add";
  flareCore.tint = WARM;
  const flareStreak = new Sprite(streakTexture());
  flareStreak.anchor.set(0.5);
  flareStreak.blendMode = "add";
  flareStreak.tint = 0x9fdcff;
  flare.addChild(flareStreak, flareCore);
  flare.alpha = 0;
  root.addChild(flare);

  // ── speed lines layer ─────────────────────────────────────────────────
  const lines = new Container();
  root.addChild(lines);
  const live: Array<{ sp: Sprite; vx: number; life: number; age: number }> = [];

  // ── title ─────────────────────────────────────────────────────────────
  const title = new Container();
  const tSize = Math.max(34, Math.min(110, B.width * 0.17));
  const word = new Text({
    text: "DRIVE-BY",
    style: new TextStyle({
      fontFamily: DISPLAY_FONT, fontSize: tSize, letterSpacing: tSize * 0.04, padding: 12,
      fill: new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: "local",
        colorStops: [{ offset: 0, color: "#ffe08a" }, { offset: 0.5, color: "#ff8a3d" }, { offset: 1, color: "#ff3d8b" }] }),
      dropShadow: { color: 0x12051f, alpha: 0.85, blur: 10, distance: 4, angle: Math.PI / 2 },
    }),
  });
  word.anchor.set(0.5);
  const sub = new Text({
    text: `${o.targets.length} WILDS INCOMING`,
    style: new TextStyle({ fontFamily: UI_FONT, fontSize: Math.max(12, tSize * 0.2), fontWeight: "700", letterSpacing: tSize * 0.06, fill: 0xfff4f8, padding: 6,
      dropShadow: { color: 0x12051f, alpha: 0.9, blur: 6, distance: 2, angle: Math.PI / 2 } }),
  });
  sub.anchor.set(0.5);
  sub.position.set(0, tSize * 0.62);
  const bar = new Graphics();
  bar.rect(-tSize * 2.2, tSize * 0.4, tSize * 4.4, 3).fill(new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: "local",
    colorStops: [{ offset: 0, color: "rgba(34,211,197,0)" }, { offset: 0.3, color: "#22d3c5" }, { offset: 0.7, color: "#ff3d8b" }, { offset: 1, color: "rgba(255,61,139,0)" }] }));
  title.addChild(bar, word, sub);
  title.skew.x = -0.16;
  const titleX = B.x + B.width / 2, titleY = B.y + B.height * 0.3;
  title.position.set(titleX + o.screenW, titleY);
  title.alpha = 0;
  if (!turbo) root.addChild(title);

  // ── timeline ──────────────────────────────────────────────────────────
  const T_TITLE_IN = 0, T_TITLE_OUT = 560 * K;
  const T_LIGHTS = turbo ? 0 : 420;
  const T_PASS = turbo ? 180 : 780;
  const D_PASS = turbo ? 700 : 1550;
  const RAMP = turbo ? 0.55 : 0.84;           // how deep the slow-mo dips
  const T_END = T_PASS + D_PASS;

  // when the car's centre crosses each target: launch slightly before
  const xAt = (u: number) => xStart + (xEnd - xStart) * ramp(Math.max(0, Math.min(1, u)), RAMP);
  const crossTime = (x: number): number => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (xAt(m) > x) lo = m; else hi = m; }
    return T_PASS + lo * D_PASS;
  };
  const order = [...o.targets].sort((a, b) => b.x - a.x);
  const launches = order.map((t, i) => ({ t, i, at: crossTime(t.x + carW * 0.06) - 40 * K, fired: false }));
  const flights: Promise<void>[] = [];

  // the centre pass (closest point) for the audio: car centre at board centre
  const passAt = crossTime(B.x + B.width / 2);
  if (!turbo) o.onCue?.({ kind: "title" });
  o.onCue?.({ kind: "pass", start: T_LIGHTS / 1000 / ts, pass: passAt / 1000 / ts, end: T_END / 1000 / ts });

  let prevX = xStart;
  let rimAngle = 0;
  let lastNow = 0;
  const update = (ms: number): void => {
    const dt = Math.max(0, ms - lastNow) / 1000;
    lastNow = ms;

    // title: streak in, hold, streak out
    if (!turbo) {
      if (ms < 200) {
        const p = easeOutCubic(ms / 200);
        title.position.x = titleX + o.screenW * 0.55 * (1 - p);
        title.alpha = p;
        title.scale.set(1 + 0.25 * (1 - p), 1);
      } else if (ms < T_TITLE_OUT) {
        title.position.x = titleX - (ms - 200) * 0.02;
        title.alpha = 1;
        title.scale.set(1);
      } else if (ms < T_TITLE_OUT + 220) {
        const p = easeInCubic((ms - T_TITLE_OUT) / 220);
        title.position.x = titleX - 7 - o.screenW * 0.6 * p;
        title.alpha = 1 - p;
        title.scale.set(1 + 0.3 * p, 1);
      } else title.visible = false;
    }

    // board dim: up during the title, lifts as the headlights take over
    // stays a touch dark while the car is on the reels, so it owns the frame
    const dimIn = Math.min(1, ms / 220);
    const dimLevel = ms < T_PASS ? 0.42 : ms < T_END ? 0.42 - 0.2 * Math.min(1, (ms - T_PASS) / (300 * K)) : 0.22 * Math.max(0, 1 - (ms - T_END) / 160);
    dim.alpha = dimLevel * dimIn;

    // glare
    if (ms >= T_LIGHTS && ms < T_PASS + 120) {
      const p = Math.min(1, (ms - T_LIGHTS) / Math.max(1, T_PASS - T_LIGHTS));
      flare.alpha = Math.min(1, p * 1.4) * (ms > T_PASS ? 1 - (ms - T_PASS) / 120 : 1);
      const k = 0.4 + p * 1.1;
      flareCore.width = flareCore.height = carH * 0.9 * k;
      flareStreak.width = carW * 1.1 * k;
      flareStreak.height = carH * 0.08 * (0.6 + p);
      wash.position.set(B.x + B.width * (1.05 - 0.35 * p), laneY - carH * 0.2);
      wash.alpha = 0.08 * p;
    } else if (ms >= T_PASS + 120) flare.alpha = 0;

    // the pass
    if (ms >= T_PASS && ms <= T_END) {
      const u = (ms - T_PASS) / D_PASS;
      const x = xAt(u);
      const v = (prevX - x) / Math.max(1e-3, dt);   // px/s, leftward positive
      prevX = x;
      const speed = Math.min(1, v / ((xStart - xEnd) / (D_PASS / 1000) * 1.6));
      car.visible = true;
      car.position.set(x, laneY + Math.sin(ms * 0.045) * carH * 0.012 * speed);
      car.rotation = -0.012 * speed;                       // squat under power
      // motion blur: the pre-smeared body takes over as the speed climbs
      const fast = Math.min(1, Math.max(0, (speed - 0.25) / 0.45));
      if (bodyFast) bodyFast.alpha = fast;
      bodySp.alpha = 1 - fast * 0.85;
      // wheels roll: angle = distance / radius (rims are body px; car is scaled)
      rimAngle -= (v * dt) / (rims[0]!.radius * s * 1.22);
      // crisp spokes in the slow-motion, a rotational smear at speed
      const smear = Math.min(1, Math.max(0, (speed - 0.22) / 0.3));
      for (const r of rims) {
        if (r.crisp) { r.crisp.rotation = rimAngle; r.crisp.alpha = 1 - smear; }
        if (r.blurred) { r.blurred.rotation = rimAngle; r.blurred.alpha = smear; }
      }
      lamp.alpha = 0.85 + 0.15 * Math.sin(ms * 0.07);
      // neon after-images trail behind (to the right), longer at speed
      for (const g of ghosts) {
        const lag = (g as Sprite & { lag: number }).lag;
        g.position.set(x + carW * 0.07 * lag * speed, car.position.y);
        g.rotation = car.rotation;
        g.alpha = 0.22 * speed / lag;
      }
      tailTrail.position.set(x + (TAIL.x - BODY_W / 2) * s, laneY + (TAIL.y - BODY_H / 2) * s);
      tailTrail.width = -(carW * 0.9 * speed + 20);
      tailTrail.alpha = 0.85 * Math.max(0.15, speed);
      beam.position.set(x + (HEADLIGHT.x - BODY_W / 2) * s, laneY + (HEADLIGHT.y - BODY_H / 2) * s);
      beam.alpha = 0.55;
      shadow.position.set(x, laneY + carH * 0.42);
      shadow.alpha = 0.55;
      under.position.set(x, laneY + carH * 0.38);
      under.alpha = 0.65 + 0.15 * Math.sin(ms * 0.02);
      wash.position.set(x - carW * 0.45, laneY - carH * 0.1);
      wash.alpha = 0.16;
      // speed lines, denser when fast
      const spawn = speed * 70 * dt * (turbo ? 0.6 : 1);
      for (let k = 0; k < Math.floor(spawn + Math.random()); k++) {
        const sp = new Sprite(streakTexture());
        sp.anchor.set(0, 0.5);
        sp.blendMode = "add";
        sp.tint = Math.random() < 0.5 ? 0xffffff : Math.random() < 0.5 ? PINK : TEAL;
        sp.width = -(carW * (0.25 + Math.random() * 0.35));
        sp.height = 2 + Math.random() * 3;
        sp.position.set(x + carW * (0.1 + Math.random() * 0.5), laneY + (Math.random() - 0.5) * carH * 1.5);
        sp.alpha = 0.5;
        lines.addChild(sp);
        live.push({ sp, vx: -v * (0.4 + Math.random() * 0.4), life: 0.32, age: 0 });
      }
      // a puff of tyre smoke while it slows over the reels
      if (speed < 0.35 && Math.random() < 0.5) {
        const puff = new Sprite(softGlowTexture());
        puff.anchor.set(0.5);
        puff.tint = 0xe8e0f4;
        const rear = RIMS[1]!;
        puff.position.set(x + (rear.x - BODY_W / 2) * s, laneY + (rear.y - BODY_H / 2) * s + rims[1]!.radius * s);
        puff.width = puff.height = carH * 0.3;
        puff.alpha = 0.22;
        lines.addChild(puff);
        live.push({ sp: puff, vx: 60 + Math.random() * 60, life: 0.9, age: 0 });
      }
    } else if (ms > T_END) {
      car.visible = false;
      for (const g of ghosts) g.alpha = 0;
      tailTrail.alpha = Math.max(0, tailTrail.alpha - dt * 4);
      beam.alpha = 0;
      shadow.alpha = Math.max(0, shadow.alpha - dt * 4);
      under.alpha = Math.max(0, under.alpha - dt * 4);
      wash.alpha = Math.max(0, wash.alpha - dt * 1.5);
    }

    // speed lines / smoke life
    for (let k = live.length - 1; k >= 0; k--) {
      const L = live[k]!;
      L.age += dt;
      L.sp.x += L.vx * dt;
      if (L.life > 0.5) { L.sp.y -= 18 * dt; L.sp.scale.set(L.sp.scale.x * (1 + dt * 1.4)); }
      L.sp.alpha = Math.max(0, (1 - L.age / L.life)) * (L.life > 0.5 ? 0.22 : 0.5);
      if (L.age >= L.life) { L.sp.destroy(); live.splice(k, 1); }
    }

    // wild throws
    for (const l of launches) {
      if (l.fired || ms < l.at) continue;
      l.fired = true;
      const from = { x: car.position.x + (WINDOW.x - BODY_W / 2) * s, y: laneY + (WINDOW.y - BODY_H / 2) * s };
      flights.push(throwWild(root, from, l.t, l.i, o));
    }
  };

  // drive the whole timeline from one clock (respects the global time scale)
  const total = T_END + 120;
  await tween(total, (p) => update(p * total), (t) => t);
  update(total);
  await Promise.all(flights);
  // let the last ring / smoke settle, then clear
  await tween(260 * K, (p) => { root.alpha = 1 - p * 0.0; for (const L of live) L.sp.alpha *= 0.9; }, (t) => t);
  root.destroy({ children: true });
}

/** One wild: thrown from the window in an arc, spinning, into its cell. */
async function throwWild(layer: Container, from: { x: number; y: number }, t: DriveByTarget, index: number, o: DriveByOpts): Promise<void> {
  const tex = o.wildTexture;
  const holder = new Container();
  layer.addChild(holder);
  const glow = new Sprite(softGlowTexture());
  glow.anchor.set(0.5);
  glow.blendMode = "add";
  glow.tint = PINK;
  glow.width = glow.height = o.cell * 1.3;
  holder.addChild(glow);
  const trail: Sprite[] = [];
  const sp = tex ? new Sprite(tex) : new Sprite(softGlowTexture());
  sp.anchor.set(0.5);
  const fit = tex ? (o.cell * 0.86) / Math.max(tex.width, tex.height) : 1;
  if (tex) for (let k = 0; k < 4; k++) {
    const ghost = new Sprite(tex);
    ghost.anchor.set(0.5);
    ghost.alpha = 0;
    ghost.tint = k % 2 ? TEAL : PINK;
    ghost.blendMode = "add";
    holder.addChild(ghost);
    trail.push(ghost);
  }
  holder.addChild(sp);
  const D = o.turbo ? 260 : 460;
  const peak = Math.min(from.y, t.y) - o.cell * (0.9 + 0.25 * (index % 2));
  const spin = (index % 2 ? -1 : 1) * Math.PI * 2 * 1.15;
  const hist: Array<{ x: number; y: number; r: number }> = [];
  await tween(D, (p) => {
    const q = 1 - p;
    const x = q * q * from.x + 2 * q * p * ((from.x + t.x) / 2) + p * p * t.x;
    const y = q * q * from.y + 2 * q * p * peak + p * p * t.y;
    const k = p < 0.6 ? 0.45 + (p / 0.6) * 0.95 : 1.4 - ((p - 0.6) / 0.4) * 0.4;
    sp.position.set(x, y);
    sp.rotation = spin * (1 - easeOutCubic(p));
    sp.scale.set(fit * k);
    glow.position.set(x, y);
    glow.alpha = 0.5 * (1 - p * 0.5);
    hist.unshift({ x, y, r: sp.rotation });
    if (hist.length > 12) hist.pop();
    trail.forEach((g, i) => {
      const h = hist[Math.min(hist.length - 1, (i + 1) * 3)];
      if (!h) return;
      g.position.set(h.x, h.y);
      g.rotation = h.r;
      g.scale.set(fit * k * (1 - i * 0.06));
      g.alpha = 0.28 * (1 - i / 4) * (1 - p * 0.6);
    });
  }, (x) => x);
  // impact
  t.land();
  o.onCue?.({ kind: "impact", index, pan: Math.max(-1, Math.min(1, (t.x / o.screenW) * 2 - 1)) });
  holder.destroy({ children: true });
  await impactFx(layer, t.x, t.y, o.cell, o.turbo);
}

async function impactFx(layer: Container, x: number, y: number, cell: number, turbo: boolean): Promise<void> {
  const fx = new Container();
  fx.position.set(x, y);
  layer.addChild(fx);
  const flash = new Sprite(softGlowTexture());
  flash.anchor.set(0.5);
  flash.blendMode = "add";
  flash.width = flash.height = cell * 1.6;
  const ring = new Graphics();
  ring.blendMode = "add";
  const sparks: Array<{ sp: Sprite; a: number; d: number }> = [];
  for (let k = 0; k < 10; k++) {
    const sp = new Sprite(k % 3 ? sparkDotTexture() : streakTexture());
    sp.anchor.set(0.5);
    sp.blendMode = "add";
    sp.tint = k % 2 ? PINK : 0xffe08a;
    const a = (k / 10) * Math.PI * 2 + Math.random() * 0.4;
    sp.rotation = a;
    sp.width = cell * 0.22; sp.height = cell * 0.07;
    sparks.push({ sp, a, d: cell * (0.55 + Math.random() * 0.35) });
    fx.addChild(sp);
  }
  fx.addChild(flash, ring);
  await tween(turbo ? 220 : 380, (p) => {
    const e = easeOutCubic(p);
    flash.alpha = (1 - p) * (1 - p);
    flash.scale.set((cell * 1.6 / 128) * (0.7 + e * 0.8));
    ring.clear();
    ring.circle(0, 0, cell * (0.3 + e * 0.6)).stroke({ color: 0xffd6e8, width: 4 * (1 - p), alpha: 1 - p });
    for (const s of sparks) {
      s.sp.position.set(Math.cos(s.a) * s.d * e, Math.sin(s.a) * s.d * e);
      s.sp.alpha = 1 - p;
    }
  }, (t) => t);
  fx.destroy({ children: true });
}

export { easeOutBack };
