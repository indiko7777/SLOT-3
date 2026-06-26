import { BlurFilter, Container, Graphics, Sprite, Text, TextStyle, Texture, TilingSprite } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type BonusCell, type Position } from "../domain";
import { getExtraTexture } from "./assets";
import { tween, wait, easeOutBack, easeOutCubic, linear, ambientTicker } from "./tween";
import type { Rect } from "./types";
import { shockwave, pulseBloom, pulseChromaticAberration } from "../vfx/Shaders";

/* ═══════════════════════════════════════════════════════════════════
   "THE GETAWAY" — POV police-chase Hold & Spin.
   Layer 1: scrolling night highway.  Layer 2: armored Brinks-truck frame.
   Layer 3: the 5x4 grid in the open truck doors — gold bars slam in and
   stick; dynamite doubles neighbours then vanishes; 5 wanted stars pulse
   ever faster as dead spins stack the heat, until a hit resets it.
   Every image has a procedural fallback so it works with no art added.
   ═══════════════════════════════════════════════════════════════════ */

const FONT = "Impact, 'Arial Black', Arial, sans-serif";
const keyOf = ([c, r]: Position): string => `${c}:${r}`;
const HEAT_PERIOD = [0.5, 0.34, 0.22, 0.12]; // seconds per red/blue pulse by heat level
// Police strobe channels — real emergency lighting: vivid red paired with blue.
const POLICE_RED = 0xff1f2e;
const POLICE_BLUE = 0x1a6bff;

// Cinematic palette — warm, filmic gold (NOT candy-neon) for the escape, cold
// gunmetal steel for the bust. Kept realistic so the pop-ups read like a GTA
// cutscene rather than an arcade machine.
const GOLD = 0xe6b24a;
const GOLD_HI = 0xf6d684;
const GOLD_DEEP = 0x6a4410;
const STEEL = 0xc7d0dc;
const STEEL_DEEP = 0x2a3340;
const INK = 0x07080c;       // near-black card body
const CINEMA_BAR = 0x050507; // letterbox bar colour

// Measured from brinks_truck_frame.webp (1024×572): the transparent door opening.
// Used to align the grid exactly inside the truck's window.
const TRUCK_OPENING = { wFrac: 0.3262, hFrac: 0.507, cxFrac: 0.5, cyFrac: 0.4441, aspect: 334 / 290 };

// Must match stake-math BONUS_RESPINS: how many respins/pips the meter shows.
const MAX_RESPINS = 4;

// Uniform dark-grey reel background. EVERY bonus symbol fills its cell with this
// exact colour and the reel panel is the same flat colour, so the symbols'
// backgrounds are invisible — during a spin you only ever see the symbol art
// move, never a background box.
const REEL_BG = 0x0c0c0f;

// Reel spin motion profile: a quick ramp to full speed, a long stretch of
// CONSTANT fast spin (so it reads as continuous, looping motion), then a smooth
// deceleration onto the stop. reelPos = 0..1 distance covered; reelVel = 0..1
// normalised speed (drives the motion blur — blurry while fast, sharp at rest).
const REEL_RAMP = 0.12;   // fraction of time spent accelerating
const REEL_HOLD = 0.6;    // fraction of time at constant top speed
const REEL_NORM = REEL_RAMP / 2 + (REEL_HOLD - REEL_RAMP) + (1 - REEL_HOLD) / 2;
function reelPos(p: number): number {
  let area: number;
  if (p < REEL_RAMP) area = (p * p) / (2 * REEL_RAMP);
  else if (p <= REEL_HOLD) area = REEL_RAMP / 2 + (p - REEL_RAMP);
  else {
    const u = (p - REEL_HOLD) / (1 - REEL_HOLD);
    area = REEL_RAMP / 2 + (REEL_HOLD - REEL_RAMP) + ((1 - REEL_HOLD) / 2) * (u + Math.sin(Math.PI * u) / Math.PI);
  }
  return area / REEL_NORM;
}
function reelVel(p: number): number {
  if (p < REEL_RAMP) return p / REEL_RAMP;
  if (p <= REEL_HOLD) return 1;
  const u = (p - REEL_HOLD) / (1 - REEL_HOLD);
  return (1 + Math.cos(Math.PI * u)) / 2;
}

function fmtX(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
}

export class BonusView extends Container {
  private readonly bgLayer = new Container();
  private readonly truckLayer = new Container();
  private readonly gridLayer = new Container();
  /** Locked (previously landed) gold bars rendered ABOVE the spinning strip so the
   *  strip's blur filter never bleeds onto or clips them. */
  private readonly lockedLayer = new Container();
  private readonly dividerLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly hudLayer = new Container();
  private readonly police = new Graphics();

  private rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;

  private highwayTile: TilingSprite | null = null;
  private highwayProc: Graphics | null = null;
  private truck: Container | null = null;
  private stars: Graphics | null = null;
  private collectedText: Text | null = null;
  private collectedShown = 0;
  private spinsBox: Container | null = null;
  private spinsText: Text | null = null;
  private spinsLabel: Text | null = null;
  private resultCard: Container | null = null;

  private heat = 0;          // 0 = baseline … 3 = max
  private busted = false;
  private respinsShown = MAX_RESPINS;   // last value shown on the meter (for the change beat)
  private isSpinning = false;           // true while reels turn — drives the anticipation shake
  private shakeBoost = 0;               // 0..1 eased ramp of the high-speed chase shake
  private readonly cells = new Map<string, Container>();

  constructor() {
    super();
    this.visible = false;
    // lockedLayer sits between gridLayer (spinning strip) and fxLayer so
    // the sticky gold bars are always drawn on top of any reel blur.
    this.addChild(this.bgLayer, this.truckLayer, this.gridLayer, this.lockedLayer, this.dividerLayer, this.fxLayer, this.police, this.hudLayer);
    // Heavy blur turns the police light sources into soft, natural bloom.
    this.police.filters = [new BlurFilter({ strength: 30, quality: 3 })];
  }

  layout(rect: Rect): void {
    this.rect = rect;
    this.position.set(rect.x, rect.y);
  }

  // ── geometry (local coords) ──────────────────────────────────────────
  /** On-screen rectangle for the grid — matches the truck opening's aspect so
   *  the frame aligns to it exactly. Wider in portrait so the doors crop away. */
  private opening(): Rect {
    const W = this.rect.width;
    const H = this.rect.height;
    const portrait = W < H;
    let ow: number;
    let oh: number;
    if (portrait) {
      ow = W * 0.9;
      oh = ow / TRUCK_OPENING.aspect;
      const maxH = H * 0.5;
      if (oh > maxH) { oh = maxH; ow = oh * TRUCK_OPENING.aspect; }
    } else {
      oh = H * 0.64;
      ow = oh * TRUCK_OPENING.aspect;
      const maxW = W * 0.5;
      if (ow > maxW) { ow = maxW; oh = ow / TRUCK_OPENING.aspect; }
    }
    const cx = W / 2;
    const cy = H * (portrait ? 0.4 : 0.46);
    return { x: cx - ow / 2, y: cy - oh / 2, width: ow, height: oh };
  }

  /** The 5×4 grid fills the opening exactly — no inner margin / background gaps. */
  private cellRect(col: number, row: number): { x: number; y: number; w: number; h: number } {
    const o = this.opening();
    const w = o.width / GRID_COLUMNS;
    const h = o.height / GRID_ROWS;
    return { x: o.x + col * w, y: o.y + row * h, w, h };
  }

  centerOf(position: Position): { x: number; y: number } {
    const r = this.cellRect(position[0], position[1]);
    return { x: this.rect.x + r.x + r.w / 2, y: this.rect.y + r.y + r.h / 2 };
  }

  // ── lifecycle ────────────────────────────────────────────────────────
  async intro(turbo: boolean): Promise<void> {
    this.visible = true;
    this.busted = false;
    this.heat = 0;
    this.collectedShown = 0;
    this.cells.clear();
    this.gridLayer.removeChildren();
    this.fxLayer.removeChildren();

    this.buildHighway();
    this.buildTruck();
    this.buildDividers();
    this.buildHud();
    this.startAmbient();
    this.scale.set(1);

    if (turbo) { this.alpha = 1; return; }

    const W = this.rect.width;
    const H = this.rect.height;

    // 1. Crossfade the chase scene in over the base game.
    this.alpha = 0;
    void tween(620, (p) => { this.alpha = p; }, easeOutCubic);

    // 2. Cinematic cold-open: letterbox bars + vignette glide in.
    const lb = this.buildLetterbox();
    const vig = this.buildVignette();
    vig.alpha = 0;
    this.hudLayer.addChildAt(vig, 0);
    void tween(620, (p) => {
      const e = easeOutCubic(p);
      lb.top.y = -lb.barH + lb.barH * e;
      lb.bot.y = H - lb.barH * e;
      vig.alpha = e * 0.85;
    }, linear);

    // 3. Distant siren wash — slow red→blue sweep across the frame (not a flash).
    const wash = new Graphics();
    this.hudLayer.addChild(wash);
    void tween(1700, (p) => {
      wash.clear();
      const r = Math.max(0, Math.sin(p * Math.PI * 2.2));
      const b = Math.max(0, Math.sin(p * Math.PI * 2.2 - Math.PI));
      wash.rect(0, 0, W, H).fill({ color: POLICE_RED, alpha: r * 0.10 * (1 - p) });
      wash.rect(0, 0, W, H).fill({ color: POLICE_BLUE, alpha: b * 0.10 * (1 - p) });
    }).then(() => wash.destroy());

    // 4. The title group. A radio-dispatch kicker, then "THE GETAWAY" with a
    //    slow camera PUSH (no arcade bounce) and a headlight sweep behind it.
    const card = new Container();
    card.position.set(W / 2, H * 0.42);
    this.hudLayer.addChild(card);

    const theSize = Math.min(30, W / 30);
    const bigSize = Math.min(92, W / 9.2);

    // soft headlight that slides behind the title once
    const beam = new Graphics();
    beam.ellipse(0, bigSize * 0.5, bigSize * 1.4, bigSize * 0.7).fill({ color: 0xfff0cf, alpha: 0.16 });
    beam.filters = [new BlurFilter({ strength: 26, quality: 2 })];
    beam.x = -W * 0.5;
    card.addChild(beam);

    const kicker = new Text({ text: "DISPATCH · ALL UNITS — SUSPECT FLEEING", style: new TextStyle({ fill: 0x9fb4d0, fontFamily: FONT, fontSize: Math.min(14, W / 60), fontWeight: "400", letterSpacing: 4 }) });
    kicker.anchor.set(0.5, 1);
    kicker.position.set(0, -theSize * 1.5);
    const the = new Text({ text: "THE", style: new TextStyle({ fill: 0xffffff, fontFamily: FONT, fontSize: theSize, fontWeight: "900", letterSpacing: 12, dropShadow: { color: 0x000000, alpha: 0.7, blur: 6, distance: 0, angle: 0 } }) });
    the.anchor.set(0.5, 1);
    the.position.set(0, -theSize * 0.2);
    const big = new Text({ text: "GETAWAY", style: new TextStyle({ fill: GOLD_HI, fontFamily: FONT, fontSize: bigSize, fontWeight: "900", letterSpacing: 6, stroke: { color: GOLD_DEEP, width: 6 }, dropShadow: { color: 0x000000, alpha: 0.55, blur: 8, distance: 3, angle: Math.PI / 2 } }) });
    big.anchor.set(0.5, 0);
    big.position.set(0, -theSize * 0.05);
    // thin gold rule drawn under the title
    const rule = new Graphics();
    rule.position.set(0, bigSize * 1.06);
    card.addChild(kicker, the, big, rule);

    card.alpha = 0;
    card.scale.set(1.06);
    await tween(640, (p) => {
      const e = easeOutCubic(p);
      card.alpha = Math.min(1, p * 2.2);
      card.scale.set(1.06 - 0.06 * e);           // slow push IN, no overshoot
      card.y = H * 0.42 - 10 * (1 - e);
      beam.x = -W * 0.5 + W * e;                  // headlight sweeps across
      const rw = bigSize * 4.4 * e;
      rule.clear();
      rule.rect(-rw / 2, 0, rw, 2).fill({ color: GOLD, alpha: 0.85 });
    }, linear);
    card.scale.set(1);
    card.alpha = 1;

    await wait(900); // hold the title

    // 5. Title drifts up + fades; letterbox & vignette retract to reveal the reel.
    await tween(560, (p) => {
      const e = easeOutCubic(p);
      card.y = H * 0.42 - 36 * e;
      card.alpha = 1 - e;
      lb.top.y = -lb.barH * e;
      lb.bot.y = H - lb.barH * (1 - e);
      vig.alpha = (1 - e) * 0.85;
    }, linear);
    card.destroy();
    lb.top.destroy();
    lb.bot.destroy();
    vig.destroy();
    this.alpha = 1;
  }

  /** Smoothly fade the whole bonus out, then tear it down (used at round end). */
  async fadeOutAndHide(turbo: boolean): Promise<void> {
    if (turbo) { this.hide(); this.alpha = 1; return; }
    await tween(560, (p) => { this.alpha = 1 - p; }, easeOutCubic);
    this.hide();
    this.alpha = 1;
  }

  /** Draw the current grid with no animation (used when resuming a round). */
  showStatic(grid: BonusCell[][]): void {
    this.visible = true;
    if (!this.truck) { this.buildHighway(); this.buildTruck(); this.buildDividers(); this.buildHud(); this.startAmbient(); }
    this.gridLayer.removeChildren();
    this.cells.clear();
    const logoTex = getExtraTexture("heat_chase_logo");
    for (let c = 0; c < GRID_COLUMNS; c++)
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        if (cell.symbol === "SAFE") this.placeCell([c, r], this.buildGoldBar(cell.value ?? 0, c, r));
        else if (cell.symbol === "MASTER_KEY") this.placeCell([c, r], this.buildDynamite(c, r));
        else this.placeCell([c, r], this.buildEmptyFace(c, r, logoTex)); // resting watermark — logos never just vanish
      }
    this.setCollected(this.sumGrid(grid), false);
  }

  async playSpin(grid: BonusCell[][], landed: Position[], respins: number, deadSpins: number, turbo: boolean, onLand?: (i: number, n: number) => void): Promise<void> {
    if (!this.truck) await this.intro(turbo);
    this.visible = true;

    const landedSet = new Set(landed.map(keyOf));

    // Clear the spinning layer; rebuild locked bars into lockedLayer so they
    // always render ABOVE the spinning strip (prevents blur/clip artefacts).
    this.gridLayer.removeChildren();
    this.lockedLayer.removeChildren();
    this.cells.clear();
    const spinning: Position[] = [];
    for (let c = 0; c < GRID_COLUMNS; c++)
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        const prevLocked = cell.symbol === "SAFE" && !landedSet.has(keyOf([c, r]));
        if (prevLocked) {
          // Place in lockedLayer so the spinning strip behind it is never clipped.
          const node = this.buildGoldBar(cell.value ?? 0, c, r);
          const rc = this.cellRect(c, r);
          node.position.set(rc.x + rc.w / 2, rc.y + rc.h / 2);
          this.lockedLayer.addChild(node);
          this.cells.set(keyOf([c, r]), node);
        } else {
          spinning.push([c, r]);
        }
      }

    // Normal reel spin: open cells spin and STOP on their result, which sticks.
    await this.spinColumns(grid, spinning, turbo, onLand);

    // Count up any gold just collected (bottom-centre, away from the meter).
    this.setCollected(this.sumGrid(grid), true);

    // Resolve the respin meter AFTER the spin, as its OWN deliberate beat — the
    // reel settles first, THEN the player watches the spins count change. The
    // counter just rolls cleanly up/down (no floating callouts, no pips).
    if (landed.length > 0) {
      this.heat = 0;
      this.hitFlash();
      await wait(turbo ? 50 : 240);
      this.animateSpinsBeat(respins, true, turbo);
      await wait(turbo ? 80 : 640);
    } else {
      this.heat = Math.min(3, deadSpins);
      this.deadSpinBeat();
      await wait(turbo ? 50 : 300);
      this.animateSpinsBeat(respins, false, turbo);
      await wait(turbo ? 80 : 680);
    }
  }

  /** Dynamite detonates: shockwave over neighbours, double them, then vanish. */
  async crack(keyPos: Position, affected: Array<{ position: Position; newValue: number }>, turbo: boolean): Promise<void> {
    const kc = this.cellRect(keyPos[0], keyPos[1]);
    const cx = kc.x + kc.w / 2;
    const cy = kc.y + kc.h / 2;
    const reach = Math.max(kc.w, kc.h);
    const dyn = this.cells.get(keyOf(keyPos));

    // Highest multiplier of affected safes
    const maxVal = affected.reduce((max, a) => Math.max(max, a.newValue), 1);

    // Dynamic scale of the explosion based on multiplier
    const explosionRadius = reach * (1.8 + Math.min(3.5, maxVal * 0.04));

    // Screen thud/shake scaling with max multiplier
    const shakeIntensity = 12 + Math.min(28, maxVal * 0.6);
    const shakeDuration = turbo ? 220 : 450 + Math.min(350, maxVal * 6);
    const origX = this.x;
    const origY = this.y;
    const shakePromise = tween(shakeDuration, (p) => {
      const decay = Math.exp(-p * 4.5);
      const dx = Math.sin(p * Math.PI * 8) * shakeIntensity * decay;
      const dy = Math.cos(p * Math.PI * 7) * shakeIntensity * decay * 0.8;
      this.x = origX + dx;
      this.y = origY + dy;
    }, linear).then(() => {
      this.x = origX;
      this.y = origY;
    });

    // Radial GPU shockwave ripple
    void shockwave(this.fxLayer, { x: cx, y: cy }, { duration: turbo ? 400 : 800 });

    // Procedural color interpolation helper
    const lerpColor = (c1: number, c2: number, t: number): number => {
      const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
      const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      return (r << 16) | (g << 8) | b;
    };

    const getExplosionColor = (progress: number): number => {
      if (progress < 0.15) {
        return lerpColor(0xffffff, 0xffea00, progress / 0.15);
      } else if (progress < 0.45) {
        return lerpColor(0xffea00, 0xff5500, (progress - 0.15) / 0.3);
      } else if (progress < 0.75) {
        return lerpColor(0xff5500, 0x444444, (progress - 0.45) / 0.3);
      } else {
        return lerpColor(0x444444, 0x111111, (progress - 0.75) / 0.25);
      }
    };

    const drawFireball = (g: Graphics, r: number, color: number, alphaScale: number) => {
      g.clear();
      g.circle(0, 0, r).fill({ color, alpha: 0.12 * alphaScale });
      g.circle(0, 0, r * 0.65).fill({ color, alpha: 0.35 * alphaScale });
      g.circle(0, 0, r * 0.35).fill({ color, alpha: 0.85 * alphaScale });
    };

    // Full screen blast overlay
    const blastFlash = new Graphics();
    blastFlash.rect(0, 0, this.rect.width, this.rect.height).fill({ color: 0xffaa00, alpha: 0.75 });
    this.fxLayer.addChild(blastFlash);

    // Layered particles setup
    interface ExplosionParticle {
      g: Graphics;
      vx: number;
      vy: number;
      size: number;
      rotSpeed: number;
      type: "fire" | "debris";
      driftY: number;
      maxScale: number;
    }

    const particles: ExplosionParticle[] = [];
    const numParticles = turbo ? 10 : 26 + Math.min(24, maxVal * 0.5);

    for (let i = 0; i < numParticles; i++) {
      const g = new Graphics();
      this.fxLayer.addChild(g);
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.25 + Math.random() * 0.75) * explosionRadius;
      const size = 14 + Math.random() * 22;
      particles.push({
        g,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size,
        rotSpeed: (Math.random() - 0.5) * 5,
        type: Math.random() < 0.75 ? "fire" : "debris",
        driftY: -(18 + Math.random() * 28),
        maxScale: 1.1 + Math.random() * 1.6
      });
    }

    const duration = turbo ? 260 : 650 + Math.min(350, maxVal * 4);

    await Promise.all([
      shakePromise,
      tween(duration, (p) => {
        // Flash fades quickly
        blastFlash.alpha = Math.max(0, (1 - p * 2.8) * 0.75);

        particles.forEach((pt) => {
          const x = cx + pt.vx * p;
          const y = cy + pt.vy * p + (pt.type === "fire" ? pt.driftY * p : 80 * p * p);
          pt.g.position.set(x, y);
          pt.g.rotation += pt.rotSpeed * 0.016;

          if (pt.type === "fire") {
            const color = getExplosionColor(p);
            const currentSize = pt.size * (0.35 + (pt.maxScale - 0.35) * Math.sin(p * Math.PI * 0.5));
            const alpha = p < 0.12 ? p / 0.12 : (1 - p) * 1.15;
            drawFireball(pt.g, currentSize, color, Math.max(0, Math.min(1, alpha)));
          } else {
            pt.g.clear();
            const shardSize = pt.size * 0.38 * (1 - p * 0.5);
            pt.g.poly([
              0, -shardSize,
              shardSize * 0.6, -shardSize * 0.2,
              shardSize * 0.4, shardSize * 0.5,
              -shardSize * 0.4, shardSize * 0.3,
            ]).fill({ color: p < 0.3 ? 0xffcc00 : 0x222222, alpha: 1 - p });
          }
        });

        if (dyn) {
          dyn.scale.set(1 + p * 0.8);
          dyn.alpha = Math.max(0, 1 - p * 3);
        }
      }, easeOutCubic)
    ]);

    blastFlash.destroy();
    particles.forEach((pt) => pt.g.destroy());
    if (dyn) {
      this.cells.delete(keyOf(keyPos));
      dyn.destroy();
    }

    // Double each neighbour — clear "×2" badge + a punch + a gold flash so the
    // upgrade is unmistakable.
    for (const a of affected) {
      const nc = this.cellRect(a.position[0], a.position[1]);
      const node = this.cells.get(keyOf(a.position));
      if (node) {
        this.updateGoldValue(node, a.newValue);
        const num = node.getChildByLabel("num") as Text | null;
        void tween(turbo ? 180 : 380, (p) => { const s = 1 + Math.sin(Math.min(1, p) * Math.PI) * 0.4; node.scale.set(s); if (num) num.scale.set(s); }).then(() => { node.scale.set(1); if (num) num.scale.set(1); });
        const cf = new Graphics(); this.fxLayer.addChild(cf);
        void tween(turbo ? 160 : 360, (p) => { cf.clear(); cf.circle(nc.x + nc.w / 2, nc.y + nc.h / 2, Math.max(nc.w, nc.h) * 0.55 * (1 + p * 0.4)).fill({ color: 0xffd95c, alpha: (1 - p) * 0.5 }); }).then(() => cf.destroy());
      }
      this.floatBadge(nc.x + nc.w / 2, nc.y + nc.h * 0.2, "×2");
    }
    await wait(turbo ? 80 : 280);
  }

  /** A floating "×2" badge that pops up and fades. */
  private floatBadge(x: number, y: number, text: string): void {
    const c = new Container();
    c.position.set(x, y);
    const g = new Graphics();
    g.roundRect(-30, -18, 60, 36, 9).fill({ color: 0x1a6bff, alpha: 0.96 });
    g.roundRect(-30, -18, 60, 36, 9).stroke({ color: 0xffffff, width: 2.5, alpha: 0.9 });
    c.addChild(g);
    const t = new Text({ text, style: new TextStyle({ fill: 0xffffff, fontFamily: FONT, fontSize: 24, fontWeight: "900", letterSpacing: 1 }) });
    t.anchor.set(0.5);
    c.addChild(t);
    this.fxLayer.addChild(c);
    c.alpha = 0;
    void tween(800, (p) => {
      c.y = y - 46 * p;
      c.alpha = p < 0.18 ? p / 0.18 : 1 - (p - 0.18) / 0.82;
      c.scale.set(0.4 + 0.6 * Math.min(1, p * 3.5));
    }).then(() => c.destroy());
  }

  /** End of the chase. filled = Grand Escape jackpot; otherwise Busted.
   *  A big, dramatic result card with the win amount that stays up until the
   *  player taps/clicks — the bonus never auto-dismisses. */
  async finish(filled: boolean, totalX: number, turbo: boolean): Promise<void> {
    const W = this.rect.width;
    const H = this.rect.height;

    // Cinematic outro framing — vignette behind, dim, rays, card, letterbox on top.
    const vig = this.buildVignette();
    vig.alpha = 0;
    this.hudLayer.addChild(vig);

    // The bust desaturates the world with a cold slate; the escape goes near-black
    // so the warm gold pops.
    const dim = new Graphics();
    dim.rect(0, 0, W, H).fill({ color: filled ? 0x000000 : 0x0a0d14, alpha: 1 });
    dim.alpha = 0;
    this.hudLayer.addChild(dim);

    // Only the triumphant escape gets a sunburst; the bust stays grim.
    const rays = filled ? this.buildResultRays(true) : null;
    if (rays) this.hudLayer.addChild(rays);

    // Kick off the signature sequence behind the card.
    if (filled) { void this.grandEscape(turbo); }
    else { this.busted = true; this.heat = 3; void this.bustedSequence(turbo); }

    const card = this.buildResultCard(filled);
    this.hudLayer.addChild(card);
    this.resultCard = card;

    const lb = this.buildLetterbox();

    card.scale.set(1.08);
    card.alpha = 0;
    // Slow, weighty settle — a camera push, never an arcade bounce.
    await tween(turbo ? 300 : 760, (p) => {
      const e = easeOutCubic(p);
      dim.alpha = e * (filled ? 0.74 : 0.84);
      vig.alpha = e * 0.9;
      if (rays) rays.alpha = e * 0.85;
      lb.top.y = -lb.barH + lb.barH * e;
      lb.bot.y = H - lb.barH * e;
      card.alpha = Math.min(1, p * 2.2);
      card.scale.set(1.08 - 0.08 * e);
    }, linear);
    card.scale.set(1);
    card.alpha = 1;

    // Count the win amount up — big and central.
    const payout = card.getChildByLabel("payout") as Text | null;
    if (payout) await this.countUp(payout, totalX, turbo);
    this.setCollected(totalX, false);

    // Keep it alive: slowly rotate the rays, pulse the amount + the tap hint,
    // until the player acknowledges the win.
    const hint = card.getChildByLabel("hint") as Text | null;
    const baseRot = rays ? rays.rotation : 0;
    const idle = (_dt: number, elapsed: number): void => {
      if (rays) rays.rotation = baseRot + elapsed * 0.12;
      if (payout) payout.scale.set(1 + Math.sin(elapsed * 2) * 0.022);
      if (hint) hint.alpha = 0.4 + 0.45 * Math.abs(Math.sin(elapsed * 2.2));
    };
    ambientTicker.add(idle);

    // Stay up until the player taps/clicks — NEVER auto-dismiss.
    await this.waitForDismiss();

    ambientTicker.remove(idle);
    // A small acknowledge pop on tap before the round_end fade takes over.
    await tween(turbo ? 120 : 200, (p) => { card.scale.set(1 + 0.05 * Math.sin(p * Math.PI)); });
    card.scale.set(1);
  }

  // ── cinematic helpers (shared by intro + finish) ─────────────────────
  /**
   * Letterbox bars (top + bottom) — the single biggest "this is a movie cutscene"
   * cue. Returns the two bars plus their height so the caller can slide them in/out.
   * They start fully off-screen.
   */
  private buildLetterbox(): { top: Graphics; bot: Graphics; barH: number } {
    const W = this.rect.width;
    const H = this.rect.height;
    const barH = Math.round(H * 0.114);
    const top = new Graphics();
    top.rect(0, 0, W, barH).fill(CINEMA_BAR);
    // a hairline highlight along the inner edge sells it as a physical bar
    top.rect(0, barH - 1.5, W, 1.5).fill({ color: 0xffffff, alpha: 0.05 });
    top.y = -barH;
    const bot = new Graphics();
    bot.rect(0, 0, W, barH).fill(CINEMA_BAR);
    bot.rect(0, 0, W, 1.5).fill({ color: 0xffffff, alpha: 0.05 });
    bot.y = H;
    this.hudLayer.addChild(top, bot);
    return { top, bot, barH };
  }

  /** Soft filmic vignette — a blurred dark frame with a clear centre. Static; the
   *  caller animates its container alpha. */
  private buildVignette(): Graphics {
    const W = this.rect.width;
    const H = this.rect.height;
    const g = new Graphics();
    g.rect(-W * 0.1, -H * 0.1, W * 1.2, H * 1.2).fill({ color: 0x000000, alpha: 0.92 });
    // punch a soft hole in the middle; the blur turns the hard cut into a gradient
    g.ellipse(W / 2, H * 0.46, W * 0.6, H * 0.56).cut();
    g.filters = [new BlurFilter({ strength: Math.max(28, Math.min(W, H) * 0.07), quality: 3 })];
    return g;
  }

  /**
   * Cinematic cash-rain for the Grand Escape — realistic falling bank notes and
   * gold coins with gravity + sway, NOT arcade confetti squares. Fire-and-forget;
   * cleans itself up.
   */
  private cashRain(turbo: boolean): void {
    const W = this.rect.width;
    const H = this.rect.height;
    const n = turbo ? 26 : 64;
    const notes: Array<{ g: Graphics; x0: number; vy: number; swayAmp: number; swayFreq: number; phase: number; spin: number; rot: number; isCoin: boolean }> = [];
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const isCoin = Math.random() < 0.28;
      if (isCoin) {
        const s = 7 + Math.random() * 6;
        g.circle(0, 0, s).fill(GOLD);
        g.circle(0, 0, s * 0.66).fill(GOLD_HI);
        g.circle(-s * 0.22, -s * 0.22, s * 0.22).fill({ color: 0xffffff, alpha: 0.55 });
      } else {
        const w = 30 + Math.random() * 18;
        const h = w * 0.46;
        // a bank note: muted green with a gold band + dark frame (realistic, not neon)
        g.roundRect(-w / 2, -h / 2, w, h, 2).fill(0x2f6f4e);
        g.roundRect(-w / 2, -h / 2, w, h, 2).stroke({ color: 0x16331f, width: 1, alpha: 0.7 });
        g.circle(0, 0, h * 0.3).fill({ color: 0xdfe9c8, alpha: 0.5 });
        g.rect(-w / 2 + 2, -h / 2 + 2, 3, h - 4).fill({ color: GOLD, alpha: 0.55 });
      }
      const x0 = Math.random() * W;
      g.position.set(x0, -40 - Math.random() * H * 0.5);
      g.rotation = Math.random() * Math.PI;
      this.fxLayer.addChild(g);
      notes.push({
        g, x0,
        vy: H * (0.42 + Math.random() * 0.34),
        swayAmp: 18 + Math.random() * 34,
        swayFreq: 1.2 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 4,
        rot: g.rotation,
        isCoin
      });
    }
    let elapsed = 0;
    const dur = turbo ? 1.0 : 2.6;
    const cb = (dt: number): void => {
      elapsed += dt;
      const k = elapsed / dur;
      for (const p of notes) {
        const y = p.g.y + p.vy * dt;
        p.g.y = y;
        p.g.x = p.x0 + Math.sin(elapsed * p.swayFreq + p.phase) * p.swayAmp;
        p.rot += p.spin * dt;
        p.g.rotation = p.rot;
        // fade the last 25% out, and once past the bottom
        if (y > H + 30 || k > 1) p.g.alpha = Math.max(0, p.g.alpha - dt * 1.4);
        else if (k > 0.75) p.g.alpha = Math.max(0, 1 - (k - 0.75) / 0.25);
      }
      if (k >= 1.2) {
        ambientTicker.remove(cb);
        notes.forEach((p) => p.g.destroy());
      }
    };
    ambientTicker.add(cb);
  }

  /** Soft volumetric sunburst behind the result card — blurred light shafts, not
   *  flat triangles, so it reads as god-rays rather than a cartoon star. */
  private buildResultRays(filled: boolean): Container {
    const c = new Container();
    c.position.set(this.rect.width / 2, this.rect.height * 0.46);
    const g = new Graphics();
    const color = filled ? GOLD : 0xff6a00;
    const R = Math.max(this.rect.width, this.rect.height) * 1.15;
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const spread = (Math.PI * 2 / n) * 0.3;
      g.moveTo(0, 0)
        .lineTo(Math.cos(a0 - spread) * R, Math.sin(a0 - spread) * R)
        .lineTo(Math.cos(a0 + spread) * R, Math.sin(a0 + spread) * R)
        .fill({ color, alpha: 0.06 });
    }
    g.filters = [new BlurFilter({ strength: 12, quality: 2 })];
    c.addChild(g);
    c.alpha = 0;
    return c;
  }

  /** Resolve once the player clicks/taps anywhere — used to dismiss the result. */
  private waitForDismiss(): Promise<void> {
    return new Promise((resolve) => {
      const onDown = (): void => { window.removeEventListener("pointerdown", onDown); resolve(); };
      window.addEventListener("pointerdown", onDown);
    });
  }

  private async countUp(text: Text, target: number, turbo: boolean): Promise<void> {
    await tween(turbo ? 250 : 700, (p) => {
      text.text = fmtX(target * p);
      text.scale.set(1 + Math.sin(p * Math.PI) * 0.12);
    }, easeOutCubic);
    text.text = fmtX(target);
    text.scale.set(1);
  }

  private buildResultCard(filled: boolean): Container {
    const W = this.rect.width;
    const H = this.rect.height;
    const c = new Container();
    c.position.set(W / 2, H * 0.46);
    const accent = filled ? GOLD : STEEL;
    const accentDeep = filled ? GOLD_DEEP : STEEL_DEEP;
    const pw = Math.min(W * 0.82, 700);
    const ph = Math.min(H * 0.56, 400);

    // Premium dark-glass slab — soft shadow, near-black body, top sheen, a hairline
    // inner bevel and a thin accent frame. No thick candy outline.
    const g = new Graphics();
    g.roundRect(-pw / 2 - 10, -ph / 2 - 4, pw + 20, ph + 24, 26).fill({ color: 0x000000, alpha: 0.55 });
    g.roundRect(-pw / 2, -ph / 2, pw, ph, 20).fill({ color: INK, alpha: 0.97 });
    g.roundRect(-pw / 2, -ph / 2, pw, ph * 0.44, 20).fill({ color: 0xffffff, alpha: 0.035 });
    g.roundRect(-pw / 2 + 4, -ph / 2 + 4, pw - 8, ph - 8, 16).stroke({ color: 0xffffff, width: 1, alpha: 0.08 });
    g.roundRect(-pw / 2, -ph / 2, pw, ph, 20).stroke({ color: accent, width: 2, alpha: 0.9 });
    // small header tab rule
    g.roundRect(-pw * 0.14, -ph / 2 + 14, pw * 0.28, 3, 2).fill({ color: accent, alpha: 0.85 });
    c.addChild(g);

    const title = new Text({
      text: filled ? "GRAND ESCAPE" : "BUSTED",
      style: new TextStyle({ fill: filled ? GOLD_HI : STEEL, fontFamily: FONT, fontSize: Math.min(70, pw / 8.5), fontWeight: "900", letterSpacing: filled ? 3 : 9, stroke: { color: accentDeep, width: 5 }, dropShadow: { color: filled ? 0x000000 : 0x3a0a0a, alpha: 0.6, blur: 12, distance: 2, angle: Math.PI / 2 } })
    });
    title.anchor.set(0.5);
    title.position.set(0, -ph * 0.28);
    c.addChild(title);

    const sub = new Text({ text: filled ? "CLEAN GETAWAY · TOTAL HAUL" : "TAKEN DOWN · FINAL TAKE", style: new TextStyle({ fill: 0x9fb4d0, fontFamily: FONT, fontSize: Math.min(18, pw / 30), letterSpacing: 4 }) });
    sub.anchor.set(0.5);
    sub.position.set(0, -ph * 0.05);
    c.addChild(sub);

    // hairline divider between the label and the haul
    const rule = new Graphics();
    rule.rect(-pw * 0.28, 0, pw * 0.56, 1).fill({ color: accent, alpha: 0.28 });
    rule.position.set(0, ph * 0.02);
    c.addChild(rule);

    const payout = new Text({
      text: "0x",
      style: new TextStyle({ fill: filled ? GOLD_HI : 0xd8c08a, fontFamily: FONT, fontSize: Math.min(104, pw / 5.4), fontWeight: "900", letterSpacing: 1, stroke: { color: accentDeep, width: 7 }, dropShadow: { color: 0x000000, alpha: 0.6, blur: 10, distance: 2, angle: Math.PI / 2 } })
    });
    payout.anchor.set(0.5);
    payout.position.set(0, ph * 0.22);
    payout.label = "payout";
    c.addChild(payout);

    const hint = new Text({ text: "TAP TO CONTINUE", style: new TextStyle({ fill: 0xffffff, fontFamily: FONT, fontSize: Math.min(17, pw / 32), letterSpacing: 3 }) });
    hint.anchor.set(0.5);
    hint.position.set(0, ph * 0.43);
    hint.alpha = 0.55;
    hint.label = "hint";
    c.addChild(hint);
    return c;
  }

  hide(): void {
    this.visible = false;
    this.stopAmbient();
    this.gridLayer.removeChildren();
    this.lockedLayer.removeChildren();
    this.dividerLayer.removeChildren();
    this.fxLayer.removeChildren();
    this.hudLayer.removeChildren();
    this.truckLayer.removeChildren();
    this.bgLayer.removeChildren();
    this.cells.clear();
    this.highwayTile = this.highwayProc = null;
    this.truck = this.stars = null;
    this.collectedText = this.spinsLabel = this.spinsText = null;
    this.spinsBox = null;
    this.resultCard = null;
  }

  // ── layer builders ───────────────────────────────────────────────────
  private buildHighway(): void {
    this.bgLayer.removeChildren();
    // Static near-black backdrop (covered by the truck + reel panel anyway).
    const g = new Graphics();
    g.rect(0, 0, this.rect.width, this.rect.height).fill(0x03040a);
    this.bgLayer.addChild(g);
    this.highwayTile = null;
    this.highwayProc = null;
  }

  private buildTruck(): void {
    this.truckLayer.removeChildren();
    const tex = getExtraTexture("brinks_truck_frame");
    const truck = new Container();
    if (tex) {
      // Scale & place the truck so its door opening lands exactly on opening().
      const o = this.opening();
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const scale = o.width / (TRUCK_OPENING.wFrac * tex.width);
      sprite.scale.set(scale);
      const truckH = tex.height * scale;
      sprite.position.set(
        o.x + o.width / 2,
        o.y + o.height / 2 - (TRUCK_OPENING.cyFrac - 0.5) * truckH
      );
      truck.addChild(sprite);
    } else {
      truck.addChild(this.procTruck());
    }

    // ONE flat, uniform reel surface inside the opening (overscanned a few px to
    // cover any truck-interior bleed). No vignette bands, no grid separators — it
    // is the exact same colour every symbol uses for its cell background, so the
    // backgrounds vanish and only the symbol art is ever seen scrolling.
    const o = this.opening();
    const pad = 6;
    const panel = new Graphics();
    panel.rect(o.x - pad, o.y - pad, o.width + pad * 2, o.height + pad * 2).fill({ color: REEL_BG });
    truck.addChild(panel);

    this.truckLayer.addChild(truck);
    this.truck = truck;
  }

  private buildDividers(): void {
    this.dividerLayer.removeChildren();
    const o = this.opening();
    const w = o.width / GRID_COLUMNS;
    const g = new Graphics();
    
    // Draw 4 vertical column delimiters for a premium slot grid look.
    // They extend vertically across the full reel window.
    for (let c = 1; c < GRID_COLUMNS; c++) {
      const x = o.x + c * w;
      
      // Main dark steel core line
      g.moveTo(x, o.y)
       .lineTo(x, o.y + o.height)
       .stroke({ color: 0x1d212b, width: 2, alpha: 0.85 });
      
      // Soft light-catching highlight (left edge) to give a fine 3D bevel look
      g.moveTo(x - 1, o.y)
       .lineTo(x - 1, o.y + o.height)
       .stroke({ color: 0xffffff, width: 1, alpha: 0.12 });
    }
    
    this.dividerLayer.addChild(g);
  }

  /** Procedural armored-truck frame: steel border with a transparent door window. */
  private procTruck(): Graphics {
    const W = this.rect.width;
    const H = this.rect.height;
    const o = this.opening();
    const g = new Graphics();
    // steel body filling the screen, with the door opening punched out (drawn as a frame)
    g.rect(0, 0, W, H).fill(0x1b1f27);
    g.rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.15 });
    // rivet seams
    for (let x = 0; x < W; x += 46) g.rect(x, 0, 2, H).fill({ color: 0x000000, alpha: 0.18 });
    // the opening: punch a hole by drawing the surrounding frame only
    const pad = 14;
    g.roundRect(o.x - pad, o.y - pad, o.width + pad * 2, o.height + pad * 2, 10)
      .fill({ color: 0x000000, alpha: 1 });
    // gold-trimmed door edges
    g.roundRect(o.x - pad, o.y - pad, o.width + pad * 2, o.height + pad * 2, 10)
      .stroke({ color: 0xffd95c, width: 4, alpha: 0.7 });
    // big door panels left/right with brake-light glow
    g.rect(0, H * 0.12, W * 0.16, H * 0.76).fill({ color: 0x23282f, alpha: 0.9 });
    g.rect(W * 0.84, H * 0.12, W * 0.16, H * 0.76).fill({ color: 0x23282f, alpha: 0.9 });
    g.rect(W * 0.155, H * 0.45, 4, H * 0.1).fill({ color: 0xffb000, alpha: 0.6 });
    g.rect(W * 0.84, H * 0.45, 4, H * 0.1).fill({ color: 0xffb000, alpha: 0.6 });
    // CRITICAL: clear the opening interior so the highway shows through
    g.roundRect(o.x, o.y, o.width, o.height, 6).cut();
    return g;
  }

  private buildHud(): void {
    this.hudLayer.removeChildren();
    const W = this.rect.width;
    const H = this.rect.height;

    // Small kicker title at the very top
    const title = new Text({
      text: "THE GETAWAY",
      style: new TextStyle({ fill: 0xffd95c, fontFamily: FONT, fontSize: Math.min(20, W / 38), fontWeight: "900", letterSpacing: 5, dropShadow: { color: 0xff6a00, alpha: 0.6, blur: 12, distance: 0, angle: 0 } })
    });
    title.anchor.set(0.5, 0);
    title.position.set(W / 2, H * 0.022);
    this.hudLayer.addChild(title);

    // 5 wanted stars, prominently below the title (drawn each frame in drawStars)
    const stars = new Graphics();
    this.hudLayer.addChild(stars);
    this.stars = stars;

    // SPINS LEFT number, top-right — refills on a hit, drops on a dead spin
    // (with "SPINS RESET" / "-1 SPIN" callouts so the up/down is clear).
    const box = new Container();
    box.position.set(W * 0.88, H * 0.04);
    this.hudLayer.addChild(box);
    this.spinsBox = box;
    const sLabel = new Text({ text: "SPINS LEFT", style: new TextStyle({ fill: 0x9fb4d0, fontFamily: FONT, fontSize: 13, letterSpacing: 2 }) });
    sLabel.anchor.set(0.5, 0);
    sLabel.position.set(0, 0);
    box.addChild(sLabel);
    this.spinsLabel = sLabel;
    const sVal = new Text({ text: `${MAX_RESPINS}`, style: new TextStyle({ fill: 0xffd95c, fontFamily: FONT, fontSize: Math.min(56, W / 14), fontWeight: "900", dropShadow: { color: 0xff6a00, alpha: 0.6, blur: 8, distance: 0, angle: 0 } }) });
    sVal.anchor.set(0.5, 0);
    sVal.position.set(0, 16);
    box.addChild(sVal);
    this.spinsText = sVal;

    this.setSpins(MAX_RESPINS);

    // COLLECTED total, bottom-centre
    const label = new Text({ text: "COLLECTED", style: new TextStyle({ fill: 0x9fb4d0, fontFamily: FONT, fontSize: 13, letterSpacing: 3 }) });
    label.anchor.set(0.5, 1);
    label.position.set(W / 2, H * 0.905);
    this.hudLayer.addChild(label);
    const val = new Text({ text: "0x", style: new TextStyle({ fill: 0xffd95c, fontFamily: FONT, fontSize: Math.min(46, W / 16), fontWeight: "900", letterSpacing: 1, dropShadow: { color: 0xff6a00, alpha: 0.7, blur: 10, distance: 0, angle: 0 } }) });
    val.anchor.set(0.5, 0);
    val.position.set(W / 2, H * 0.905);
    this.hudLayer.addChild(val);
    this.collectedText = val;
  }

  private setSpins(n: number): void {
    if (!this.spinsText || !this.spinsLabel) return;
    const v = Math.max(0, n);
    this.respinsShown = v;
    this.spinsText.text = `${v}`;
    const low = v <= 1;
    this.spinsText.style.fill = low ? 0xffb000 : 0xffd95c;
    this.spinsLabel.text = v === 1 ? "LAST SPIN!" : "SPINS LEFT";
    this.spinsLabel.style.fill = low ? 0xffb000 : 0x9fb4d0;
  }

  /**
   * The respin meter changes after a spin — shown as ONE smooth, readable beat:
   * the old number rolls away while the new one drops/punches into place. No
   * floating "+1/−1" text and no pips (removed per request) — just the counter
   * cleanly updating. Turbo snaps instantly.
   *   reset=true  → a hit refilled the spins (punch up to full)
   *   reset=false → a dead spin spent one     (roll down one)
   */
  private animateSpinsBeat(to: number, reset: boolean, turbo: boolean): void {
    const sv = this.spinsText;
    const box = this.spinsBox;
    if (!sv || !box) { this.setSpins(to); return; }
    if (turbo) { this.setSpins(to); return; }

    const baseY = sv.y;
    // Ghost the OLD number (captured before setSpins overwrites it) so the change
    // is a visible transition, never a jump.
    const ghost = new Text({ text: sv.text, style: sv.style.clone() });
    ghost.anchor.set(0.5, 0);
    ghost.position.set(sv.x, baseY);
    box.addChildAt(ghost, box.getChildIndex(sv));

    this.setSpins(to);
    sv.alpha = 0;

    if (reset) {
      // Hit: the new (full) number pops up into place; the box gives a soft punch.
      sv.scale.set(0.55);
      void tween(620, (p) => {
        ghost.alpha = (1 - p) * 0.7;
        ghost.y = baseY - 14 * p;
        sv.alpha = Math.min(1, p * 2);
        sv.scale.set(0.55 + 0.45 * easeOutBack(Math.min(1, p * 1.15)));
      }).then(() => { ghost.destroy(); sv.alpha = 1; sv.scale.set(1); });
      void tween(600, (p) => box.scale.set(1 + Math.sin(Math.min(1, p) * Math.PI) * 0.16)).then(() => box.scale.set(1));
    } else {
      // Dead spin: old number falls away, new number drops in from above (a clean tick-down).
      void tween(540, (p) => {
        ghost.alpha = 1 - p;
        ghost.y = baseY + 22 * p;
        ghost.scale.set(1 - 0.18 * p);
        sv.alpha = Math.min(1, p * 1.9);
        sv.y = baseY - 20 * (1 - easeOutBack(Math.min(1, p)));
      }).then(() => { ghost.destroy(); sv.alpha = 1; sv.y = baseY; sv.scale.set(1); });
    }
  }

  private drawStars(elapsed: number): void {
    const g = this.stars;
    if (!g) return;
    const W = this.rect.width;
    const period = HEAT_PERIOD[this.heat] ?? 0.5;
    const phase = (elapsed % period) / period;
    const blue = phase < 0.5;
    const color = blue ? POLICE_BLUE : POLICE_RED;
    const bright = this.busted ? 1 : 0.6 + Math.abs(Math.sin(phase * Math.PI)) * 0.4;

    g.clear();
    const r = Math.min(20, W / 40);
    const gap = r * 2.9;
    const total = gap * 4;
    const startX = W / 2 - total / 2;
    const y = this.rect.height * 0.085;
    for (let i = 0; i < 5; i++) {
      const sx = startX + i * gap;
      // soft colored glow
      g.poly(this.starPoints(sx, y, r * 1.55, r * 0.66)).fill({ color, alpha: 0.22 * bright });
      g.poly(this.starPoints(sx, y, r * 1.25, r * 0.55)).fill({ color, alpha: 0.25 * bright });
      // bright body: white core tinted toward the pulse colour
      const pts = this.starPoints(sx, y, r, r * 0.42);
      g.poly(pts).fill(0xffffff);
      g.poly(pts).fill({ color, alpha: 0.55 * bright });
      g.poly(pts).stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
    }
  }

  /** 3 quick flashes across a burst window (real police strobe rhythm). */
  private strobe(t: number): number {
    return Math.abs(Math.sin(t * Math.PI * 3));
  }

  /**
   * Police lighting: bright light sources at the rear light-bar (behind the POV)
   * with up-top reflections, flashing red then blue in a real strobe rhythm.
   * A heavy BlurFilter on this layer turns them into soft, natural bloom — not
   * flat 2D shapes.
   */
  private drawPolice(elapsed: number): void {
    this.police.clear();
    const peak = this.busted ? 0.95 : [0.0, 0.55, 0.78, 1.0][this.heat] ?? 0;
    if (peak <= 0.001) return;
    const W = this.rect.width;
    const H = this.rect.height;
    const cycle = this.busted ? 0.5 : [1.1, 0.85, 0.62, 0.45][this.heat] ?? 1.1;
    const ph = (elapsed % cycle) / cycle;
    let red = 0;
    let blue = 0;
    if (ph < 0.42) red = this.strobe(ph / 0.42);
    else if (ph >= 0.5 && ph < 0.92) blue = this.strobe((ph - 0.5) / 0.42);

    const src = (cx: number, cy: number, rx: number, ry: number, color: number, a: number): void => {
      if (a <= 0.01) return;
      this.police.ellipse(cx, cy, rx, ry).fill({ color, alpha: Math.min(1, a) });
    };
    // Rear light-bar wash (cop sits behind/below the POV) + upper reflections.
    src(W * 0.30, H * 0.98, W * 0.30, H * 0.22, POLICE_RED, red * peak);
    src(W * 0.70, H * 0.98, W * 0.30, H * 0.22, POLICE_BLUE, blue * peak);
    src(W * 0.14, H * 0.14, W * 0.20, H * 0.16, POLICE_RED, red * peak * 0.7);
    src(W * 0.86, H * 0.14, W * 0.20, H * 0.16, POLICE_BLUE, blue * peak * 0.7);
    // faint full-scene colour grade so the whole frame feels lit
    if (red > 0) this.police.rect(0, 0, W, H).fill({ color: POLICE_RED, alpha: red * peak * 0.07 });
    if (blue > 0) this.police.rect(0, 0, W, H).fill({ color: POLICE_BLUE, alpha: blue * peak * 0.07 });
  }

  // ── cell nodes ───────────────────────────────────────────────────────
  private placeCell(pos: Position, node: Container): void {
    const r = this.cellRect(pos[0], pos[1]);
    node.position.set(r.x + r.w / 2, r.y + r.h / 2);
    this.gridLayer.addChild(node);
    this.cells.set(keyOf(pos), node);
  }

  private buildGoldBar(value: number, col: number, row: number, hideNumber = false): Container {
    const r = this.cellRect(col, row);
    const c = new Container();

    // Solid cell background so no transparent gaps appear at edges when locked
    const cellBg = new Graphics();
    cellBg.rect(-r.w / 2, -r.h / 2, r.w, r.h).fill(REEL_BG);   // full cell, exactly the panel colour → invisible
    c.addChild(cellBg);

    const tex = getExtraTexture("gold_bar");
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(Math.min((r.w * 0.94) / tex.width, (r.h * 0.94) / tex.height));
      c.addChild(s);
    } else {
      const g = new Graphics();
      const w = r.w * 0.82, h = r.h * 0.6;
      g.roundRect(-w / 2, -h / 2, w, h, 6).fill(0xffcf3a);
      g.roundRect(-w / 2, -h / 2, w, h * 0.4, 6).fill({ color: 0xffe98a, alpha: 0.8 });
      g.roundRect(-w / 2, -h / 2, w, h, 6).stroke({ color: 0xb8860b, width: 2 });
      c.addChild(g);
    }
    if (!hideNumber) c.addChild(this.numText(value, r));
    return c;
  }

  private numText(value: number, r: { w: number; h: number }): Text {
    const t = new Text({
      text: fmtX(value),
      style: new TextStyle({
        fill: 0xffffff, fontFamily: FONT, fontSize: Math.min(26, r.h * 0.34), fontWeight: "900",
        letterSpacing: 1, stroke: { color: 0x3a2400, width: 4 },
        dropShadow: { color: 0x000000, alpha: 0.7, blur: 4, distance: 1, angle: Math.PI / 2 }
      })
    });
    t.anchor.set(0.5);
    t.label = "num";
    this.fit(t, r.w * 0.92);
    return t;
  }

  private updateGoldValue(node: Container, value: number): void {
    const num = node.getChildByLabel("num") as Text | null;
    if (num) num.text = fmtX(value);
  }

  private buildDynamite(col: number, row: number): Container {
    const r = this.cellRect(col, row);
    const c = new Container();
    // Full-cell background matching the panel so only the dynamite art is seen.
    const cellBg = new Graphics();
    cellBg.rect(-r.w / 2, -r.h / 2, r.w, r.h).fill(REEL_BG);
    c.addChild(cellBg);
    const tex = getExtraTexture("dynamite");
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(Math.min((r.w * 0.92) / tex.width, (r.h * 0.92) / tex.height));
      c.addChild(s);
    } else {
      const g = new Graphics();
      const bw = r.w * 0.16;
      for (let i = -1; i <= 1; i++) {
        g.roundRect(i * bw * 1.2 - bw / 2, -r.h * 0.28, bw, r.h * 0.56, 3).fill(0xc24a00);
        g.roundRect(i * bw * 1.2 - bw / 2, -r.h * 0.28, bw, r.h * 0.12, 3).fill({ color: 0xff6a00, alpha: 0.6 });
      }
      g.rect(-r.w * 0.24, -r.h * 0.04, r.w * 0.48, r.h * 0.08).fill(0x222222);
      g.circle(0, -r.h * 0.34, 3).fill(0xffd95c); // fuse spark
      c.addChild(g);
    }
    return c;
  }

  /**
   * The "blank" reel symbol: the Heat Chase logo on the SAME full-cell background
   * every other symbol uses. It is a real, visible symbol, so no cell is ever
   * empty while spinning — but it's clearly the logo, not a gold/dynamite win. Its
   * background is the exact panel colour, so only the logo art is seen scrolling.
   */
  private buildEmptyFace(col: number, row: number, logoTex: Texture | null): Container {
    const r = this.cellRect(col, row);
    const c = new Container();
    const bg = new Graphics();
    bg.rect(-r.w / 2, -r.h / 2, r.w, r.h).fill(REEL_BG);
    c.addChild(bg);
    if (logoTex) {
      const logo = new Sprite(logoTex);
      logo.anchor.set(0.5);
      logo.alpha = 0.5;   // clearly present as a symbol, muted vs the vivid wins
      const maxDim = Math.min(r.w, r.h) * 0.8;
      logo.scale.set(Math.min(maxDim / logoTex.width, maxDim / logoTex.height));
      c.addChild(logo);
    }
    return c;
  }

  // ── animation helpers ────────────────────────────────────────────────
  /**
   * Normal reel spin on the open cells. Each cell scrolls a strip of gold/dynamite
   * faces and decelerates to STOP on its real outcome (gold / dynamite / blank).
   * The outcome then sticks as a fixed overlay. Columns settle left → right.
   * Locked cells from earlier spins are untouched (they stay put as overlays).
   */
  private async spinColumns(grid: BonusCell[][], spinning: Position[], turbo: boolean, onLand?: (i: number, n: number) => void): Promise<void> {
    if (!spinning.length) { await wait(turbo ? 60 : 240); return; }
    const landCount = spinning.filter(([c, r]) => grid[c][r].symbol !== "EMPTY").length;
    let landIdx = 0;
    const onLandOne = (): void => onLand?.(landIdx++, landCount);

    // Group the open cells by column → one continuous reel per column.
    const byCol = new Map<number, number[]>();
    for (const [c, r] of spinning) { (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(r); }

    // Slower, more deliberate spin (per request) — the staggered per-column stops
    // are spread out further so the left→right reveal builds real anticipation.
    const base = turbo ? 300 : 760;
    const stagger = turbo ? 55 : 150;
    this.isSpinning = true;
    try {
      await Promise.all([...byCol.entries()].map(([c, rows]) =>
        this.spinOneColumn(grid, c, rows, base + c * stagger, turbo, onLandOne)
      ));
    } finally {
      this.isSpinning = false;
    }
  }

  /**
   * One continuous column reel: a single strip of faces scrolls smoothly through
   * the open rows of the column (symbols flow across cell boundaries — no seams),
   * decelerates, and stops on the column's outcome. Landed faces then stick.
   */
  private spinOneColumn(grid: BonusCell[][], col: number, rows: number[], dur: number, turbo: boolean, onLandOne: () => void): Promise<void> {
    const rc0 = this.cellRect(col, 0);
    const cellW = rc0.w;
    const cellH = rc0.h;
    const cx = rc0.x + cellW / 2;
    const colTop = rc0.y;
    const colH = cellH * GRID_ROWS;
    // More screens = a longer, clearly continuous scroll before the stop.
    const screens = turbo ? 4 : 7;
    const travel = colH * screens;

    // Heat Chase logo used as a dim watermark on empty spinning cells so the
    // reel feels alive even on dead spins. Falls back gracefully if not loaded.
    const logoTex = getExtraTexture("heat_chase_logo");

    const strip = new Container();
    const openSet = new Set(rows);
    const addFace = (r: number, k: number, outcome: boolean): void => {
      let node: Container;
      if (outcome) {
        const cell = grid[col][r];
        if (cell.symbol === "SAFE") node = this.buildGoldBar(cell.value ?? 0, col, r);
        else if (cell.symbol === "MASTER_KEY") node = this.buildDynamite(col, r);
        else node = this.buildEmptyFace(col, r, logoTex);
      } else {
        const rnd = Math.random();
        if (rnd < 0.10) node = this.buildDynamite(col, r);
        else if (rnd < 0.24) node = this.buildGoldBar(0, col, r, true);
        else node = this.buildEmptyFace(col, r, logoTex);
      }
      // +k stacks faces BELOW the outcome row, so at the start the lower filler
      // already fills the window (never an empty frame) and the strip scrolls
      // DOWN — symbols flow down, fresh ones arrive from above.
      node.position.set(cx, colTop + r * cellH + cellH / 2 + k * colH);
      strip.addChild(node);
    };
    // Outcome screen at the TOP (k=0): open rows show the real result; locked rows
    // get filler (they sit under the lockedLayer overlay) so the belt stays packed.
    for (let r = 0; r < GRID_ROWS; r++) addFace(r, 0, openSet.has(r));
    // Filler screens stacked BELOW — enough to keep the window full for the whole
    // travel, so every cell of every column ALWAYS shows a symbol.
    for (let k = 1; k <= screens + 1; k++) for (let r = 0; r < GRID_ROWS; r++) addFace(r, k, false);

    // Mask the ENTIRE column span (not just the open rows) so the scrolling strip
    // flows SMOOTHLY behind any sticky/locked symbols instead of being clipped at
    // their cell edges (the old per-row mask caused passing symbols to get cut off
    // at the invisible box around a stuck symbol). Locked gold bars live in
    // lockedLayer, above gridLayer, so they naturally occlude the reel where they
    // sit — the reel now reads as gliding cleanly *behind* them.
    // Insert strip + mask at z-index 0 so any same-layer content renders on top.
    const mask = new Graphics();
    mask.rect(rc0.x, colTop, cellW, colH).fill(0xffffff);
    this.gridLayer.addChildAt(mask, 0);
    strip.mask = mask;
    strip.y = -travel;
    this.gridLayer.addChildAt(strip, 0);

    // Vertical motion blur so the reel reads as genuinely SPINNING.
    const blurMax = turbo ? 7 : 16;
    const blur = new BlurFilter({ strength: blurMax, quality: 2 });
    blur.strengthX = 0;
    strip.filters = [blur];

    // Constant-speed spin (the continuous illusion) then a smooth settle. The
    // strip is one continuous run of faces, so symbols flow down and fresh ones
    // keep arriving from the top — never a visible disappear/re-pop.
    return tween(dur, (p) => {
      strip.y = -travel * (1 - reelPos(p));
      blur.strengthY = blurMax * reelVel(p);   // blurry while fast, razor sharp at rest
    }, linear).then(() => {
      strip.destroy({ children: true });
      mask.destroy();
      for (const r of rows) {
        const cell = grid[col][r];
        const landed = cell.symbol === "SAFE" || cell.symbol === "MASTER_KEY";
        if (cell.symbol === "SAFE") { this.placeCell([col, r], this.buildGoldBar(cell.value ?? 0, col, r)); onLandOne(); }
        else if (cell.symbol === "MASTER_KEY") { this.placeCell([col, r], this.buildDynamite(col, r)); onLandOne(); }
        // EMPTY: leave a resting Heat Chase watermark so the logos never just
        // vanish when the reel stops (every cell stays consistent, spin or rest).
        else this.placeCell([col, r], this.buildEmptyFace(col, r, logoTex));
        this.cellStopFx([col, r], landed);
      }
    });
  }

  /** A quick impact when a reel stops on a WIN: the gold/dynamite symbol punches
   *  in. Empty stops get nothing — the old expanding ring + grey puff circles were
   *  removed (they looked ugly); the reel motion and the symbol sell the stop. */
  private cellStopFx(pos: Position, landed: boolean): void {
    if (!landed) return;
    const node = this.cells.get(keyOf(pos));
    if (!node) return;
    const num = node.getChildByLabel("num") as Text | null;
    void tween(300, (p) => { const s = 1 + Math.sin(Math.min(1, p) * Math.PI) * 0.28; node.scale.set(s); if (num) num.scale.set(s); })
      .then(() => { node.scale.set(1); if (num) num.scale.set(1); });
  }

  /** Dead spin (no land): a red wash around the opening + a centred "NO HIT" so
   *  the player clearly registers that the reel spun and missed. */
  private deadSpinBeat(): void {
    const o = this.opening();
    const ring = new Graphics();
    this.fxLayer.addChild(ring);
    void tween(420, (p) => {
      const a = Math.sin(p * Math.PI);
      ring.clear();
      ring.roundRect(o.x - 8, o.y - 8, o.width + 16, o.height + 16, 10)
        .stroke({ color: POLICE_RED, width: 6, alpha: a * 0.8 });
    }).then(() => ring.destroy());

    const t = new Text({
      text: "NO HIT",
      style: new TextStyle({ fill: 0xffb000, fontFamily: FONT, fontSize: Math.min(34, o.width / 7), fontWeight: "900", letterSpacing: 4, stroke: { color: 0x000000, width: 5 }, dropShadow: { color: POLICE_RED, alpha: 0.6, blur: 12, distance: 0, angle: 0 } })
    });
    t.anchor.set(0.5);
    t.position.set(o.x + o.width / 2, o.y + o.height / 2);
    this.fxLayer.addChild(t);
    t.scale.set(0.6);
    void tween(700, (p) => {
      t.scale.set(0.6 + 0.5 * easeOutBack(Math.min(1, p * 1.8)));
      t.alpha = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
      t.y = o.y + o.height / 2 - 14 * p;
    }).then(() => t.destroy());
  }

  private hitFlash(): void {
    const W = this.rect.width;
    const H = this.rect.height;
    const f = new Graphics();
    this.fxLayer.addChild(f);
    void tween(360, (p) => {
      f.clear();
      const blue = p < 0.5;
      f.rect(0, 0, W, H).fill({ color: blue ? POLICE_BLUE : POLICE_RED, alpha: (1 - p) * 0.28 });
    }).then(() => f.destroy());
  }

  /**
   * GTA-style BUST: a chromatic jolt, the police strobes slam in from both sides
   * and converge, then everything settles to a slow, grim red heartbeat. No
   * fireworks — the world goes cold and you got caught.
   */
  private async bustedSequence(turbo: boolean): Promise<void> {
    const W = this.rect.width;
    const H = this.rect.height;
    // a hard camera jolt as the cuffs go on
    void pulseChromaticAberration(this, { intensity: turbo ? 6 : 13, duration: turbo ? 300 : 700 });

    const lights = new Graphics();
    this.fxLayer.addChild(lights);
    lights.filters = [new BlurFilter({ strength: 44, quality: 2 })];

    await tween(turbo ? 320 : 1600, (p) => {
      lights.clear();
      // red (left) + blue (right) strobes slam in from the sides, then fade back.
      const conv = easeOutCubic(Math.min(1, p * 2.4));
      const redX = -W * 0.15 + W * 0.32 * conv;     // slides in from off the left edge
      const blueX = W * 1.15 - W * 0.32 * conv;     // slides in from off the right edge
      const strobe = Math.abs(Math.sin(p * Math.PI * (turbo ? 7 : 11)));
      const fade = p > 0.62 ? 1 - (p - 0.62) / 0.38 : 1;
      lights.ellipse(redX, H * 0.52, W * 0.38, H * 0.64)
        .fill({ color: POLICE_RED, alpha: strobe * 0.46 * fade });
      lights.ellipse(blueX, H * 0.52, W * 0.38, H * 0.64)
        .fill({ color: POLICE_BLUE, alpha: (1 - strobe) * 0.46 * fade });
      // deep red vignette heartbeat in the back half — the grim settle
      const beat = p > 0.5 ? Math.abs(Math.sin((p - 0.5) * Math.PI * 3)) * 0.14 : 0;
      lights.rect(0, 0, W, H).fill({ color: 0x4a0808, alpha: beat });
    }, linear);
    lights.destroy();
  }

  /**
   * GRAND ESCAPE: a warm bloom surge over the whole scene, a soft gold light ring
   * blooming outward, and a cinematic rain of bank notes + coins. Filmic, not
   * arcade confetti.
   */
  private async grandEscape(turbo: boolean): Promise<void> {
    const W = this.rect.width;
    const H = this.rect.height;
    const cx = W / 2, cy = H * 0.46;

    // the lights surge — GPU bloom over the entire bonus
    void pulseBloom(this, { scale: turbo ? 0.8 : 1.5, duration: turbo ? 520 : 1150 });

    // warm flash that decays
    const flash = new Graphics();
    flash.rect(0, 0, W, H).fill({ color: 0xfff0cf, alpha: 0.72 });
    this.fxLayer.addChild(flash);

    // soft blooming light ring (blurred → a shockwave of light, not a hoop)
    const ring = new Graphics();
    ring.filters = [new BlurFilter({ strength: 9, quality: 2 })];
    this.fxLayer.addChild(ring);

    // cinematic cash-rain
    this.cashRain(turbo);

    const reach = Math.max(W, H) * 0.62;
    await tween(turbo ? 320 : 1150, (p) => {
      const e = easeOutCubic(p);
      flash.alpha = (1 - p) * 0.72;
      ring.clear();
      ring.circle(cx, cy, reach * e).stroke({ color: GOLD, width: Math.max(1, 16 * (1 - p)), alpha: (1 - p) * 0.7 });
      ring.circle(cx, cy, reach * e * 0.66).stroke({ color: 0xffffff, width: Math.max(1, 7 * (1 - p)), alpha: (1 - p) * 0.45 });
    }, linear);
    flash.destroy();
    ring.destroy();
  }

  // ── ambient + totals ─────────────────────────────────────────────────
  private startAmbient(): void {
    this.stopAmbient();
    this.truckLayer.position.set(0, 0);
    this.gridLayer.position.set(0, 0);
    this.lockedLayer.position.set(0, 0);
    this.fxLayer.position.set(0, 0);
    this.shakeBoost = 0;
    this.ambientCb = (dt, elapsed) => {
      this.drawStars(elapsed);
      this.drawPolice(elapsed);
      this.driveShake(dt, elapsed);
    };
    ambientTicker.add(this.ambientCb);
  }

  /**
   * High-speed chase shake: a constant engine/road rumble on the truck frame +
   * reels so it always feels like we're barrelling forward, intensifying during a
   * spin (and with the heat level) for anticipation. The HUD and the police glow
   * stay rock-steady so the numbers and lighting remain readable.
   */
  private driveShake(dt: number, elapsed: number): void {
    // Ease the boost toward 1 while spinning, back to 0 once settled.
    const target = this.isSpinning ? 1 : 0;
    this.shakeBoost += (target - this.shakeBoost) * Math.min(1, dt * 6);
    const t = elapsed;
    // Layered sines ≈ a pseudo-random rumble; the vertical axis dominates (the
    // forward thrust / road bumps), with a slower suspension bob on top.
    const ry = Math.sin(t * 52) * 0.5 + Math.sin(t * 89) * 0.3;
    const rx = Math.sin(t * 61) * 0.4 + Math.sin(t * 97) * 0.25;
    const bob = Math.sin(t * 5.0) * 0.5;
    const amp = 1.6 + this.heat * 0.6 + this.shakeBoost * 2.6;
    const ox = rx * amp;
    const oy = (ry + bob) * amp;
    this.truckLayer.position.set(ox, oy);
    this.gridLayer.position.set(ox, oy);
    this.lockedLayer.position.set(ox, oy);
  }

  private stopAmbient(): void {
    if (this.ambientCb) { ambientTicker.remove(this.ambientCb); this.ambientCb = null; }
  }

  private sumGrid(grid: BonusCell[][]): number {
    let t = 0;
    for (let c = 0; c < GRID_COLUMNS; c++)
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        if (cell.symbol === "SAFE" && cell.value) t += cell.value;
      }
    return Number(t.toFixed(2));
  }

  private setCollected(total: number, animate: boolean): void {
    if (!this.collectedText) return;
    if (!animate || total <= this.collectedShown) {
      this.collectedShown = total;
      this.collectedText.text = fmtX(total);
      return;
    }
    const start = this.collectedShown;
    void tween(450, (p) => {
      const v = start + (total - start) * p;
      this.collectedShown = v;
      if (this.collectedText) {
        this.collectedText.text = fmtX(v);
        this.collectedText.scale.set(1 + Math.sin(p * Math.PI) * 0.12);
      }
    }, easeOutCubic).then(() => {
      this.collectedShown = total;
      if (this.collectedText) { this.collectedText.text = fmtX(total); this.collectedText.scale.set(1); }
    });
  }

  private starPoints(cx: number, cy: number, outerR: number, innerR: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? outerR : innerR;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return pts;
  }

  private fit(t: Text, maxWidth: number): void {
    if (t.width > maxWidth) t.scale.set(maxWidth / t.width);
  }
}
