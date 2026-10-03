import { Container, Graphics, Sprite, Text, BlurFilter } from "pixi.js";
import type { SymbolId } from "../domain";
import { SYMBOLS } from "../domain";
import { SYMBOL_ASSETS, getSymbolTexture, createSkelSymbol } from "./assets";
import type { SkelPlayer } from "./SkelPlayer";
import { makeText } from "./text";
import { easeInOutCubic, easeOutBack, easeOutCubic, easeOutQuad, linear, tween, ambientTicker, getTimeScale } from "./tween";
import { softGlowTexture } from "./fxTextures";
import { SymbolFlow, isSemantic, type ClipPlan, type LandSource } from "./symbolFlow";

/** How long a winner may sit in its held pose before it is released back to
 *  idle on its own (a win that no removal followed). ms at 1x time scale. */
const HOLD_SAFETY_MS = 2600;

export const WIN_ACCENT: Record<SymbolId, number> = {
  // Low Tier: Steel Blue
  BRASS: 0x74b9ff,
  KNIFE: 0x74b9ff,
  
  // Mid Tier: Golden Orange
  PISTOL: 0xfdcb6e,
  AMMO: 0xfdcb6e,
  DUFFEL: 0xfdcb6e,
  
  // Premium Tier: Magenta / Purple
  CASH: 0xe056fd,
  DIAMOND: 0xe056fd,
  BIKE: 0xe056fd,
  
  // Specials (Wilds): Electric Green
  WILD: 0x9ae64e,
  CAR_WILD: 0x9ae64e,
  
  // Scatters / Bonus: Neon Red & Pure Gold
  PHONE_SCATTER: 0xff4757,
  SAFE: 0xffd700,
  MASTER_KEY: 0xffd700,
  
  EMPTY: 0x000000
};
const HERO_SYMBOLS = new Set<SymbolId>(["CAR_WILD", "SAFE", "MASTER_KEY"]);

/** Lift curve: rise past the target to `peak`× of it, then settle onto it.
 *  Returned value is the 0→1 shape setLift() maps onto from→target. */
function popShape(peak: number): (p: number) => number {
  return (p) => (p < 0.55
    ? peak * easeOutCubic(p / 0.55)
    : peak - (peak - 1) * easeInOutCubic((p - 0.55) / 0.45));
}
export const DEFAULT_ACCENT = 0xffdf65;

export class SymbolView extends Container {
  readonly id: SymbolId;
  private readonly background = new Graphics();
  private readonly sprite: Sprite | null;
  private readonly labelText: Text;
  private readonly corner: Text;
  private readonly winGlow = new Graphics();
  private readonly shimmer = new Graphics();
  private readonly shimmerMask = new Graphics();
  private readonly topSheen = new Graphics();
  private widthValue = 0;
  private heightValue = 0;
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;
  private blurFilter: BlurFilter | null = null;
  /** 2D skeletal player (tools/skel-pipeline bundle). When present it replaces
   *  the static sprite entirely: idle loops on the ambient ticker, win/vanish
   *  play the authored skeletal animations. */
  private readonly skel: SkelPlayer | null = null;
  private readonly skelFitW: number = 1;
  private readonly skelFitH: number = 1;
  private skelCb: ((dt: number) => void) | null = null;
  /** Clip-flow state (idle / land / win / hold / destroy) for skeletal symbols. */
  private readonly flow: SymbolFlow | null = null;
  /** Completion callback of the clip on screen; resolved early if a newer clip
   *  interrupts it, so nothing awaiting a clip can hang. */
  private pendingComplete: (() => void) | null = null;
  private holdTimer: number | null = null;
  private highlighted = false;
  private settleToken = 0;
  /** Soft additive accent bloom behind a winning symbol (breathes while lit). */
  private winPlate: Sprite | null = null;
  private plateCb: ((dt: number, elapsed: number) => void) | null = null;
  /** Presentation scale on top of the cell fit — winners lift toward the
   *  player. Multiplies the rig's own transform, never replaces its motion. */
  private lift = 1;
  private liftToken = 0;
  private dimToken = 0;

  /** Sink for authored clip events (gunshot, casing tink, bill flutter…).
   *  Wired by the scene to the audio bus; null = silent. */
  static foleySink: ((id: SymbolId, cue: string, turbo: boolean) => void) | null = null;

  constructor(id: SymbolId) {
    super();
    this.id = id;
    const skin = SYMBOL_ASSETS[id];
    const tex = getSymbolTexture(id);

    if (tex && tex.width > 0 && tex.height > 0) {
      this.sprite = new Sprite(tex);
      this.sprite.anchor.set(0.5);
    } else {
      this.sprite = null;
    }

    const skelInfo = createSkelSymbol(id);
    if (skelInfo) {
      this.skel = skelInfo.player;
      this.skelFitW = skelInfo.fitW;
      this.skelFitH = skelInfo.fitH;
      this.flow = new SymbolFlow({ hasHold: this.skel.has("hold"), hasLand: this.skel.has("land") });
    }

    this.labelText = makeText(skin.label, 24, skin.text, 0, 0, "center");
    this.corner = makeText(SYMBOLS[id].shortLabel, 11, 0xffffff, 0, 0, "right");
    this.winGlow.alpha = 0;
    this.shimmer.alpha = 0;

    this.addChild(this.background, this.winGlow);
    if (this.skel) {
      // Skeletal symbol: the player replaces the static sprite. Its idle loop
      // runs on the shared ambient ticker for the lifetime of this view.
      if (this.sprite) this.sprite.visible = false;
      this.addChild(this.skel);
      this.skel.play("idle", { loop: true });
      this.skelCb = (dt: number) => this.skel!.update(dt);
      ambientTicker.add(this.skelCb);
    } else if (this.sprite) {
      this.addChild(this.sprite);
    }
    this.addChild(this.topSheen, this.shimmer, this.shimmerMask);
    // The win shimmer streak is clipped to the cell so it never bleeds onto neighbours.
    this.shimmer.mask = this.shimmerMask;
    if (!this.sprite && !this.skel) {
      this.addChild(this.labelText, this.corner);
    }
  }

  layout(width: number, height: number): void {
    this.widthValue = width;
    this.heightValue = height;
    this.redraw(false, false, false);
  }

  redraw(highlighted: boolean, transformed: boolean, alert: boolean): void {
    const w = this.widthValue;
    const h = this.heightValue;

    this.highlighted = highlighted;
    this.background.clear();
    this.background.alpha = 1;

    // No idle cell box or white frame — symbols sit directly on the reel.
    // A border is only drawn to signal win / alert / transform states.
    if (highlighted) {
      const accent = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
      // A lit cell, not a wireframe box: soft accent halo + one crisp inner edge.
      this.background.roundRect(1, 1, w - 2, h - 2, 12)
        .fill({ color: accent, alpha: 0.10 })
        .stroke({ color: accent, width: 6, alpha: 0.16 });
      this.background.roundRect(3, 3, w - 6, h - 6, 10)
        .stroke({ color: accent, width: 2, alpha: 0.85 });
      this.background.roundRect(4.5, 4.5, w - 9, h - 9, 9)
        .stroke({ color: 0xffffff, width: 1, alpha: 0.22 });
    } else if (alert) {
      // Glossy transparent green background fill inside the cell
      this.background.roundRect(0, 0, w, h, 10)
        .fill({ color: 0x9ae64e, alpha: 0.28 });
      // Glossy top reflection sheen
      this.background.roundRect(0, 0, w, h / 2, 10)
        .fill({ color: 0xffffff, alpha: 0.15 });
      // Neon green outer glowing border
      this.background.roundRect(-2, -2, w + 4, h + 4, 12)
        .stroke({ color: 0x9ae64e, width: 3.5, alpha: 0.95 });
      // Subtler inner border for extra depth
      this.background.roundRect(0, 0, w, h, 10)
        .stroke({ color: 0x9ae64e, width: 1.5, alpha: 0.60 });
    } else if (transformed) {
      this.background.roundRect(-1, -1, w + 2, h + 2, 11)
        .stroke({ color: 0x62ffa7, width: 3, alpha: 0.7 });
    }

    // Top glass sheen removed — it was part of the white per-cell frame.
    this.topSheen.clear();

    if (highlighted) this.showPlate();
    else this.hidePlate();

    // Keep the shimmer mask sized to the cell (clips the win light streak).
    this.shimmerMask.clear();
    this.shimmerMask.roundRect(0, 0, w, h, 10).fill(0xffffff);

    // Scale sprite to fill cell
    if (this.sprite) this.fitInCell(this.sprite);

    // Skeletal player: origin is the symbol centre; scale by the ART content
    // size (fitW/fitH), not the padded canvas, so it matches the static art.
    if (this.skel && w > 0 && h > 0) {
      const s = this.skelFitScale();
      if (s > 0) this.skel.scale.set(s * this.lift);
      this.skel.position.set(w / 2, h / 2);
    }

    // Fallback text
    if (!this.sprite && !this.skel) {
      this.labelText.style.fontSize = Math.max(20, Math.min(w, h) * 0.42);
      this.labelText.position.set(w / 2, h * 0.23);
      this.corner.style.fontSize = Math.max(10, Math.min(18, w * 0.18));
      this.corner.position.set(w - 8, h - 22);
    }
  }

  /** Breathing accent bloom behind the art while this cell is a winner. */
  private showPlate(): void {
    const w = this.widthValue;
    const h = this.heightValue;
    if (w <= 0 || h <= 0) return;
    if (!this.winPlate) {
      const plate = new Sprite(softGlowTexture());
      plate.anchor.set(0.5);
      plate.blendMode = "add";
      plate.alpha = 0;
      this.addChildAt(plate, 1);
      this.winPlate = plate;
    }
    const plate = this.winPlate;
    plate.tint = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
    plate.position.set(w / 2, h / 2);
    plate.width = w * 1.25;
    plate.height = h * 1.25;
    const baseX = plate.scale.x;
    const baseY = plate.scale.y;
    if (this.plateCb) return;
    let t = 0;
    this.plateCb = (dt) => {
      if (plate.destroyed) return;
      t += dt;
      const fadeIn = Math.min(1, t / 0.16);
      const breathe = 0.5 + 0.5 * Math.sin(t * 6.2);
      plate.alpha = fadeIn * (0.38 + 0.22 * breathe);
      const k = 1 + 0.05 * breathe;
      plate.scale.set(baseX * k, baseY * k);
    };
    ambientTicker.add(this.plateCb);
  }

  private hidePlate(): void {
    if (this.plateCb) { ambientTicker.remove(this.plateCb); this.plateCb = null; }
    if (this.winPlate && !this.winPlate.destroyed) this.winPlate.alpha = 0;
  }

  /** Tween the presentation lift (1 = resting in the cell). */
  private setLift(target: number, ms: number, shape: (p: number) => number = easeOutQuad): void {
    const token = ++this.liftToken;
    const from = this.lift;
    void tween(ms, (p) => {
      if (this.destroyed || token !== this.liftToken) return;
      this.lift = from + (target - from) * shape(p);
      const fit = this.skelFitScale();
      if (this.skel && fit > 0) this.skel.scale.set(fit * this.lift);
    }, linear);
  }

  /** Non-winning symbols step back while a cluster pays, so the win reads at a
   *  glance. Fades the art only — never the cell's own alpha or its clips. */
  setDimmed(on: boolean, turbo: boolean): void {
    const art = this.skel ?? this.sprite;
    if (!art || this.destroyed) return;
    const token = ++this.dimToken;
    const from = art.alpha;
    const to = on ? 0.32 : 1;
    if (Math.abs(from - to) < 0.01) return;
    void tween(on ? (turbo ? 70 : 160) : (turbo ? 60 : 140), (p) => {
      if (this.destroyed || art.destroyed || token !== this.dimToken) return;
      art.alpha = from + (to - from) * p;
    }, easeOutQuad);
  }

  private skelFitScale(): number {
    const padding = 6;
    const s = Math.min((this.widthValue - padding * 2) / this.skelFitW, (this.heightValue - padding * 2) / this.skelFitH);
    return isFinite(s) && s > 0 ? s : 0;
  }

  /** Scale + center a sprite to fill the cell with a small padding. */
  private fitInCell(sprite: Sprite): void {
    const w = this.widthValue;
    const h = this.heightValue;
    if (w <= 0 || h <= 0) return;
    const tw = sprite.texture.width;
    const th = sprite.texture.height;
    // Guard: if texture hasn't uploaded yet its dimensions can be 0, producing NaN/Infinity
    if (tw <= 0 || th <= 0) return;
    const padding = 6;
    const scale = Math.min((w - padding * 2) / tw, (h - padding * 2) / th);
    if (!isFinite(scale) || scale <= 0) return;
    sprite.scale.set(scale);
    sprite.position.set(w / 2, h / 2);
  }

  startIdleShimmer(): void {
    // Idle white sheen removed — no per-cell shimmer rectangle.
  }

  stopIdleShimmer(): void {
    if (this.ambientCb) {
      ambientTicker.remove(this.ambientCb);
      this.ambientCb = null;
    }
    this.shimmer.clear();
    this.shimmer.alpha = 0;
  }

  setSpinBlur(strength: number): void {
    if (strength > 0) {
      if (!this.blurFilter) {
        this.blurFilter = new BlurFilter({ strengthX: 0, strengthY: strength, quality: 2 });
        this.filters = [this.blurFilter];
      } else {
        this.blurFilter.strengthY = strength;
      }
    } else {
      // null, never [] — in Pixi v8 an empty array still routes the container
      // through the filter pipeline (a render-texture resample), which softens
      // the art exactly like the reel-column blur did.
      this.filters = null;
      this.blurFilter?.destroy();
      this.blurFilter = null;
    }
  }

  /* ─── skeletal clip plumbing ─── */

  /** Start a planned clip. Any clip it interrupts has its completion released
   *  immediately (after the switch), so an awaiting caller never hangs. */
  private runPlan(plan: ClipPlan, turbo: boolean, onComplete?: () => void): void {
    const skel = this.skel;
    // A destroyed view never plays another clip: its sprites are gone. (A clip
    // still pending when the board tears down — the tab was backgrounded, or a
    // quick autoplay spin — releases its completion from destroy().)
    if (!skel || this.destroyed || skel.destroyed || !skel.has(plan.clip)) { onComplete?.(); return; }
    const interrupted = this.pendingComplete;
    this.pendingComplete = null;
    const done = (): void => {
      if (this.pendingComplete === done) this.pendingComplete = null;
      onComplete?.();
    };
    if (onComplete) this.pendingComplete = done;
    const sink = SymbolView.foleySink;
    skel.play(plan.clip, {
      loop: plan.loop,
      speed: plan.speed,
      mix: plan.mix,
      weight: plan.weight,
      onComplete: onComplete ? done : null,
      onEvent: plan.events && sink ? (cue) => sink(this.id, cue, turbo) : null,
    });
    interrupted?.();
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) { window.clearTimeout(this.holdTimer); this.holdTimer = null; }
  }

  /**
   * The symbol has just come to rest in its cell. `tumble` = it fell into
   * place during a cascade; `reel` = its reel column just slammed to a stop.
   * Semantic rigs play their object-specific `land` clip (the board already
   * moved the symbol — the clip never animates the fall itself). Anything
   * without one gets a tiny container settle that leaves its rig untouched.
   * A symbol that is mid-win / held / being destroyed is never interrupted.
   */
  touchdown(source: LandSource, turbo: boolean): void {
    if (this.destroyed) return;
    if (this.skel && this.flow) {
      const plan = this.flow.land(source, turbo, getTimeScale());
      if (plan) {
        this.runPlan(plan, turbo, () => {
          if (this.destroyed) return;
          const next = this.flow?.landEnded();
          if (next) this.runPlan(next, turbo);
        });
        return;
      }
      if (this.flow.state !== "idle") return;
    }
    if (source === "tumble") this.containerSettle(turbo);
  }

  /** Bottom-anchored micro squash for symbols with no authored `land` clip.
   *  Scales the player's container only; its clips are never touched. */
  private containerSettle(turbo: boolean): void {
    const target = this.skel ?? this.sprite;
    if (!target) return;
    const token = ++this.settleToken;
    const baseScale = (): number => (this.skel ? this.skelFitScale() : target.scale.y);
    const s0 = baseScale();
    if (s0 <= 0) return;
    const halfH = (this.skel ? this.skelFitH : target.height / s0) / 2;
    const cy = this.heightValue / 2;
    void tween(turbo ? 110 : 200, (p) => {
      if (this.destroyed || token !== this.settleToken) return;
      const k = Math.exp(-4.2 * p) * Math.cos(Math.PI * 2 * 1.1 * p) * (1 - p);
      const sy = 1 - 0.05 * k;
      const sx = 1 + 0.035 * k;
      target.scale.set(s0 * sx, s0 * sy);
      target.y = cy + (1 - sy) * halfH * s0;
    }, linear).then(() => {
      if (this.destroyed || token !== this.settleToken) return;
      target.scale.set(s0);
      target.y = cy;
    });
  }

  async punch(): Promise<void> {
    await tween(180, (progress) => {
      const s = 1 + 0.12 * Math.sin(progress * Math.PI);
      this.scale.set(s);
    }, easeInOutCubic);
    this.scale.set(1);
  }

  async winCelebrate(turbo: boolean): Promise<void> {
    if (this.skel && this.flow && isSemantic(this.flow.caps)) return this.winCelebrateSemantic(turbo);
    if (this.skel) return this.winCelebrateSkel(turbo);
    const w = this.widthValue;
    const h = this.heightValue;
    this.redraw(true, false, false);

    const accent = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
    const hero = HERO_SYMBOLS.has(this.id);
    const fx = this.sprite;
    const baseScale = fx ? fx.scale.x : 1; // sprites are pre-scaled to fit the cell

    // Tier-coloured aura behind the symbol.
    this.winGlow.clear();
    this.winGlow.roundRect(-8, -8, w + 16, h + 16, 16).fill({ color: accent, alpha: hero ? 0.32 : 0.24 });
    this.winGlow.roundRect(-3, -3, w + 6, h + 6, 12).fill({ color: accent, alpha: 0.16 });
    this.winGlow.alpha = 0;

    // Light streak sweeps across the symbol (runs alongside the pop).
    const sweep = this.sweepShimmer(turbo, accent);

    // Phase 1 — anticipation squash (skipped in turbo for snappiness).
    if (fx && !turbo) {
      await tween(90, (p) => {
        fx.scale.set(baseScale * (1 - 0.12 * p), baseScale * (1 + 0.06 * p));
      }, easeOutQuad);
    }

    // Phase 2 — pop in with a 3D tilt + brightness flash + glow rise.
    const popAmt = turbo ? 0.12 : hero ? 0.26 : 0.18;
    const tiltAmt = turbo ? 0 : hero ? 0.22 : 0.13;
    await tween(turbo ? 90 : 240, (p) => {
      this.winGlow.alpha = Math.min(1, p * 1.4) * (hero ? 1 : 0.9);
      if (fx) {
        const s = baseScale * (1 + popAmt * Math.sin(p * Math.PI));
        fx.scale.set(s);
        fx.skew.x = tiltAmt * Math.sin(p * Math.PI * 2) * (1 - p);
      } else {
        this.scale.set(1 + popAmt * Math.sin(p * Math.PI));
      }
    }, easeOutBack);

    // Phase 3 — sustained breathing glow (heroes linger a touch longer).
    await tween(turbo ? 60 : hero ? 320 : 220, (p) => {
      this.winGlow.alpha = 0.7 + Math.sin(p * Math.PI * 2) * 0.22;
      if (fx) fx.scale.set(baseScale * (1 + 0.035 * Math.sin(p * Math.PI * 2)));
      else this.scale.set(1 + 0.03 * Math.sin(p * Math.PI * 2));
    });

    await sweep;

    // Reset to clean idle state.
    if (fx) { fx.skew.x = 0; fx.scale.set(baseScale); }
    this.scale.set(1);
    this.winGlow.alpha = 0;
    this.shimmer.alpha = 0;
  }

  /**
   * Semantic skeletal win: the object's own motion is the hero. No filled
   * tier box and no diagonal shimmer sweep — the rig flares its silhouette
   * glow itself — only the thin tier border stays, faded in, so the winning
   * cells still read at a glance next to the cluster link.
   *
   * Resolves when the signature action has played; the symbol then HOLDS its
   * presented pose until it is destroyed (tumble_remove) or released (it
   * survived), instead of dropping back to idle for a beat first.
   */
  private async winCelebrateSemantic(turbo: boolean): Promise<void> {
    const flow = this.flow!;
    this.clearHoldTimer();
    this.redraw(true, false, false);
    const border = this.background;
    border.alpha = 0;
    void tween(turbo ? 70 : 160, (p) => { if (!border.destroyed) border.alpha = p; }, easeOutQuad);

    // Lift toward the player with a small overshoot, then hold slightly raised.
    this.setLift(1.06, turbo ? 140 : 360, popShape(2.15));
    const plan = flow.win(turbo, getTimeScale());
    if (!plan) return;
    await new Promise<void>((resolve) => this.runPlan(plan, turbo, resolve));
    if (this.destroyed) return;
    const next = flow.winEnded(getTimeScale());
    if (next) this.runPlan(next, turbo);
    if (flow.state === "hold") {
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        this.releaseHold();
      }, HOLD_SAFETY_MS / getTimeScale());
    }
  }

  /** A held winner that is NOT being removed goes back to idle (called by the
   *  board when a cascade moves on, and by the hold safety timer). */
  releaseHold(): void {
    if (this.destroyed || !this.flow) return;
    this.clearHoldTimer();
    const plan = this.flow.release();
    if (plan) {
      this.runPlan(plan, false);
      if (this.highlighted) this.redraw(false, false, false);
    }
    if (this.lift !== 1) this.setLift(1, 160);
  }

  /** Legacy skeletal win (WILD, CAR_WILD, truck): play the authored `win`
   *  animation with the tier aura + shimmer sweep layered on top, then idle. */
  private async winCelebrateSkel(turbo: boolean): Promise<void> {
    const w = this.widthValue;
    const h = this.heightValue;
    this.redraw(true, false, false);

    const accent = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
    // The breathing plate drawn by redraw() is the glow — no filled tier box
    // (it read as a flat coloured square behind the symbol).
    this.winGlow.clear();
    this.winGlow.alpha = 0;
    if (w > 0 && h > 0) this.setLift(1.07, turbo ? 140 : 340, popShape(1.7));

    const sweep = this.sweepShimmer(turbo, accent);
    const glowIn = Promise.resolve();
    // The ambient ticker keeps calling skel.update, so a one-shot play resolves
    // itself; speed tracks turbo and the global time scale like the tweens do.
    const plan = this.flow?.win(turbo, getTimeScale());
    if (plan) await new Promise<void>((resolve) => this.runPlan(plan, turbo, resolve));
    await Promise.all([sweep, glowIn]);
    if (this.destroyed) return;

    this.winGlow.alpha = 0;
    this.shimmer.alpha = 0;
    this.setLift(1, turbo ? 90 : 220);
    const next = this.flow?.winEnded(getTimeScale());
    if (next) this.runPlan(next, turbo);
  }

  /** A diagonal light streak sweeping left→right across the symbol (cell-clipped). */
  private async sweepShimmer(turbo: boolean, accent: number): Promise<void> {
    const w = this.widthValue;
    const h = this.heightValue;
    const g = this.shimmer;
    const bandW = w * 0.34;
    const lean = h * 0.45; // diagonal lean
    const drawBand = (cx: number, halfW: number, color: number, alpha: number) => {
      g.moveTo(cx - halfW, 0);
      g.lineTo(cx + halfW, 0);
      g.lineTo(cx + halfW - lean, h);
      g.lineTo(cx - halfW - lean, h);
      g.fill({ color, alpha });
    };
    g.alpha = 1;
    await tween(turbo ? 150 : 360, (p) => {
      const cx = -bandW + (w + 2 * bandW) * p;
      const fade = Math.sin(p * Math.PI);
      g.clear();
      drawBand(cx, bandW * 0.9, accent, 0.18 * fade);   // soft accent halo
      drawBand(cx, bandW * 0.5, 0xffffff, 0.30 * fade);  // mid streak
      drawBand(cx, bandW * 0.16, 0xffffff, 0.55 * fade); // bright core
    }, linear);
    g.clear();
    g.alpha = 0;
  }

  /** Scatter trigger: start the armored truck's engine-rev (skeletal
   *  `drive_off` — squat, nose-up, building shudder, glow flare). The actual
   *  exit across the board is driven by BoardView, which owns the geometry.
   *  Safe no-op for symbols without the animation. */
  revEngine(turbo: boolean): void {
    if (!this.skel || !this.skel.animations.includes("drive_off")) return;
    this.skel.play("drive_off", { speed: (turbo ? 2 : 1) * getTimeScale() });
  }

  async vanish(turbo: boolean): Promise<void> {
    // The cell's win frame leaves with the symbol, never after it (the old
    // border outlived the art and left empty boxes on the board).
    if (this.highlighted) {
      const bg = this.background;
      void tween(turbo ? 60 : 140, (p) => { if (!bg.destroyed) bg.alpha = 1 - p; }, linear);
      this.hidePlate();
    }
    if (this.skel && this.flow) {
      // Authored destroy, cross-faded straight out of the held win pose on
      // semantic rigs. Legacy rigs keep their 2x/4x playback exactly.
      this.clearHoldTimer();
      const plan = this.flow.vanish(turbo, getTimeScale());
      if (plan) await new Promise<void>((resolve) => this.runPlan(plan, turbo, resolve));
      return;
    }
    await tween(turbo ? 100 : 220, (progress) => {
      this.alpha = 1 - progress;
      this.scale.set(1 - progress * 0.3);
      this.rotation = progress * 0.15;
    });
  }

  override destroy(options?: { children?: boolean }): void {
    this.hidePlate();
    this.liftToken++;
    this.dimToken++;
    this.setSpinBlur(0);
    this.stopIdleShimmer();
    this.clearHoldTimer();
    this.settleToken++;
    if (this.skelCb) {
      ambientTicker.remove(this.skelCb);
      this.skelCb = null;
    }
    this.skel?.stop();
    // Release anything still awaiting a clip on this view (after the destroy,
    // so a continuation sees `destroyed` and plays nothing). Never let it
    // throw out of destroy(): the board destroys views in bulk.
    const pending = this.pendingComplete;
    this.pendingComplete = null;
    super.destroy(options);
    try {
      pending?.();
    } catch (err) {
      console.error("[SymbolView] pending clip completion failed after destroy:", err);
    }
  }
}

