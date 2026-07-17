import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { TEXT, type Position } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import { getExtraTexture } from "./assets";
import { makeText } from "./text";
import { ambientTicker, tween, wait, easeOutBack, linear } from "./tween";
import type { LayoutMetrics, Rect, SceneRuntime } from "./types";
import { formatBalance, formatWin } from "../rgs/client";
import { OutlineFilter, DropShadowFilter } from "pixi-filters";

const IDLE_MESSAGES = [
  "PRESS SPACE TO SPIN!",
  "TRY TURBO FOR RAPID SPINS!",
  "THE GETAWAY AWAITS!",
  "CRANK UP THE HEAT!",
  "GET THE ESCAPE DRIVER READY!",
  "OUTRUN THE LAW FOR BIG WINS!"
];

const SPIN_START_MESSAGES = [
  "GOOD LUCK!",
  "THE CHASE IS ON!",
  "HERE WE GO!",
  "START THE ENGINE!",
  "SPINNING!"
];

const SPIN_MID_MESSAGES = [
  "OUTRUN THE COPS!",
  "DRIVE FAST, WIN BIG!",
  "NO SPEED LIMITS!",
  "CHASING THE GOLD!",
  "HEAT UP THE REELS!",
  "HOLD SPACE FOR TURBO!",
  "TRY TURBO FOR RAPID SPINS!"
];

const TUMBLE_MESSAGES = [
  "CASCADING!",
  "CRANKING THE HEAT!",
  "NEW LOOT INCOMING!",
  "MORE COPS INCOMING!",
  "BUILDING THE MULTIPLIER!",
  "READY FOR ESCAPE!"
];

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

  /** Star position cache — set by drawWantedStars, read by animateStarFill */
  private starDrawRect: Rect | null = null;
  private starRadius = 0;

  private lastState = "idle";
  private currentSpinMessage = "GOOD LUCK!";
  private currentMidSpinMessage = "OUTRUN THE COPS!";
  private currentTumbleMessage = "CASCADING!";
  private currentIdleMessage = "";

  public readonly bgContainer: Container;
  public readonly underParticlesContainer: Container;

  override get visible(): boolean {
    return super.visible;
  }
  override set visible(val: boolean) {
    super.visible = val;
    if (this.bgContainer) this.bgContainer.visible = val;
    if (this.underParticlesContainer) this.underParticlesContainer.visible = val;
  }

  constructor(
    private readonly runtime: SceneRuntime,
    private readonly layers: {
      bg: Container;
      underParticles: Container;
    }
  ) {
    super();
    this.bgContainer = layers.bg;
    this.underParticlesContainer = layers.underParticles;
  }

  /** Full rebuild — call on initial load, window resize, and major state changes (heat advance, round end) */
  draw(layout: LayoutMetrics, snapshot: PlaybackSnapshot): void {
    this.cleanupAmbient();
    this.removeChildren();
    if (this.bgContainer) this.bgContainer.removeChildren();
    if (this.underParticlesContainer) this.underParticlesContainer.removeChildren();
    this.starDrawRect = null;
    this.statusText = null;
    this.winText = null;
    this.updateStateMessages(snapshot.state);
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
    const bet = snapshot.betAmount || this.runtime.getBetLevel();
    const roundWinAmount = snapshot.roundWin * bet;

    this.updateStateMessages(snapshot.state);

    if (this.statusText) {
      if (roundWinAmount > 0) {
        this.animateWinTo(roundWinAmount);
      } else {
        this.cancelWinAnim();
        this.displayedWin = 0;
        this.targetWin = 0;
        
        if (snapshot.state !== "idle") {
          this.statusText.text = this.getStatusMessage(snapshot.state);
          this.statusText.style.fill = 0xffffff;
        } else {
          // Returning to idle with 0 win: show the social-aware default prompt.
          this.statusText.text = this.t().idlePrompt;
          this.statusText.style.fill = 0xffffff;
        }
      }
    }
    // Update credit display (deduct could happen externally)
    if (this.creditText) {
      this.creditText.text = `${TEXT.credit} ${this.runtime.getCredit().toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${this.runtime.getCurrency()}`;
    }
  }

  /** Money formatter shared by the win counter, credit and bet displays. */
  private fmtMoney(amount: number): string {
    return formatBalance(amount);
  }
  
  private fmtWinMoney(amount: number): string {
    return formatWin(amount);
  }

  /** Animate the win counter (in real money) from the current value to target. */
  private animateWinTo(target: number): void {
    if (!this.winText) return;
    this.targetWin = target;
    // If already animating, just update the target — the loop will catch up
    if (this.winAnimFrame) return;

    const startVal = this.displayedWin;
    const startTime = performance.now();
    const currency = this.runtime.getCurrency();
    const duration = Math.min(900, 250 + Math.abs(target - startVal) * 6);

    const tick = (now: number) => {
      const raw = Math.min(1, (now - startTime) / duration);
      // ease out quad
      const t = 1 - (1 - raw) * (1 - raw);
      const current = startVal + (this.targetWin - startVal) * t;
      this.displayedWin = current;
        if (this.winText) {
          this.winText.text = `WIN ${this.fmtWinMoney(current)} ${currency}`;
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
            this.winText.text = `WIN ${this.fmtWinMoney(this.targetWin)} ${currency}`;
            this.winText.scale.set(1);
          }
        }
    };
    this.winAnimFrame = requestAnimationFrame(tick);
  }

  /** RGS-sourced cost multiplier for a bet mode (getaway/super_getaway/ante). */
  private costX(mode: string): number {
    return this.runtime.getCostMultiplier?.(mode) ?? 1;
  }

  /** Social-aware UI strings (bet→play etc. on Stake.US). */
  private t() {
    return this.runtime.getUiStrings();
  }

  /** Controls are locked during a round, autoplay and replay. */
  private controlsLocked(): boolean {
    return (
      this.runtime.isPlaying() ||
      (this.runtime.isAutoplayActive?.() ?? false) ||
      (this.runtime.isReplayActive?.() ?? false)
    );
  }

  /** Dynamic one-line collection / Power-Level status for the centre of the bar. */
  private centerHint(): string {
    const tier = this.runtime.getActiveTier?.() ?? 0;
    const active = this.runtime.isHeadStartActive?.() ?? false;
    const prog = this.runtime.getGalleryProgress();
    if (tier > 0 && active) return `POWER LEVEL ${tier} ACTIVE · ${tier}★ HEAD-START`;
    if (tier > 0 && !active) return `LOWER BET TO ARM YOUR TIER ${tier} HEAD-START`;
    if (prog.mastered) return "GALLERY MASTERED · COLLECT TO RESET";
    return `COLLECT WILDS TO UNLOCK ${prog.girlName.toUpperCase()}`;
  }

  private cancelWinAnim(): void {
    if (this.winAnimFrame) {
      cancelAnimationFrame(this.winAnimFrame);
      this.winAnimFrame = 0;
    }
  }

  setWinAmountDirect(amount: number): void {
    this.cancelWinAnim();
    this.displayedWin = amount;
    this.targetWin = amount;
    if (this.winText) {
      const currency = this.runtime.getCurrency();
      this.winText.text = amount > 0 ? `WIN ${this.fmtWinMoney(amount)} ${currency}` : "";
      this.winText.style.fill = 0xffdf65;
      this.winText.scale.set(1);
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
      this.bgContainer.addChild(sprite);
      // Dim overlay so UI remains readable
      const dim = new Graphics();
      dim.rect(0, 0, layout.width, layout.height).fill({ color: 0x000000, alpha: 0.15 });
      this.bgContainer.addChild(dim);
    } else {
      // Fallback procedural background
      const g = new Graphics();
      g.rect(0, 0, layout.width, layout.height).fill(0x000000);
      g.circle(layout.width * 0.78, layout.height * 0.2, Math.max(layout.width, layout.height) * 0.26).fill({ color: 0x2ea847, alpha: 0.24 });
      g.circle(layout.width * 0.26, layout.height * 0.96, Math.max(layout.width, layout.height) * 0.25).fill({ color: 0xff6129, alpha: 0.3 });
      if (isMaxHeat) {
        g.rect(0, 0, layout.width / 2, layout.height).fill({ color: 0xffb000, alpha: 0.14 });
        g.rect(layout.width / 2, 0, layout.width / 2, layout.height).fill({ color: 0x7cf595, alpha: 0.14 });
      }
      this.bgContainer.addChild(g);
    }
  }

  private drawBuyPanel(rect: Rect): void {
    const panelWidth = rect.width;
    // Cost values are sourced from the RGS bet-mode config, never hardcoded.
    // The kicker word ("BUY" / "FEATURE") is jurisdiction-driven.
    const kicker = this.t().featureKicker;
    const buyX = this.costX("getaway");
    const superX = this.costX("super_getaway");
    const antePct = `+${Math.round((this.costX("ante") - 1) * 100)}%`;
    const anteVal = this.runtime.isAnteEnabled() ? "ON" : "OFF";
    const anteSub = this.runtime.isAnteEnabled() ? "ACTIVE" : antePct;
    if (rect.height < 130) {
      const slot = (rect.width - 16) / 3;
      this.panelButton(rect.x, rect.y, slot, rect.height, kicker, "GETAWAY", `${buyX}x`, "getaway");
      this.panelButton(rect.x + slot + 8, rect.y, slot, rect.height, kicker, "SUPER", `${superX}x`, "super_getaway");
      this.panelButton(rect.x + (slot + 8) * 2, rect.y, slot, rect.height, "ANTE", anteSub, anteVal, "ante");
      return;
    }

    this.panelButton(rect.x, rect.y, panelWidth, 112, kicker, TEXT.buy, `${buyX.toFixed(2)}x`, "getaway");
    this.panelButton(rect.x, rect.y + 124, panelWidth, 124, kicker, TEXT.superBuy, `${superX.toFixed(2)}x`, "super_getaway");
    this.panelButton(rect.x, rect.y + 262, panelWidth, 134, TEXT.ante, anteSub, anteVal, "ante");

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

        // Fill the gap as fully as possible. The old `availH * 1.2` fudge was
        // compensating for dead transparent margin in the logo file; the art is
        // tightly cropped now, so overshooting here would genuinely overflow.
        // 0.97 leaves headroom for the 3% breathing pulse below.
        const baseScale = Math.min(boxW / logoTex.width, availH / logoTex.height) * 0.97;
        logo.scale.set(baseScale);
        logo.position.set(center, (regionTop + regionBottom) / 2);
        
        // Add a drop shadow to separate it clearly from the background
        logo.filters = [new DropShadowFilter({ color: 0x000000, alpha: 0.9, blur: 8, offset: { x: 0, y: 5 } })];

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

    const glowColor = 0xe30000; // Red theme color (#E30000)

    // Outer neon glow
    const glow = new Graphics();
    glow.roundRect(-4, -4, width + 8, height + 8, 10)
      .fill({ color: glowColor, alpha: 0.16 });
    glow.alpha = 0.8;
    panel.addChild(glow);

    // Dark body (with a tiny bit bolder strokes for extra depth/weight)
    const bg = new Graphics();
    bg.roundRect(0, 0, width, height, 8).fill({ color: 0x000000, alpha: 0.5 });
    bg.roundRect(0, 0, width, height, 8).stroke({ color: glowColor, width: 3.5, alpha: 0.85 });
    panel.addChild(bg);

    // Inner width available for text (account for the rounded body padding)
    const textMaxWidth = width - 16;

    // Kicker text
    const kickerSize = Math.min(13, Math.max(10, width / 12));
    const kickerColor = 0xffd1d1; // Soft light red
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

    // Value — gold or active red with drop shadow
    const vSize = Math.min(26, Math.max(16, width / 6));
    const valText = new Text({
      text: value,
      style: new TextStyle({
        fill: action === "ante" && this.runtime.isAnteEnabled() ? 0xff3333 : 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: vSize,
        fontWeight: "900",
        letterSpacing: 1,
        align: "center",
        dropShadow: { color: action === "super_getaway" ? 0xff6a00 : 0x000000, alpha: 0.5, blur: 6, distance: 0 }
      })
    });
    valText.anchor.set(0.5, 0);
    valText.position.set(width / 2, height * 0.65);
    this.fitText(valText, textMaxWidth);
    panel.addChild(valText);

    panel.position.set(x, y);
    panel.eventMode = "static";

    const disabled = this.controlsLocked();
    panel.cursor = disabled ? "default" : "pointer";
    if (disabled) {
       panel.alpha = 0.5;
    }

    // Breathing glow animation
    this.addAmbient((_dt, elapsed) => {
      const breath = 0.6 + Math.sin(elapsed * 2.2 + (action === "super_getaway" ? 1 : action === "ante" ? 2 : 0)) * 0.4;
      glow.alpha = 0.08 + breath * 0.14;
    });

    // Scale visual children (glow + bg), not the panel container itself.
    // This keeps the hit area stable so pointerup always routes back to `panel`.
    const scaleTarget = (s: number) => { glow.scale.set(s); bg.scale.set(s); };

    panel.on("pointerover", () => {
      if (!this.controlsLocked()) {
        scaleTarget(1.04);
        glow.alpha = 0.4;
      }
    });
    panel.on("pointerout", () => {
      scaleTarget(1);
    });
    panel.on("pointerdown", () => {
      if (!this.controlsLocked()) scaleTarget(0.96);
    });
    panel.on("pointerup", () => {
      scaleTarget(1);
      if (!this.controlsLocked()) void this.runtime.onAction(action);
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
      .stroke({ color: 0x9ae64e, width: 2, alpha: 0.45 });
    frame.roundRect(rect.x, rect.y, rect.width, rect.height, 10)
      .stroke({ color: 0x9ae64e, width: 1, alpha: 0.25 });
    this.underParticlesContainer.addChild(frame);
  }

  private drawControls(rect: Rect, snapshot: PlaybackSnapshot): void {
    // Bar background
    const bar = new Graphics();
    bar.rect(rect.x, rect.y, rect.width, rect.height).fill({ color: 0x000000, alpha: 0.5 });
    this.addChild(bar);

    // Small utility buttons
    this.smallButton(rect.x + 18, rect.y + rect.height / 2 - 20, 40, "☰", "menu");
    this.smallButton(rect.x + 66, rect.y + rect.height / 2 - 20, 40, this.runtime.isMuted() ? "🔇" : "📻", "mute");
    this.smallButton(rect.x + 114, rect.y + rect.height / 2 - 20, 40, "i", "info");

    const credit = this.runtime.getCredit();
    const betLevel = this.runtime.getBetLevel();
    const currency = this.runtime.getCurrency();
    // Effective bet uses the ante cost multiplier straight from the RGS config.
    const anteMult = this.runtime.isAnteEnabled() ? this.costX("ante") : 1;
    const effectiveBet = betLevel * anteMult;

    const isReplay = this.runtime.isReplayActive && this.runtime.isReplayActive();

    // Credit display (hidden entirely in replay mode)
    this.creditText = new Text({
      text: isReplay ? "" : `Credit ${this.fmtMoney(credit)} ${currency}`,
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

    // Bet display ("Play" on social casinos)
    this.betText = new Text({
      text: `${this.t().betLabel} ${this.fmtMoney(effectiveBet)} ${currency}`,
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

    // ── Centre column: single large text field centered in the panel ──
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    this.statusText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 24,
        fontWeight: "900",
        letterSpacing: 2,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 6, distance: 0 }
      })
    });
    this.statusText.anchor.set(0.5, 0.5);
    this.statusText.position.set(cx, cy);
    this.addChild(this.statusText);

    // Keep winText as a reference pointing to statusText for clean backwards compatibility!
    this.winText = this.statusText;

    const initBet = snapshot.betAmount || betLevel;
    const initWin = snapshot.roundWin > 0 ? snapshot.roundWin * initBet : 0;

    if (snapshot.state === "idle") {
      if (initWin > 0) {
        this.statusText.text = `WIN ${this.fmtWinMoney(initWin)} ${currency}`;
        this.statusText.style.fill = 0xffdf65; // Gold
      } else {
        this.statusText.text = this.currentIdleMessage;
        this.statusText.style.fill = 0xffffff; // White
      }
    } else {
      if (initWin > 0) {
        this.statusText.text = `WIN ${this.fmtWinMoney(initWin)} ${currency}`;
        this.statusText.style.fill = 0xffdf65;
      } else {
        this.statusText.text = this.getStatusMessage(snapshot.state);
        this.statusText.style.fill = 0xffffff;
      }
    }

    this.displayedWin = initWin;
    this.targetWin = initWin;
    this.cancelWinAnim();

    // Right side: bet controls + spin
    const right = rect.x + rect.width - 220;
    this.betButton(right, rect.y + rect.height / 2 - 20, 42, "−", "minus");
    this.spinButton(right + 64, rect.y + rect.height / 2 - 44);
    this.betButton(right + 160, rect.y + rect.height / 2 - 20, 42, "+", "plus");
  }

  private updateStateMessages(state: string): void {
    if (state !== this.lastState) {
      if (state === "spinning") {
        this.currentSpinMessage = SPIN_START_MESSAGES[Math.floor(Math.random() * SPIN_START_MESSAGES.length)]!;
      }
      if (state === "board_settle" || state === "cluster_evaluate") {
        this.currentMidSpinMessage = SPIN_MID_MESSAGES[Math.floor(Math.random() * SPIN_MID_MESSAGES.length)]!;
      }
      if (state === "tumble") {
        this.currentTumbleMessage = TUMBLE_MESSAGES[Math.floor(Math.random() * TUMBLE_MESSAGES.length)]!;
      }
      if (state === "idle") {
        // 70% chance of the standard prompt, 30% chance of a random tip.
        // The prompt is social-aware ("PLACE YOUR BET" → "PRESS SPIN TO PLAY").
        if (Math.random() < 0.7) {
          this.currentIdleMessage = this.t().idlePrompt;
        } else {
          this.currentIdleMessage = IDLE_MESSAGES[Math.floor(Math.random() * IDLE_MESSAGES.length)]!;
        }
      }
      this.lastState = state;
    }
  }

  private getStatusMessage(state: string): string {
    if (state === "spinning") {
      return this.currentSpinMessage;
    }
    if (state === "board_settle" || state === "cluster_evaluate" || state === "win_highlight") {
      return this.currentMidSpinMessage;
    }
    if (state === "tumble") {
      return this.currentTumbleMessage;
    }
    switch (state) {
      case "idle":
        return this.currentIdleMessage || this.t().idlePrompt;
      case "bonus_intro":
        return "THE GETAWAY CHASE!";
      case "bonus_respin":
        return "POLICE CHASE ACTIVE!";
      case "bonus_collect":
        return "COLLECTING THE STASH!";
      case "bonus_key_crack":
        return "CRACKING SAFES!";
      case "heat_advance":
        return "HEAT LEVEL INCREASED!";
      case "heat_feature_transform":
        return "BUST THE STASH!";
      case "round_complete":
        return "SPIN COMPLETED!";
      default:
        return state.replaceAll("_", " ").toUpperCase();
    }
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
   * Animate a single star filling in — call AFTER draw() so the static star is
   * already rendered; this overlay pops on top then fades, directing the player's
   * eye to the newly-earned heat star.
   */
  async animateStarFill(starIndex: number): Promise<void> {
    const rect = this.starDrawRect;
    if (!rect || starIndex < 0 || starIndex >= 5) return;

    const starR = this.starRadius;
    const gap = starR * 0.55;
    const totalW = starR * 2 * 5 + gap * 4;
    const startX = rect.x + (rect.width - totalW) / 2 + starR;
    const labelSize = Math.min(13, rect.width * 0.04);
    const starCY = rect.y + rect.height / 2 + labelSize * 0.5 + 2;
    const sx = startX + starIndex * (starR * 2 + gap);

    // Overlay star — slight pop in and flash white (GTA style)
    const starGfx = new Graphics();
    const pts = this.starPoints(0, 0, starR, starR * 0.42);
    starGfx.poly(pts).fill(0xffffff);
    starGfx.poly(pts).stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
    starGfx.position.set(sx, starCY);
    starGfx.alpha = 0;
    this.underParticlesContainer.addChild(starGfx);

    // Fast fade in with slight bump, then holds
    await tween(150, (p) => {
      starGfx.alpha = p;
      starGfx.scale.set(1.0 + Math.sin(p * Math.PI) * 0.3);
    }, linear);

    starGfx.scale.set(1);

    // Hold for a moment, then fade away (revealing the static filled star underneath)
    await wait(100);
    await tween(150, (p) => { starGfx.alpha = 1 - p; }, linear);
    starGfx.destroy();
  }

  /**
   * Draw the 5 GTA-style wanted-level stars inside `rect`.
   * Works for both the landscape art panel (full height) and the portrait
   * starsBar strip (narrow strip above the board).
   */
  private drawWantedStars(rect: Rect): void {
    this.starDrawRect = rect;
    const starR = Math.min(22, rect.width / 11); // outer radius
    this.starRadius = starR;
    const starIR = starR * 0.42;                 // inner radius — sharper GTA points
    const gap = starR * 0.55;
    const totalW = starR * 2 * 5 + gap * 4;
    const startX = rect.x + (rect.width - totalW) / 2 + starR;
    // Centre the stars vertically in the rect, leaving a bit of room for the label above.
    const labelSize = Math.min(13, rect.width * 0.04);
    const starCY = rect.y + rect.height / 2 + labelSize * 0.5 + 2;

    const meter = Math.max(0, Math.min(5, this.runtime.getWantedLevel()));
    const filledStars: Graphics[] = [];
    // Collection head-start: the first `headStart` stars are pre-lit (gold) as
    // the active Power-Level advantage. `activeTier` stars exist but show dimmed
    // when the current bet is above that tier's average-bet lock (advantage off).
    const headStart = Math.max(0, Math.min(5, this.runtime.getHeadStartStars?.() ?? 0));
    const activeTier = Math.max(0, Math.min(5, this.runtime.getActiveTier?.() ?? 0));

    // "WANTED LEVEL" label centred above the star row
    this.underParticlesContainer.addChild(makeText(
      "WANTED LEVEL",
      labelSize,
      0x9fb4d0,
      rect.x + rect.width / 2,
      starCY - starR - labelSize - 2,
      "center"
    ));

    for (let i = 0; i < 5; i++) {
      const sx = startX + i * (starR * 2 + gap);
      const pts = this.starPoints(sx, starCY, starR, starIR);

      const base = new Graphics();
      base.poly(pts).fill({ color: 0x000000, alpha: 0.5 });
      base.poly(pts).stroke({ color: 0x4a5570, width: 2.5, alpha: 0.6 });
      this.underParticlesContainer.addChild(base);

      // The first `headStart` stars are the pre-lit gold advantage; the live heat
      // climb fills the stars AFTER them, so head-start + climb tops out at 5★
      // exactly when the Getaway triggers on a tier book.
      if (i < headStart) {
        const hs = new Graphics();
        hs.poly(pts).fill({ color: 0xffcf40, alpha: 0.9 });
        hs.poly(pts).stroke({ color: 0xffe680, width: 1.5, alpha: 0.95 });
        this.underParticlesContainer.addChild(hs);
        continue; // a head-start star carries no live (white) fill
      }
      // Tier unlocked but dimmed (bet above the average-bet lock → advantage off).
      if (i < activeTier) {
        const dim = new Graphics();
        dim.poly(pts).fill({ color: 0xffcf40, alpha: 0.12 });
        dim.poly(pts).stroke({ color: 0xffcf40, width: 1.5, alpha: 0.4 });
        this.underParticlesContainer.addChild(dim);
      }

      // Quantize to 0, 0.5, or 1 — never three-quarters or any other fraction.
      const rawFill = Math.max(0, Math.min(1, meter - (i - headStart)));
      const fill = rawFill < 0.25 ? 0 : rawFill < 0.75 ? 0.5 : 1;

      if (fill > 0) {
        const filled = new Graphics();
        filled.poly(pts).fill(0xffffff);
        filled.poly(pts).stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        this.underParticlesContainer.addChild(filled);
        if (fill < 1) {
          // Reveal the leftmost `fill` fraction of the star horizontally (left-to-right fill).
          // Star bounding box: x ∈ [sx - starR, sx + starR], y ∈ [starCY - starR, starCY + starR]
          const filledW = 2 * starR * fill;
          const mask = new Graphics();
          mask.rect(sx - starR, starCY - starR, filledW, starR * 2).fill(0xffffff);
          this.underParticlesContainer.addChild(mask);
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

  private drawCharacter(rect: Rect, _count: number): void {
    // Driven by the PERSISTENT gallery (not the old wrap-at-8 counter).
    const prog = this.runtime.getGalleryProgress();

    const silTex = getExtraTexture(`${prog.artPrefix}_silhouette`);
    if (!silTex) return; // no art for this girl yet (girls 2/3) — see card options

    const assembly = new Container();
    const silSprite = new Sprite(silTex);
    silSprite.anchor.set(0.5);
    silSprite.x = prog.artPrefix === "char" ? 57.5 : 0;
    silSprite.y = prog.artPrefix === "char" ? 27.5 : 0;
    silSprite.tint = 0x000000;
    const outline = new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1.0 });
    outline.resolution = window.devicePixelRatio || 1;
    silSprite.filters = [outline];
    assembly.addChild(silSprite);

    for (let i = 1; i <= Math.min(prog.totalPieces, prog.pieces); i++) {
      const pieceTex = getExtraTexture(`${prog.artPrefix}_piece_${i}`);
      if (pieceTex) {
        const pieceSprite = new Sprite(pieceTex);
        pieceSprite.anchor.set(0.5);
        assembly.addChild(pieceSprite);
      }
    }

    // When complete, draw the full image instead of separate layers (no seams).
    if (prog.pieces >= prog.totalPieces) {
      const fullTex = getExtraTexture(`${prog.artPrefix}_full`);
      if (fullTex) {
        const fullSprite = new Sprite(fullTex);
        fullSprite.anchor.set(0.5);
        assembly.addChild(fullSprite);
      }
    }

    const boxW = rect.width - 24;
    const boxH = rect.height - 84;
    const scale = Math.min(boxW / silTex.width, boxH / silTex.height);
    const multiplier = prog.artPrefix !== "char" ? 1.25 : 1.0;
    assembly.scale.set(scale * multiplier);
    assembly.position.set(rect.x + rect.width / 2, rect.y + 60 + (rect.height - 60) / 2);
    this.underParticlesContainer.addChild(assembly);
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
    g.circle(size / 2, size / 2, size / 2).fill({ color: 0x000000, alpha: 0.5 }).stroke({ color: 0x6d9154, width: 1.5 });
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
    g.circle(size / 2, size / 2, size / 2).fill({ color: 0x000000, alpha: 0.5 }).stroke({ color: 0x9ae64e, width: 2, alpha: 0.6 });
    button.addChild(g);
    const txt = new Text({
      text: label,
      style: new TextStyle({
        fill: 0x9ae64e,
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

    // Bet sizing is locked while a round runs, during autoplay and in replay.
    const disabled = this.controlsLocked();
    button.cursor = disabled ? "default" : "pointer";
    if (disabled) button.alpha = 0.5;

    button.on("pointerover", () => { if(!disabled) { button.scale.set(1.12); g.tint = 0xccddff; }});
    button.on("pointerout", () => { if(!disabled) { button.scale.set(1); g.tint = 0xffffff; }});
    button.on("pointertap", () => { if(!this.controlsLocked()) void this.runtime.onAction(action); });
    this.addChild(button);
  }

  private spinButton(x: number, y: number): void {
    const isPlaying = this.runtime.isPlaying();
    const autoRemaining = this.runtime.getAutoplayRemaining?.() ?? 0;
    const isAuto = autoRemaining > 0;
    const button = new Container();
    const R = 44;

    // `visual` is the element that scales on press.
    // Keeping it separate from `button` (the hit-area container) means the
    // interactive bounds never change mid-press, so Pixi always routes pointerup
    // back to `button` even if the pointer drifted slightly during the press.
    const visual = new Container();

    // Halo glow behind
    const halo = new Graphics();
    halo.circle(R, R, R + 10).fill({ color: 0x9ae64e, alpha: isPlaying ? 0 : 0.08 });
    visual.addChild(halo);

    // Outer ring
    const outer = new Graphics();
    outer.circle(R, R, R).fill({ color: 0x000000, alpha: 0.5 });
    outer.circle(R, R, R).stroke({ color: isPlaying ? 0x5d7d49 : 0x9ae64e, width: 4 });
    visual.addChild(outer);

    // Inner disc
    const inner = new Graphics();
    inner.circle(R, R, R - 8).fill({ color: 0x000000, alpha: 0.5 });
    inner.circle(R, R, R - 8).stroke({ color: isPlaying ? 0x4d6639 : 0x9ae64e, width: 1.5, alpha: 0.4 });
    visual.addChild(inner);

    // SPIN text — Impact. During autoplay the button becomes the STOP control
    // and shows the number of spins left (∞ for endless).
    const spinLabel = isAuto
      ? `STOP\n${Number.isFinite(autoRemaining) ? autoRemaining : "∞"}`
      : "SPIN";
    const spinText = new Text({
      text: spinLabel,
      style: new TextStyle({
        fill: isAuto ? 0xff7676 : isPlaying ? 0x5a6a7c : 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: isAuto ? 18 : 24,
        fontWeight: "900",
        letterSpacing: 3,
        align: "center",
        dropShadow: isPlaying && !isAuto ? undefined : { color: isAuto ? 0xff5555 : 0x9ae64e, alpha: 0.4, blur: 6, distance: 0 }
      })
    });
    spinText.anchor.set(0.5, 0.5);
    spinText.position.set(R, R);
    visual.addChild(spinText);

    button.addChild(visual);
    button.position.set(x, y);
    button.eventMode = "static";

    // During autoplay the button stays ENABLED (it stops the run); it is
    // disabled mid-round otherwise, and always in replay mode.
    const disabled = (isPlaying && !isAuto) || (this.runtime.isReplayActive && this.runtime.isReplayActive());
    button.cursor = disabled ? "default" : "pointer";
    if (this.runtime.isReplayActive && this.runtime.isReplayActive()) {
        button.alpha = 0.5;
    }

    if (!disabled) {
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
