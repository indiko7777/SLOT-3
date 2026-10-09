import { FillGradient, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { CASCADE_LADDER, TEXT, type Position } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import { winCountMoney } from "./winCount";
import { getExtraTexture, silhouetteOffset } from "./assets";
import { drawCabinetBack, drawCabinetFront } from "./cabinet";
import { buildLivingBackground, BASE_STREET } from "./livingBackground";
import { GIRL_ACCENT, pieceBounds } from "./girlReveal";
import { wantedStarsGeometry } from "./layout";
import { makeText } from "./text";
import { ambientTicker, tween, wait, easeOutBack, easeOutCubic, easeInCubic, linear } from "./tween";
import { softGlowTexture } from "./fxTextures";
import type { LayoutMetrics, Rect, SceneRuntime } from "./types";
import { formatMultiplier } from "../format";
import { money, moneyBalance } from "../currency";
import { buildControlBar, fitWidth } from "./controlBar";
import { anteCard, featureCard } from "./featureCards";
import { OutlineFilter, DropShadowFilter } from "pixi-filters";
import { getPrestigeTitle } from "../meta/collection";
import { DISPLAY_FONT, UI_FONT } from "../typography";

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
  /** The living street survives HUD redraws (rebuilt only when the size changes). */
  private living: { key: string; world: Container; tick: (dt: number, t: number) => void } | null = null;
  private readonly starEffects = new Container();
  private statusText: Text | null = null;
  private winText: Text | null = null;
  private creditText: Text | null = null;
  private betText: Text | null = null;
  private winLabel: Text | null = null;

  /** Win counter animation state */
  private displayedWin = 0;
  private targetWin = 0;
  private winAnimFrame = 0;

  /** Star position cache — set by drawWantedStars, read by animateStarFill */
  private starDrawRect: Rect | null = null;
  private wantedLabel: Text | null = null;
  private starFlash: { text: string; until: number } | null = null;
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
    this.cancelWinAnim();
    for (const child of this.removeChildren()) child.destroy({ children: true });
    for (const child of this.bgContainer.removeChildren()) {
      if (child !== this.living?.world) child.destroy({ children: true });
    }
    for (const child of this.underParticlesContainer.removeChildren()) {
      if (child !== this.starEffects) child.destroy({ children: true });
    }
    this.starDrawRect = null;
    this.statusText = null;
    this.winText = null;
    this.winLabel = null;
    this.updateStateMessages(snapshot.state);
    this.drawBackground(layout, snapshot);
    if (layout.leftPanel) this.drawBuyPanel(layout.leftPanel, layout);
    if (layout.artPanel) this.drawArt(layout.artPanel, snapshot);
    // Portrait: draw the 5 wanted stars in the dedicated strip above the board.
    if (layout.starsBar) this.drawWantedStars(layout.starsBar);
    this.drawBoardFrame(layout, snapshot);
    this.drawControls(layout.bottomBar, snapshot);
    // Running star tweens own their lifetime and survive an unrelated HUD redraw.
    this.underParticlesContainer.addChild(this.starEffects);
  }

  /** Lightweight update — only changes the status/win text. No rebuild, no flash. */
  updateStatus(layout: LayoutMetrics, snapshot: PlaybackSnapshot): void {
    const bet = snapshot.betAmount || this.runtime.getBetLevel();
    const roundWinAmount = snapshot.roundWin * bet;

    this.updateStateMessages(snapshot.state);

    if (roundWinAmount > 0) {
      this.animateWinTo(roundWinAmount);
    } else {
      this.cancelWinAnim();
      this.displayedWin = 0;
      this.targetWin = 0;
      this.showMessage(snapshot.state !== "idle" ? this.getStatusMessage(snapshot.state) : this.t().idlePrompt);
    }
    // Update balance display (deduct could happen externally). Replays have
    // no wallet, so the balance stays hidden there.
    if (this.creditText) {
      this.creditText.text = this.runtime.isReplayActive?.() ? "—" : moneyBalance(this.runtime.getCredit());
      fitWidth(this.creditText, (this.creditText as Text & { maxW?: number }).maxW ?? 180);
    }
  }

  /** Animate the win counter (in real money) from the current value to target. */
  private animateWinTo(target: number): void {
    if (!this.winText) return;
    this.targetWin = target;
    if (this.winAnimFrame) return;

    const startVal = this.displayedWin;
    const startTime = performance.now();
    const duration = Math.min(900, 250 + Math.abs(target - startVal) * 6);

    const tick = (now: number) => {
      const raw = Math.min(1, (now - startTime) / duration);
      const t = 1 - (1 - raw) * (1 - raw);
      const current = startVal + (this.targetWin - startVal) * t;
      this.displayedWin = current;
      // Count at the payout's own precision — interpolated floats used to
      // flicker through four-decimal values.
      this.showWin(winCountMoney(this.targetWin)(current), 1 + Math.sin(raw * Math.PI) * 0.12);
      if (raw < 1) {
        this.winAnimFrame = requestAnimationFrame(tick);
      } else {
        this.winAnimFrame = 0;
        this.displayedWin = this.targetWin;
        this.showWin(money(this.targetWin));
      }
    };
    this.winAnimFrame = requestAnimationFrame(tick);
  }

  private costX(mode: string): number {
    return this.runtime.getCostMultiplier?.(mode) ?? 1;
  }

  private t() {
    return this.runtime.getUiStrings();
  }

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
    if (tier > 0 && !active) return `${tier} GOLD STARS SAVED FOR BASE MODE`;
    if (prog.prestige > 0) return `${getPrestigeTitle(prog.prestige)} ACTIVE · COLLECT WILDS FOR ${prog.girlName.toUpperCase()}`;
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
    if (amount > 0) this.showWin(money(amount));
    else if (this.winText) { this.winText.text = ""; this.winText.visible = false; }
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
    const isBonus = snapshot.state.startsWith("bonus");
    const bgTex = getExtraTexture(isBonus ? "bg_bonus" : "bg_base");

    // Base game: the living street (swaying palms, glints, gulls). Kept alive
    // across redraws so the trees never snap back after a spin.
    let living = false;
    if (!isBonus) {
      const key = `${layout.width}x${layout.height}`;
      if (this.living && this.living.key !== key) {
        ambientTicker.remove(this.living.tick);
        this.living.world.destroy({ children: true });
        this.living = null;
      }
      if (!this.living) {
        const built = buildLivingBackground(this.bgContainer, { w: layout.width, h: layout.height }, BASE_STREET);
        if (built) {
          this.living = { key, ...built };
          ambientTicker.add(built.tick);
        }
      } else {
        this.bgContainer.addChildAt(this.living.world, 0);
      }
      living = !!this.living;
    }
    if (living) {
      const dim = new Graphics();
      dim.rect(0, 0, layout.width, layout.height).fill({ color: 0x0b151c, alpha: 0.06 });
      this.bgContainer.addChild(dim);
    } else if (bgTex) {
      const sprite = new Sprite(bgTex);
      const scaleX = layout.width / bgTex.width;
      const scaleY = layout.height / bgTex.height;
      const scale = Math.max(scaleX, scaleY);
      sprite.scale.set(scale);
      sprite.anchor.set(0.5);
      sprite.position.set(layout.width / 2, layout.height / 2);
      this.bgContainer.addChild(sprite);
      const dim = new Graphics();
      dim.rect(0, 0, layout.width, layout.height).fill({ color: 0x0b151c, alpha: 0.06 });
      this.bgContainer.addChild(dim);
    } else {
      const g = new Graphics();
      g.rect(0, 0, layout.width, layout.height).fill(0x000000);
      g.circle(layout.width * 0.78, layout.height * 0.2, Math.max(layout.width, layout.height) * 0.26).fill({ color: 0x2ea847, alpha: 0.24 });
      g.circle(layout.width * 0.26, layout.height * 0.96, Math.max(layout.width, layout.height) * 0.25).fill({ color: 0xff6129, alpha: 0.3 });
      this.bgContainer.addChild(g);
    }
  }

  private drawBuyPanel(rect: Rect, layout: LayoutMetrics): void {
    const t = this.t();
    const social = this.runtime.isSocial();
    const bet = this.runtime.getBetLevel();
    const buyX = this.costX("getaway");
    const superX = this.costX("super_getaway");
    const anteX = this.costX("ante");
    const anteOn = this.runtime.isAnteEnabled();
    const locked = this.controlsLocked();
    const unit = social ? "PLAY" : "BET";
    const kicker = social ? "FEATURE" : "BONUS BUY";
    const tap = (a: string) => () => { if (!this.controlsLocked()) void this.runtime.onAction(a); };
    const anteTitle = social ? "Ante" : "Ante Bet";
    const anteCost = `+${Math.round((anteX - 1) * 100)}% ${unit} · ${anteOn ? "ON" : "OFF"}`;

    if (rect.height < 130) {
      // Portrait / compact: three cards in a row.
      const gap = 8;
      const w = (rect.width - gap * 2) / 3;
      const h = rect.height;
      this.addChild(featureCard({
        x: rect.x, y: rect.y, w, h, compact: true, art: getExtraTexture("card_getaway"), focus: { x: 0.55, y: 0.3 },
        theme: "getaway", kicker, title: "Getaway", price: money(bet * buyX), priceNote: "", disabled: locked, onTap: tap("getaway"),
      }));
      this.addChild(featureCard({
        x: rect.x + w + gap, y: rect.y, w, h, compact: true, art: getExtraTexture("card_super"), focus: { x: 0.5, y: 0.35 },
        theme: "super", kicker, title: "Super", price: money(bet * superX), priceNote: "", disabled: locked, onTap: tap("super_getaway"),
      }));
      this.addChild(anteCard({
        x: rect.x + (w + gap) * 2, y: rect.y, w, h, compact: true, on: anteOn, title: "Ante",
        detail: "", cost: `+${Math.round((anteX - 1) * 100)}%`, disabled: locked, onTap: tap("ante"),
      }));
      return;
    }

    // Landscape: two slim art cards and the ante switch, the logo under them.
    const x0 = 14;
    const x1 = Math.max(x0 + 150, layout.boardFrame.x - 54);
    const w = Math.min(214, x1 - x0);
    const left = (x0 + x1) / 2 - w / 2;
    let y = rect.y;
    const cardH = 104;
    this.addChild(featureCard({
      x: left, y, w, h: cardH, compact: false, art: getExtraTexture("card_getaway"), focus: { x: 0.56, y: 0.3 },
      theme: "getaway", kicker, title: TEXT.buy, price: money(bet * buyX), priceNote: `${formatMultiplier(buyX)}× ${unit}`,
      disabled: locked, onTap: tap("getaway"),
    }));
    y += cardH + 10;
    this.addChild(featureCard({
      x: left, y, w, h: cardH, compact: false, art: getExtraTexture("card_super"), focus: { x: 0.52, y: 0.34 },
      theme: "super", kicker, title: TEXT.superBuy, price: money(bet * superX), priceNote: `${formatMultiplier(superX)}× ${unit}`,
      disabled: locked, onTap: tap("super_getaway"),
    }));
    y += cardH + 10;
    this.addChild(anteCard({
      x: left, y, w, h: 56, compact: false, on: anteOn, title: anteTitle,
      detail: "", cost: anteCost, disabled: locked, onTap: tap("ante"),
    }));
    y += 56;

    const logoTex = getExtraTexture("heat_chase_logo");
    if (logoTex && logoTex.width > 0 && logoTex.height > 0) {
      const regionTop = y + 18, regionBottom = rect.y + rect.height - 4;
      const availH = regionBottom - regionTop;
      if (availH > 30) {
        const logo = new Sprite(logoTex);
        logo.anchor.set(0.5);
        logo.scale.set(Math.min(w * 0.96 / logoTex.width, availH * 0.85 / logoTex.height));
        logo.position.set(left + w / 2, (regionTop + regionBottom) / 2);
        this.addChild(logo);
      }
    }
  }

  /** The reel cabinet: glass + bezel under the reels, neon + deco over the edge. */
  private drawBoardFrame(layout: LayoutMetrics, snapshot: PlaybackSnapshot): void {
    const bgTex = getExtraTexture(snapshot.state.startsWith("bonus") ? "bg_bonus" : "bg_base");
    drawCabinetBack(this.bgContainer, layout.boardFrame, layout.board, bgTex, { w: layout.width, h: layout.height });
    this.addAmbient(drawCabinetFront(this.underParticlesContainer, layout.boardFrame, layout.board));
  }

  private drawControls(rect: Rect, snapshot: PlaybackSnapshot): void {
    const rt = this.runtime;
    const anteMult = rt.isAnteEnabled() ? this.costX("ante") : 1;
    const isReplay = rt.isReplayActive?.() ?? false;
    const t = this.t();
    const bar = buildControlBar(rect, {
      muted: rt.isMuted(),
      playing: rt.isPlaying(),
      locked: this.controlsLocked(),
      replay: isReplay,
      autoRemaining: rt.getAutoplayRemaining?.() ?? 0,
      turbo: rt.getTurboMode?.() ?? (rt.isTurbo() ? "turbo" : "off"),
      canMinus: rt.canBetDown?.() ?? true,
      canPlus: rt.canBetUp?.() ?? true,
      labels: { balance: t.creditLabel, bet: t.betLabel, win: "Win" },
      balance: moneyBalance(rt.getCredit()),
      bet: money(rt.getBetLevel() * anteMult),
    }, (action) => void rt.onAction(action));
    this.addChild(bar.root);
    this.addAmbient(bar.tick);
    this.creditText = bar.balance;
    this.betText = bar.bet;
    this.winText = bar.win;
    this.winLabel = bar.winLabel;
    this.statusText = bar.message;

    const initBet = snapshot.betAmount || rt.getBetLevel();
    const initWin = snapshot.roundWin > 0 ? snapshot.roundWin * initBet : 0;
    this.displayedWin = initWin;
    this.targetWin = initWin;
    this.cancelWinAnim();
    if (initWin > 0) this.showWin(money(initWin));
    else this.showMessage(snapshot.state === "idle" ? this.currentIdleMessage || t.idlePrompt : this.getStatusMessage(snapshot.state));
  }

  /** WIN read-out on, message off. */
  private showWin(text: string, pulse = 1): void {
    if (!this.winText) return;
    this.winText.text = text;
    const maxW = (this.winText as Text & { maxW?: number }).maxW ?? 400;
    fitWidth(this.winText, maxW);
    if (pulse !== 1) this.winText.scale.set(this.winText.scale.x * pulse);
    this.winText.visible = true;
    if (this.winLabel) this.winLabel.visible = true;
    if (this.statusText) this.statusText.visible = false;
  }

  /** No win: the WIN slot carries the round's status line instead. */
  private showMessage(text: string): void {
    if (this.winText) this.winText.visible = false;
    if (this.winLabel) this.winLabel.visible = false;
    if (!this.statusText) return;
    this.statusText.text = text;
    const maxW = (this.statusText as Text & { maxW?: number }).maxW ?? (this.winText as Text & { maxW?: number } | null)?.maxW ?? 400;
    fitWidth(this.statusText, maxW);
    this.statusText.visible = text.length > 0;
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
    // The wanted stars live in layout.starsBar, on top of the reel frame.
    this.drawCharacter(rect, _snapshot.collectionCount);
  }

  /** The character fits above the crew tag that CardPeekView draws at the
   *  bottom of the art panel. */
  private crewBounds(rect: Rect): { top: number; bottom: number } {
    return { top: rect.y + 8, bottom: rect.y + rect.height - 44 };
  }

  async animateStarFill(starIndex: number): Promise<void> {
    const rect = this.starDrawRect;
    if (!rect || starIndex < 0 || starIndex >= 5) return;

    const geo = wantedStarsGeometry(rect);
    const starR = geo.starR;
    const starCY = geo.centers[starIndex]!.y;
    const sx = geo.centers[starIndex]!.x;

    // Name what this star just bought, in the label above the meter.
    const feature = ["", "STASH BUST", "MEGA WILD", "MEGA WILD", "THE GETAWAY"][starIndex] ?? "";
    const mult = starIndex < 4 ? `×${CASCADE_LADDER[starIndex + 1]} WINS` : "";
    const text = [mult, feature].filter(Boolean).join(" · ");
    this.starFlash = { text, until: performance.now() + 1600 };
    const label = this.wantedLabel;
    if (label && !label.destroyed) {
      label.text = text;
      label.style.fill = 0xffd75e;
      window.setTimeout(() => {
        if (label.destroyed || this.wantedLabel !== label) return;
        label.text = "WANTED LEVEL";
        label.style.fill = 0xffffff;
      }, 1600);
    }

    const starGfx = new Graphics();
    const pts = this.starPoints(0, 0, starR, starR * 0.42);
    starGfx.poly(pts).fill(0xffffff);
    starGfx.poly(pts).stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
    starGfx.position.set(sx, starCY);
    starGfx.alpha = 0;
    this.starEffects.addChild(starGfx);

    await tween(150, (p) => {
      starGfx.alpha = p;
      starGfx.scale.set(1.0 + Math.sin(p * Math.PI) * 0.3);
    }, linear);

    starGfx.scale.set(1);

    await wait(100);
    await tween(150, (p) => { starGfx.alpha = 1 - p; }, linear);
    starGfx.destroy();
  }

  /**
   * The Wanted meter has filled to 5★ on a paid spin: ignite the five stars
   * themselves so it is unmistakable that FILLING THE STARS — not any single
   * symbol on the reels — is what triggers the Getaway. The stars charge in
   * sequence, then detonate together with a shockwave and spark shower. The
   * caller covers the tail with a white-out and cross-fades the bonus intro in,
   * so the stars visibly *become* the chase. Text-free by design.
   *
   * Aligns to the live star geometry cached by drawWantedStars, so it lands in
   * the right place in both the landscape art panel and the portrait stars bar.
   */
  async igniteWantedStars(onBeat?: (i: number) => void, turbo = false): Promise<void> {
    const rect = this.starDrawRect;
    if (!rect) { await wait(turbo ? 120 : 300); return; }

    const geo = wantedStarsGeometry(rect);
    const starR = geo.starR;
    const starIR = starR * 0.42;
    const cy = geo.centers[0]!.y;
    const centerX = rect.x + rect.width / 2;

    const fx = new Container();
    this.starEffects.addChild(fx);

    const stars: Graphics[] = [];
    for (let i = 0; i < 5; i++) {
      const cx = geo.centers[i]!.x;
      const g = new Graphics();
      const pts = this.starPoints(0, 0, starR, starIR);
      g.poly(pts).fill(0xffe07a);
      g.poly(pts).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
      g.position.set(cx, cy);
      g.alpha = 0;
      fx.addChild(g);
      stars.push(g);
    }

    // Phase 1 — sequential charge: each star flares gold-white and pops with an
    // expanding ring, left to right, so the eye is led across the full meter.
    const step = turbo ? 55 : 110;
    for (let i = 0; i < 5; i++) {
      onBeat?.(i);
      const g = stars[i]!;
      const ring = new Graphics();
      ring.position.set(g.x, g.y);
      fx.addChildAt(ring, 0);
      void tween(turbo ? 240 : 420, (p) => {
        const e = easeOutBack(Math.min(1, p * 1.3));
        g.alpha = Math.min(1, p * 3);
        g.scale.set(0.6 + e * 0.6);
        const rr = 1 + p * 1.6;
        ring.clear();
        ring.poly(this.starPoints(0, 0, starR * rr, starIR * rr))
          .stroke({ color: 0xffd95c, width: 3 * (1 - p), alpha: 0.85 * (1 - p) });
      }, linear).then(() => { g.scale.set(1); ring.destroy(); });
      await wait(step);
    }

    // Phase 2 — unified detonation: all five pulse white-hot together while a
    // shockwave ring and a radial spark shower blow out from the meter's centre.
    await wait(turbo ? 40 : 90);
    onBeat?.(5);
    const shock = new Graphics();
    shock.position.set(centerX, cy);
    fx.addChild(shock);

    const sparkN = turbo ? 10 : 18;
    const sparks: Graphics[] = [];
    const angles: number[] = [];
    for (let s = 0; s < sparkN; s++) {
      const sp = new Graphics();
      sp.circle(0, 0, starR * 0.16).fill(0xfff4d6);
      sp.position.set(centerX, cy);
      fx.addChild(sp);
      sparks.push(sp);
      angles.push((s / sparkN) * Math.PI * 2 + Math.random() * 0.35);
    }
    const reach = starR * (turbo ? 5 : 8);

    // The blast light swells out of the meter until it fills the screen and
    // hands straight into the white-out — the stars visibly BECOME the chase.
    const swell = new Sprite(softGlowTexture());
    swell.anchor.set(0.5);
    swell.blendMode = "add";
    swell.tint = 0xfff1c9;
    swell.position.set(centerX, cy);
    swell.alpha = 0;
    fx.addChildAt(swell, 0);
    const screenSpan = Math.max(window.innerWidth, window.innerHeight) * 2.4 / 128;

    await tween(turbo ? 300 : 520, (p) => {
      swell.scale.set(0.4 + screenSpan * easeInCubic(p));
      swell.alpha = Math.min(1, p * 1.6);
      const e = easeOutCubic(p);
      const pulse = 1 + Math.sin(Math.min(1, p * 1.5) * Math.PI) * 0.7;
      for (const g of stars) g.scale.set(pulse);
      const sr = 1 + e * 7;
      shock.clear();
      shock.poly(this.starPoints(0, 0, starR * sr, starIR * sr))
        .stroke({ color: 0xffffff, width: 6 * (1 - p), alpha: 0.9 * (1 - p) });
      sparks.forEach((sp, s) => {
        sp.position.set(centerX + Math.cos(angles[s]!) * reach * e, cy + Math.sin(angles[s]!) * reach * e);
        sp.alpha = 1 - p;
        sp.scale.set(1 - p * 0.5);
      });
    }, linear);

    fx.destroy({ children: true });
  }

  private drawWantedStars(rect: Rect): void {
    this.starDrawRect = rect;
    const geo = wantedStarsGeometry(rect);
    const starR = geo.starR;
    this.starRadius = starR;
    const starIR = starR * 0.42;
    const labelSize = geo.labelSize;
    const starCY = geo.centers[0]!.y;

    const meter = Math.max(0, Math.min(5, this.runtime.getWantedLevel()));
    const filledStars: Graphics[] = [];
    const headStart = Math.max(0, Math.min(5, this.runtime.getHeadStartStars?.() ?? 0));
    const activeTier = Math.max(0, Math.min(5, this.runtime.getActiveTier?.() ?? 0));

    // Right after a star fills, the label briefly names what it bought (the
    // tumble multiplier, and the feature at 2★ / 3★ / 4★) — otherwise the meter
    // stays the plain GTA "WANTED LEVEL".
    const flash = this.starFlash && performance.now() < this.starFlash.until ? this.starFlash.text : null;
    const wantedLabel = makeText(
      flash ?? (headStart > 0 ? `WANTED LEVEL · ${headStart} STAR MODE` : "WANTED LEVEL"),
      labelSize,
      flash ? 0xffd75e : 0xffffff,
      rect.x + rect.width / 2,
      starCY - starR - labelSize - 2,
      "center"
    );
    this.wantedLabel = wantedLabel;
    // readable over the bright sunset sky: white with a soft dark shadow
    wantedLabel.style.letterSpacing = 1.5;
    wantedLabel.style.dropShadow = { color: 0x1a0c14, alpha: 0.75, blur: 4, distance: 1, angle: Math.PI / 2 };
    this.underParticlesContainer.addChild(wantedLabel);

    for (let i = 0; i < 5; i++) {
      const sx = geo.centers[i]!.x;
      const pts = this.starPoints(sx, starCY, starR, starIR);

      const base = new Graphics();
      base.poly(pts).fill({ color: 0x000000, alpha: 0.5 });
      base.poly(pts).stroke({ color: 0x4a5570, width: 2.5, alpha: 0.6 });
      this.underParticlesContainer.addChild(base);

      if (i < headStart) {
        const hs = new Graphics();
        hs.poly(pts).fill({ color: 0xffcf40, alpha: 0.9 });
        hs.poly(pts).stroke({ color: 0xffe680, width: 1.5, alpha: 0.95 });
        this.underParticlesContainer.addChild(hs);
        continue;
      }
      if (i < activeTier) {
        const dim = new Graphics();
        dim.poly(pts).fill({ color: 0xffcf40, alpha: 0.12 });
        dim.poly(pts).stroke({ color: 0xffcf40, width: 1.5, alpha: 0.4 });
        this.underParticlesContainer.addChild(dim);
      }

      const rawFill = Math.max(0, Math.min(1, meter - (i - headStart)));
      const fill = rawFill < 0.25 ? 0 : rawFill < 0.75 ? 0.5 : 1;

      if (fill > 0) {
        const filled = new Graphics();
        filled.poly(pts).fill(0xffffff);
        filled.poly(pts).stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        this.underParticlesContainer.addChild(filled);
        if (fill < 1) {
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
    const prog = this.runtime.getGalleryProgress();
    const silTex = getExtraTexture(`${prog.artPrefix}_silhouette`);
    if (!silTex) return;

    const assembly = new Container();
    const silSprite = new Sprite(silTex);
    silSprite.anchor.set(0.5);
    // BULLETPROOF ALIGNMENT: silhouette + every piece + the full image share ONE
    // canvas per character. Pieces are the real art (placed at 0,0); the
    // silhouette gets a per-character registration offset (canvas-fraction based,
    // so it scales exactly at ANY panel size) because girl 1's silhouette was
    // authored off-centre from her pieces. See silhouetteOffset() in assets.ts.
    const silOff = silhouetteOffset(prog.artPrefix, silTex);
    silSprite.x = silOff.x;
    silSprite.y = silOff.y;
    // Unrevealed = a dark slate figure with a cream keyline, not a pure-black
    // cut-out (that read as a missing image).
    silSprite.tint = 0x1a2331;
    silSprite.alpha = 0.92;
    const outline = new OutlineFilter({ thickness: 1.6, color: 0xf3e6d4, alpha: 0.75, quality: 1.0 });
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

    if (prog.pieces >= prog.totalPieces) {
      const fullTex = getExtraTexture(`${prog.artPrefix}_full`);
      if (fullTex) {
        const fullSprite = new Sprite(fullTex);
        fullSprite.anchor.set(0.5);
        assembly.addChild(fullSprite);
      }
    }

    // Fit the FIGURE (its alpha box), not the padded canvas, between the crew
    // header and the crew strip.
    const { top, bottom } = this.crewBounds(rect);
    const fig = pieceBounds(silTex);
    const boxW = rect.width - 24;
    const boxH = Math.max(80, bottom - top);
    const scale = Math.min(boxW / fig.w, boxH / fig.h);
    const multiplier = 1.0;
    assembly.scale.set(scale * multiplier);
    assembly.position.set(rect.x + rect.width / 2 - (fig.ox + silOff.x) * scale, top + boxH / 2 - (fig.oy + silOff.y) * scale);
    // Contact shadow: she stands ON the street, not pasted over it.
    const fb = pieceBounds(silTex);
    const k = scale * multiplier;
    const footY = assembly.y + (fb.oy + silOff.y + fb.h / 2) * k;
    const footX = assembly.x + (fb.ox + silOff.x) * k;
    const shadowW = fb.w * k * 0.62;
    const contact = new Graphics();
    for (let i = 5; i >= 1; i--) {
      contact.ellipse(footX, footY - 3, shadowW * (0.5 + i * 0.1), 4 + i * 2.4).fill({ color: 0x07040e, alpha: 0.09 });
    }
    contact.label = "artChar";
    this.underParticlesContainer.addChild(contact);
    assembly.label = "artChar";
    this.underParticlesContainer.addChild(assembly);
  }

  /** Hide the art-panel girl while a full-screen reveal draws its own copy of her. */
  setArtCharVisible(visible: boolean): void {
    for (const c of this.underParticlesContainer.children) if (c.label === "artChar") c.visible = visible;
  }

  private starPoints(cx: number, cy: number, outerR: number, innerR: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? outerR : innerR;
      pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    return pts;
  }

  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    return (rr << 16) | (rg << 8) | rb;
  }
}
