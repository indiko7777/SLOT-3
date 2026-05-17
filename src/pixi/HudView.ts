import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { TEXT, type Position } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import { getExtraTexture } from "./assets";
import { makeText } from "./text";
import { ambientTicker } from "./tween";
import type { LayoutMetrics, Rect, SceneRuntime } from "./types";

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
    this.drawTopPlaque(layout.topPlaque);
    this.drawBoardFrame(layout.boardFrame);
    this.drawHeatRail(layout.heatRail, snapshot.heatLevel);
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
      this.creditText.text = `${TEXT.credit} ${this.runtime.getCredit().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      sprite.anchor.set(0.5, 0.5);
      sprite.position.set(layout.width / 2, layout.height / 2);
      this.addChild(sprite);
      // Dim overlay so UI remains readable
      const dim = new Graphics();
      dim.rect(0, 0, layout.width, layout.height).fill({ color: 0x000000, alpha: 0.35 });
      this.addChild(dim);
    } else {
      // Fallback procedural background
      const g = new Graphics();
      g.rect(0, 0, layout.width, layout.height).fill(0x060917);
      g.circle(layout.width * 0.78, layout.height * 0.2, Math.max(layout.width, layout.height) * 0.26).fill({ color: 0x126dff, alpha: 0.24 });
      g.circle(layout.width * 0.26, layout.height * 0.96, Math.max(layout.width, layout.height) * 0.25).fill({ color: 0xff6129, alpha: 0.3 });
      if (isMaxHeat) {
        g.rect(0, 0, layout.width / 2, layout.height).fill({ color: 0xff3158, alpha: 0.14 });
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

    const scanner = new Graphics();
    scanner.roundRect(rect.x, rect.y + 412, panelWidth, Math.max(80, rect.height - 412), 6).fill(0x061a38).stroke({ color: 0x65dfff, alpha: 0.65, width: 2 });
    this.addChild(scanner);

    this.addAmbient((_dt, elapsed) => {
      const lineY = rect.y + 418 + (Math.sin(elapsed * 1.5) * 0.5 + 0.5) * Math.max(60, rect.height - 432);
      scanner.clear();
      scanner.roundRect(rect.x, rect.y + 412, panelWidth, Math.max(80, rect.height - 412), 6)
        .fill(0x061a38).stroke({ color: 0x65dfff, alpha: 0.65, width: 2 });
      scanner.moveTo(rect.x + 8, lineY).lineTo(rect.x + panelWidth - 8, lineY);
      scanner.stroke({ color: 0x65dfff, alpha: 0.4, width: 1 });
    });
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

    // Dark body with faux gradient
    const bg = new Graphics();
    bg.roundRect(0, 0, width, height, 8).fill(0x07152e);
    bg.roundRect(0, 0, width, height * 0.5, 8).fill({ color: 0x0d2449, alpha: 0.5 });
    bg.roundRect(0, 0, width, height, 8).stroke({ color: glowColor, width: 2.5, alpha: 0.75 });
    panel.addChild(bg);

    // Top glass reflection
    bg.roundRect(8, 3, width - 16, 1.5, 1).fill({ color: 0xffffff, alpha: 0.06 });

    // Kicker text
    const kickerSize = Math.min(13, Math.max(10, width / 12));
    const kickerColor = action === "super_buy" ? 0xbfa65c : action === "ante" ? 0x6abf8a : 0x6ab8cc;
    panel.addChild(makeText(kicker, kickerSize, kickerColor, width / 2, 10, "center"));

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
    panel.addChild(valText);

    panel.position.set(x, y);
    panel.eventMode = "static";
    panel.cursor = this.runtime.isPlaying() ? "default" : "pointer";

    // Breathing glow animation
    this.addAmbient((_dt, elapsed) => {
      const breath = 0.6 + Math.sin(elapsed * 2.2 + (action === "super_buy" ? 1 : action === "ante" ? 2 : 0)) * 0.4;
      glow.alpha = 0.08 + breath * 0.14;
    });

    panel.on("pointerover", () => {
      if (!this.runtime.isPlaying()) {
        panel.scale.set(1.04);
        glow.alpha = 0.4;
      }
    });
    panel.on("pointerout", () => {
      panel.scale.set(1);
    });
    panel.on("pointerdown", () => {
      if (!this.runtime.isPlaying()) panel.scale.set(0.96);
    });
    panel.on("pointerup", () => {
      panel.scale.set(1);
    });
    panel.on("pointertap", () => void this.runtime.onAction(action));
    this.addChild(panel);
  }

  private drawTopPlaque(rect: Rect): void {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const w = rect.width;
    const h = rect.height;
    const r = Math.min(12, h / 3);

    // === Gold luxury frame ===
    const frame = new Graphics();
    frame.roundRect(rect.x - 2, rect.y + 2, w + 4, h + 2, r + 2)
      .fill({ color: 0x1a0e00, alpha: 0.5 });
    frame.roundRect(rect.x, rect.y, w, h, r)
      .fill(0x0c0a14);
    frame.roundRect(rect.x, rect.y, w, h, r)
      .stroke({ color: 0xd4a830, width: 3 });
    frame.roundRect(rect.x + 4, rect.y + 3, w - 8, h - 6, r - 2)
      .stroke({ color: 0xffd95c, width: 1.5, alpha: 0.4 });
    // Top sheen
    frame.roundRect(rect.x + 12, rect.y + 2, w - 24, Math.max(3, h * 0.12), r)
      .fill({ color: 0xffffff, alpha: 0.07 });
    this.addChild(frame);

    // === Single bold gold line: "WIN UP TO 5,000X YOUR BET" ===
    const fontSize = Math.min(26, w / 22, h * 0.6);
    const mainText = new Text({
      text: "WIN UP TO 5,000X YOUR BET",
      style: new TextStyle({
        fill: 0xffd95c,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize,
        fontWeight: "900",
        letterSpacing: 3,
        stroke: { color: 0x8b6914, width: 2 },
        dropShadow: { color: 0xd4a830, alpha: 0.5, blur: 10, distance: 0 }
      })
    });
    mainText.anchor.set(0.5, 0.5);
    mainText.position.set(cx, cy);
    this.addChild(mainText);

    // === Shimmer sweep ===
    const shimmer = new Graphics();
    shimmer.rect(0, rect.y + 2, 40, h - 4).fill({ color: 0xffffff, alpha: 0.06 });
    this.addChild(shimmer);

    this.addAmbient((_dt, elapsed) => {
      const cycle = (elapsed % 3.5) / 3.5;
      shimmer.x = rect.x + cycle * (w + 60) - 40;
      shimmer.alpha = cycle < 0.1 || cycle > 0.9 ? 0 : 0.1;
    });
  }

  private drawBoardFrame(rect: Rect): void {
    const frame = new Graphics();
    // Dark metallic frame background
    frame.roundRect(rect.x, rect.y, rect.width, rect.height, 10).fill(0x080c1c);
    // Outer glow edge — subtle neon
    frame.roundRect(rect.x, rect.y, rect.width, rect.height, 10)
      .stroke({ color: 0x48e5ff, alpha: 0.3, width: 2 });
    // Inner subtle edge
    frame.roundRect(rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8, 7)
      .stroke({ color: 0x48e5ff, alpha: 0.08, width: 1 });
    // Top reflection strip
    frame.roundRect(rect.x + 6, rect.y + 2, rect.width - 12, 6, 3)
      .fill({ color: 0xffffff, alpha: 0.04 });
    this.addChild(frame);
  }

  private drawHeatRail(rect: Rect, heatLevel: number): void {
    const rail = new Graphics();
    rail.roundRect(rect.x, rect.y, rect.width, rect.height, 3).fill(0x230b37).stroke({ color: 0xffda64, alpha: 0.55, width: 1 });
    this.addChild(rail);
    const starHeight = rect.height / 5;
    const starTex = getExtraTexture("wanted_star");
    const litStars: { sprite: Sprite; star: number }[] = [];

    for (let index = 0; index < 5; index += 1) {
      const star = 5 - index;
      const lit = heatLevel >= star;
      const y = rect.y + index * starHeight;

      // Multiplier label
      this.addChild(makeText(`${star}x`, Math.min(24, rect.width * 0.34), lit ? 0xffdf65 : 0x7a5570, rect.x + rect.width * 0.5, y + 8, "center"));

      // Wanted star image or fallback text
      if (starTex) {
        const starSprite = new Sprite(starTex);
        starSprite.anchor.set(0.5);
        const starSize = Math.min(rect.width * 0.55, starHeight * 0.45);
        const scale = starSize / Math.max(starTex.width, starTex.height);
        starSprite.scale.set(scale);
        starSprite.position.set(rect.x + rect.width * 0.52, y + starHeight * 0.65);
        starSprite.alpha = lit ? 1 : 0.2;
        if (!lit) starSprite.tint = 0x555555;
        this.addChild(starSprite);
        if (lit) litStars.push({ sprite: starSprite, star });
      } else {
        const starText = makeText("★", Math.min(32, rect.width * 0.52), lit ? 0xff3158 : 0x49344a, rect.x + rect.width * 0.52, y + starHeight * 0.46, "center");
        this.addChild(starText);
      }
    }

    // Pulse animation on lit stars
    if (litStars.length > 0) {
      const baseScales = litStars.map(({ sprite }) => sprite.scale.x);
      this.addAmbient((_dt, elapsed) => {
        for (let i = 0; i < litStars.length; i++) {
          const { sprite, star } = litStars[i];
          const pulse = 0.85 + Math.sin(elapsed * 3 + star * 0.7) * 0.15;
          const s = baseScales[i] * pulse;
          sprite.scale.set(s);
        }
      });
    }
  }

  private drawControls(rect: Rect, snapshot: PlaybackSnapshot): void {
    // Bar background with top highlight
    const bar = new Graphics();
    bar.rect(rect.x, rect.y, rect.width, rect.height).fill(0x070a18);
    bar.rect(rect.x, rect.y, rect.width, 1).fill({ color: 0xffdf65, alpha: 0.10 });
    bar.rect(rect.x, rect.y + 1, rect.width, 1).fill({ color: 0x48e5ff, alpha: 0.06 });
    this.addChild(bar);

    // Small utility buttons
    this.smallButton(rect.x + 18, rect.y + rect.height / 2 - 20, 40, "☰", "menu");
    this.smallButton(rect.x + 66, rect.y + rect.height / 2 - 20, 40, this.runtime.isMuted() ? "🔇" : "🔊", "mute");
    this.smallButton(rect.x + 114, rect.y + rect.height / 2 - 20, 40, "i", "info");

    const credit = this.runtime.getCredit();
    const betLevel = this.runtime.getBetLevel();
    const anteMult = this.runtime.isAnteEnabled() ? 1.5 : 1;
    const effectiveBet = betLevel * anteMult;

    // Credit display
    this.creditText = new Text({
      text: `Credit ${credit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
      text: `Bet ${effectiveBet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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

  private drawArt(rect: Rect, snapshot: PlaybackSnapshot): void {
    const cx = rect.x + rect.width / 2;
    const titleSize = Math.min(48, rect.width / 4.5);
    const subSize = Math.min(22, rect.width / 9);
    const heatAreaHeight = 90;

    // === CHARACTER IMAGE — rendered first so titles overlay on top ===
    const charTex = getExtraTexture("getaway_car_scene");

    if (charTex) {
      const charSprite = new Sprite(charTex);
      const titleReserve = titleSize + subSize + 28;
      const availH = rect.height - heatAreaHeight - titleReserve;
      const availW = rect.width;
      // Use the LARGER scale so the character fills the space — big and dominant
      const scaleH = availH / charTex.height;
      const scaleW = availW / charTex.width;
      const imgScale = Math.max(scaleH, scaleW);
      charSprite.scale.set(imgScale);
      charSprite.anchor.set(0.5, 0);
      const imageTop = rect.y + titleReserve;
      charSprite.position.set(cx, imageTop);

      // Mask so character never bleeds into title area or below heat bar
      const clipMask = new Graphics();
      clipMask.rect(rect.x, rect.y + titleReserve, rect.width, availH).fill(0xffffff);
      this.addChild(clipMask);
      charSprite.mask = clipMask;

      this.addChild(charSprite);

      // Subtle idle sway
      this.addAmbient((_dt, elapsed) => {
        charSprite.y = imageTop + Math.sin(elapsed * 1.2) * 2;
      });
    }

    // === TITLE: "HEAT CHASE" — bold gold with glow ===
    const titleGlow = new Text({
      text: TEXT.title.toUpperCase(),
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: titleSize,
        fontWeight: "900",
        letterSpacing: 4,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 12, distance: 0 }
      })
    });
    titleGlow.anchor.set(0.5, 0);
    titleGlow.position.set(cx, rect.y + 10);
    this.addChild(titleGlow);

    const titleMain = new Text({
      text: TEXT.title.toUpperCase(),
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: titleSize,
        fontWeight: "900",
        letterSpacing: 4,
        align: "center",
        stroke: { color: 0x8b4513, width: 3 }
      })
    });
    titleMain.anchor.set(0.5, 0);
    titleMain.position.set(cx, rect.y + 10);
    this.addChild(titleMain);

    // === SUBTITLE: "GRAND ESCAPE" — white with cyan accent ===
    const subtitle = new Text({
      text: TEXT.subtitle.toUpperCase(),
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: subSize,
        fontWeight: "900",
        letterSpacing: 6,
        align: "center",
        stroke: { color: 0x1a6b8a, width: 2 },
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 10, distance: 0 }
      })
    });
    subtitle.anchor.set(0.5, 0);
    subtitle.position.set(cx, rect.y + 10 + titleSize + 4);
    this.addChild(subtitle);

    // Ambient title pulse
    this.addAmbient((_dt, elapsed) => {
      const glow = 0.85 + Math.sin(elapsed * 2.5) * 0.15;
      titleGlow.alpha = glow;
    });

    // === HEAT METER — GTA V wanted stars with police siren ===
    const heatY = rect.y + rect.height - heatAreaHeight;
    const meterH = heatAreaHeight;
    const starCY = heatY + meterH / 2;

    // GTA-style stars: big, bold, tightly spaced
    const starR = Math.min(22, rect.width / 11); // outer radius
    const starIR = starR * 0.42; // inner radius — GTA stars have sharper points
    const gap = starR * 0.55;
    const totalW = starR * 2 * 5 + gap * 4;
    const startX = rect.x + (rect.width - totalW) / 2 + starR;

    const POLICE_BLUE = 0x1177ff;
    const POLICE_RED = 0xff1133;

    const starBodies: Graphics[] = [];
    const glowLayers: Graphics[] = [];

    for (let i = 0; i < 5; i++) {
      const lit = snapshot.heatLevel > i;
      const sx = startX + i * (starR * 2 + gap);

      // Glow layer (behind star, animated for lit ones)
      const glow = new Graphics();
      this.addChild(glow);
      glowLayers.push(glow);

      // Star body
      const star = new Graphics();
      const pts = this.starPoints(sx, starCY, starR, starIR);

      if (lit) {
        // Solid filled star — white base, will be tinted by animation
        star.poly(pts).fill(0xffffff);
        star.poly(pts).stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
      } else {
        // Empty outlined star — like GTA's unfilled wanted stars
        star.poly(pts).fill({ color: 0x0a0e1e, alpha: 0.4 });
        star.poly(pts).stroke({ color: 0x3a4565, width: 2.5, alpha: 0.55 });
      }
      this.addChild(star);
      starBodies.push(star);
    }

    // Multiplier badge to the right
    if (snapshot.globalMultiplier > 1) {
      const badgeX = startX + 4 * (starR * 2 + gap) + starR + 16;
      const mult = new Text({
        text: `${snapshot.globalMultiplier}x`,
        style: new TextStyle({
          fill: 0xffdf65,
          fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
          fontSize: Math.min(22, starR * 1.1),
          fontWeight: "900",
          dropShadow: { color: 0xff6a00, alpha: 0.7, blur: 6, distance: 0 }
        })
      });
      mult.anchor.set(0, 0.5);
      mult.position.set(badgeX, starCY);
      this.addChild(mult);
    }

    // Police siren animation — alternating red/blue across lit stars
    if (snapshot.heatLevel > 0) {
      this.addAmbient((_dt, elapsed) => {
        const speed = 4 + snapshot.heatLevel;
        for (let i = 0; i < 5; i++) {
          const sx = startX + i * (starR * 2 + gap);
          const glow = glowLayers[i];
          const star = starBodies[i];

          if (snapshot.heatLevel <= i) {
            glow.clear();
            continue;
          }

          // Phase offset per star so they ripple like police bar
          const phase = elapsed * speed + i * Math.PI * 0.6;
          const wave = Math.sin(phase);
          const isBlue = wave > 0;
          const color = isBlue ? POLICE_BLUE : POLICE_RED;
          const bright = Math.abs(wave);

          // Glow halo
          glow.clear();
          glow.circle(sx, starCY, starR * 1.4)
            .fill({ color, alpha: bright * 0.35 });
          glow.circle(sx, starCY, starR * 0.9)
            .fill({ color, alpha: bright * 0.2 });

          // Tint the star itself
          star.tint = isBlue
            ? this.lerpColor(0xffffff, 0x88bbff, bright * 0.7)
            : this.lerpColor(0xffffff, 0xff8888, bright * 0.7);
        }
      });
    }
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
    g.circle(size / 2, size / 2, size / 2).fill(0x0a1020).stroke({ color: 0x3a5a7a, width: 1.5 });
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
    g.circle(size / 2, size / 2, size / 2).fill(0x0a1428).stroke({ color: 0x48e5ff, width: 2, alpha: 0.6 });
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

    // Halo glow behind
    const halo = new Graphics();
    halo.circle(R, R, R + 10).fill({ color: 0x48e5ff, alpha: isPlaying ? 0 : 0.08 });
    button.addChild(halo);

    // Outer ring
    const outer = new Graphics();
    outer.circle(R, R, R).fill(0x0a1428);
    outer.circle(R, R, R).stroke({ color: isPlaying ? 0x3a4a5c : 0x48e5ff, width: 4 });
    button.addChild(outer);

    // Inner disc
    const inner = new Graphics();
    inner.circle(R, R, R - 8).fill(0x0c1530);
    inner.circle(R, R, R - 8).stroke({ color: isPlaying ? 0x2a3a4c : 0x48e5ff, width: 1.5, alpha: 0.4 });
    button.addChild(inner);

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
    button.addChild(spinText);

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
        button.scale.set(1.08);
        halo.alpha = 0.20;
      });
      button.on("pointerout", () => {
        button.scale.set(1);
      });
      button.on("pointerdown", () => {
        button.scale.set(0.94);
      });
      button.on("pointerup", () => {
        button.scale.set(1);
      });
    }

    button.on("pointertap", () => void this.runtime.onAction("spin"));
    this.addChild(button);
  }
}
