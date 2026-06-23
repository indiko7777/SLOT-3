import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { TEXT, type Position } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import { getExtraTexture } from "./assets";
import { makeText } from "./text";
import { ambientTicker } from "./tween";
import type { LayoutMetrics, Rect, SceneRuntime } from "./types";
import { OutlineFilter, DropShadowFilter } from "pixi-filters";

export class HudView extends Container {
  private ambientCbs: Array<(dt: number, elapsed: number) => void> = [];
  private statusText: Text | null = null;
  private winText: Text | null = null;
  private creditText: Text | null = null;
  private betText: Text | null = null;

  /** Win counter animation state */
  private displayedWin = 0;
  private targetWin = 0;
  private winAnimFrame = 0;

  constructor(private readonly runtime: SceneRuntime) {
    super();
  }

  /** Full rebuild — call on initial load, window resize, and major state changes (heat advance, round end) */
  draw(layout: LayoutMetrics, snapshot: PlaybackSnapshot): void {
    this.cleanupAmbient();
    this.removeChildren();
    this.statusText = null;
    this.winText = null;
    this.drawBackground(layout, snapshot);
    if (layout.leftPanel) this.drawBuyPanel(layout.leftPanel);
    if (layout.artPanel) this.drawArt(layout.artPanel, snapshot);
    // Portrait: draw the 5 wanted stars in the dedicated strip above the board.
    if (layout.starsBar) this.drawWantedStars(layout.starsBar);
    this.drawBoardFrame(layout.boardFrame);
    this.drawControls(layout.bottomBar, snapshot);
  }

  /** Lightweight update — only changes the status/win text. No rebuild, no flash. */
  updateStatus(layout: LayoutMetrics, snapshot: PlaybackSnapshot): void {
    if (this.statusText) {
      const label = snapshot.state === "idle" ? "" : snapshot.state.replaceAll("_", " ").toUpperCase();
      this.statusText.text = label;
    }
    if (this.winText && snapshot.roundWin > 0) {
      this.animateWinTo(snapshot.roundWin);
    } else if (this.winText) {
      this.winText.text = "";
      this.displayedWin = 0;
      this.targetWin = 0;
      this.cancelWinAnim();
    }
    // Update credit display (deduct could happen externally)
    if (this.creditText) {
      this.creditText.text = `${TEXT.credit} ${this.runtime.getCredit().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${this.runtime.getCurrency()}`;
    }
  }

  /** Animate the win counter from current displayed value to target */
  private animateWinTo(target: number): void {
    if (!this.winText) return;
    this.targetWin = target;
    // If already animating, just update the target — the loop will catch up
    if (this.winAnimFrame) return;

    const startVal = this.displayedWin;
    const startTime = performance.now();
    const duration = Math.min(800, 200 + Math.abs(target - startVal) * 120);

    const tick = (now: number) => {
      const raw = Math.min(1, (now - startTime) / duration);
      // ease out quad
      const t = 1 - (1 - raw) * (1 - raw);
      const current = startVal + (this.targetWin - startVal) * t;
      this.displayedWin = current;
      if (this.winText) {
        this.winText.text = `WIN ${current.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
        this.winText.style.fill = 0xffdf65;
        // Pulse the text size slightly during counting
        const pulse = 1 + Math.sin(raw * Math.PI) * 0.15;
        this.winText.scale.set(pulse);
      }
      if (raw < 1) {
        this.winAnimFrame = requestAnimationFrame(tick);
      } else {
        this.winAnimFrame = 0;
        this.displayedWin = this.targetWin;
        if (this.winText) {
          this.winText.text = `WIN ${this.targetWin.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
          this.winText.scale.set(1);
        }
      }
    };
    this.winAnimFrame = requestAnimationFrame(tick);
  }

  private cancelWinAnim(): void {
    if (this.winAnimFrame) {
      cancelAnimationFrame(this.winAnimFrame);
      this.winAnimFrame = 0;
    }
  }

  private cleanupAmbient(): void {
    for (const cb of this.ambientCbs) ambientTicker.remove(cb);
    this.ambientCbs = [];
  }

  private addAmbient(cb: (dt: number, elapsed: number) => void): void {
    this.ambientCbs.push(cb);
    ambientTicker.add(cb);
  }

  private drawBackground(layout: LayoutMetrics, snapshot: PlaybackSnapshot): void {
    // Try texture-based backgrounds first
    const isBonus = snapshot.state.startsWith("bonus");
    const isMaxHeat = snapshot.heatLevel >= 5 || snapshot.state === "big_win";
    const bgKey = isBonus ? "bg_bonus" : isMaxHeat ? "bg_max_heat" : "bg_base";
    const bgTex = getExtraTexture(bgKey);

    if (bgTex) {
      const sprite = new Sprite(bgTex);
      // Cover the entire screen (maintain aspect ratio, crop overflow)
      const scaleX = layout.width / bgTex.width;
      const scaleY = layout.height / bgTex.height;
      const scale = Math.max(scaleX, scaleY);
      sprite.scale.set(scale);
      sprite.anchor.set(0, 1); // Anchor at bottom-left so logo is fully visible
      sprite.position.set(0, layout.height);
      this.addChild(sprite);
      // Dim overlay so UI remains readable
      const dim = new Graphics();
      dim.rect(0, 0, layout.width, layout.height).fill({ color: 0x000000, alpha: 0.15 });
      this.addChild(dim);
    } else {
      // Fallback procedural background
      const g = new Graphics();
      g.rect(0, 0, layout.width, layout.height).fill(0x060917);
      g.circle(layout.width * 0.78, layout.height * 0.2, Math.max(layout.width, layout.height) * 0.26).fill({ color: 0x126dff, alpha: 0.24 });
      g.circle(layout.width * 0.26, layout.height * 0.96, Math.max(layout.width, layout.height) * 0.25).fill({ color: 0xff6129, alpha: 0.3 });
      if (isMaxHeat) {
        g.rect(0, 0, layout.width / 2, layout.height).fill({ color: 0xffb000, alpha: 0.14 });
        g.rect(layout.width / 2, 0, layout.width / 2, layout.height).fill({ color: 0x29d4ff, alpha: 0.14 });
      }
      this.addChild(g);
    }
  }

  private drawBuyPanel(rect: Rect): void {
    const panelWidth = rect.width;
    if (rect.height < 130) {
      const slot = (rect.width - 16) / 3;
      this.panelButton(rect.x, rect.y, slot, rect.height, "BUY", "GETAWAY", "100x", "buy");
      this.panelButton(rect.x + slot + 8, rect.y, slot, rect.height, "BUY", "SUPER", "500x", "super_buy");
      this.panelButton(rect.x + (slot + 8) * 2, rect.y, slot, rect.height, "ANTE", this.runtime.isAnteEnabled() ? "ACTIVE" : "+50%", this.runtime.isAnteEnabled() ? "ON" : "OFF", "ante");
      return;
    }

    this.panelButton(rect.x, rect.y, panelWidth, 112, "BUY", TEXT.buy, "100.00x", "buy");
    this.panelButton(rect.x, rect.y + 124, panelWidth, 124, "BUY", TEXT.superBuy, "500.00x", "super_buy");
    this.panelButton(rect.x, rect.y + 262, panelWidth, 134, TEXT.ante, this.runtime.isAnteEnabled() ? "ACTIVE" : "+50%", this.runtime.isAnteEnabled() ? "ON" : "OFF", "ante");

    // Game name & logo below the button stack — LANDSCAPE ONLY (the compact
    // portrait layout returned above). A deliberately bigger gap separates it
    // from the buttons so it doesn't read as "just another button", and it's
    // sized as large as the side gap allows while staying clear of everything.
    const logoTex = getExtraTexture("heat_chase_logo");
    if (logoTex && logoTex.width > 0 && logoTex.height > 0) {
      const center = rect.x + panelWidth / 2;
      const buttonsBottom = rect.y + 396;
      const spaceBelow = (rect.y + rect.height) - buttonsBottom;
      const gap = Math.min(56, spaceBelow * 0.32);   // > the ~12px inter-button gaps
      const regionTop = buttonsBottom + gap;
      const regionBottom = rect.y + rect.height - 8;
      const availH = regionBottom - regionTop;
      const boxW = Math.max(0, rect.width * 1.4);      // Allow it to be significantly wider than the buttons
      if (availH > 24 && boxW > 24) {
        const logo = new Sprite(logoTex);
        logo.anchor.set(0.5, 0.5);
        
        // Use a multiplier to make it noticeably larger (pop out more)
        const baseScale = Math.min(boxW / logoTex.width, (availH * 1.2) / logoTex.height);
        logo.scale.set(baseScale);
        logo.position.set(center, (regionTop + regionBottom) / 2);
        
        // Add a drop shadow to separate it clearly from the background
        logo.filters = [new DropShadowFilter({ color: 0x000000, alpha: 0.9, blur: 8, distance: 5 })];

        // Subtle breathing animation to draw the eye
        this.addAmbient((_dt, elapsed) => {
          logo.scale.set(baseScale * (1 + 0.03 * Math.sin(elapsed * 2)));
        });

        this.addChild(logo);
      }
    }
  }

  /** Shrink a text object uniformly so it never spills past maxWidth (never enlarges). */
  private fitText(text: Text, maxWidth: number): void {
    if (text.width > maxWidth) {
      text.scale.set(maxWidth / text.width);
    }
  }

  private panelButton(x: number, y: number, width: number, height: number, kicker: string, title: string, value: string, action: string): void {
    const panel = new Container();

    const glowColor = action === "super_buy" ? 0xffdf65
                    : action === "ante" ? (this.runtime.isAnteEnabled() ? 0x22dd66 : 0x4a5a6c)
                    : 0x48e5ff;

    // Outer neon glow
    const glow = new Graphics();
    glow.roundRect(-4, -4, width + 8, height + 8, 10)
      .fill({ color: glowColor, alpha: 0.12 });
    glow.alpha = 0.8;
    panel.addChild(glow);

    // Dark body
    const bg = new Graphics();
    bg.roundRect(0, 0, width, height, 8).fill({ color: 0x07152e, alpha: 0.5 });
    bg.roundRect(0, 0, width, height, 8).stroke({ color: glowColor, width: 2.5, alpha: 0.75 });
    panel.addChild(bg);

    // Inner width available for text (account for the rounded body padding)
    const textMaxWidth = width - 16;

    // Kicker text
    const kickerSize = Math.min(13, Math.max(10, width / 12));
    const kickerColor = action === "super_buy" ? 0xbfa65c : action === "ante" ? 0x6abf8a : 0x6ab8cc;
    const kickerText = makeText(kicker, kickerSize, kickerColor, width / 2, 10, "center");
    this.fitText(kickerText, textMaxWidth);
    panel.addChild(kickerText);

    // Title — bold Impact
    const tSize = Math.min(22, Math.max(13, width / 8));
    const titleText = new Text({
      text: title,
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: tSize,
        fontWeight: "900",
        letterSpacing: 1,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.6, blur: 4, distance: 0 }
      })
    });
    titleText.anchor.set(0.5, 0);
    titleText.position.set(width / 2, height * 0.34);
    this.fitText(titleText, textMaxWidth);
    panel.addChild(titleText);

    // Value — gold with drop shadow
    const vSize = Math.min(26, Math.max(16, width / 6));
    const valText = new Text({
      text: value,
      style: new TextStyle({
        fill: action === "ante" && this.runtime.isAnteEnabled() ? 0x22dd66 : 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: vSize,
        fontWeight: "900",
        letterSpacing: 1,
        align: "center",
        dropShadow: { color: action === "super_buy" ? 0xff6a00 : 0x000000, alpha: 0.5, blur: 6, distance: 0 }
      })
    });
    valText.anchor.set(0.5, 0);
    valText.position.set(width / 2, height * 0.65);
    this.fitText(valText, textMaxWidth);
    panel.addChild(valText);

    panel.position.set(x, y);
    panel.eventMode = "static";
    panel.cursor = this.runtime.isPlaying() ? "default" : "pointer";

    // Breathing glow animation
    this.addAmbient((_dt, elapsed) => {
      const breath = 0.6 + Math.sin(elapsed * 2.2 + (action === "super_buy" ? 1 : action === "ante" ? 2 : 0)) * 0.4;
      glow.alpha = 0.08 + breath * 0.14;
    });

    // Scale visual children (glow + bg), not the panel container itself.
    // This keeps the hit area stable so pointerup always routes back to `panel`.
    const scaleTarget = (s: number) => { glow.scale.set(s); bg.scale.set(s); };

    panel.on("pointerover", () => {
      if (!this.runtime.isPlaying()) {
        scaleTarget(1.04);
        glow.alpha = 0.4;
      }
    });
    panel.on("pointerout", () => {
      scaleTarget(1);
    });
    panel.on("pointerdown", () => {
      if (!this.runtime.isPlaying()) scaleTarget(0.96);
    });
    panel.on("pointerup", () => {
      scaleTarget(1);
      void this.runtime.onAction(action);
    });
    panel.on("pointerupoutside", () => {
      scaleTarget(1);
    });
    this.addChild(panel);
  }

  private drawBoardFrame(rect: Rect): void {
    const frame = new Graphics();
    // Fully transparent interior — background shows through
    // Outer neon edge border only
    frame.roundRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, 12)
      .stroke({ color: 0x48e5ff, width: 2, alpha: 0.45 });
    frame.roundRect(rect.x, rect.y, rect.width, rect.height, 10)
      .stroke({ color: 0x48e5ff, width: 1, alpha: 0.25 });
    this.addChild(frame);
  }

  private drawControls(rect: Rect, snapshot: PlaybackSnapshot): void {
    // Bar background
    const bar = new Graphics();
    bar.rect(rect.x, rect.y, rect.width, rect.height).fill({ color: 0x070a18, alpha: 0.5 });
    this.addChild(bar);

    // Small utility buttons
    this.smallButton(rect.x + 18, rect.y + rect.height / 2 - 20, 40, "☰", "menu");
    this.smallButton(rect.x + 66, rect.y + rect.height / 2 - 20, 40, this.runtime.isMuted() ? "🔇" : "📻", "mute");
    this.smallButton(rect.x + 114, rect.y + rect.height / 2 - 20, 40, "i", "info");

    const credit = this.runtime.getCredit();
    const betLevel = this.runtime.getBetLevel();
    const currency = this.runtime.getCurrency();
    const anteMult = this.runtime.isAnteEnabled() ? 1.5 : 1;
    const effectiveBet = betLevel * anteMult;

    // Credit display
    this.creditText = new Text({
      text: `Credit ${credit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 20,
        fontWeight: "900",
        letterSpacing: 1
      })
    });
    this.creditText.anchor.set(0, 0);
    this.creditText.position.set(rect.x + 180, rect.y + 16);
    this.addChild(this.creditText);

    // Bet display
    this.betText = new Text({
      text: `Bet ${effectiveBet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 18,
        fontWeight: "900",
        letterSpacing: 1,
        dropShadow: { color: 0xff6a00, alpha: 0.3, blur: 4, distance: 0 }
      })
    });
    this.betText.anchor.set(0, 0);
    this.betText.position.set(rect.x + 180, rect.y + 44);
    this.addChild(this.betText);

    // Status text (center)
    const stateLabel = snapshot.state === "idle" ? "" : snapshot.state.replaceAll("_", " ").toUpperCase();
    this.statusText = makeText(stateLabel, 20, 0xffffff, rect.x + rect.width / 2, rect.y + 18, "center");
    this.addChild(this.statusText);

    // Win counter
    this.winText = makeText("", 15, 0xffdf65, rect.x + rect.width / 2, rect.y + 50, "center");
    this.addChild(this.winText);
    this.displayedWin = 0;
    this.targetWin = 0;
    this.cancelWinAnim();

    // Turbo hint (very subtle)
    this.addChild(makeText(TEXT.turboHint.toUpperCase(), 10, 0x4a5a6c, rect.x + rect.width / 2, rect.y + 72, "center"));

    // Right side: bet controls + spin
    const right = rect.x + rect.width - 220;
    this.betButton(right, rect.y + rect.height / 2 - 20, 42, "−", "minus");
    this.spinButton(right + 64, rect.y + rect.height / 2 - 44);
    this.betButton(right + 160, rect.y + rect.height / 2 - 20, 42, "+", "plus");
  }

  private drawArt(rect: Rect, _snapshot: PlaybackSnapshot): void {
    // Landscape: the 5 wanted stars sit in a strip at the TOP of the panel, ABOVE
    // the black character silhouette ("shadow") that fills the rest below.
    const starR = Math.min(22, rect.width / 11);
    const labelSize = Math.min(13, rect.width * 0.04);
    const starsH = labelSize + starR * 2 + 16;
    this.drawWantedStars({ x: rect.x, y: rect.y, width: rect.width, height: starsH });
    this.drawCharacter(rect, _snapshot.collectionCount);
  }

  /**
   * Draw the 5 GTA-style wanted-level stars inside `rect`.
   * Works for both the landscape art panel (full height) and the portrait
   * starsBar strip (narrow strip above the board).
   */
  private drawWantedStars(rect: Rect): void {
    const starR = Math.min(22, rect.width / 11); // outer radius
    const starIR = starR * 0.42;                 // inner radius — sharper GTA points
    const gap = starR * 0.55;
    const totalW = starR * 2 * 5 + gap * 4;
    const startX = rect.x + (rect.width - totalW) / 2 + starR;
    // Centre the stars vertically in the rect, leaving a bit of room for the label above.
    const labelSize = Math.min(13, rect.width * 0.04);
    const starCY = rect.y + rect.height / 2 + labelSize * 0.5 + 2;

    const meter = Math.max(0, Math.min(5, this.runtime.getWantedLevel()));
    const filledStars: Graphics[] = [];

    // "WANTED LEVEL" label centred above the star row
    this.addChild(makeText(
      "WANTED LEVEL",
      labelSize,
      0x9fb4d0,
      rect.x + rect.width / 2,
      starCY - starR - labelSize - 2,
      "center"
    ));

    for (let i = 0; i < 5; i++) {
      const sx = startX + i * (starR * 2 + gap);
      // Quantize to 0, 0.5, or 1 — never three-quarters or any other fraction.
      const rawFill = Math.max(0, Math.min(1, meter - i));
      const fill = rawFill < 0.25 ? 0 : rawFill < 0.75 ? 0.5 : 1;
      const pts = this.starPoints(sx, starCY, starR, starIR);

      const base = new Graphics();
      base.poly(pts).fill({ color: 0x0a0e1e, alpha: 0.5 });
      base.poly(pts).stroke({ color: 0x4a5570, width: 2.5, alpha: 0.6 });
      this.addChild(base);

      if (fill > 0) {
        const filled = new Graphics();
        filled.poly(pts).fill(0xffffff);
        filled.poly(pts).stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        this.addChild(filled);
        if (fill < 1) {
          // Reveal the leftmost `fill` fraction of the star horizontally (left-to-right fill).
          // Star bounding box: x ∈ [sx - starR, sx + starR], y ∈ [starCY - starR, starCY + starR]
          const filledW = 2 * starR * fill;
          const mask = new Graphics();
          mask.rect(sx - starR, starCY - starR, filledW, starR * 2).fill(0xffffff);
          this.addChild(mask);
          filled.mask = mask;
        }
        filledStars.push(filled);
      }
    }


    if (filledStars.length > 0) {
      const near = meter / 5;
      this.addAmbient((_dt, elapsed) => {
        const pulse = 0.5 + Math.sin(elapsed * (2 + near * 5)) * 0.5;
        const a = 0.8 + pulse * 0.2 * near;
        for (const s of filledStars) s.alpha = a;
      });
    }
  }

  private drawCharacter(rect: Rect, count: number): void {
    const silTex = getExtraTexture("char_silhouette");
    if (!silTex) return;

    const assembly = new Container();

    // Silhouette Sprite
    const silSprite = new Sprite(silTex);
    silSprite.anchor.set(0.5);
    silSprite.x = 57.5; // Shift shadow right to align with the pieces
    silSprite.y = 27.5; // Shift shadow down to align with the pieces
    silSprite.tint = 0x000000;
    const outline = new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1.0 });
    outline.resolution = window.devicePixelRatio || 1;
    silSprite.filters = [outline];
    assembly.addChild(silSprite);

    // Add collected pieces
    // Order: 1: Right Feet, 2: Left Feet, 3: Legs, 4: Stomach, 5: Phonearm, 6: Chest, 7: Left Arm (rightarm1), 8: Head
    for (let i = 1; i <= Math.min(8, count); i++) {
      const pieceTex = getExtraTexture(`char_piece_${i}`);
      if (pieceTex) {
        const pieceSprite = new Sprite(pieceTex);
        pieceSprite.anchor.set(0.5);
        assembly.addChild(pieceSprite);
      }
    }

    // If complete (8), draw the full image instead of separate layers to avoid seam lines
    if (count >= 8) {
      const fullTex = getExtraTexture("char_full");
      if (fullTex) {
        const fullSprite = new Sprite(fullTex);
        fullSprite.anchor.set(0.5);
        assembly.addChild(fullSprite);
      }
    }

    // Fit inside the box panel
    const boxW = rect.width - 24;
    const boxH = rect.height - 84;
    const scale = Math.min(boxW / silTex.width, boxH / silTex.height);
    assembly.scale.set(scale);

    // Center in the box
    assembly.position.set(
      rect.x + rect.width / 2,
      rect.y + 60 + (rect.height - 60) / 2
    );

    this.addChild(assembly);
  }

  /** Generate points for a 5-pointed star polygon */
  private starPoints(cx: number, cy: number, outerR: number, innerR: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? outerR : innerR;
      pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    return pts;
  }

  /** Simple linear color interpolation */
  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    return (rr << 16) | (rg << 8) | rb;
  }

  private smallButton(x: number, y: number, size: number, label: string, action: string): void {
    const button = new Container();
    const g = new Graphics();
    g.circle(size / 2, size / 2, size / 2).fill({ color: 0x0a1020, alpha: 0.5 }).stroke({ color: 0x3a5a7a, width: 1.5 });
    button.addChild(g);
    button.addChild(makeText(label, Math.min(18, size * 0.42), 0x8a9ab8, size / 2, size * 0.24, "center"));
    button.position.set(x, y);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerover", () => { button.scale.set(1.1); g.tint = 0xccddff; });
    button.on("pointerout", () => { button.scale.set(1); g.tint = 0xffffff; });
    button.on("pointertap", () => void this.runtime.onAction(action));
    this.addChild(button);
  }

  private betButton(x: number, y: number, size: number, label: string, action: string): void {
    const button = new Container();
    const g = new Graphics();
    g.circle(size / 2, size / 2, size / 2).fill({ color: 0x0a1428, alpha: 0.5 }).stroke({ color: 0x48e5ff, width: 2, alpha: 0.6 });
    button.addChild(g);
    const txt = new Text({
      text: label,
      style: new TextStyle({
        fill: 0x48e5ff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 22,
        fontWeight: "900"
      })
    });
    txt.anchor.set(0.5, 0.5);
    txt.position.set(size / 2, size / 2);
    button.addChild(txt);
    button.position.set(x, y);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointerover", () => { button.scale.set(1.12); g.tint = 0xccddff; });
    button.on("pointerout", () => { button.scale.set(1); g.tint = 0xffffff; });
    button.on("pointertap", () => void this.runtime.onAction(action));
    this.addChild(button);
  }

  private spinButton(x: number, y: number): void {
    const isPlaying = this.runtime.isPlaying();
    const button = new Container();
    const R = 44;

    // `visual` is the element that scales on press.
    // Keeping it separate from `button` (the hit-area container) means the
    // interactive bounds never change mid-press, so Pixi always routes pointerup
    // back to `button` even if the pointer drifted slightly during the press.
    const visual = new Container();

    // Halo glow behind
    const halo = new Graphics();
    halo.circle(R, R, R + 10).fill({ color: 0x48e5ff, alpha: isPlaying ? 0 : 0.08 });
    visual.addChild(halo);

    // Outer ring
    const outer = new Graphics();
    outer.circle(R, R, R).fill({ color: 0x0a1428, alpha: 0.5 });
    outer.circle(R, R, R).stroke({ color: isPlaying ? 0x3a4a5c : 0x48e5ff, width: 4 });
    visual.addChild(outer);

    // Inner disc
    const inner = new Graphics();
    inner.circle(R, R, R - 8).fill({ color: 0x0c1530, alpha: 0.5 });
    inner.circle(R, R, R - 8).stroke({ color: isPlaying ? 0x2a3a4c : 0x48e5ff, width: 1.5, alpha: 0.4 });
    visual.addChild(inner);

    // SPIN text — Impact
    const spinText = new Text({
      text: "SPIN",
      style: new TextStyle({
        fill: isPlaying ? 0x5a6a7c : 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 3,
        dropShadow: isPlaying ? undefined : { color: 0x48e5ff, alpha: 0.4, blur: 6, distance: 0 }
      })
    });
    spinText.anchor.set(0.5, 0.5);
    spinText.position.set(R, R);
    visual.addChild(spinText);

    button.addChild(visual);
    button.position.set(x, y);
    button.eventMode = "static";
    button.cursor = isPlaying ? "default" : "pointer";

    if (!isPlaying) {
      this.addAmbient((_dt, elapsed) => {
        const pulse = 0.7 + Math.sin(elapsed * 3) * 0.3;
        halo.alpha = pulse * 0.10;
        outer.alpha = 0.7 + pulse * 0.3;
      });

      button.on("pointerover", () => {
        visual.scale.set(1.08);
        halo.alpha = 0.20;
      });
      button.on("pointerout", () => {
        visual.scale.set(1);
      });
      button.on("pointerdown", () => {
        visual.scale.set(0.94);
      });
      // Use pointerup (not pointertap) so the action fires reliably even when
      // the pointer drifted a few pixels between down and up.
      button.on("pointerup", () => {
        visual.scale.set(1);
        void this.runtime.onAction("spin");
      });
      button.on("pointerupoutside", () => {
        visual.scale.set(1);
      });
    }

    this.addChild(button);
  }
}
