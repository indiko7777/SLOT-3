import { Container, Graphics, Sprite, Text, BlurFilter, AnimatedSprite } from "pixi.js";
import type { SymbolId } from "../domain";
import { SYMBOLS } from "../domain";
import { SYMBOL_ASSETS, getSymbolTexture, getSymbolAnimation, type SymbolAnimation } from "./assets";
import { makeText } from "./text";
import { easeInOutCubic, easeOutElastic, easeOutBack, easeOutQuad, linear, tween, ambientTicker } from "./tween";

/** Per-symbol win accent colour. Heroes get their own signature glow. */
const WIN_ACCENT: Partial<Record<SymbolId, number>> = {
  CAR_WILD: 0x65f8ff,      // electric cyan
  MASTER_KEY: 0x68f7ff,    // key energy
  SAFE: 0xffe27a,          // warm gold
  DIAMOND: 0x9fe8ff,       // icy sparkle
  PHONE_SCATTER: 0xff7bd0, // scatter pink
};
const HERO_SYMBOLS = new Set<SymbolId>(["CAR_WILD", "SAFE", "MASTER_KEY"]);
const DEFAULT_ACCENT = 0xffdf65;

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
  private readonly animation: SymbolAnimation | null;
  private winSprite: AnimatedSprite | null = null;

  constructor(id: SymbolId) {
    super();
    this.id = id;
    const skin = SYMBOL_ASSETS[id];
    const tex = getSymbolTexture(id);
    this.animation = getSymbolAnimation(id);

    if (tex) {
      this.sprite = new Sprite(tex);
      this.sprite.anchor.set(0.5);
    } else {
      this.sprite = null;
    }

    this.labelText = makeText(skin.label, 24, skin.text, 0, 0, "center");
    this.corner = makeText(SYMBOLS[id].shortLabel, 11, 0xffffff, 0, 0, "right");
    this.winGlow.alpha = 0;
    this.shimmer.alpha = 0;

    this.addChild(this.background, this.winGlow);
    if (this.sprite) {
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
      // Golden glow border for wins
      this.background.roundRect(-2, -2, w + 4, h + 4, 12)
        .stroke({ color: 0xffdf65, width: 3, alpha: 0.9 });
      this.background.roundRect(0, 0, w, h, 10)
        .stroke({ color: 0xffdf65, width: 1.5, alpha: 0.5 });
    } else if (alert) {
      this.background.roundRect(-1, -1, w + 2, h + 2, 11)
        .stroke({ color: 0x65f8ff, width: 3, alpha: 0.8 });
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
    if (this.winSprite) this.fitInCell(this.winSprite);

    // Fallback text
    if (!this.sprite) {
      this.labelText.style.fontSize = Math.max(20, Math.min(w, h) * 0.42);
      this.labelText.position.set(w / 2, h * 0.23);
      this.corner.style.fontSize = Math.max(10, Math.min(18, w * 0.18));
      this.corner.position.set(w - 8, h - 22);
    }
  }

  /** Scale + center a sprite to fill the cell with a small padding. */
  private fitInCell(sprite: Sprite | AnimatedSprite): void {
    const w = this.widthValue;
    const h = this.heightValue;
    const padding = 6;
    const scale = Math.min((w - padding * 2) / sprite.texture.width, (h - padding * 2) / sprite.texture.height);
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
      this.filters = [];
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
    const w = this.widthValue;
    const h = this.heightValue;
    this.redraw(true, false, false);

    // If this symbol has a generated win sprite-sheet, play it over the static
    // art for the duration of the celebration. Otherwise fall through to the
    // procedural glow below (which still runs on top either way).
    const playing = this.startWinAnimation();

    const accent = WIN_ACCENT[this.id] ?? DEFAULT_ACCENT;
    const hero = HERO_SYMBOLS.has(this.id);
    const fx = this.celebrationTarget();
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
        fx.skew.x = tiltAmt * Math.sin(p * Math.PI * 2) * (1 - p); // quick parallax wobble
        fx.tint = p < 0.5
          ? lerpColor(0xffffff, lighten(accent), p * 2)
          : lerpColor(lighten(accent), 0xffffff, (p - 0.5) * 2);
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
    if (fx) { fx.tint = 0xffffff; fx.skew.x = 0; fx.scale.set(baseScale); }
    this.scale.set(1);
    this.winGlow.alpha = 0;
    this.shimmer.alpha = 0;
    if (playing) this.stopWinAnimation();
  }

  /** The element to pop/tilt: the playing win-sprite, else the static sprite. */
  private celebrationTarget(): Sprite | AnimatedSprite | null {
    if (this.winSprite?.visible) return this.winSprite;
    return this.sprite;
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

  /** Show + play the win sprite-sheet (if any). Returns true if it started. */
  private startWinAnimation(): boolean {
    if (!this.animation) return false;
    if (!this.winSprite) {
      this.winSprite = new AnimatedSprite(this.animation.textures);
      this.winSprite.anchor.set(0.5);
      this.winSprite.loop = true;
      this.winSprite.animationSpeed = this.animation.fps / 60;
      // Sits above the static sprite, below the sheen/shimmer overlays.
      this.addChildAt(this.winSprite, this.getChildIndex(this.topSheen));
    }
    this.fitInCell(this.winSprite);
    this.winSprite.visible = true;
    this.winSprite.gotoAndPlay(0);
    if (this.sprite) this.sprite.visible = false;
    return true;
  }

  private stopWinAnimation(): void {
    if (!this.winSprite) return;
    this.winSprite.stop();
    this.winSprite.visible = false;
    if (this.sprite) this.sprite.visible = true;
  }

  async vanish(turbo: boolean): Promise<void> {
    await tween(turbo ? 100 : 220, (progress) => {
      this.alpha = 1 - progress;
      this.scale.set(1 - progress * 0.3);
      this.rotation = progress * 0.15;
    });
  }

  override destroy(options?: { children?: boolean }): void {
    this.stopIdleShimmer();
    this.winSprite?.stop();
    super.destroy(options);
  }
}

/** Push a colour toward white (for a bright flash tint). */
function lighten(c: number): number {
  return lerpColor(c, 0xffffff, 0.55);
}

/** Linearly interpolate between two RGB colors */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
