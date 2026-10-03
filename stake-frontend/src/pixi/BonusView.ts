import { MiamiStreet } from "./MiamiStreet";
import { BlurFilter, ColorMatrixFilter, Container, FillGradient, Graphics, PerspectiveMesh, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { BONUS_START_RESPINS, GRID_COLUMNS, GRID_ROWS, MAX_WIN_MULTIPLIER, type BonusCell, type Position } from "../domain";
import { getExtraTexture } from "./assets";
import { softGlowTexture, sparkDotTexture, streakTexture } from "./fxTextures";
import { DISPLAY_FONT, UI_FONT } from "../typography";
import { GetawayResult, type GetawayResultAudio } from "./GetawayResult";
import { tween, wait, easeOutBack, easeOutCubic, easeInCubic, easeInQuad, easeInOutCubic, linear, ambientTicker, getTimeScale, simulate } from "./tween";

import type { GetawayCue, Rect } from "./types";
import { dudDynamites } from "./dynamitePlan";
import { shockwave, pulseBloom } from "../vfx/Shaders";

/* ═══════════════════════════════════════════════════════════════════
   "THE GETAWAY" — POV police-chase Hold & Spin.
   Layer 1: scrolling night highway.  Layer 2: armored Brinks-truck frame.
   Layer 3: the 5x4 grid in the open truck doors — gold bars slam in and
   stick; dynamite doubles neighbours then vanishes; 5 wanted stars pulse
   ever faster as dead spins stack the heat, until a hit resets it.
   Every image has a procedural fallback so it works with no art added.
   ═══════════════════════════════════════════════════════════════════ */

const FONT = UI_FONT;
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

// The reel window, as fractions of the truck-layer canvas — measured from
// brinks_truck_frame.webp's punched-out window. This is what the grid is sized
// to, so it must stay matched to the FRAME, never to the door art (basing it on
// the doors made the grid stop fitting the frame). brinks_truck_no_doors.webp is
// registered to the same canvas, so one mapping places both.
// Cargo opening of truck_frame_open.webp, measured from its alpha as the longest
// contiguous transparent run through the centre column and row (NOT first/last
// transparent pixel - that swallows the empty space above the truck). The opening
// is transparent in that art, so the reels show straight through it.
// The 1048x983 plate replaced a 714x667 one that was drawn 2-4x upscaled and read
// softer than the doors bolted to it; the opening aspect only moved 1.1191 -> 1.1163.
const TRUCK_OPENING = { wFrac: 0.6412, hFrac: 0.6124, cxFrac: 0.4948, cyFrac: 0.4369, aspect: 1.1163 };
// Legacy one-piece frame (doors already drawn open) — only used if the new
// door-reveal art is missing.
const TRUCK_OPENING_LEGACY = { wFrac: 0.3262, hFrac: 0.507, cxFrac: 0.5, cyFrac: 0.4441, aspect: 334 / 290 };

/** How far the doors swing before they rest, in degrees.
 *
 *  Why so far past 90: at exactly 90 a door is edge-on, so its face has no
 *  width at all and it reads as a thin sliver. Rotating PAST square turns the
 *  face back towards the viewer and fattens it up again. Measured against the
 *  live opening (516px wide), the door's on-screen face is:
 *      63deg -> 218px but still covering 14% of the grid
 *      92deg -> 129px, clears the grid but looks skinny (w:h 0.19)
 *     115deg -> 269px, w:h 0.41 — substantial, and still 1.43x magnified
 *  115 also sits INSIDE the reference look: it reaches 0.23 of an opening-width
 *  past the truck body, where the original one-piece art reached 0.35. */
const DOOR_OPEN_DEG = 115;
/** Virtual camera distance, in multiples of the opening width. Smaller = more
 *  extreme perspective. 1.55 keeps the near edge ~43% magnified at rest, so the
 *  doors stay genuinely three-dimensional rather than merely squashed. */
const DOOR_CAM_DIST = 1.55;
/** How far past the centre line each door reaches, so the two overlap and no
 *  background shows through the seam where their soft edges meet. */
const DOOR_SEAM_OVERLAP = 6;

// Hold & Spin COUNTDOWN: the meter starts here, a lock HOLDS it, and each dead
// spin spends one — the feature ends after this many dead spins in total. The
// number only ever falls. Imported rather than redeclared: this file used to
// hold its own copy that silently disagreed with domain.ts.
const START_RESPINS = BONUS_START_RESPINS;

// Uniform dark reel background. EVERY bonus symbol fills its cell with this
// exact colour and the reel panel is the same flat colour, so the symbols'
// backgrounds are invisible — during a spin you only ever see the symbol art
// move, never a background box. The moving highway is the BACKDROP only: it
// rushes past AROUND the truck, never behind the grid symbols.
const REEL_BG = 0x0c0c0f;

// Perspective road and roadside layers accelerate independently of the skyline.
const HW_RATE_START = 0.85;   // chase speed immediately on entry
const HW_RATE_CRUISE = 1.1;   // sustained city passing speed
const HW_RAMP_SECS = 2;       // seconds of continuous acceleration to reach cruise
const HW_RATE_SURGE = 0.2;    // extra cycles / sec while the reels spin — flooring it
const HW_HEAT = 0.05;         // extra cycles / sec per heat level (the chase tightening)
const HW_VP_FRAC_Y = 0.4;     // art's vanishing point: horizontal centre, ~40% down

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

// Where the fuse is on dynamite.webp (640², centre-relative texture px): the lit
// tip drawn into the art, and where the fuse enters the sticks. The burn-down
// runs the spark from one to the other.
const FUSE_TIP = { x: 125, y: -195 };
const FUSE_BASE = { x: 66, y: -98 };

function fmtX(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
}

/** Compact money number: "4", "1.5", "0.25", "1,250" — no trailing zeros. */
function fmtMoneyNum(amount: number): string {
  const r = Math.round(amount * 100) / 100;
  return r.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export class BonusView extends Container {
  private readonly bgLayer = new Container();
  private readonly truckLayer = new Container();
  private readonly rig = new Container();
  private readonly reelSurface = new Container();
  private readonly aperture = new Graphics();
  private readonly apertureMask = new Graphics();
  private readonly gridLayer = new Container();
  /** Locked (previously landed) gold bars rendered ABOVE the spinning strip so the
   *  strip's blur filter never bleeds onto or clips them. */
  private readonly lockedLayer = new Container();
  private readonly dividerLayer = new Container();
  /** The two armored doors, drawn ABOVE the reels so they hide the grid when
   *  shut and expose it as they swing out towards the player. */
  private readonly doorLayer = new Container();
  private doorL: PerspectiveMesh | null = null;
  private doorR: PerspectiveMesh | null = null;
  /** [left, right] door plates: what the door shows shut vs. swung past square. */
  private doorOuter: [Texture, Texture] | null = null;
  private doorInner: [Texture, Texture] | null = null;
  /** Contact shadow cast into the door frame at each hinge — without it the
   *  doors read as floating in front of the truck rather than hung on it. */
  private doorShadow: Graphics | null = null;
  private doorsOpen = false;
  private readonly fxLayer = new Container();
  private readonly hudLayer = new Container();
  /** HUD widgets (title, stars, spins, COLLECTED) — separate from the intro's
   *  cinematic overlays so the HUD can fade in after the title card. */
  private hudPanel: Container | null = null;
  private readonly police = new Graphics();
  /** Warm light from street lamps sweeping over the truck as it passes them. */
  private readonly lightLayer = new Container();
  private sweepTimer = 0.6;
  private glintTimer = 1.2;
  /** Police strobes during the intro title, before any heat exists. */
  private introLights = false;

  private rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;

  // Background scene lifetime and continuous acceleration state.
  private miamiStreet: MiamiStreet | null = null;
  private highwaySpeed = 0;             // eased phase-advance (cycles/sec)
  private highwayAge = 0;               // seconds since this feature's highway was built (drives the accel ramp)
  private truck: Container | null = null;
  private stars: Graphics | null = null;
  private collectedText: Text | null = null;
  /** Small always-visible USD readout of the total win, under the COLLECTED meter. */
  private collectedUsdText: Text | null = null;
  private collectedShown = 0;
  private collectedTarget = 0;
  private spinsBox: Container | null = null;
  private spinsText: Text | null = null;
  private spinsLabel: Text | null = null;
  private result: GetawayResult | null = null;

  private heat = 0;          // 0 = baseline … 3 = max
  private busted = false;
  private respinsShown = START_RESPINS; // last value shown on the meter (for the change beat)
  private isSpinning = false;           // true while reels turn — drives the anticipation shake
  private shakeBoost = 0;               // 0..1 eased ramp of the high-speed chase shake
  /** Short decaying camera kick (px) for impacts — NO HIT, the dud's thud. */
  private jolt = 0;
  /** World speed (1 = normal). BUSTED drops it to a crawl — GTA "wasted" slow-mo. */
  private slowmo = 1;
  private slowmoTarget = 1;
  /** Desaturates the street during BUSTED (the street has no masks, so it is safe to filter). */
  private bustedGrade: ColorMatrixFilter | null = null;
  private readonly cells = new Map<string, Container>();
  /** Scene already built for the coming intro (see prepare()). */
  private prepared = false;
  /** The heist readout for the payout screen. */
  private spinsPlayed = 0;
  private blasts = 0;

  /** Bet context for showing REAL money on gold bars / meter / result — like an
   *  official slot. 0 bet = fall back to raw multipliers (shouldn't happen). */
  private betAmount = 0;
  private currency = "";

  /** Moment sink: fired on the frame each visual happens (the reel stopping,
   *  a bar slamming in, the fuse, the blast, each ×2, the meter) so sound can
   *  be synced to it. Set by the scene. */
  onCue: ((cue: GetawayCue) => void) | null = null;
  private cue(c: GetawayCue): void { this.onCue?.(c); }

  setMoneyContext(betAmount: number, currency: string): void {
    this.betAmount = betAmount;
    this.currency = currency;
  }

  /** Money string with the currency, for result pop-ups and the small USD total.
   *  Gold bars themselves keep their multiplier numbers (fmtX). */
  private fmtTotal(v: number): string {
    return this.betAmount > 0 ? `${fmtMoneyNum(v * this.betAmount)} ${this.currency}` : fmtX(v);
  }

  constructor() {
    super();
    this.visible = false;
    // lockedLayer sits between gridLayer (spinning strip) and fxLayer so
    // the sticky gold bars are always drawn on top of any reel blur.
    this.reelSurface.addChild(this.aperture, this.gridLayer, this.lockedLayer);
    this.reelSurface.mask = this.apertureMask;
    this.rig.addChild(this.truckLayer, this.reelSurface, this.apertureMask, this.dividerLayer, this.doorLayer, this.fxLayer);
    this.lightLayer.eventMode = "none";
    this.addChild(this.bgLayer, this.rig, this.lightLayer, this.police, this.hudLayer);
    // Heavy blur turns the police light sources into soft, natural bloom.
    this.police.filters = [new BlurFilter({ strength: 30, quality: 3 })];
  }

  layout(rect: Rect): void {
    if (this.visible && this.truck) {
      // A live reel animation owns its coordinate system. Resizing only some
      // layers made future strips use new cells while held bars kept old ones.
      const scale = Math.min(rect.width / this.rect.width, rect.height / this.rect.height);
      this.scale.set(scale);
      this.position.set(rect.x + (rect.width - this.rect.width * scale) / 2, rect.y + (rect.height - this.rect.height * scale) / 2);
      return;
    }
    this.rect = rect;
    this.scale.set(1);
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
  /**
   * Build the chase scene ahead of its intro (still invisible). Construction
   * is the heavy part of the trigger — doing it while the trigger beat is
   * still playing means the hand-off frame never stalls into a blank screen.
   * Idempotent until hide().
   */
  prepare(): void {
    if (this.prepared && this.truck) return;
    this.prepared = true;
    this.spinsPlayed = 0;
    this.blasts = 0;
    this.busted = false;
    this.heat = 0;
    this.collectedShown = 0;
    this.cells.clear();
    for (const layer of [this.gridLayer, this.lockedLayer, this.fxLayer]) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
    this.buildHighway();
    this.buildTruck();
    this.buildDividers();
    this.buildHud();
    // The doors open onto resting reel faces, never onto a black void.
    const logoTex = getExtraTexture("heat_chase_logo_symbol") ?? getExtraTexture("heat_chase_logo");
    for (let c = 0; c < GRID_COLUMNS; c++)
      for (let r = 0; r < GRID_ROWS; r++) this.placeCell([c, r], this.buildEmptyFace(c, r, logoTex));
    this.scale.set(1);
  }

  /** `onCovered` fires once the chase fully covers the base game — the caller
   *  hides the base scene THEN, so the hand-off is a true crossfade instead of
   *  the base popping out and the chase fading up from an empty frame. */
  async intro(turbo: boolean, onTypewriterStart?: () => void, onTypewriterStop?: () => void, onDoorsOpen?: () => void, onCovered?: () => void): Promise<void> {
    this.prepare();
    this.visible = true;
    this.startAmbient();

    // Turbo skips the cold-open, so the doors settle straight to open — they
    // must never be left shut over the reels.
    if (turbo) { this.alpha = 1; if (this.hudPanel) this.hudPanel.alpha = 1; onCovered?.(); this.snapDoorsOpen(); return; }

    const W = this.rect.width;
    const H = this.rect.height;
    // The HUD waits for the title card: it fades in as the letterbox retracts.
    const hudPanel = this.hudPanel;
    if (hudPanel) hudPanel.alpha = 0;
    // Pursuit lights wash over the shut doors while dispatch calls it in.
    this.introLights = true;

    // 1. Crossfade the chase scene in over the base game.
    this.alpha = 0;
    void tween(620, (p) => { this.alpha = p; }, easeOutCubic).then(() => onCovered?.());

    // 2. Cinematic cold-open: full blackout → letterbox bars + vignette glide in.
    const blackout = new Graphics();
    blackout.rect(0, 0, W, H).fill(0x000000);
    this.hudLayer.addChild(blackout);
    const lb = this.buildLetterbox();
    const vig = this.buildVignette();
    vig.alpha = 0;
    this.hudLayer.addChildAt(vig, 0);
    await tween(520, (p) => {
      const e = easeOutCubic(p);
      lb.top.y = -lb.barH + lb.barH * e;
      lb.bot.y = H - lb.barH * e;
      vig.alpha = e * 0.85;
      blackout.alpha = 1 - e * 0.6;
    }, linear);

    // 3. Radio static + slow blue police-wash crawling across the frame.
    const wash = new Graphics();
    this.hudLayer.addChild(wash);
    // thin horizontal scan-line crawls down the frame like a camera feed
    const scanLine = new Graphics();
    this.hudLayer.addChild(scanLine);
    void tween(2200, (p) => {
      wash.clear();
      // cold police blue slowly washing across from the left, not a flash
      const sweep = easeOutCubic(Math.min(1, p * 1.6));
      wash.rect(0, 0, W * sweep, H).fill({ color: POLICE_BLUE, alpha: 0.04 * (1 - p) });
      wash.rect(W * (1 - sweep), 0, W * sweep, H).fill({ color: POLICE_RED, alpha: 0.03 * (1 - p) });
      // scan-line
      scanLine.clear();
      const sy = (p * 1.8 % 1) * H;
      scanLine.rect(0, sy, W, 2).fill({ color: 0xffffff, alpha: 0.03 * (1 - p) });
    }).then(() => { wash.destroy(); scanLine.destroy(); });

    // 4. GTA mission-start title: no popup card. Raw text between the bars.
    //    Dispatch text types in character-by-character like radio chatter,
    //    then the mission name materialises with filmic weight.
    const titleGroup = new Container();
    titleGroup.position.set(W / 2, H * 0.44);
    this.hudLayer.addChild(titleGroup);

    const dispatchSize = Math.min(16, W / 52);
    const theSize = Math.min(22, W / 38);
    const bigSize = Math.min(86, W / 9.8);

    // cold, dim blue back-glow behind the title area
    const titleGlow = new Graphics();
    titleGlow.ellipse(0, 0, W * 0.46, bigSize * 1.6).fill({ color: 0x1a3a6e, alpha: 0.12 });
    titleGlow.filters = [new BlurFilter({ strength: 40, quality: 2 })];
    titleGlow.alpha = 0;
    titleGroup.addChild(titleGlow);

    // Dispatch line — types in letter by letter
    const dispatchFull = "ALL UNITS — SUSPECTS FLEEING SCENE";
    const dispatch = new Text({
      text: "",
      style: new TextStyle({
        fill: 0x9fc0e6, fontFamily: FONT, fontSize: dispatchSize,
        fontWeight: "400", letterSpacing: 3
      })
    });
    dispatch.anchor.set(0.5, 1);
    dispatch.position.set(0, -theSize * 2.2);
    titleGroup.addChild(dispatch);

    // thin rule under the dispatch
    const dispRule = new Graphics();
    dispRule.rect(-W * 0.16, 0, W * 0.32, 1).fill({ color: 0x6a8ab0, alpha: 0.3 });
    dispRule.position.set(0, -theSize * 1.9);
    dispRule.alpha = 0;
    titleGroup.addChild(dispRule);

    // "THE" — small, spaced, above the main title
    const the = new Text({
      text: "THE",
      style: new TextStyle({
        fill: 0xc8d4e0, fontFamily: FONT, fontSize: theSize,
        fontWeight: "900", letterSpacing: 18,
        stroke: { color: 0x000000, width: 3 },
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 8, distance: 0, angle: 0 }
      })
    });
    the.anchor.set(0.5, 1);
    the.position.set(0, -theSize * 0.3);
    the.alpha = 0;
    titleGroup.addChild(the);

    // "GETAWAY" — the hero title, large
    const big = new Text({
      text: "GETAWAY",
      style: new TextStyle({
        fill: 0xffffff, fontFamily: FONT, fontSize: bigSize,
        fontWeight: "900", letterSpacing: 4,
        stroke: { color: 0x000000, width: 6 },
        dropShadow: { color: 0x000000, alpha: 0.7, blur: 14, distance: 3, angle: Math.PI / 2 }
      })
    });
    big.anchor.set(0.5, 0);
    big.position.set(0, -theSize * 0.1);
    big.alpha = 0;
    titleGroup.addChild(big);

    // --- Phase A: Dispatch types in (800ms) ---
    // Start typewriter sound exactly when typing begins
    onTypewriterStart?.();
    titleGroup.alpha = 1;
    blackout.alpha = 0.4;
    const typeTime = 800;
    const typeChars = dispatchFull.length;
    await tween(typeTime, (p) => {
      const chars = Math.floor(p * typeChars);
      dispatch.text = dispatchFull.substring(0, chars) + (p < 0.95 ? "_" : "");
      titleGlow.alpha = p * 0.6;
      blackout.alpha = 0.4 - p * 0.15;
    }, linear);
    dispatch.text = dispatchFull;
    // Stop typewriter sound exactly when typing finishes
    onTypewriterStop?.();
    dispRule.alpha = 1;
    void tween(300, (p) => { dispRule.alpha = easeOutCubic(p) * 0.6; });

    await wait(280);

    // --- Phase B: "THE" fades in, then "GETAWAY" lands ---
    await tween(400, (p) => {
      the.alpha = easeOutCubic(p);
    });

    // GETAWAY title: punches in from slightly large and settles, with a warm
    // light bursting behind it — the title has weight instead of a slow fade.
    const titleFlash = new Sprite(softGlowTexture());
    titleFlash.anchor.set(0.5);
    titleFlash.blendMode = "add";
    titleFlash.tint = 0xffe2a8;
    titleFlash.position.set(0, bigSize * 0.5);
    titleFlash.width = W * 0.7;
    titleFlash.height = bigSize * 2.4;
    titleFlash.alpha = 0;
    titleGroup.addChildAt(titleFlash, 1);
    const flashW = titleFlash.scale.x;
    const flashH = titleFlash.scale.y;
    await tween(700, (p) => {
      const e = easeOutBack(Math.min(1, p * 1.25));
      big.alpha = Math.min(1, p * 3);
      big.scale.set(1.22 - 0.22 * e);
      big.y = -theSize * 0.1 + 6 * (1 - easeOutCubic(p));
      titleFlash.alpha = p < 0.25 ? p / 0.25 * 0.55 : 0.55 * (1 - (p - 0.25) / 0.75);
      titleFlash.scale.set(flashW * (0.8 + 0.5 * p), flashH * (0.8 + 0.3 * p));
      blackout.alpha = 0.25 - easeOutCubic(p) * 0.15;
    }, linear);
    big.alpha = 1;
    big.scale.set(1);
    titleFlash.destroy();

    await wait(1100); // hold the title — let it breathe

    // 5. Everything dissolves out; letterbox & vignette retract to reveal the reel.
    await tween(700, (p) => {
      const e = easeOutCubic(p);
      titleGroup.alpha = 1 - e;
      titleGroup.y = H * 0.44 - 20 * e;
      lb.top.y = -lb.barH * e;
      lb.bot.y = H - lb.barH * (1 - e);
      vig.alpha = (1 - e) * 0.85;
      blackout.alpha = (1 - e) * 0.1;
      if (hudPanel && !hudPanel.destroyed) hudPanel.alpha = e;
    }, linear);
    if (hudPanel && !hudPanel.destroyed) hudPanel.alpha = 1;
    titleGroup.destroy();
    lb.top.destroy();
    lb.bot.destroy();
    vig.destroy();
    blackout.destroy();
    this.alpha = 1;

    // 6. THE REVEAL — the doors unlatch and swing out onto the reels.
    onDoorsOpen?.();
    await this.openDoors(false);
    this.introLights = false;
  }

  /** The payout owns the cover, so restoration is hidden even during resize or
   * key-up. Its DOM remains above the canvas until the base scene is ready. */
  async fadeOutAndHide(turbo: boolean, restoreBase: () => void): Promise<void> {
    const restore = (): void => {
      this.hide();
      this.alpha = 1;
      restoreBase();
    };
    if (this.result) {
      const result = this.result;
      this.result = null;
      await result.exit(turbo, restore);
    } else {
      // Recovery path without a result screen must still restore all base layers.
      restore();
    }
  }

  /** Draw the current grid with no animation (used when resuming a round). */
  showStatic(grid: BonusCell[][]): void {
    this.visible = true;
    if (!this.truck) { this.buildHighway(); this.buildTruck(); this.buildDividers(); this.buildHud(); this.startAmbient(); }
    // Resuming mid-feature: the doors were opened already, so don't replay it.
    this.snapDoorsOpen();
    this.gridLayer.removeChildren();
    this.cells.clear();
    const logoTex = getExtraTexture("heat_chase_logo_symbol") ?? getExtraTexture("heat_chase_logo");
    for (let c = 0; c < GRID_COLUMNS; c++)
      for (let r = 0; r < GRID_ROWS; r++) {
        const cell = grid[c][r];
        if (cell.symbol === "SAFE") {
          const bar = this.buildGoldBar(cell.value ?? 0, c, r);
          this.dressLocked(bar, c, r);
          this.placeCell([c, r], bar);
        }
        else if (cell.symbol === "MASTER_KEY") this.placeCell([c, r], this.buildDynamite(c, r));
        else this.placeCell([c, r], this.buildEmptyFace(c, r, logoTex)); // resting watermark — logos never just vanish
      }
    this.setCollected(this.sumGrid(grid), false);
  }

  async playSpin(grid: BonusCell[][], landed: Position[], respins: number, deadSpins: number, turbo: boolean, onLand?: (i: number, n: number) => void): Promise<void> {
    if (!this.truck) await this.intro(turbo);
    this.visible = true;
    this.spinsPlayed++;

    const landedSet = new Set(landed.map(keyOf));

    const previous = new Map(this.cells);
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
          const key = keyOf([c, r]);
          const node = previous.get(key) ?? this.buildGoldBar(cell.value ?? 0, c, r);
          this.dressLocked(node, c, r);
          previous.delete(key);
          this.updateGoldValue(node, cell.value ?? 0);
          const rc = this.cellRect(c, r);
          node.position.set(rc.x + rc.w / 2, rc.y + rc.h / 2);
          this.lockedLayer.addChild(node);
          this.cells.set(keyOf([c, r]), node);
        } else {
          spinning.push([c, r]);
        }
      }

    // Normal reel spin: open cells spin and STOP on their result, which sticks.
    for (const node of previous.values()) node.destroy({ children: true });
    const duds = new Set(dudDynamites(grid, landed).map(keyOf));
    await this.spinColumns(grid, spinning, duds, turbo, onLand);

    // New gold flies into the COLLECTED meter, THEN the meter counts up.
    const newBars = landed.filter(([c, r]) => grid[c]?.[r]?.symbol === "SAFE");
    if (newBars.length && !turbo) await this.collectFlight(newBars);
    this.setCollected(this.sumGrid(grid), true);

    // Dynamite with no gold bar beside it has nothing to blow. The engine sends
    // no blast for it, so it used to just sit there and vanish on the next spin;
    // now it visibly fizzles out right here and its cell goes back to a blank.
    if (duds.size) {
      await wait(turbo ? 40 : 160);
      await Promise.all([...duds].map((k) => this.fizzle(k.split(":").map(Number) as Position, turbo)));
    }

    // Resolve the respin meter AFTER the spin, as its OWN deliberate beat — the
    // reel settles first, THEN the player watches the spins count change. The
    // counter just rolls cleanly up/down (no floating callouts, no pips).
    if (landed.length > 0) {
      this.heat = 0;
      this.hitFlash();
      await wait(turbo ? 50 : 240);
      // Countdown rule: a lock HOLDS the meter (the number does not change), so
      // there is no number transition to play — just a confirming gold pulse.
      this.cue({ kind: "held" });
      this.spinsHeldBeat(turbo);
      await wait(turbo ? 60 : 420);
    } else {
      this.heat = Math.min(3, deadSpins);
      this.cue({ kind: "dead", heat: this.heat });
      // Police tape + the NO HIT stamp; resolves when the "-1" reaches the
      // spins meter, so the number drops on the frame it is hit. A final spin
      // that ends on the max win is an ESCAPE, never a bust.
      const maxWin = respins <= 0 && this.sumGrid(grid) >= MAX_WIN_MULTIPLIER;
      if (maxWin) await this.maxWinBeat(turbo);
      else await this.noHitBeat(this.heat, respins, turbo);
      this.cue({ kind: "spent", spinsLeft: respins });
      this.animateSpinsBeat(respins, turbo);
      await wait(turbo ? 80 : 470);
    }
  }

  /** Where the burning fuse sits on a dynamite node (node-local coords). */
  private fuseGeometry(node: Container): { tip: { x: number; y: number }; base: { x: number; y: number } } {
    const art = node.getChildByLabel("art");
    // FUSE_* are measured on the 640² art; rescale to the loaded texture.
    const s = art instanceof Sprite ? art.scale.x * (art.texture.width / 640) : 0;
    if (!s) {
      const h = node.height || 60;
      return { tip: { x: 0, y: -h * 0.34 }, base: { x: 0, y: -h * 0.24 } };
    }
    return { tip: { x: FUSE_TIP.x * s, y: FUSE_TIP.y * s }, base: { x: FUSE_BASE.x * s, y: FUSE_BASE.y * s } };
  }

  /**
   * A live fuse: a flickering hot spark on the tip, so a dynamite that WILL go
   * off reads as lit from the moment it lands until its blast. Lives on the
   * node (dies with it); crack() moves it down the fuse.
   */
  private lightFuse(node: Container): Graphics {
    const existing = node.getChildByLabel("spark");
    if (existing instanceof Graphics) return existing;
    const { tip } = this.fuseGeometry(node);
    const unit = Math.max(6, (node.width || 60) * 0.05);
    const spark = new Graphics();
    spark.label = "spark";
    spark.blendMode = "add";
    spark.position.set(tip.x, tip.y);
    node.addChild(spark);
    const cb = (_dt: number, elapsed: number): void => {
      // Stop with the node — destroyed, or just cleared off the board (hide()
      // detaches the grid without destroying it).
      if (spark.destroyed || !node.parent) { ambientTicker.remove(cb); return; }
      const f = 0.75 + 0.25 * Math.sin(elapsed * 41) * Math.sin(elapsed * 23 + 1.3);
      spark.clear();
      spark.circle(0, 0, unit * 1.9 * f).fill({ color: 0xff7a1a, alpha: 0.28 });
      spark.circle(0, 0, unit * 1.05 * f).fill({ color: 0xffc04a, alpha: 0.6 });
      spark.circle(0, 0, unit * 0.45).fill({ color: 0xfff6d0, alpha: 0.95 });
      // a few stray sparks spitting off
      for (let i = 0; i < 3; i++) {
        const a = elapsed * (7 + i * 3) + i * 2.1;
        const d = unit * (1.4 + ((elapsed * (3 + i)) % 1) * 1.6);
        spark.circle(Math.cos(a) * d, Math.sin(a) * d - unit * 0.4, unit * 0.16).fill({ color: 0xffe08a, alpha: 0.85 });
      }
    };
    ambientTicker.add(cb);
    node.once("destroyed", () => ambientTicker.remove(cb));
    return spark;
  }

  /**
   * A dud: no gold bar next to it, so there is nothing to blow — but the
   * player doesn't know that yet. The fuse catches and races down, sparks
   * spitting, the sticks shaking harder and the cell pulsing danger-red as the
   * riser climbs... then nothing: the spark pops out with a "pfft", a ring of
   * smoke, the sticks go limp and grey, and a DUD stamp slaps on with a wobble.
   * Tension, then the joke — the near-miss is what makes a player feel it.
   */
  private async fizzle(pos: Position, turbo: boolean): Promise<void> {
    const node = this.cells.get(keyOf(pos));
    if (!node) return;
    const rc = this.cellRect(pos[0], pos[1]);
    const cx = rc.x + rc.w / 2;
    const cy = rc.y + rc.h / 2;
    const unit = Math.max(6, rc.w * 0.05);
    const { tip, base } = this.fuseGeometry(node);
    const art = node.getChildByLabel("art") as Sprite | null;
    const art0 = art ? { x: art.x, y: art.y, r: art.rotation, sx: art.scale.x, sy: art.scale.y } : null;

    // ── 1. THE BUILD: fuse races down, everything says it's about to blow ──
    const armMs = turbo ? 200 : 520;
    this.cue({ kind: "dud_arm", seconds: armMs / 1000 / getTimeScale() });
    const danger = this.glow(0xff4a14, cx, cy, rc.w * 1.6, rc.h * 1.6, this.fxLayer);
    danger.alpha = 0;
    const spark = new Container();
    spark.position.set(tip.x, tip.y);
    node.addChild(spark);
    const sparkGlow = this.glow(0xff9a2a, 0, 0, unit * 6, unit * 6, spark);
    const sparkCore = this.glow(0xffffff, 0, 0, unit * 2.2, unit * 2.2, spark);
    const spits: { s: Sprite; vx: number; vy: number; life: number }[] = [];
    let spitClock = 0;
    let phase = 0;
    let last = performance.now();
    await tween(armMs, (p) => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const e = easeInQuad(p);
      spark.position.set(tip.x + (base.x - tip.x) * e, tip.y + (base.y - tip.y) * e);
      const f = 0.8 + 0.35 * Math.sin(now * 0.06) * Math.sin(now * 0.037);
      sparkGlow.scale.set((unit * 6 / 128) * f * (1 + p));
      sparkCore.scale.set((unit * 2.2 / 128) * f * (1 + 0.5 * p));
      // sparks spitting off the fuse, faster as it burns down
      spitClock += dt;
      while (spitClock > 0.045 - 0.03 * p) {
        spitClock -= 0.045 - 0.03 * p;
        const sp = new Sprite(streakTexture());
        sp.anchor.set(1, 0.5);
        sp.blendMode = "add";
        sp.tint = Math.random() < 0.4 ? 0xffffff : 0xffc04a;
        sp.scale.set(0.18 + Math.random() * 0.14, 0.35);
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const v = unit * (0.5 + Math.random() * 0.7);
        sp.position.set(spark.x, spark.y);
        sp.rotation = a;
        node.addChild(sp);
        spits.push({ s: sp, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 });
      }
      for (let i = spits.length - 1; i >= 0; i--) {
        const d = spits[i]!;
        d.s.x += d.vx; d.s.y += d.vy; d.vy += unit * 0.08;
        d.s.rotation = Math.atan2(d.vy, d.vx);
        d.life -= dt * 3.2;
        d.s.alpha = Math.max(0, d.life);
        if (d.life <= 0) { d.s.destroy(); spits.splice(i, 1); }
      }
      // the sticks shake harder and harder
      if (art && art0 && !art.destroyed) {
        const amp = rc.w * 0.035 * p * p;
        art.position.set(art0.x + (Math.random() * 2 - 1) * amp, art0.y + (Math.random() * 2 - 1) * amp * 0.7);
        art.rotation = art0.r + (Math.random() * 2 - 1) * 0.06 * p;
      }
      // danger pulse, quickening
      phase += dt * (5 + 22 * p);
      danger.alpha = (0.12 + 0.5 * p) * (0.55 + 0.45 * Math.sin(phase * Math.PI));
    }, linear);
    for (const d of spits) d.s.destroy();
    if (art && art0 && !art.destroyed) { art.position.set(art0.x, art0.y); art.rotation = art0.r; }

    // ── 2. ...PFFT ──
    this.cue({ kind: "dud" });
    const sx = spark.x, sy = spark.y;
    spark.destroy({ children: true });
    void tween(turbo ? 120 : 260, (p) => { danger.alpha = 0.35 * (1 - p); }, easeOutCubic).then(() => danger.destroy());
    // a last few sparks pop out and drop dead
    const nodeX = node.x, nodeY = node.y;
    const pops: { s: Sprite; vx: number; vy: number }[] = [];
    for (let i = 0; i < (turbo ? 3 : 7); i++) {
      const d = new Sprite(sparkDotTexture());
      d.anchor.set(0.5);
      d.blendMode = "add";
      d.tint = 0xffb050;
      d.scale.set(0.3 + Math.random() * 0.25);
      d.position.set(nodeX + sx, nodeY + sy);
      this.fxLayer.addChild(d);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = unit * (0.25 + Math.random() * 0.35);
      pops.push({ s: d, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
    }
    void simulate(520, (k, t) => {
      for (const d of pops) {
        d.s.x += d.vx * k; d.s.y += d.vy * k; d.vy += unit * 0.05 * k;
        d.s.alpha = 1 - t;
        d.s.tint = t > 0.3 ? 0x6b5a48 : 0xffb050; // embers cool to ash
      }
    }).then(() => pops.forEach((d) => d.s.destroy()));
    // ring of smoke + lazy wisps
    const smoke: { s: Sprite; a: number; rise: number }[] = [];
    if (!turbo) {
      for (let i = 0; i < 10; i++) {
        const sm = this.glow(0x8d9198, nodeX + sx, nodeY + sy, unit * 4, unit * 3, this.fxLayer, false);
        sm.alpha = 0;
        smoke.push({ s: sm, a: (i / 10) * Math.PI * 2, rise: 0 });
      }
      for (let i = 0; i < 4; i++) {
        const sm = this.glow(0xa7abb2, nodeX + sx + (Math.random() - 0.5) * unit * 2, nodeY + sy, unit * 3, unit * 4, this.fxLayer, false);
        sm.alpha = 0;
        smoke.push({ s: sm, a: NaN, rise: 0.5 + Math.random() * 0.5 });
      }
    }
    const smokeBase = smoke.map((m) => m.s.scale.x);
    void tween(900, (p) => {
      smoke.forEach((m, i) => {
        if (Number.isNaN(m.a)) {
          m.s.y = nodeY + sy - p * rc.h * 0.7 * m.rise;
          m.s.x += Math.sin(p * 6 + i) * 0.3;
          m.s.alpha = 0.45 * Math.sin(Math.min(1, p * 1.2) * Math.PI);
          m.s.scale.set(smokeBase[i]! * (1 + 1.5 * p));
        } else {
          const r = unit * (1 + 6 * easeOutCubic(p));
          m.s.position.set(nodeX + sx + Math.cos(m.a) * r, nodeY + sy + Math.sin(m.a) * r * 0.55 - p * unit * 2);
          m.s.alpha = 0.5 * (1 - p) * Math.min(1, p * 8);
          m.s.scale.set(smokeBase[i]! * (1 + 1.2 * p));
        }
      });
    }, linear).then(() => smoke.forEach((m) => m.s.destroy()));

    // the sticks go limp: wilt over, squash down, cool to charcoal
    if (art && art0 && !art.destroyed) {
      void tween(turbo ? 160 : 420, (p) => {
        if (art.destroyed) return;
        const e = easeOutBack(Math.min(1, p));
        art.rotation = art0.r + 0.32 * e;
        art.scale.set(art0.sx * (1 + 0.05 * e), art0.sy * (1 - 0.1 * e));
        art.position.set(art0.x + rc.w * 0.04 * e, art0.y + rc.h * 0.06 * e);
        const v = Math.round(255 - 150 * Math.min(1, p * 1.3));
        art.tint = (v << 16) | (v << 8) | v;
      }, linear);
    }
    this.jolt = Math.max(this.jolt, turbo ? 1 : 2.5);

    // ── 3. DUD — a grey stamp slaps on and wobbles ──
    await wait(turbo ? 40 : 110);
    const size = Math.min(56, rc.h * 0.5);
    const label = new Text({
      text: "DUD",
      style: new TextStyle({
        fontFamily: DISPLAY_FONT, fontSize: size, letterSpacing: 2, padding: 12,
        fill: new FillGradient({ start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
          { offset: 0, color: 0xffffff }, { offset: 0.48, color: 0xd5dbe3 }, { offset: 0.52, color: 0x9aa3ae }, { offset: 1, color: 0x5f6873 },
        ] }),
        stroke: { color: 0x101317, width: 7, join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 0, distance: 4, angle: Math.PI / 2 },
      }),
    });
    label.anchor.set(0.5);
    label.position.set(cx, cy + rc.h * 0.08);
    label.rotation = -0.16;
    label.scale.set(1.9);
    label.alpha = 0;
    this.fxLayer.addChild(label);
    await tween(turbo ? 70 : 110, (p) => { label.alpha = p; label.scale.set(1.9 - 0.9 * easeInCubic(p)); }, linear);
    // contact: a little dust puff and a wobble
    if (!turbo) {
      for (let i = 0; i < 5; i++) {
        const dust = this.glow(0x9aa0a8, cx + (i - 2) * size * 0.35, cy + rc.h * 0.08 + size * 0.35, size * 0.7, size * 0.45, this.fxLayer, false);
        const d0 = dust.scale.x;
        void tween(360, (p) => { dust.alpha = 0.4 * (1 - p); dust.scale.set(d0 * (1 + p)); dust.y -= 0.3; }).then(() => dust.destroy());
      }
    }
    await tween(turbo ? 160 : 460, (p) => {
      const w = Math.sin(p * Math.PI * 4) * Math.exp(-p * 4);
      label.rotation = -0.16 + w * 0.18;
      label.scale.set(1 + w * 0.08, 1 - w * 0.06);
    }, linear);
    await wait(turbo ? 60 : 220);

    // ── 4. Back to a blank cell ──
    const logoTex = getExtraTexture("heat_chase_logo_symbol") ?? getExtraTexture("heat_chase_logo");
    const blank = this.buildEmptyFace(pos[0], pos[1], logoTex);
    blank.alpha = 0;
    this.placeCell(pos, blank);
    await tween(turbo ? 90 : 240, (p) => {
      blank.alpha = p;
      if (!node.destroyed) node.alpha = 1 - p;
      label.alpha = 1 - p;
      label.y = cy + rc.h * 0.08 - 8 * p;
    }, linear);
    label.destroy();
    node.destroy({ children: true });
  }

  /**
   * Dynamite, as one readable beat: it doubles every gold bar next to it.
   *   1. ARM — the bars it will hit light up with a "×2" tag while the spark
   *      runs down the fuse and the sticks tremble (the player sees exactly
   *      what is about to happen, and to which bars).
   *   2. BOOM — the blast, on the frame the spark reaches the sticks.
   *   3. ×2 — each target bar doubles on its OWN beat: punch, new value, the
   *      money gained, a hit climbing in pitch, COLLECTED ticking up.
   *   4. The spent cell goes back to a blank, ready to be refilled.
   */
  async crack(keyPos: Position, affected: Array<{ position: Position; newValue: number }>, turbo: boolean): Promise<void> {
    this.blasts++;
    const kc = this.cellRect(keyPos[0], keyPos[1]);
    const cx = kc.x + kc.w / 2;
    const cy = kc.y + kc.h / 2;
    const reach = Math.max(kc.w, kc.h);
    const dyn = this.cells.get(keyOf(keyPos));
    const dynArt = dyn ? dyn.children.filter((ch) => ch.label === "art") : [];

    // Highest multiplier of affected safes
    const maxVal = affected.reduce((max, a) => Math.max(max, a.newValue), 1);

    // ── 1. ARM ─────────────────────────────────────────────────────────────
    const armMs = turbo ? 220 : 640;
    const zone = new Graphics();
    zone.blendMode = "add";
    this.fxLayer.addChild(zone);
    const chips = affected.map((a) => this.targetChip(a.position));
    const spark = dyn ? this.lightFuse(dyn) : null;
    const fuse = dyn ? this.fuseGeometry(dyn) : null;
    const artPos = dynArt.map((ch) => ({ x: ch.x, y: ch.y }));
    this.cue({ kind: "fuse", seconds: armMs / 1000 / getTimeScale() });
    await tween(armMs, (p) => {
      if (spark && fuse && !spark.destroyed) {
        const e = easeInQuad(p);
        spark.position.set(fuse.tip.x + (fuse.base.x - fuse.tip.x) * e, fuse.tip.y + (fuse.base.y - fuse.tip.y) * e);
      }
      // The sticks tremble harder as the spark nears them.
      const amp = reach * 0.02 * p * p;
      dynArt.forEach((ch, i) => {
        if (ch.destroyed) return;
        ch.position.set(artPos[i]!.x + Math.sin(p * 97) * amp, artPos[i]!.y + Math.cos(p * 83) * amp * 0.6);
      });
      // Blast reach: every bar it will double pulses hot, faster as it burns.
      const pulse = 0.5 + 0.5 * Math.sin(p * Math.PI * (4 + 6 * p));
      zone.clear();
      for (const a of affected) {
        const nc = this.cellRect(a.position[0], a.position[1]);
        zone.roundRect(nc.x + 3, nc.y + 3, nc.w - 6, nc.h - 6, 8).fill({ color: 0xff7a1a, alpha: 0.08 + 0.1 * pulse * p });
        zone.roundRect(nc.x + 3, nc.y + 3, nc.w - 6, nc.h - 6, 8).stroke({ color: 0xffa640, width: 2.5, alpha: 0.35 + 0.55 * pulse });
      }
      const pop = Math.min(1, p / 0.3);
      chips.forEach((chip) => { chip.alpha = pop; chip.scale.set(0.4 + 0.6 * easeOutBack(pop)); });
    }, linear);
    dynArt.forEach((ch, i) => { if (!ch.destroyed) ch.position.set(artPos[i]!.x, artPos[i]!.y); });
    zone.destroy();
    chips.forEach((chip) => chip.destroy({ children: true }));
    spark?.destroy();

    // ── 2. BOOM ────────────────────────────────────────────────────────────
    this.cue({ kind: "boom", power: Math.min(1, affected.length / 4 + maxVal / 100) });

    // Dynamic scale of the explosion based on multiplier
    const explosionRadius = reach * (1.1 + Math.min(1.0, maxVal * 0.015));

    // Screen thud/shake scaling with max multiplier
    const shakeIntensity = 3 + Math.min(4, maxVal * 0.12);
    const shakeDuration = turbo ? 180 : 320;
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

    // White-hot detonation core — a fast additive flash AT the dynamite cell.
    const core = this.glow(0xfff3d0, cx, cy, reach * 0.9, reach * 0.9, this.fxLayer);
    const coreS = core.scale.x;
    void tween(turbo ? 160 : 300, (p) => {
      core.scale.set(coreS * (0.5 + 1.4 * p));
      core.alpha = 1 - p;
    }, easeOutCubic).then(() => core.destroy());

    // GPU bloom pulse over the whole grid — the frame "blows out" for a beat.
    if (!turbo) void pulseBloom(this.lockedLayer, { scale: 0.35, duration: 320 });

    // Blast light: a radial orange bloom from the dynamite outward (not a flat
    // full-screen tint) — the grid is lit FROM the explosion.
    const blastLight = this.glow(0xff9a3a, cx, cy, reach * 6, reach * 6, this.fxLayer);
    blastLight.alpha = 0.7;

    // Fireball: layered additive puffs that start white-hot and cool through
    // yellow and orange as they billow out and rise.
    const fireN = turbo ? 7 : 14;
    const fire: { s: Sprite; vx: number; vy: number; grow: number; spin: number }[] = [];
    for (let i = 0; i < fireN; i++) {
      const a = (i / fireN) * Math.PI * 2 + Math.random() * 0.6;
      const sp = (0.35 + Math.random() * 0.65) * explosionRadius;
      const f = this.glow(0xffffff, cx, cy, reach * 0.42, reach * 0.42, this.fxLayer);
      fire.push({ s: f, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - reach * 0.25, grow: 1.4 + Math.random() * 1.6, spin: (Math.random() - 0.5) * 2 });
    }
    const fireTint = (t: number): number => (t < 0.12 ? 0xffffff : t < 0.3 ? 0xffe27a : t < 0.55 ? 0xffa03a : 0xff5a1a);
    // Smoke: darker, slower, rising wisps behind the fire (normal blend).
    const smoke: { s: Sprite; vx: number; vy: number }[] = [];
    if (!turbo) {
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const sm = this.glow(0x2b2725, cx, cy, reach * 0.5, reach * 0.5, this.fxLayer, false);
        sm.alpha = 0;
        this.fxLayer.setChildIndex(sm, 0);
        smoke.push({ s: sm, vx: Math.cos(a) * reach * 0.5, vy: -reach * (0.5 + Math.random() * 0.5) });
      }
    }
    this.shardsAt(cx, cy, 0xffc45a, turbo ? 8 : 16, null, 1.25);

    // ── 3. ×2, one bar at a time, while the fireball is still alive ──────
    const doubling = (async () => {
      await wait(turbo ? 60 : 150);
      for (let i = 0; i < affected.length; i++) {
        if (i > 0) await wait(turbo ? 70 : 210);
        const a = affected[i]!;
        const nc = this.cellRect(a.position[0], a.position[1]);
        const tx = nc.x + nc.w / 2;
        const ty = nc.y + nc.h / 2;
        const node = this.cells.get(keyOf(a.position));
        this.cue({ kind: "double", index: i });
        // A jolt of energy from the blast into the bar it doubles.
        this.energyArc(cx, cy, tx, ty, turbo);
        if (node) {
          this.updateGoldValue(node, a.newValue);
          this.burstAt(tx, ty, Math.min(nc.w, nc.h), 0xffd25a, turbo, 0.9);
          this.barPulse(node, turbo, 0.24);
          this.punchNumber(node, turbo);
        }
        // Doubling: the money gained is the other half of the new value.
        this.floatWinBadge(nc.x + nc.w / 2, nc.y + nc.h * 0.30, a.newValue / 2, turbo);
        // COLLECTED climbs with each bar, in step with its badge.
        this.setCollected(this.collectedTarget + a.newValue / 2, true);
      }
    })();

    const duration = turbo ? 260 : 650 + Math.min(350, maxVal * 4);
    // The sticks blow apart: only the art grows (the cell's own backdrop stays
    // put, so it never covers the neighbours being doubled).
    const artScales = dynArt.map((ch) => ch.scale.x);
    const fireBase = fire.map((f) => f.s.scale.x);
    const smokeBase = smoke.map((m) => m.s.scale.x);
    // The spent cell fades back to a blank while the smoke clears, so there is
    // no dead black hole where the dynamite was.
    const logoTex = getExtraTexture("heat_chase_logo_symbol") ?? getExtraTexture("heat_chase_logo");
    const blank = this.buildEmptyFace(keyPos[0], keyPos[1], logoTex);
    blank.alpha = 0;

    await Promise.all([
      shakePromise,
      doubling,
      tween(duration, (p) => {
        blastLight.alpha = 0.7 * Math.max(0, 1 - p * 2.2);
        fire.forEach((f, i) => {
          f.s.position.set(cx + f.vx * p, cy + f.vy * p);
          f.s.scale.set(fireBase[i]! * (0.6 + f.grow * Math.sin(Math.min(1, p * 1.15) * Math.PI * 0.5)));
          f.s.tint = fireTint(p);
          f.s.rotation = f.spin * p;
          f.s.alpha = p < 0.08 ? p / 0.08 : Math.max(0, 1 - (p - 0.08) / 0.92) * 0.95;
        });
        smoke.forEach((m, i) => {
          const q = Math.max(0, (p - 0.15) / 0.85);
          m.s.position.set(cx + m.vx * q, cy + m.vy * q);
          m.s.scale.set(smokeBase[i]! * (1 + 2.2 * q));
          m.s.alpha = 0.55 * Math.sin(Math.min(1, q) * Math.PI);
        });
        dynArt.forEach((ch, i) => {
          if (ch.destroyed) return;
          ch.scale.set(artScales[i]! * (1 + p * 0.8));
          ch.alpha = Math.max(0, 1 - p * 3);
        });
        if (p > 0.45) {
          if (!blank.parent) this.placeCell(keyPos, blank);
          blank.alpha = Math.min(1, (p - 0.45) / 0.4);
        }
      }, easeOutCubic)
    ]);

    blastLight.destroy();
    fire.forEach((f) => f.s.destroy());
    smoke.forEach((m) => m.s.destroy());

    // ── 4. The spent cell is a blank again (the engine clears it too) ──────
    if (!blank.parent) this.placeCell(keyPos, blank);
    dyn?.destroy({ children: true });
    if (blank.alpha < 1) await tween(turbo ? 60 : 160, (p) => { blank.alpha = Math.max(blank.alpha, p); }, linear);
    blank.alpha = 1;
    await wait(turbo ? 40 : 120);
  }

  /** A crackling arc of energy from the blast into a bar being doubled. */
  private energyArc(x0: number, y0: number, x1: number, y1: number, turbo: boolean): void {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const beam = new Sprite(streakTexture());
    beam.anchor.set(1, 0.5);
    beam.blendMode = "add";
    beam.tint = 0xffd36a;
    beam.position.set(x1, y1);
    beam.rotation = Math.atan2(dy, dx);
    beam.height = 14;
    beam.width = 1;
    this.fxLayer.addChild(beam);
    const bolt = new Graphics();
    bolt.blendMode = "add";
    this.fxLayer.addChild(bolt);
    void tween(turbo ? 140 : 280, (p) => {
      const grow = Math.min(1, p / 0.35);
      beam.width = len * grow;
      beam.alpha = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65;
      // jagged core along the same line
      bolt.clear();
      if (p < 0.7) {
        const n = 7;
        const pts: number[] = [];
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * grow;
          const jitter = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 12;
          pts.push(x0 + dx * t - (dy / len) * jitter, y0 + dy * t + (dx / len) * jitter);
        }
        bolt.poly(pts, false).stroke({ color: 0xfff4c8, width: 2, alpha: 1 - p });
      }
    }, linear).then(() => { beam.destroy(); bolt.destroy(); });
  }

  /** The value on a bar punches up big and settles — the ×2 lands on the number. */
  private punchNumber(node: Container, turbo: boolean): void {
    const num = node.getChildByLabel("num");
    if (!num) return;
    const s0 = num.scale.x;
    void tween(turbo ? 160 : 360, (p) => {
      if (num.destroyed) return;
      num.scale.set(s0 * (1 + 0.7 * (1 - easeOutBack(p))));
    }, linear).then(() => { if (!num.destroyed) num.scale.set(s0); });
  }

  /** The "×2" tag a target bar wears while the fuse burns. */
  private targetChip(pos: Position): Container {
    const rc = this.cellRect(pos[0], pos[1]);
    const h = Math.max(14, Math.min(24, rc.h * 0.24));
    const c = new Container();
    const t = new Text({
      text: "×2",
      style: new TextStyle({ fill: 0xffffff, fontFamily: FONT, fontSize: h * 0.72, fontWeight: "900", letterSpacing: 0.5 }),
    });
    t.anchor.set(0.5);
    const w = Math.max(h * 1.5, t.width + h * 0.6);
    const pill = new Graphics();
    pill.roundRect(-w / 2, -h / 2, w, h, h / 2).fill(0xe8561a).stroke({ color: 0xffd08a, width: 1.5 });
    c.addChild(pill, t);
    c.position.set(rc.x + rc.w - w / 2 - 4, rc.y + h / 2 + 4);
    c.alpha = 0;
    this.fxLayer.addChild(c);
    return c;
  }

  /**
   * Premium payout badge: the REAL MONEY gained, big and gold, with a small
   * "×2" tag — cinematic gold-on-ink (matches the result card), not the old
   * blue arcade chip. Pops with an overshoot, hangs so it can be read, fades.
   */
  private floatWinBadge(x: number, y: number, gainedX: number, turbo: boolean): void {
    const c = new Container();
    c.position.set(x, y);
    const cell = this.cellRect(0, 0);

    const moneyStr = this.betAmount > 0 ? `+${fmtMoneyNum(gainedX * this.betAmount)}` : `+${fmtX(gainedX)}`;
    const money = new Text({
      text: moneyStr,
      style: new TextStyle({
        fill: GOLD_HI, fontFamily: FONT, fontSize: Math.min(28, cell.h * 0.30), fontWeight: "700", letterSpacing: 0,
        stroke: { color: GOLD_DEEP, width: 3 },
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 6, distance: 2, angle: Math.PI / 2 }
      })
    });
    money.anchor.set(0.5);
    this.fit(money, cell.w * 0.8);

    const tag = new Text({
      text: "×2",
      style: new TextStyle({
        fill: 0xffffff, fontFamily: FONT, fontSize: 16, fontWeight: "900", letterSpacing: 1,
        stroke: { color: 0x000000, width: 3 }
      })
    });
    tag.anchor.set(0.5);
    tag.position.set(0, -money.height * 0.72);

    // Soft additive glow behind the number so it lifts off the busy blast frame.
    const glow = new Graphics();
    glow.ellipse(0, 0, money.width * 0.6, money.height * 0.65).fill({ color: GOLD, alpha: 0.15 });
    glow.blendMode = "add";

    c.addChild(glow, money, tag);
    this.fxLayer.addChild(c);
    c.alpha = 0;
    c.scale.set(0.2);

    const dur = turbo ? 500 : 1050;
    void tween(dur, (p) => {
      // Overshoot pop in the first 22%, then a slow readable drift up + fade.
      const pop = Math.min(1, p / 0.22);
      c.scale.set(0.2 + 0.8 * easeOutBack(pop));
      c.y = y - Math.min(36, cell.h * 0.3) * p;
      c.alpha = p < 0.12 ? p / 0.12 : p > 0.72 ? (1 - p) / 0.28 : 1;
      glow.alpha = 1 - p;
    }, linear).then(() => c.destroy());
  }

  /** The Getaway has its own payout stage and audio, independent of base wins. */
  async finish(filled: boolean, totalX: number, turbo: boolean, autoDismiss = false, audio?: GetawayResultAudio): Promise<void> {
    // Finale tally: the haul lights up bar by bar, in reading order, before the
    // payout screen takes over — the chase ends on the loot, not on a cut.
    if (!turbo) {
      const bars = [...this.cells.entries()]
        .filter(([, n]) => !n.destroyed && n.getChildByLabel("plate"))
        .map(([k, n]) => ({ n, c: Number(k.split(":")[0]), r: Number(k.split(":")[1]) }))
        .sort((a, b) => a.r - b.r || a.c - b.c);
      const step = bars.length > 12 ? 45 : 70;
      for (const { n, c, r } of bars) {
        const rc = this.cellRect(c, r);
        this.barPulse(n, false, 0.18);
        this.burstAt(rc.x + rc.w / 2, rc.y + rc.h / 2, Math.min(rc.w, rc.h) * 0.8, 0xffd25a, true, 0.7);
        await wait(step);
      }
      if (bars.length) await wait(320);
    }
    this.stopAmbient();
    this.heat = 0;
    this.police.clear();
    this.setCollected(totalX, false);
    this.result?.destroy();
    this.result = new GetawayResult();
    // The payout screen is opaque once its entrance lands; stop drawing the
    // chase underneath it (the full-screen police blur alone is a heavy pass).
    const result = this.result;
    const coverTimer = window.setTimeout(() => {
      if (this.result === result) this.setSceneLayersVisible(false);
    }, (turbo ? 260 : 520) / getTimeScale());
    try {
      const bars = [...this.cells.values()].filter((n) => !n.destroyed && n.getChildByLabel("plate")).length;
      await result.present({
        filled, totalX, turbo, autoDismiss, audio, bet: this.betAmount, currency: this.currency,
        stats: { bars, blasts: this.blasts, spins: this.spinsPlayed },
      });
    } finally {
      window.clearTimeout(coverTimer);
    }
  }

  private setSceneLayersVisible(on: boolean): void {
    this.bgLayer.visible = on;
    this.lightLayer.visible = on;
    this.rig.visible = on;
    this.police.visible = on;
    this.hudLayer.visible = on;
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

  hide(): void {
    this.visible = false;
    this.prepared = false;
    this.clearBustedGrade();
    this.introLights = false;
    this.lightLayer.removeChildren().forEach((child) => child.destroy());
    this.stopAmbient();
    this.setSceneLayersVisible(true);
    // Destroy, not just detach: every gold bar / badge carries Text textures
    // that otherwise stayed alive on the GPU after each feature.
    for (const layer of [this.gridLayer, this.lockedLayer, this.dividerLayer, this.fxLayer, this.hudLayer, this.truckLayer]) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
    this.bgLayer.removeChildren().forEach(child => child.destroy({ children: true }));
    this.miamiStreet = null;
    this.doorLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.cells.clear();
    this.truck = this.stars = null;
    this.collectedText = this.collectedUsdText = this.spinsLabel = this.spinsText = null;
    this.spinsBox = null;

  }

  // ── layer builders ───────────────────────────────────────────────────
  private buildHighway(): void {
    this.bgLayer.removeChildren().forEach(child => child.destroy({ children: true }));
    this.miamiStreet = null;
    this.highwaySpeed = HW_RATE_START;
    this.highwayAge = 0;   // enter the chase already travelling at speed
    const W = this.rect.width;
    const H = this.rect.height;

    const tex = getExtraTexture("chase_city");
    if (!tex) {
      // No art: fall back to the old near-black backdrop with a faint centre
      // glow so it still reads as a distant night skyline, not a dead void.
      const g = new Graphics();
      g.rect(0, 0, W, H).fill(0x03040a);
      g.ellipse(W / 2, H * HW_VP_FRAC_Y, W * 0.32, H * 0.16).fill({ color: 0x101a2e, alpha: 0.7 });
      g.filters = null;
      this.bgLayer.addChild(g);
      return;
    }

    const buildings = ["chase_hotel", "chase_club", "chase_apartments"]
      .map(key => getExtraTexture(key)).filter((texture): texture is Texture => !!texture);
    this.miamiStreet = new MiamiStreet(tex, W, H, getExtraTexture("getaway_palm"), buildings);
    this.bgLayer.addChild(this.miamiStreet);
    this.updateHighway(0, 0);
  }

  /** Fast side scenery against a quiet night skyline; truck framing is independent. */
  private updateHighway(dt: number, elapsed: number): void {
    if (!this.miamiStreet || this.miamiStreet.destroyed) return;
    this.highwayAge += dt;
    const ramp = Math.min(1, this.highwayAge / HW_RAMP_SECS);
    const cruise = HW_RATE_START + (HW_RATE_CRUISE - HW_RATE_START) * ramp;
    const target = cruise + this.shakeBoost * HW_RATE_SURGE + this.heat * HW_HEAT;
    this.highwaySpeed += (target - this.highwaySpeed) * Math.min(1, dt * 2);
    this.miamiStreet.update(dt, elapsed, this.highwaySpeed, this.heat);
  }

  /**
   * The armored truck with real, openable doors.
   *
   * The frame's cargo opening is transparent art, so the reel panel sits behind
   * it and shows through. Each door is a PerspectiveMesh — a true 4-corner
   * projective quad — laid exactly over its half of the opening. Shut, the pair
   * seals the window; `openDoors` then swings them out towards the camera.
   */
  private buildRevealTruck(frameTex: Texture, dl: Texture, dr: Texture): void {
    const o = this.opening();
    const truck = new Container();

    // Reel backdrop goes down FIRST, behind the frame, so it fills the opening.
    // Flat black — the same colour every symbol uses for its cell, so the grid
    // reads on a clean dark panel and the highway stays a BACKDROP around the truck.
    const pad = 6;
    const panel = new Graphics();
    panel.rect(o.x - pad, o.y - pad, o.width + pad * 2, o.height + pad * 2).fill({ color: REEL_BG });
    truck.addChild(panel);

    const scale = o.width / (TRUCK_OPENING.wFrac * frameTex.width);
    const sprite = new Sprite(frameTex);
    sprite.anchor.set(0.5);
    sprite.scale.set(scale);
    sprite.position.set(
      o.x + o.width / 2 - (TRUCK_OPENING.cxFrac - 0.5) * frameTex.width * scale,
      o.y + o.height / 2 - (TRUCK_OPENING.cyFrac - 0.5) * frameTex.height * scale
    );
    // The source's black-background key also erased dark paint/bumper pixels.
    // Seat the unchanged artwork on opaque steel INSIDE its existing outline.
    // This follows the exact sprite transform and stays behind the cargo panel;
    // no city scenery can show through the chassis or taillight housings.
    const steel = new Graphics();
    const outline = [64,74, 982,74, 982,730, 1001,881, 1035,906,
      1035,959, 984,978, 64,978, 12,959, 12,907, 35,887, 49,730];
    steel.poly(outline.map((value, index) => value - (index % 2 ? 983 : 1048) / 2)).fill(0x16191c);
    steel.scale.set(scale * frameTex.width / 1048, scale * frameTex.height / 983);
    steel.position.copyFrom(sprite.position);
    truck.addChildAt(steel, 0);
    truck.addChild(sprite);
    this.truckLayer.addChild(truck);
    this.truck = truck;

    // Doors start shut: 8 vertices across is plenty for a smooth projective warp.
    // The hinge shadow goes down first so it sits UNDER both doors.
    this.doorShadow = new Graphics();
    // Inner faces (what the brinks plates actually show) plus the outer faces used
    // while the doors are shut. setDoorAngle() swaps between them at square.
    this.doorInner = [dl, dr];
    this.doorOuter = [getExtraTexture("truck_door_outer_l") ?? dl,
                      getExtraTexture("truck_door_outer_r") ?? dr];
    this.doorL = new PerspectiveMesh({ texture: this.doorOuter[0], verticesX: 8, verticesY: 8 });
    this.doorR = new PerspectiveMesh({ texture: this.doorOuter[1], verticesX: 8, verticesY: 8 });
    this.doorLayer.addChild(this.doorShadow, this.doorL, this.doorR);
    this.setDoorAngle(0);
  }

  /**
   * Pose both doors at `deg` open, as a genuine 3D rotation about the vertical
   * hinge line where each door meets the truck's side pillar.
   *
   * The hinge edge has z = 0, so it never moves — that is what keeps the doors
   * looking bolted to the truck. The free (inner) edge swings towards the
   * camera, so it both narrows horizontally (cos) and, being nearer, projects
   * LARGER (the perspective divide). That combination is what sells the 3D.
   */
  private setDoorAngle(deg: number): void {
    if (!this.doorL || !this.doorR) return;
    const o = this.opening();
    const half = o.width / 2;
    const cx = o.x + o.width / 2;
    const cy = o.y + o.height / 2;
    const camera = o.width * DOOR_CAM_DIST;

    // Each door reaches a few px PAST the centre line so their inner edges
    // overlap. Both plates carry a soft alpha margin, and butting them exactly
    // edge-to-edge let the dark background show through as a seam.
    const span = half + DOOR_SEAM_OVERLAP;

    const rad = (deg * Math.PI) / 180;
    const reach = span * Math.cos(rad);   // how far the free edge still spans
    const depth = span * Math.sin(rad);   // how far it has come towards us
    const mag = camera / Math.max(1, camera - depth); // perspective divide

    const projY = (y: number): number => cy + (y - cy) * mag;
    const top = o.y, bot = o.y + o.height;
    const freeTop = projY(top), freeBot = projY(bot);

    // setCorners maps texture (0,0),(1,0),(1,1),(0,1) onto the four points in
    // order, so the plate renders MIRRORED whenever the first corner sits to the
    // right of the second. That matters here because the doors swing PAST square
    // (DOOR_OPEN_DEG > 90): cos() turns negative, the free edge crosses over its
    // own hinge and the quad flips horizontally halfway through the swing. Pinning
    // a fixed corner order therefore gets the painted "6" badge right in one state
    // and backwards in the other — closed or open, pick your poison.
    //
    // So the order is chosen per frame: whichever corner is further LEFT on screen
    // is fed first. The plate is then never mirrored, the badge reads correctly at
    // every angle, and the door looks the same coming and going. The cost is that
    // past square the hardware (latch rod vs hinge plates) swaps sides — invisible
    // on a slab of riveted steel, unlike a reversed glyph.
    const plate = (
      door: PerspectiveMesh,
      hingeX: number, freeX: number
    ): void => {
      if (freeX >= hingeX) door.setCorners(hingeX, top, freeX, freeTop, freeX, freeBot, hingeX, bot);
      else door.setCorners(freeX, freeTop, hingeX, top, hingeX, bot, freeX, freeBot);
    };

    // A door shut shows its OUTSIDE; past square you are looking at its INSIDE.
    // The game re-uses one plate per door, so the plate itself has to change over
    // — otherwise the closed doors display interior latch rods and lock boxes.
    if (this.doorOuter && this.doorInner) {
      const inside = deg > 90;
      const [l, r] = inside ? this.doorInner : this.doorOuter;
      if (this.doorL.texture !== l) this.doorL.texture = l;
      if (this.doorR.texture !== r) this.doorR.texture = r;
    }

    // Left door: hinged on the opening's left edge, free edge sweeping right.
    const lFreeX = cx + (o.x + reach - cx) * mag;
    plate(this.doorL, o.x, lFreeX);

    // Right door: mirrored — hinged on the right edge, free edge sweeping left.
    const rHingeX = o.x + o.width;
    const rFreeX = cx + (rHingeX - reach - cx) * mag;
    plate(this.doorR, rHingeX, rFreeX);

    // Surfaces turning off-axis catch less light.
    // CLAMPED: a negative angle makes sin() negative, which pushed the channel
    // to 256 and produced 0x1010100 — a 25-bit value Pixi rejects outright,
    // throwing inside the tween and freezing the doors mid-swing.
    const shade = Math.min(1, Math.max(0, 1 - 0.42 * Math.sin(Math.max(0, rad))));
    const ch = Math.min(255, Math.max(0, Math.round(0xff * shade)));
    const tint = (ch << 16) | (ch << 8) | ch;
    this.doorL.tint = tint;
    this.doorR.tint = tint;

    // Contact shadow: as a door swings away it exposes the recess it was
    // sitting in, so a soft dark band grows along its hinge inside the opening.
    // This is what stops the doors looking pasted on top of the truck.
    if (this.doorShadow) {
      const g = this.doorShadow;
      g.clear();
      const open = Math.min(1, Math.abs(Math.sin(rad)));
      if (open > 0.01) {
        const band = Math.max(3, o.width * 0.030);
        for (let i = 0; i < 4; i++) {
          const t = i / 4;
          const a = 0.5 * open * (1 - t);
          const wStep = band * (1 - t * 0.35);
          g.rect(o.x - wStep - 8, o.y, wStep, o.height).fill({ color: 0x000000, alpha: a });
          g.rect(o.x + o.width + 8, o.y, wStep, o.height).fill({ color: 0x000000, alpha: a });
        }
      }
    }
  }

  /**
   * The widest swing that still leaves the doors on screen.
   *
   * Past 90 degrees the doors reach outward beyond the truck, which is what
   * gives them a substantial face instead of a sliver — but in portrait the
   * opening is 90% of the screen width, so there is barely any room outside it
   * and a full swing would fling them off the edge. Walk the angle back until
   * the outer edge fits, so wide layouts get the full 115 and narrow ones get
   * the most they can hold.
   */
  private restAngle(): number {
    const o = this.opening();
    const half = o.width / 2;
    const cx = o.x + o.width / 2;
    const span = half + DOOR_SEAM_OVERLAP;
    const camera = o.width * DOOR_CAM_DIST;
    const margin = this.rect.width * 0.015;

    // Never wind back below this: at 90 the door is edge-on and reads as a
    // sliver, which is worse than being cropped by the screen edge. Portrait
    // (opening = 90% of the width) has no room outside the truck at all, so
    // there it simply keeps the full swing and lets the edge crop it.
    const FLOOR = 100;
    for (let deg = DOOR_OPEN_DEG; deg > FLOOR; deg -= 1) {
      const rad = (deg * Math.PI) / 180;
      const depth = span * Math.sin(rad);
      const mag = camera / Math.max(1, camera - depth);
      const freeX = cx + (o.x + span * Math.cos(rad) - cx) * mag;
      if (freeX >= margin) return deg;
    }
    return FLOOR;
  }

  /** Doors instantly at rest, open (turbo, or resuming mid-feature). */
  private snapDoorsOpen(): void {
    this.doorsOpen = true;
    this.setDoorAngle(this.restAngle());
  }

  /**
   * THE REVEAL — the doors unlatch and swing out towards the player, stopping
   * part-way so they stay wide and clearly three-dimensional.
   */
  async openDoors(turbo: boolean): Promise<void> {
    if (this.doorsOpen || !this.doorL || !this.doorR) return;
    this.doorsOpen = true;

    const rest = this.restAngle();
    if (turbo) { this.setDoorAngle(rest); return; }

    // Strain against the latch, then give. abs() keeps it OUTWARD only — a
    // negative angle would rotate the door back into the truck, which is both
    // impossible and what was overflowing the shade calculation.
    await tween(200, (p) => {
      this.setDoorAngle(Math.abs(Math.sin(p * Math.PI * 5)) * (1 - p) * 1.8);
    }, linear);

    // Heavy doors: they accelerate away, then settle back against their stops.
    await tween(780, (p) => {
      const e = easeOutCubic(p);
      const overshoot = Math.sin(p * Math.PI) * 5 * (1 - p);
      this.setDoorAngle(rest * e + overshoot);
    }, linear);
    this.setDoorAngle(rest);
  }

  private buildTruck(): void {
    this.truckLayer.removeChildren();
    this.doorLayer.removeChildren();
    this.doorL = this.doorR = null;
    this.doorShadow = null;
    this.doorsOpen = false;

    const frameTex = getExtraTexture("truck_frame_open");
    const dl = getExtraTexture("truck_door_l");
    const dr = getExtraTexture("truck_door_r");
    if (frameTex && dl && dr) {
      this.buildRevealTruck(frameTex, dl, dr);
      return;
    }

    const tex = getExtraTexture("brinks_truck_frame");
    const truck = new Container();
    const o = this.opening();
    if (tex) {
      // Scale & place the truck so its door opening lands exactly on opening().
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const scale = o.width / (TRUCK_OPENING_LEGACY.wFrac * tex.width);
      sprite.scale.set(scale);
      const truckH = tex.height * scale;
      sprite.position.set(
        o.x + o.width / 2,
        o.y + o.height / 2 - (TRUCK_OPENING_LEGACY.cyFrac - 0.5) * truckH
      );
      truck.addChild(sprite);
    } else {
      truck.addChild(this.procTruck());
    }

    // ONE flat, uniform reel surface inside the opening (overscanned a few px to
    // cover any truck-interior bleed). It is the exact same colour every symbol
    // uses for its cell background, so the backgrounds vanish and only the symbol
    // art is ever seen scrolling.
    const pad = 6;
    const panel = new Graphics();
    panel.rect(o.x - pad, o.y - pad, o.width + pad * 2, o.height + pad * 2).fill({ color: REEL_BG });
    truck.addChild(panel);

    this.truckLayer.addChild(truck);
    this.truck = truck;
  }

  private buildDividers(): void {
    this.dividerLayer.removeChildren().forEach((child) => child.destroy());
    const o = this.opening();
    this.aperture.clear().rect(o.x - 1, o.y - 1, o.width + 2, o.height + 2).fill(REEL_BG);
    this.apertureMask.clear().rect(o.x, o.y, o.width, o.height).fill(0xffffff);
    this.dividerLayer.addChild(this.buildApertureTrim(o));
  }

  /**
   * The seam where the grid meets the truck.
   *
   * The grid is a flat REEL_BG rectangle; the truck around it is painted art. A
   * hard-edged black ring laid over that art reads as a pasted-on rectangle —
   * a lip in a colour that belongs to neither side, which is exactly what made
   * the bonus grid's edges look wrong. The rectangle also cannot be aligned to
   * the painted opening on every screen size, so the lip is a different width
   * on each side.
   *
   * So the ring is not hard-edged any more. Going outward from the grid the
   * reel colour FADES to nothing over `FEATHER` px, which leaves no seam to
   * misalign: wherever the edge lands it is the grid's own colour dissolving
   * into the art. Going inward, a matching soft shadow seats the grid INSIDE
   * the cargo bay instead of floating on top of it, and a single warm hairline
   * — the game's gold, not a stray grey-green — draws the aperture itself.
   */
  private buildApertureTrim(o: Rect): Graphics {
    const trim = new Graphics();
    const FEATHER = 20;  // reel colour dissolving outward into the truck art
    const SEAT = 9;      // inner shadow seating the grid into the opening
    const steps = 14;
    // Outward: rectangular bands, drawn as four strips each so no fill ever
    // crosses into the opening. Bands do not overlap, so each one's alpha IS
    // the coverage at that distance — no stacking to reason about, and the
    // outer cells are never dimmed by their own trim.
    for (let i = 1; i <= steps; i++) {
      // A touch of inward bleed hides the antialiased seam between bands.
      const inner = Math.max(0, (FEATHER * (i - 1)) / steps - 0.6);
      const outer = (FEATHER * i) / steps;
      // Saturated for the first few px so no truck art bleeds through right at
      // the grid edge, then a smooth falloff to nothing.
      const alpha = Math.min(1, Math.pow(1 - (i - 0.5) / steps, 1.6) * 1.18);
      const x = o.x - outer;
      const y = o.y - outer;
      const w = o.width + outer * 2;
      const h = o.height + outer * 2;
      const t = outer - inner;
      const paint = { color: REEL_BG, alpha };
      trim.rect(x, y, w, t).fill(paint);
      trim.rect(x, y + h - t, w, t).fill(paint);
      trim.rect(x, y + t, t, h - t * 2).fill(paint);
      trim.rect(x + w - t, y + t, t, h - t * 2).fill(paint);
    }
    // Inward: a soft contact shadow, drawn as bands so it never hides a symbol.
    for (let i = 0; i < steps; i++) {
      const inset = (SEAT * i) / steps;
      trim
        .rect(o.x + inset, o.y + inset, o.width - inset * 2, o.height - inset * 2)
        .stroke({ color: 0x000000, width: SEAT / steps + 0.8, alpha: 0.06 * (1 - i / steps), alignment: 0 });
    }
    // One hairline for the aperture, in the same gold as the rest of the feature.
    trim.rect(o.x, o.y, o.width, o.height).stroke({ color: GOLD, width: 1, alpha: 0.22, alignment: 0.5 });
    return trim;
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
    this.hudLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const W = this.rect.width;
    const H = this.rect.height;
    const panel = new Container();
    this.hudLayer.addChild(panel);
    this.hudPanel = panel;

    // Small kicker title at the very top
    const title = new Text({
      text: "THE GETAWAY",
      style: new TextStyle({ fill: 0xffd95c, fontFamily: FONT, fontSize: Math.max(16, Math.min(22, W / 38)), fontWeight: "900", letterSpacing: 5, dropShadow: { color: 0xff6a00, alpha: 0.6, blur: 12, distance: 0, angle: 0 } })
    });
    title.anchor.set(0.5, 0);
    title.position.set(W / 2, H * 0.022);
    panel.addChild(title);

    // 5 wanted stars, prominently below the title (drawn each frame in drawStars)
    const stars = new Graphics();
    panel.addChild(stars);
    this.stars = stars;

    // SPINS LEFT number, top-right — ticks down on a dead spin; a lock HOLDS it
    // (never up, never refilled). The count only falls, so the player always
    // knows exactly how close the feature is to ending.
    const box = new Container();
    box.position.set(W < H ? W / 2 : W * 0.88, H * (W < H ? 0.13 : 0.10));
    panel.addChild(box);
    this.spinsBox = box;
    // A proper instrument, not floating text: dark glass plate, gold rim.
    const valSize = Math.max(34, Math.min(52, W / 14));
    const plateW = Math.max(108, valSize * 2.4);
    const plateH = 22 + valSize * 1.18;
    const plateG = new Graphics();
    plateG.roundRect(-plateW / 2, -9, plateW, plateH, 12)
      .fill({ color: 0x07090f, alpha: 0.72 })
      .stroke({ color: GOLD, width: 2, alpha: 0.7 });
    plateG.roundRect(-plateW / 2 + 4, -5, plateW - 8, plateH - 8, 9).stroke({ color: GOLD_HI, width: 1, alpha: 0.18 });
    plateG.label = "plate";
    box.addChild(plateG);
    const sLabel = new Text({ text: "SPINS LEFT", style: new TextStyle({ fill: 0x9fb4d0, fontFamily: FONT, fontSize: 13, letterSpacing: 2 }) });
    sLabel.anchor.set(0.5, 0);
    sLabel.position.set(0, 0);
    box.addChild(sLabel);
    this.spinsLabel = sLabel;
    const sVal = new Text({ text: `${START_RESPINS}`, style: new TextStyle({ fill: 0xffd95c, fontFamily: FONT, fontSize: valSize, fontWeight: "900", dropShadow: { color: 0xff6a00, alpha: 0.6, blur: 8, distance: 0, angle: 0 } }) });
    sVal.anchor.set(0.5, 0);
    sVal.position.set(0, 16);
    box.addChild(sVal);
    this.spinsText = sVal;

    this.setSpins(START_RESPINS);

    // COLLECTED block, bottom-centre. Stacked UPWARD from the bottom edge so it
    // can never overflow: the old layout hung the multiplier off H*0.905 and put
    // the USD line a further (fontSize + 6) below it, which pushed the USD text
    // past the bottom of the view — the real-money total was clipped off-screen.
    const meterSize = Math.max(30, Math.min(46, W / 16));
    const usdSize = Math.max(15, Math.min(18, W / 46));
    const bottom = H * 0.962;

    const usd = new Text({ text: this.fmtTotal(0), style: new TextStyle({ fill: 0xd9e4f5, fontFamily: FONT, fontSize: usdSize, letterSpacing: 1.5, dropShadow: { color: 0x000000, alpha: 0.8, blur: 4, distance: 1, angle: Math.PI / 2 } }) });
    usd.anchor.set(0.5, 1);
    usd.position.set(W / 2, bottom);
    panel.addChild(usd);
    this.collectedUsdText = usd;

    // anchored at its BASELINE-BOTTOM so the count-up pulse grows upward, away
    // from the screen edge, instead of shoving the USD line out of frame.
    const val = new Text({ text: "0x", style: new TextStyle({ fill: 0xffd95c, fontFamily: FONT, fontSize: meterSize, fontWeight: "900", letterSpacing: 1, dropShadow: { color: 0xff6a00, alpha: 0.7, blur: 10, distance: 0, angle: 0 } }) });
    val.anchor.set(0.5, 1);
    val.position.set(W / 2, bottom - usdSize * 1.25 - 4);
    panel.addChild(val);
    this.collectedText = val;

    const label = new Text({ text: "COLLECTED", style: new TextStyle({ fill: 0x9fb4d0, fontFamily: FONT, fontSize: 13, letterSpacing: 3 }) });
    label.anchor.set(0.5, 1);
    label.position.set(W / 2, val.y - meterSize - 2);
    panel.addChild(label);
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
    const plate = this.spinsBox?.getChildByLabel("plate");
    if (plate) plate.tint = low ? 0xffb39a : 0xffffff;
  }

  /**
   * The respin meter changes after a spin — shown as ONE smooth, readable beat:
   * the old number rolls away while the new one drops/punches into place. No
   * floating "+1/−1" text and no pips (removed per request) — just the counter
   * cleanly updating. Turbo snaps instantly.
   *   lock=true  → a lock RESET the meter to full (a refill — punch beat; the
   *                value rises back to the budget, e.g. 2→3, or holds at 3)
   *   lock=false → a dead spin spent one  (roll down one)
   */
  /** Dead spin: old number falls away, new number drops in from above (a clean
   *  tick-down). Locks no longer route here — under the countdown rule the
   *  number never goes up, so a lock plays spinsHeldBeat instead. */
  private animateSpinsBeat(to: number, turbo: boolean): void {
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

    void tween(540, (p) => {
      ghost.alpha = 1 - p;
      ghost.y = baseY + 22 * p;
      ghost.scale.set(1 - 0.18 * p);
      sv.alpha = Math.min(1, p * 1.9);
      sv.y = baseY - 20 * (1 - easeOutBack(Math.min(1, p)));
    }).then(() => { ghost.destroy(); sv.alpha = 1; sv.y = baseY; sv.scale.set(1); });
  }

  /** Lock: the meter is HELD, not refilled — confirm it with a gold pulse on
   *  the unchanged number so the player reads "safe, same spins left". */
  private spinsHeldBeat(turbo: boolean): void {
    const sv = this.spinsText;
    const box = this.spinsBox;
    if (!sv || !box || turbo) return;
    void tween(480, (p) => {
      const s = Math.sin(Math.min(1, p) * Math.PI);
      box.scale.set(1 + s * 0.12);
      sv.style.dropShadow = { color: 0xffd95c, alpha: 0.5 + s * 0.5, blur: 8 + s * 10, distance: 0, angle: 0 };
    }).then(() => {
      box.scale.set(1);
      sv.style.dropShadow = { color: 0xff6a00, alpha: 0.6, blur: 8, distance: 0, angle: 0 };
    });
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
      // police-coloured light around the star...
      g.poly(this.starPoints(sx, y, r * 1.7, r * 0.78)).fill({ color, alpha: 0.16 * bright });
      g.poly(this.starPoints(sx, y, r * 1.32, r * 0.6)).fill({ color, alpha: 0.26 * bright });
      // ...on a warm white star with a coloured rim (the old tinted body read pink)
      const pts = this.starPoints(sx, y, r, r * 0.42);
      g.poly(pts).fill(0xfff6e2);
      g.poly(this.starPoints(sx, y - r * 0.08, r * 0.55, r * 0.24)).fill({ color: 0xffffff, alpha: 0.9 });
      g.poly(pts).stroke({ color, width: 2, alpha: 0.75 * bright + 0.2 });
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
    const heatPeak = this.busted ? 0.95 : [0.0, 0.55, 0.78, 1.0][this.heat] ?? 0;
    const peak = Math.max(heatPeak, this.introLights ? 0.5 : 0);
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
    // Kept to the lower CORNERS so the COLLECTED plate in the middle stays clean.
    src(W * 0.12, H * 1.0, W * 0.24, H * 0.2, POLICE_RED, red * peak * 0.85);
    src(W * 0.88, H * 1.0, W * 0.24, H * 0.2, POLICE_BLUE, blue * peak * 0.85);
    src(W * 0.14, H * 0.14, W * 0.20, H * 0.16, POLICE_RED, red * peak * 0.7);
    src(W * 0.86, H * 0.14, W * 0.20, H * 0.16, POLICE_BLUE, blue * peak * 0.7);
    // faint full-scene colour grade so the whole frame feels lit
    if (red > 0) this.police.rect(0, 0, W, H).fill({ color: POLICE_RED, alpha: red * peak * 0.07 });
    if (blue > 0) this.police.rect(0, 0, W, H).fill({ color: POLICE_BLUE, alpha: blue * peak * 0.07 });
  }

  // ── shared fx ─────────────────────────────────────────────────────────
  private glow(tint: number, x: number, y: number, w: number, h: number, parent: Container, additive = true): Sprite {
    const g = new Sprite(softGlowTexture());
    g.anchor.set(0.5);
    g.tint = tint;
    if (additive) g.blendMode = "add";
    g.position.set(x, y);
    g.width = w;
    g.height = h;
    parent.addChild(g);
    return g;
  }

  /** Impact burst on a cell: additive flash, white core, ring and shards. */
  private burstAt(x: number, y: number, size: number, color: number, turbo: boolean, power = 1): void {
    const flash = this.glow(color, x, y, size * 1.2 * power, size * 1.2 * power, this.fxLayer);
    const fs = flash.scale.x;
    void tween(turbo ? 160 : 320, (p) => {
      flash.scale.set(fs * (1 + 0.9 * p));
      flash.alpha = 0.95 * (1 - p) * (1 - p);
    }, easeOutCubic).then(() => flash.destroy());
    const core = this.glow(0xffffff, x, y, size * 0.55 * power, size * 0.55 * power, this.fxLayer);
    const cs = core.scale.x;
    void tween(turbo ? 110 : 210, (p) => {
      core.scale.set(cs * (1 + 0.4 * p));
      core.alpha = 1 - p;
    }, easeOutCubic).then(() => core.destroy());
    const ring = new Graphics();
    ring.circle(0, 0, size * 0.42).stroke({ color, width: 3 });
    ring.blendMode = "add";
    ring.position.set(x, y);
    ring.scale.set(0.5);
    this.fxLayer.addChild(ring);
    void tween(turbo ? 180 : 360, (p) => {
      ring.scale.set(0.5 + 0.9 * power * p);
      ring.alpha = 1 - p;
    }, easeOutCubic).then(() => ring.destroy());
    if (!turbo) this.shardsAt(x, y, color, Math.round(9 * power), null, power);
  }

  /** Light shards flying out of a point (full circle, or a cone around dir). */
  private shardsAt(x: number, y: number, color: number, count: number, dir: number | null, power: number, parent: Container = this.fxLayer): void {
    const list: { s: Sprite; vx: number; vy: number; len: number }[] = [];
    for (let i = 0; i < count; i++) {
      const sh = new Sprite(streakTexture());
      sh.anchor.set(1, 0.5);
      sh.blendMode = "add";
      sh.tint = i % 3 === 0 ? 0xffffff : color;
      sh.position.set(x, y);
      const a = dir === null ? (i / count) * Math.PI * 2 + Math.random() * 0.5 : dir + (Math.random() - 0.5) * 1.3;
      const sp = (3.5 + Math.random() * 4.5) * power;
      const len = 0.3 + Math.random() * 0.4;
      sh.scale.set(len, 0.5 + Math.random() * 0.3);
      sh.rotation = a;
      parent.addChild(sh);
      list.push({ s: sh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len });
    }
    void simulate(460, (k, t) => {
      const drag = Math.pow(0.9, k);
      for (const d of list) {
        d.s.x += d.vx * k;
        d.s.y += d.vy * k;
        d.vx *= drag;
        d.vy = d.vy * drag + 0.2 * k;
        d.s.rotation = Math.atan2(d.vy, d.vx);
        d.s.scale.x = d.len * (1 - 0.6 * t);
        d.s.alpha = 1 - t * t;
      }
    }).then(() => list.forEach((d) => d.s.destroy()));
  }

  /**
   * A gold bar that has STUCK: a recessed gold-rimmed slot with a warm glow
   * under the bar — the Hold & Spin "locked" read, so held loot never looks
   * like the reel filler scrolling past it. Idempotent.
   */
  private dressLocked(node: Container, col: number, row: number): void {
    if (node.getChildByLabel("plate")) return;
    const r = this.cellRect(col, row);
    const plate = new Container();
    plate.label = "plate";
    const slot = new Graphics();
    slot.roundRect(-r.w / 2 + 3, -r.h / 2 + 3, r.w - 6, r.h - 6, 10)
      .fill({ color: 0x2a1906, alpha: 0.6 })
      .stroke({ color: GOLD, width: 2, alpha: 0.8 });
    slot.roundRect(-r.w / 2 + 6.5, -r.h / 2 + 6.5, r.w - 13, r.h - 13, 8)
      .stroke({ color: GOLD_HI, width: 1, alpha: 0.28 });
    plate.addChild(slot);
    const warm = this.glow(0xffb43c, 0, 0, r.w * 1.0, r.h * 1.0, plate);
    warm.alpha = 0.3;
    node.addChildAt(plate, Math.min(1, node.children.length));
  }

  /** A held bar flaring once (doubling, finale tally). */
  private barPulse(node: Container, turbo: boolean, amount = 0.2): void {
    const art = node.children.filter((ch) => ch.label !== "spark" && ch.label !== "plate" && ch.label !== "fx" && ch !== node.children[0]);
    const scales = art.map((ch) => ch.scale.x);
    const plate = node.getChildByLabel("plate");
    void tween(turbo ? 140 : 300, (p) => {
      const k = Math.sin(p * Math.PI) * (1 - 0.35 * p);
      art.forEach((ch, i) => { if (!ch.destroyed) ch.scale.set(scales[i]! * (1 + amount * k)); });
      if (plate && !plate.destroyed) plate.alpha = 1 + k * 0.8;
    }, linear).then(() => {
      art.forEach((ch, i) => { if (!ch.destroyed) ch.scale.set(scales[i]!); });
      if (plate && !plate.destroyed) plate.alpha = 1;
    });
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

    // Solid black cell background so no transparent gaps appear at edges when
    // locked — exactly the panel colour, so the background is invisible.
    const cellBg = new Graphics();
    cellBg.rect(-r.w / 2, -r.h / 2, r.w, r.h).fill(REEL_BG);
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
        fill: 0xffffff, fontFamily: FONT, fontSize: Math.min(28, r.h * 0.32), fontWeight: "700",
        letterSpacing: 0, stroke: { color: 0x3a2400, width: 3 },
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
    if (num) {
      num.text = fmtX(value);
      num.scale.set(1);
      this.fit(num, this.opening().width / GRID_COLUMNS * 0.88);
    }
  }

  private buildDynamite(col: number, row: number): Container {
    const r = this.cellRect(col, row);
    const c = new Container();
    // Full-cell black background matching the panel so only the dynamite art is seen.
    const cellBg = new Graphics();
    cellBg.rect(-r.w / 2, -r.h / 2, r.w, r.h).fill(REEL_BG);
    c.addChild(cellBg);
    const tex = getExtraTexture("dynamite");
    if (tex) {
      const s = new Sprite(tex);
      s.label = "art";
      s.anchor.set(0.5);
      s.scale.set(Math.min((r.w * 0.92) / tex.width, (r.h * 0.92) / tex.height));
      c.addChild(s);
    } else {
      const g = new Graphics();
      g.label = "art";
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
   * The "blank" reel symbol: the Heat Chase logo on the SAME full-cell black
   * background every other symbol uses. It is a real, visible symbol, so no cell
   * is ever empty while spinning — but it's clearly the logo, not a gold/dynamite
   * win. Its background is the exact panel colour, so only the logo art is seen.
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
      // The watermark art ships pre-shaded (heat_chase_logo_symbol.webp), so the
      // alpha only has to mute it — it must still read as a symbol, but sit
      // back far enough that locked gold is what the eye goes to.
      logo.alpha = 0.55;
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
  private async spinColumns(grid: BonusCell[][], spinning: Position[], duds: Set<string>, turbo: boolean, onLand?: (i: number, n: number) => void): Promise<void> {
    if (!spinning.length) { await wait(turbo ? 60 : 240); return; }
    this.cue({ kind: "spin_start" });
    // Every landing gets its own beat, in the order the player sees them.
    const landCount = spinning.filter(([c, r]) => grid[c][r].symbol !== "EMPTY").length;
    let landIdx = 0;
    let barIdx = 0;
    const onLandOne = (pos: Position): void => {
      onLand?.(landIdx++, landCount);
      const cell = grid[pos[0]][pos[1]];
      if (cell.symbol === "SAFE") this.cue({ kind: "bar", index: barIdx++, value: cell.value ?? 0 });
      else if (cell.symbol === "MASTER_KEY") {
        this.cue({ kind: "dynamite" });
        // A dynamite that will go off stays visibly lit until its blast.
        const node = this.cells.get(keyOf(pos));
        if (node && !duds.has(keyOf(pos))) this.lightFuse(node);
      }
    };

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
  private spinOneColumn(grid: BonusCell[][], col: number, rows: number[], dur: number, turbo: boolean, onLandOne: (pos: Position) => void): Promise<void> {
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
    const logoTex = getExtraTexture("heat_chase_logo_symbol") ?? getExtraTexture("heat_chase_logo");

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
    // The screen in the window when the spin starts shows the resting blank
    // faces, so the reel starts from what was on screen instead of popping to
    // random filler on the first frame.
    for (let k = 1; k <= screens + 1; k++) for (let r = 0; r < GRID_ROWS; r++) {
      if (k === screens) {
        const face = this.buildEmptyFace(col, r, logoTex);
        face.position.set(cx, colTop + r * cellH + cellH / 2 + k * colH);
        strip.addChild(face);
      } else addFace(r, k, false);
    }

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
    const blurMax = turbo ? 5 : 10;
    const blur = new BlurFilter({ strength: blurMax, quality: 2 });
    blur.strengthX = 0;
    strip.filters = [blur];

    // Constant-speed spin (the continuous illusion) then a smooth settle. The
    // strip is one continuous run of faces, so symbols flow down and fresh ones
    // keep arriving from the top — never a visible disappear/re-pop.
    // Wind-up (a short lift before the launch) and a weighted stop (it runs a
    // touch past the line, then settles back) — the reel has mass.
    const kickPx = turbo ? 0 : cellH * 0.12;
    const overshootPx = turbo ? cellH * 0.04 : cellH * 0.09;
    return tween(dur, (p) => {
      const kick = p < 0.07 ? -kickPx * Math.sin((p / 0.07) * Math.PI) : 0;
      const u = (p - 0.84) / 0.16;
      const settle = u > 0 ? overshootPx * Math.sin(Math.min(1, u) * Math.PI) * (1 - 0.3 * u) : 0;
      strip.y = -travel * (1 - reelPos(p)) + kick + settle;
      blur.strengthY = blurMax * reelVel(p);   // blurry while fast, razor sharp at rest
    }, linear).then(async () => {
      strip.filters = null;
      blur.destroy();
      strip.destroy({ children: true });
      mask.destroy();
      this.cue({ kind: "column_stop", col });
      // Every stop is placed at once (no cell is ever blank)…
      const wins: Position[] = [];
      for (const r of rows) {
        const cell = grid[col][r];
        if (cell.symbol === "SAFE") {
          const bar = this.buildGoldBar(cell.value ?? 0, col, r);
          this.dressLocked(bar, col, r);
          this.placeCell([col, r], bar);
          wins.push([col, r]);
        } else if (cell.symbol === "MASTER_KEY") {
          this.placeCell([col, r], this.buildDynamite(col, r));
          wins.push([col, r]);
        }
        // EMPTY: leave a resting Heat Chase watermark so the logos never just
        // vanish when the reel stops (every cell stays consistent, spin or rest).
        else this.placeCell([col, r], this.buildEmptyFace(col, r, logoTex));
      }
      // …then each win in the column slams in on its OWN beat, top to bottom,
      // so two bars in one column are two hits, never one blurred together.
      const gap = turbo ? 40 : 110;
      await Promise.all(wins.map((pos, i) => wait(i * gap).then(() => {
        onLandOne(pos);
        return this.cellStopFx(pos, true, turbo);
      })));
    });
  }

  /** The impact when a reel stops on a WIN: the gold/dynamite punches in with a
   *  bright glint across the cell. Empty stops get nothing — the old expanding
   *  ring + grey puff circles were removed (they looked ugly). */
  private async cellStopFx(pos: Position, landed: boolean, turbo: boolean): Promise<void> {
    if (!landed) return;
    const node = this.cells.get(keyOf(pos));
    if (!node) return;
    const art = node.children.filter((child) => child.label !== "spark" && child.label !== "plate" && child.label !== "fx" && child !== node.children[0]);
    const scales = art.map((child) => child.scale.x);
    const plate = node.getChildByLabel("plate");
    const isGold = !!plate;
    const rc = this.cellRect(pos[0], pos[1]);
    const cx = rc.x + rc.w / 2;
    const cy = rc.y + rc.h / 2;
    const color = isGold ? 0xffc94a : 0xff8a2a;
    // Burst on contact (same frame as the landing sound)...
    this.burstAt(cx, cy, Math.min(rc.w, rc.h), color, turbo, isGold ? 1 : 0.85);
    // ...a white-hot flash of the art itself...
    const mainArt = art.find((ch) => ch instanceof Sprite) as Sprite | undefined;
    if (mainArt && !turbo) {
      const stamp = new Sprite(mainArt.texture);
      stamp.anchor.set(0.5);
      stamp.scale.copyFrom(mainArt.scale);
      stamp.position.set(cx, cy);
      stamp.blendMode = "add";
      this.fxLayer.addChild(stamp);
      const s0 = stamp.scale.x;
      void tween(300, (p) => { stamp.alpha = 0.75 * (1 - p); stamp.scale.set(s0 * (1 + 0.12 * p)); }, easeOutCubic)
        .then(() => stamp.destroy());
    }
    // ...and the bar SLAMS into its slot: drops in large, squashes on impact,
    // recovers with a little spring. The locked slot lights up beneath it.
    if (plate) plate.alpha = 0;
    await tween(turbo ? 130 : 300, (p) => {
      let k: number;
      if (p < 0.24) k = 1.38 - 0.46 * easeInQuad(p / 0.24);            // 1.38 → 0.92
      else k = 0.92 + 0.08 * easeOutBack((p - 0.24) / 0.76);          // 0.92 → 1 (spring)
      art.forEach((child, i) => { if (!child.destroyed) child.scale.set(scales[i]! * k); });
      if (plate && !plate.destroyed) plate.alpha = Math.min(1, Math.max(0, (p - 0.18) / 0.3));
    }, linear);
    art.forEach((child, i) => { if (!child.destroyed) child.scale.set(scales[i]!); });
    if (plate && !plate.destroyed) plate.alpha = 1;
  }

  /**
   * Police tape, drawn once per size on a 2D canvas: glossy caution yellow,
   * bold black "POLICE LINE · DO NOT CROSS" repeated, dark hem lines. A real
   * crime-scene object, so the miss reads as the cops shutting the haul down.
   */
  private tapeTexture(len: number, h: number): Texture {
    const key = `${Math.round(len)}x${Math.round(h)}`;
    const cached = this.tapeCache.get(key);
    if (cached) return cached;
    const k = 2;
    const W = Math.ceil(len * k), H = Math.ceil(h * k);
    if (typeof document === "undefined") return Texture.WHITE;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d")!;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#fff27a"); g.addColorStop(0.18, "#ffd60a");
    g.addColorStop(0.62, "#f5c400"); g.addColorStop(1, "#c99400");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // gloss band
    const gl = c.createLinearGradient(0, 0, 0, H);
    gl.addColorStop(0.08, "rgba(255,255,255,0.55)"); gl.addColorStop(0.3, "rgba(255,255,255,0)");
    c.fillStyle = gl; c.fillRect(0, 0, W, H * 0.4);
    // hems
    c.fillStyle = "#1a1405";
    c.fillRect(0, H * 0.07, W, H * 0.07);
    c.fillRect(0, H * 0.86, W, H * 0.07);
    // text
    c.font = `${Math.round(H * 0.5)}px 'Heat Display', Impact, sans-serif`;
    c.textBaseline = "middle";
    c.fillStyle = "#14100a";
    const unit = "POLICE LINE   \u2022   DO NOT CROSS   \u2022   ";
    const uw = c.measureText(unit).width;
    for (let x = -uw * 0.3; x < W; x += uw) c.fillText(unit, x, H * 0.52);
    // creases: faint darker diagonal folds so it reads as vinyl, not a bar
    for (let x = 60; x < W; x += 170 + (x % 90)) {
      const cr = c.createLinearGradient(x, 0, x + 26, 0);
      cr.addColorStop(0, "rgba(0,0,0,0)"); cr.addColorStop(0.5, "rgba(80,50,0,0.16)"); cr.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = cr; c.fillRect(x, 0, 26, H);
    }
    const tex = Texture.from(cv);
    this.tapeCache.set(key, tex);
    return tex;
  }
  private readonly tapeCache = new Map<string, Texture>();

  /**
   * The chase ends on the maximum win: no tape, no BUSTED, no wasted sting.
   * The police lights cut out, the grid flares gold bar by bar, and a MAX WIN
   * stamp slams in on a burst of light with the game's top-tier win sting.
   */
  private async maxWinBeat(turbo: boolean): Promise<void> {
    const o = this.opening();
    const cx = o.x + o.width / 2;
    const cy = o.y + o.height / 2;
    const size = Math.min(110, o.width / 3.8);
    this.heat = 0;
    this.cue({ kind: "maxwin" });

    // golden wash from the grid outward
    const wash = this.glow(0xffc95a, cx, cy, o.width * 2.2, o.height * 2.2, this.fxLayer);
    wash.alpha = 0;
    void tween(turbo ? 200 : 520, (p) => { wash.alpha = 0.55 * Math.sin(p * Math.PI); }, linear).then(() => wash.destroy());

    // every locked bar flares, in a fast sweep
    const bars = [...this.cells.entries()]
      .filter(([, n]) => !n.destroyed && n.getChildByLabel("plate"))
      .map(([k, n]) => ({ n, c: Number(k.split(":")[0]), r: Number(k.split(":")[1]) }))
      .sort((a, b) => (a.c + a.r) - (b.c + b.r));
    bars.forEach(({ n, c, r }, i) => {
      void wait(i * (turbo ? 12 : 30)).then(() => {
        const rc = this.cellRect(c, r);
        this.barPulse(n, turbo, 0.2);
        this.burstAt(rc.x + rc.w / 2, rc.y + rc.h / 2, Math.min(rc.w, rc.h) * 0.8, 0xffd25a, true, 0.8);
      });
    });

    // the stamp
    const stamp = new Container();
    stamp.position.set(cx, cy);
    stamp.rotation = -0.05;
    const band = new Graphics();
    const bw = o.width + 80, bh = size * 1.55, sk = bh * 0.3;
    band.poly([-bw / 2 + sk, -bh / 2, bw / 2 + sk * 0.2, -bh / 2, bw / 2 - sk, bh / 2, -bw / 2 - sk * 0.2, bh / 2])
      .fill({ color: 0x0b0710, alpha: 0.88 });
    band.rect(-bw / 2 + sk, -bh / 2 - 4, bw - sk * 0.8, 4).fill({ color: 0xffd25a });
    band.rect(-bw / 2 - sk * 0.2, bh / 2, bw - sk * 0.8, 4).fill({ color: 0x3fe3ff });
    const halo = this.glow(0xffc95a, 0, 0, bw * 1.2, bh * 2.4, stamp);
    halo.alpha = 0.5;
    stamp.addChild(band);
    const title = new Text({
      text: "MAX WIN",
      style: new TextStyle({
        fontFamily: DISPLAY_FONT, fontSize: size, letterSpacing: 4, padding: 18,
        fill: new FillGradient({ start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
          { offset: 0, color: 0xffffff }, { offset: 0.4, color: 0xfff1b8 }, { offset: 0.5, color: 0xffc23a }, { offset: 1, color: 0xff6a2a },
        ] }),
        stroke: { color: 0x2a1204, width: 9, join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 0, distance: 6, angle: Math.PI / 2 },
      }),
    });
    title.anchor.set(0.5);
    title.skew.x = -0.12;
    title.y = -size * 0.06;
    stamp.addChild(title);
    const sub = new Text({
      text: `CLEAN ESCAPE  \u2022  ${MAX_WIN_MULTIPLIER.toLocaleString("en-US")}\u00d7`,
      style: new TextStyle({ fontFamily: FONT, fontSize: Math.max(14, size * 0.2), fontWeight: "700", letterSpacing: 5, fill: 0xbff6ff, stroke: { color: 0x000000, width: 4 } }),
    });
    sub.anchor.set(0.5);
    sub.y = size * 0.55;
    stamp.addChild(sub);
    stamp.scale.set(2.4);
    stamp.alpha = 0;
    this.fxLayer.addChild(stamp);
    await wait(turbo ? 60 : 180);
    await tween(turbo ? 90 : 150, (p) => { stamp.alpha = Math.min(1, p * 3); stamp.scale.set(2.4 - 1.4 * easeInCubic(p)); }, linear);
    stamp.scale.set(1);
    this.jolt = Math.max(this.jolt, turbo ? 4 : 10);
    this.burstAt(cx, cy, Math.min(o.width, o.height), 0xffd25a, turbo, 1.7);
    this.shardsAt(cx, cy, 0x3fe3ff, turbo ? 6 : 14, null, 1.4);
    void tween(400, (p) => {
      const k = Math.sin(p * Math.PI * 2.4) * Math.exp(-p * 4.5);
      stamp.scale.set(1 + k * 0.08, 1 - k * 0.1);
    }, linear);
    await wait(turbo ? 350 : 1100);
    void tween(300, (p) => { stamp.alpha = 1 - p; stamp.y = cy - 14 * p; }, linear).then(() => stamp.destroy({ children: true }));
  }

  private clearBustedGrade(): void {
    this.slowmoTarget = 1;
    if (this.bustedGrade) {
      this.bgLayer.filters = null;
      this.bustedGrade.destroy();
      this.bustedGrade = null;
    }
  }

  /**
   * Dead spin — the cops shut it down. One strip of police tape (two once the
   * heat is up) whips across the reel window and slaps taut, a NO HIT stamp
   * slams onto a red alarm band in the middle, the camera kicks, the police
   * strobes flare from both sides, and a "-1" is torn off the stamp and flung
   * into the SPINS meter. On the final spin the stamp reads BUSTED.
   * Resolves when the "-1" lands (the caller drops the number then); the
   * tape and stamp clear away on their own afterwards.
   */
  private async noHitBeat(heat: number, spinsLeft: number, turbo: boolean): Promise<void> {
    const o = this.opening();
    const cx = o.x + o.width / 2;
    const cy = o.y + o.height / 2;
    const last = spinsLeft <= 0;
    const W = this.rect.width;
    const H = this.rect.height;
    const titleSize = Math.min(96, o.width / 4.2);

    // ── the stamp (built first: turbo still shows it) ──
    const stamp = new Container();
    stamp.position.set(cx, cy);
    stamp.rotation = -0.06;
    const bandH = titleSize * 1.45;
    const bandW = o.width + 70;
    const band = new Graphics();
    const sk = bandH * 0.32;
    band.poly([-bandW / 2 + sk, -bandH / 2, bandW / 2 + sk * 0.2, -bandH / 2, bandW / 2 - sk, bandH / 2, -bandW / 2 - sk * 0.2, bandH / 2])
      .fill({ color: 0x0a0204, alpha: 0.86 });
    // red edge lines that follow the slanted band exactly
    band.rect(-bandW / 2 + sk, -bandH / 2 - 4, bandW - sk * 0.8, 4).fill({ color: POLICE_RED });
    band.rect(-bandW / 2 - sk * 0.2, bandH / 2, bandW - sk * 0.8, 4).fill({ color: POLICE_RED });
    const bandGlow = this.glow(POLICE_RED, 0, 0, bandW * 1.15, bandH * 2.2, stamp);
    bandGlow.alpha = 0;
    stamp.addChild(band);
    const face = new FillGradient({ start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
      { offset: 0, color: 0xffffff }, { offset: 0.42, color: 0xffe0d2 },
      { offset: 0.5, color: last ? 0xff4a3a : 0xff7656 }, { offset: 1, color: 0xb80c22 },
    ] });
    const title = new Text({
      text: last ? "BUSTED" : "NO HIT",
      style: new TextStyle({
        fontFamily: DISPLAY_FONT, fontSize: titleSize, fill: face, letterSpacing: 3, padding: 18,
        stroke: { color: 0x1c0306, width: 9, join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 0, distance: 6, angle: Math.PI / 2 },
      }),
    });
    title.anchor.set(0.5);
    title.skew.x = -0.12;
    title.y = -titleSize * 0.06;
    stamp.addChild(title);
    const sub = new Text({
      text: last ? "THE CHASE IS OVER" : "\u2212 1  SPIN",
      style: new TextStyle({ fontFamily: FONT, fontSize: Math.max(14, titleSize * 0.2), fontWeight: "700", letterSpacing: 6, fill: 0xffd2c8, stroke: { color: 0x000000, width: 4 } }),
    });
    sub.anchor.set(0.5);
    sub.y = titleSize * 0.52;
    stamp.addChild(sub);

    // BUSTED rides the wasted sting: world drops to slow-mo on its first hit,
    // the stamp slams on its second (~2.5 s in, as in GTA).
    if (last) this.cue({ kind: "busted" });

    if (turbo) {
      stamp.scale.set(1.25);
      stamp.alpha = 0;
      this.fxLayer.addChild(stamp);
      await tween(110, (p) => { stamp.alpha = p; stamp.scale.set(1.25 - 0.25 * easeInCubic(p)); }, linear);
      this.cue({ kind: "nohit", heat, last });
      this.jolt = Math.max(this.jolt, 6);
      void wait(160).then(() => tween(110, (p) => { stamp.alpha = 1 - p; }, linear)).then(() => stamp.destroy({ children: true }));
      return;
    }

    // ── lights out + red alarm inside the window ──
    const dim = new Graphics().rect(o.x - 2, o.y - 2, o.width + 4, o.height + 4).fill(0x000000);
    dim.alpha = 0;
    this.fxLayer.addChild(dim);
    const alarm = this.glow(POLICE_RED, cx, cy, o.width * 1.5, o.height * 1.5, this.fxLayer);
    alarm.alpha = 0;
    void tween(160, (p) => { dim.alpha = 0.5 * p; alarm.alpha = 0.32 * p; }, easeOutCubic);

    // BUSTED: the world slows to a crawl and drains of colour, then the stamp lands on the sting's second hit.
    let wastedVeil: Graphics | null = null;
    const STAMP_HIT_MS = 2460;
    const bustedStart = performance.now();
    if (last) {
      this.slowmoTarget = 0.08;
      try {
        const cm = new ColorMatrixFilter();
        cm.desaturate();
        cm.alpha = 0;
        this.bgLayer.filters = [cm];
        this.bustedGrade = cm;
      } catch { /* filter unsupported: veil alone still sells it */ }
      wastedVeil = new Graphics().rect(0, 0, W, H).fill(0x0b0c12);
      wastedVeil.alpha = 0;
      this.lightLayer.addChild(wastedVeil);
      const veil = wastedVeil, grade = this.bustedGrade;
      void tween(900, (p) => {
        veil.alpha = 0.42 * p;
        if (grade) grade.alpha = p;
      }, easeOutCubic);
    }

    // ── police strobes flaring in from both edges ──
    const strobeL = this.glow(POLICE_RED, 0, H * 0.5, W * 0.75, H * 1.3, this.lightLayer);
    const strobeR = this.glow(POLICE_BLUE, W, H * 0.5, W * 0.75, H * 1.3, this.lightLayer);
    strobeL.alpha = strobeR.alpha = 0;
    const flashes = heat >= 2 || last ? 3 : 2;
    void tween(600, (p) => {
      const ph = p * flashes;
      const k = ph % 1;
      const on = Math.sin(k * Math.PI) ** 2;
      const red = Math.floor(ph) % 2 === 0;
      strobeL.alpha = red ? 0.55 * on : 0;
      strobeR.alpha = red ? 0 : 0.6 * on;
    }, linear).then(() => { strobeL.destroy(); strobeR.destroy(); });

    // ── police tape: whips in along its own length and slaps taut ──
    const tapeH = Math.max(30, Math.min(54, o.height * 0.1));
    const tapeLen = Math.hypot(o.width, o.height) * 1.12;
    const strips = heat >= 2 || last ? 2 : 1;
    const tapes: Container[] = [];
    const travel = 110;
    const tapeLead = last ? 120 : 0; // busted: tape lands on the sting's first hit
    const slapAt = (i: number): number => tapeLead + i * 75 + travel;
    const placeTape = async (i: number): Promise<void> => {
      await wait(tapeLead + i * 75);
      const angle = i === 0 ? -0.2 : 0.17;
      const ty = cy + (i === 0 ? -o.height * 0.16 : o.height * 0.2);
      const holder = new Container();
      holder.position.set(cx, ty);
      holder.rotation = angle;
      const shadow = new Graphics().rect(-tapeLen / 2, -tapeH / 2 + 7, tapeLen, tapeH).fill({ color: 0x000000, alpha: 0.4 });
      const tape = new Sprite(this.tapeTexture(tapeLen, tapeH));
      tape.anchor.set(0.5);
      tape.width = tapeLen;
      tape.height = tapeH;
      holder.addChild(shadow, tape);
      this.fxLayer.addChild(holder);
      tapes.push(holder);
      const dir = i === 0 ? -1 : 1; // comes in from the left, then the right
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const from = tapeLen * 1.05 * dir;
      if (!last) this.cue({ kind: "tape", index: i, seconds: travel / 1000 / getTimeScale() });
      await tween(travel, (p) => {
        const d = from * (1 - easeInCubic(p));
        holder.position.set(cx + ux * d, ty + uy * d);
        holder.scale.set(1, 1 - 0.18 * (1 - p)); // stretched thin in flight
      }, linear);
      holder.position.set(cx, ty);
      this.jolt = Math.max(this.jolt, 4);
      // slap: snaps past taut, then flutters to rest
      void tween(520, (p) => {
        const wob = Math.sin(p * Math.PI * 7) * Math.exp(-p * 5);
        holder.rotation = angle + wob * 0.05;
        holder.scale.set(1 + wob * 0.012, 1 - Math.abs(wob) * 0.06);
        shadow.y = wob * 3;
      }, linear);
    };
    const tapesDone = Promise.all(Array.from({ length: strips }, (_, i) => placeTape(i)));

    // ── the stamp slams on top ──
    const stampStart = slapAt(strips - 1) - 30;
    if (last) {
      // hold the slow-mo until the sting's second hit (wall clock — the
      // audio does not follow __slow), the alarm breathing slowly meanwhile
      const until = STAMP_HIT_MS - 130 - (performance.now() - bustedStart);
      if (until > 0) {
        void tween(until, (p) => { alarm.alpha = 0.22 + 0.14 * Math.sin(p * Math.PI * 3); }, linear);
        await new Promise<void>((r) => window.setTimeout(r, until));
      }
    } else {
      await wait(stampStart);
    }
    stamp.scale.set(2.6);
    stamp.alpha = 0;
    this.fxLayer.addChild(stamp);
    const ghosts: Text[] = [];
    let lastGhost = 0;
    await tween(130, (p) => {
      const s2 = 2.6 - 1.6 * easeInCubic(p);
      stamp.scale.set(s2);
      stamp.alpha = Math.min(1, p * 3);
      band.scale.set(0.55 + 0.45 * p, 1);
      if (p - lastGhost > 0.3 && p < 0.9) {
        lastGhost = p;
        const ghost = new Text({ text: title.text, style: title.style });
        ghost.anchor.set(0.5);
        ghost.skew.x = title.skew.x;
        ghost.blendMode = "add";
        ghost.tint = POLICE_RED;
        ghost.alpha = 0.35;
        ghost.position.copyFrom(stamp.position);
        ghost.rotation = stamp.rotation;
        ghost.scale.set(s2 * 1.08);
        this.fxLayer.addChildAt(ghost, this.fxLayer.getChildIndex(stamp));
        ghosts.push(ghost);
        void tween(200, (g) => { ghost.alpha = 0.35 * (1 - g); }).then(() => ghost.destroy());
      }
    }, linear);
    stamp.scale.set(1);
    band.scale.set(1, 1);

    // IMPACT
    this.cue({ kind: "nohit", heat, last });
    this.jolt = Math.max(this.jolt, last ? 16 : 11);
    this.burstAt(cx, cy, Math.min(o.width, o.height) * 0.9, POLICE_RED, false, last ? 1.6 : 1.25);
    this.shardsAt(cx, cy, 0xffb000, 10, null, 1.3);
    const flash = this.glow(0xffffff, cx, cy, o.width * 1.1, o.height * 0.7, this.fxLayer);
    const fs0 = flash.scale.x;
    void tween(260, (p) => { flash.alpha = 0.85 * (1 - p) * (1 - p); flash.scale.set(fs0 * (1 + 0.4 * p)); }, easeOutCubic)
      .then(() => flash.destroy());
    void tween(360, (p) => {
      // squash on contact, spring back
      const k = Math.sin(p * Math.PI * 2.4) * Math.exp(-p * 4.5);
      stamp.scale.set(1 + k * 0.08, 1 - k * 0.1);
      bandGlow.alpha = 0.55 * Math.exp(-p * 2) + 0.18;
    }, linear);

    // ── the "-1" is torn off and flung into the spins meter ──
    const target = this.spinsBox;
    await wait(last ? 260 : 200);
    if (target && !last) {
      const start = { x: cx + this.rig.x, y: cy + sub.y + this.rig.y };
      sub.alpha = 0.25;
      const chip = new Container();
      const chipGlow = this.glow(POLICE_RED, 0, 0, 120, 80, chip);
      chipGlow.alpha = 0.9;
      const chipText = new Text({ text: "\u22121", style: new TextStyle({ fontFamily: DISPLAY_FONT, fontSize: 40, fill: 0xffffff, stroke: { color: 0x3a0008, width: 6 }, padding: 8 }) });
      chipText.anchor.set(0.5);
      chip.addChild(chipText);
      chip.position.set(start.x, start.y);
      this.hudLayer.addChild(chip);
      const tx = target.x, ty = target.y + 42;
      const ctrlX = (start.x + tx) / 2 + 40, ctrlY = Math.min(start.y, ty) - 90;
      let lastTrail = 0;
      await tween(300, (p) => {
        const e = easeInCubic(p) * 0.6 + p * 0.4;
        const a = 1 - e;
        chip.x = a * a * start.x + 2 * a * e * ctrlX + e * e * tx;
        chip.y = a * a * start.y + 2 * a * e * ctrlY + e * e * ty;
        chip.scale.set(1.15 - 0.45 * p);
        chip.rotation = -0.4 * p;
        if (p - lastTrail > 0.1) {
          lastTrail = p;
          const tr = this.glow(POLICE_RED, chip.x, chip.y, 60, 60, this.hudLayer);
          void tween(220, (q) => { tr.alpha = 0.8 * (1 - q); }).then(() => tr.destroy());
        }
      }, linear);
      chip.destroy({ children: true });
      const hit = this.glow(POLICE_RED, tx, ty, 170, 120, this.hudLayer);
      const hs = hit.scale.x;
      void tween(320, (q) => { hit.alpha = 1 - q; hit.scale.set(hs * (1 + 0.5 * q)); }, easeOutCubic).then(() => hit.destroy());
      if (this.spinsBox) {
        const box = this.spinsBox;
        void tween(260, (q) => { box.x = tx + Math.sin(q * Math.PI * 5) * 6 * (1 - q); }, linear).then(() => { box.x = tx; });
      }
    }

    // ── clear away: tape is torn off, stamp lifts, lights come back ──
    void (async () => {
      await tapesDone;
      await wait(last ? 650 : 300);
      const t0 = tapes.map((t) => ({ t, x: t.x, y: t.y, r: t.rotation }));
      await tween(300, (p) => {
        const e = easeInCubic(p);
        stamp.alpha = 1 - p;
        stamp.y = cy - 14 * e;
        stamp.scale.set(1 + 0.06 * e);
        dim.alpha = 0.5 * (1 - p);
        alarm.alpha = 0.32 * (1 - p);
        t0.forEach(({ t, x, y, r }, i) => {
          const dir = i === 0 ? 1 : -1;
          t.x = x + dir * e * o.width * 1.2;
          t.y = y - e * 40;
          t.rotation = r + dir * e * 0.25;
          t.alpha = 1 - e;
        });
      }, linear);
      for (const t of tapes) t.destroy({ children: true });
      stamp.destroy({ children: true });
      dim.destroy();
      alarm.destroy();
      for (const g of ghosts) if (!g.destroyed) g.destroy();
      if (wastedVeil) {
        const veil = wastedVeil, grade = this.bustedGrade;
        await tween(320, (p) => { veil.alpha = 0.42 * (1 - p); if (grade && this.bustedGrade === grade) grade.alpha = 1 - p; }, linear);
        veil.destroy();
        this.clearBustedGrade();
      }
    })();
  }

  private hitFlash(): void {
    const W = this.rect.width;
    const H = this.rect.height;
    const f = new Graphics();
    this.fxLayer.addChild(f);
    void tween(360, (p) => {
      f.clear();
      const blue = p < 0.5;
      f.rect(0, 0, W, H).fill({ color: blue ? POLICE_BLUE : POLICE_RED, alpha: (1 - p) * 0.09 });
    }).then(() => f.destroy());
  }

  // ── ambient + totals ─────────────────────────────────────────────────
  private startAmbient(): void {
    this.stopAmbient();
    this.rig.position.set(0, 0);
    this.truckLayer.position.set(0, 0);
    this.gridLayer.position.set(0, 0);
    this.lockedLayer.position.set(0, 0);
    this.fxLayer.position.set(0, 0);
    this.shakeBoost = 0;
    this.slowmo = this.slowmoTarget = 1;
    this.ambientCb = (dt, elapsed) => {
      this.slowmo += (this.slowmoTarget - this.slowmo) * Math.min(1, dt * 4);
      this.updateHighway(dt * this.slowmo, elapsed);
      this.drawStars(elapsed);
      this.drawPolice(elapsed);
      this.driveShake(dt, elapsed);
      this.updateStreetLights(dt);
      this.updateGlints(dt);
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
    const amp = (1.6 + this.heat * 0.6 + this.shakeBoost * 2.6) * this.slowmo;
    this.jolt *= Math.exp(-dt * 11);
    const jx = this.jolt > 0.05 ? (Math.random() * 2 - 1) * this.jolt : 0;
    const jy = this.jolt > 0.05 ? (Math.random() * 2 - 1) * this.jolt * 0.75 : 0;
    const ox = rx * amp + jx;
    const oy = (ry + bob) * amp + jy;
    this.rig.position.set(ox, oy);
  }

  private stopAmbient(): void {
    if (this.ambientCb) { ambientTicker.remove(this.ambientCb); this.ambientCb = null; }
  }

  /**
   * Street lamps passing overhead: every second or so a warm band of light
   * rolls over the truck from top to bottom, faster as the chase speeds up.
   * It is what makes the truck itself feel like it is moving through the city,
   * not just the scenery beside it.
   */
  private updateStreetLights(dt: number): void {
    this.sweepTimer -= dt * (this.highwaySpeed / HW_RATE_CRUISE);
    if (this.sweepTimer > 0) return;
    this.sweepTimer = 1.05 + Math.random() * 0.5;
    const W = this.rect.width;
    const H = this.rect.height;
    const band = this.glow(0xffb468, W / 2, -H * 0.35, W * 1.15, H * 0.55, this.lightLayer);
    band.alpha = 0;
    const dur = 700 / Math.max(0.7, this.highwaySpeed / HW_RATE_CRUISE);
    void tween(dur, (p) => {
      if (band.destroyed) return;
      band.y = -H * 0.35 + H * 1.7 * p;
      band.alpha = 0.16 * Math.sin(p * Math.PI);
    }, linear).then(() => band.destroy());
  }

  /** Locked gold catches the light: one bar at a time gets a quick shine. */
  private updateGlints(dt: number): void {
    this.glintTimer -= dt;
    if (this.glintTimer > 0) return;
    this.glintTimer = 0.45 + Math.random() * 0.6;
    const locked = [...this.cells.values()].filter((n) => !n.destroyed && n.parent && n.getChildByLabel("plate"));
    if (!locked.length) return;
    const node = locked[(Math.random() * locked.length) | 0]!;
    const art = node.children.find((ch) => ch instanceof Sprite && ch.label !== "spark") as Sprite | undefined;
    if (!art) return;
    const w = art.width;
    const h = art.height;
    const shine = new Sprite(streakTexture());
    shine.anchor.set(0.5);
    shine.blendMode = "add";
    shine.rotation = -0.55;
    shine.width = h * 1.1;
    shine.height = Math.max(6, h * 0.16);
    shine.alpha = 0;
    shine.label = "fx";
    node.addChild(shine);
    void tween(520, (p) => {
      if (shine.destroyed) return;
      shine.x = -w * 0.45 + w * 0.9 * p;
      shine.y = h * 0.1 - h * 0.2 * p;
      shine.alpha = 0.8 * Math.sin(p * Math.PI);
    }, easeInOutCubic).then(() => { if (!shine.destroyed) shine.destroy(); });
    // a twinkle on the bar's corner
    const tw = new Sprite(sparkDotTexture());
    tw.anchor.set(0.5);
    tw.blendMode = "add";
    tw.position.set(w * 0.3, -h * 0.28);
    tw.alpha = 0;
    tw.label = "fx";
    node.addChild(tw);
    void tween(600, (p) => {
      if (tw.destroyed) return;
      const k = Math.sin(p * Math.PI);
      tw.alpha = k;
      tw.scale.set(0.3 + 0.7 * k);
      tw.rotation = p * 1.2;
    }, linear).then(() => { if (!tw.destroyed) tw.destroy(); });
  }

  /** Gold orbs stream from each newly locked bar into the COLLECTED meter. */
  private async collectFlight(positions: Position[]): Promise<void> {
    const target = this.collectedText;
    if (!target) return;
    const tx = target.x;
    const ty = target.y - target.height * 0.5;
    const ox = this.rig.x;
    const oy = this.rig.y;
    const flights = positions.slice(0, 8).map(([c, r], i) => {
      const rc = this.cellRect(c, r);
      const x0 = rc.x + rc.w / 2 + ox;
      const y0 = rc.y + rc.h / 2 + oy;
      const orb = new Container();
      const halo = this.glow(0xffc23a, 0, 0, 46, 46, orb);
      halo.alpha = 0.9;
      this.glow(0xffffff, 0, 0, 16, 16, orb);
      orb.position.set(x0, y0);
      orb.scale.set(0.4);
      this.hudLayer.addChild(orb);
      const side = x0 < tx ? -1 : 1;
      const cxp = (x0 + tx) / 2 + side * 60;
      const cyp = Math.min(y0, ty) - 70;
      let lastTrail = 0;
      return wait(i * 70).then(() => tween(460, (p) => {
        const e = easeInCubic(p) * 0.65 + p * 0.35;
        const a = 1 - e;
        orb.x = a * a * x0 + 2 * a * e * cxp + e * e * tx;
        orb.y = a * a * y0 + 2 * a * e * cyp + e * e * ty;
        orb.scale.set(0.4 + 0.6 * Math.sin(Math.min(1, p * 1.4) * Math.PI * 0.5));
        if (p - lastTrail > 0.08) {
          lastTrail = p;
          const tr = this.glow(0xffb02a, orb.x, orb.y, 26, 26, this.hudLayer);
          void tween(240, (q) => { tr.alpha = 0.7 * (1 - q); tr.scale.set(tr.scale.x * 0.97); }).then(() => tr.destroy());
        }
      }, linear)).then(() => {
        orb.destroy({ children: true });
        const hit = this.glow(0xffd76a, tx, ty, 90, 60, this.hudLayer);
        const hs = hit.scale.x;
        void tween(260, (q) => { hit.alpha = 1 - q; hit.scale.set(hs * (1 + 0.6 * q)); }, easeOutCubic).then(() => hit.destroy());
      });
    });
    await Promise.all(flights);
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

  private collectedRevision = 0;

  private setCollected(total: number, animate: boolean): void {
    const revision = ++this.collectedRevision;
    this.collectedTarget = total;
    if (!this.collectedText) return;
    // The win is capped at the max win, so the meter never shows more.
    const paint = (raw: number): void => {
      const v = Math.min(MAX_WIN_MULTIPLIER, raw);
      if (this.collectedText) this.collectedText.text = fmtX(v);
      if (this.collectedUsdText) this.collectedUsdText.text = this.fmtTotal(v);
    };
    if (!animate || total <= this.collectedShown) {
      this.collectedShown = total;
      paint(total);
      return;
    }
    const start = this.collectedShown;
    void tween(320, (p) => {
      if (revision !== this.collectedRevision) return;
      const v = start + (total - start) * p;
      this.collectedShown = v;
      paint(v);
      this.collectedText?.scale.set(1 + Math.sin(p * Math.PI) * 0.12);
    }, easeOutCubic).then(() => {
      if (revision !== this.collectedRevision) return;
      this.collectedShown = total;
      paint(total);
      this.collectedText?.scale.set(1);
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
