import { Container, Graphics, Sprite, Text, BlurFilter } from "pixi.js";
import type { SymbolId } from "../domain";
import { SYMBOLS } from "../domain";
import { SYMBOL_ASSETS, getSymbolTexture, createSkelSymbol } from "./assets";
import type { SkelPlayer } from "./SkelPlayer";
import { makeText } from "./text";
import { easeInOutCubic, easeOutElastic, easeOutBack, easeOutQuad, linear, tween, ambientTicker, getTimeScale } from "./tween";

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
    if (!this.sprite) {
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

    this.background.clear();

    // No idle cell box or white frame — symbols sit directly on the reel.
    // A border is only drawn to signal win / alert / transform states.
    if (highlighted) {
      const accent = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
      // Glowing border for wins based on symbol accent color
      this.background.roundRect(-2, -2, w + 4, h + 4, 12)
        .stroke({ color: accent, width: 3, alpha: 0.9 });
      this.background.roundRect(0, 0, w, h, 10)
        .stroke({ color: accent, width: 1.5, alpha: 0.5 });
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

    // Keep the shimmer mask sized to the cell (clips the win light streak).
    this.shimmerMask.clear();
    this.shimmerMask.roundRect(0, 0, w, h, 10).fill(0xffffff);

    // Scale sprite to fill cell
    if (this.sprite) this.fitInCell(this.sprite);

    // Skeletal player: origin is the symbol centre; scale by the ART content
    // size (fitW/fitH), not the padded canvas, so it matches the static art.
    if (this.skel && w > 0 && h > 0) {
      const padding = 6;
      const s = Math.min((w - padding * 2) / this.skelFitW, (h - padding * 2) / this.skelFitH);
      if (isFinite(s) && s > 0) this.skel.scale.set(s);
      this.skel.position.set(w / 2, h / 2);
    }

    // Fallback text
    if (!this.sprite) {
      this.labelText.style.fontSize = Math.max(20, Math.min(w, h) * 0.42);
      this.labelText.position.set(w / 2, h * 0.23);
      this.corner.style.fontSize = Math.max(10, Math.min(18, w * 0.18));
      this.corner.position.set(w - 8, h - 22);
    }
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
      this.blurFilter = null;
    }
  }

  async land(delay: number, turbo: boolean): Promise<void> {
    const targetY = this.y;
    const startY = targetY - (turbo ? 30 : 80);
    this.alpha = 0;
    this.scale.set(0.78);
    this.y = startY;
    await tween(turbo ? 120 : 280 + delay, (progress) => {
      this.alpha = Math.min(1, progress * 1.5);
      this.scale.set(0.78 + 0.22 * progress);
      this.y = startY + (targetY - startY) * progress;
    }, easeOutElastic);
    this.y = targetY;
    this.scale.set(1);
    this.alpha = 1;
  }

  async punch(): Promise<void> {
    await tween(180, (progress) => {
      const s = 1 + 0.12 * Math.sin(progress * Math.PI);
      this.scale.set(s);
    }, easeInOutCubic);
    this.scale.set(1);
  }

  async winCelebrate(turbo: boolean): Promise<void> {
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

  /** Skeletal win: play the authored `win` animation (anticipation crush →
   *  prismatic burst) with the tier aura + shimmer sweep layered on top. */
  private async winCelebrateSkel(turbo: boolean): Promise<void> {
    const w = this.widthValue;
    const h = this.heightValue;
    this.redraw(true, false, false);

    const accent = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
    this.winGlow.clear();
    this.winGlow.roundRect(-8, -8, w + 16, h + 16, 16).fill({ color: accent, alpha: 0.3 });
    this.winGlow.roundRect(-3, -3, w + 6, h + 6, 12).fill({ color: accent, alpha: 0.16 });
    this.winGlow.alpha = 0;

    const sweep = this.sweepShimmer(turbo, accent);
    const glowIn = tween(turbo ? 90 : 200, (p) => { this.winGlow.alpha = p; });
    // The ambient ticker keeps calling skel.update, so a one-shot play resolves
    // itself; speed tracks turbo and the global time scale like the tweens do.
    const speed = (turbo ? 2 : 1) * getTimeScale();
    await new Promise<void>((resolve) => this.skel!.play("win", { speed, onComplete: resolve }));
    await Promise.all([sweep, glowIn]);

    this.winGlow.alpha = 0;
    this.shimmer.alpha = 0;
    this.skel!.play("idle", { loop: true });
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
    if (this.skel) {
      // Authored shatter: light flies outward, body collapses, ends invisible.
      const speed = (turbo ? 4 : 2) * getTimeScale();
      await new Promise<void>((resolve) => this.skel!.play("destroy", { speed, onComplete: resolve }));
      return;
    }
    await tween(turbo ? 100 : 220, (progress) => {
      this.alpha = 1 - progress;
      this.scale.set(1 - progress * 0.3);
      this.rotation = progress * 0.15;
    });
  }

  override destroy(options?: { children?: boolean }): void {
    this.stopIdleShimmer();
    if (this.skelCb) {
      ambientTicker.remove(this.skelCb);
      this.skelCb = null;
    }
    this.skel?.stop();
    super.destroy(options);
  }
}

