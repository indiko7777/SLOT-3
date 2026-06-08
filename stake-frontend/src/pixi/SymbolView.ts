import { Container, Graphics, Sprite, Text, BlurFilter } from "pixi.js";
import type { SymbolId } from "../domain";
import { SYMBOLS } from "../domain";
import { SYMBOL_ASSETS, getSymbolTexture } from "./assets";
import { makeText } from "./text";
import { easeInOutCubic, easeOutElastic, tween, ambientTicker } from "./tween";

export class SymbolView extends Container {
  readonly id: SymbolId;
  private readonly background = new Graphics();
  private readonly sprite: Sprite | null;
  private readonly labelText: Text;
  private readonly corner: Text;
  private readonly winGlow = new Graphics();
  private readonly shimmer = new Graphics();
  private readonly topSheen = new Graphics();
  private widthValue = 0;
  private heightValue = 0;
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;
  private blurFilter: BlurFilter | null = null;

  constructor(id: SymbolId) {
    super();
    this.id = id;
    const skin = SYMBOL_ASSETS[id];
    const tex = getSymbolTexture(id);

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
    this.addChild(this.topSheen, this.shimmer);
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
        .stroke({ color: 0xff3158, width: 3, alpha: 0.8 });
    } else if (transformed) {
      this.background.roundRect(-1, -1, w + 2, h + 2, 11)
        .stroke({ color: 0x62ffa7, width: 3, alpha: 0.7 });
    }

    // Top glass sheen removed — it was part of the white per-cell frame.
    this.topSheen.clear();

    // Scale sprite to fill cell
    if (this.sprite) {
      const padding = 6;
      const availW = w - padding * 2;
      const availH = h - padding * 2;
      const scale = Math.min(availW / this.sprite.texture.width, availH / this.sprite.texture.height);
      this.sprite.scale.set(scale);
      this.sprite.position.set(w / 2, h / 2);
    }

    // Fallback text
    if (!this.sprite) {
      this.labelText.style.fontSize = Math.max(20, Math.min(w, h) * 0.42);
      this.labelText.position.set(w / 2, h * 0.23);
      this.corner.style.fontSize = Math.max(10, Math.min(18, w * 0.18));
      this.corner.position.set(w - 8, h - 22);
    }
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

    // Golden aura glow behind the symbol
    this.winGlow.clear();
    this.winGlow.roundRect(-6, -6, w + 12, h + 12, 14)
      .fill({ color: 0xffdf65, alpha: 0.25 });
    this.winGlow.roundRect(-3, -3, w + 6, h + 6, 12)
      .fill({ color: 0xffdf65, alpha: 0.15 });
    this.winGlow.alpha = 0;

    // Phase 1: Glow in + scale pulse
    await tween(turbo ? 80 : 200, (progress) => {
      this.winGlow.alpha = progress * 0.9;
      const s = 1 + 0.1 * Math.sin(progress * Math.PI);
      this.scale.set(s);
      // Brightness flash
      if (this.sprite) {
        this.sprite.tint = progress < 0.5
          ? lerpColor(0xffffff, 0xffffcc, progress * 2)
          : lerpColor(0xffffcc, 0xffffff, (progress - 0.5) * 2);
      }
    }, easeInOutCubic);

    // Phase 2: Sustained glow with gentle pulse
    await tween(turbo ? 60 : 200, (progress) => {
      this.winGlow.alpha = 0.7 + Math.sin(progress * Math.PI * 2) * 0.2;
      this.scale.set(1 + 0.03 * Math.sin(progress * Math.PI * 2));
    });

    // Reset
    if (this.sprite) this.sprite.tint = 0xffffff;
    this.winGlow.alpha = 0;
    this.scale.set(1);
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
    super.destroy(options);
  }
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
