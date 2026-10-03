import { Container, Graphics, Text, TextStyle, Sprite } from "pixi.js";
import { AnnouncementArt, announcementTitleStyle } from "./AnnouncementArt";
import { logicalViewport } from "./layout";
import { UI_FONT, DISPLAY_FONT } from "../typography";
import type { Position } from "../domain";
import type { Rect } from "./types";
import { makeText } from "./text";
import { tween, wait, easeOutBack, easeOutCubic, easeInOutCubic, easeOutElastic, linear, ambientTicker, getTimeScale, simulate } from "./tween";
import { getExtraTexture } from "./assets";
import { raysTexture, softGlowTexture } from "./fxTextures";
import { winCountFormatter } from "./winCount";

export class EffectsLayer extends Container {
  public readonly particles = new Container();
  private readonly coinPool: Graphics[] = [];
  private readonly billPool: Container[] = [];
  private pileHeights: number[] = [];
  private readonly numCols = 15;
  private maxWinActive = false;
  private shouldStack = false;
  private readonly announcements = new Set<{
    content: Container;
    veil: Graphics;
    source: Rect;
    veilOpacity: number;
  }>();

  /** Re-anchor a running title without restarting its motion or count-up. */
  resize(board: Rect, viewport: { width: number; height: number }): void {
    for (const item of this.announcements) {
      const scale = Math.min(board.width / item.source.width, board.height / item.source.height);
      item.content.scale.set(scale);
      item.content.position.set(
        board.x + board.width / 2 - (item.source.x + item.source.width / 2) * scale,
        board.y + board.height / 2 - (item.source.y + item.source.height / 2) * scale,
      );
      item.veil.clear().rect(0, 0, viewport.width, viewport.height)
        .fill({ color: 0x070a12, alpha: item.veilOpacity });
    }
  }

  private trackAnnouncement(content: Container, veil: Graphics, source: Rect, veilOpacity: number): () => void {
    const item = { content, veil, source: { ...source }, veilOpacity };
    this.announcements.add(item);
    return () => { this.announcements.delete(item); };
  }

  private readonly activeParticles: Array<{
    view: Container | Graphics;
    isBill: boolean;
    x0: number;
    y0: number;
    vx: number;
    vy: number;
    spin: number;
    delay: number;
    elapsed: number;
    fullScreen: boolean;
    rect: Rect;
    stacked?: boolean;
    pileOffset?: number;
    targetRotation?: number;
    elapsedAfterStacked?: number;
    driftX?: number;        // accumulated horizontal drift from vx
    flutterPhase?: number;  // per-bill sway phase so the rain is not synchronized
    flutterFreq?: number;   // per-bill sway frequency
    flutterAmp?: number;    // per-bill sway amplitude
  }> = [];

  constructor(private readonly particleLayer: Container) {
    super();
    this.particleLayer.addChild(this.particles);
    this.preWarmPools();
  }

  private preWarmPools(): void {
    // Pre-warm coins pool to 250 for continuous emission support
    for (let i = 0; i < 250; i++) {
      const coin = new Graphics();
      const size = 8;
      coin.circle(0, 0, size).fill(0xffd700);
      coin.circle(0, 0, size * 0.7).fill(0xffec80);
      coin.circle(-size * 0.2, -size * 0.2, size * 0.25).fill({ color: 0xffffff, alpha: 0.6 });
      coin.rect(-1, -size * 0.4, 2, size * 0.8).fill({ color: 0xb8860b, alpha: 0.5 });
      coin.visible = false;
      this.particles.addChild(coin);
      this.coinPool.push(coin);
    }

    // Pre-warm bills pool to 250 for continuous emission support
    const billTex = getExtraTexture("real_bill");
    for (let i = 0; i < 250; i++) {
      const bill = new Container();
      if (billTex) {
        const spr = new Sprite(billTex);
        spr.anchor.set(0.5);
        bill.addChild(spr);
      } else {
        const gfx = new Graphics();
        const w = 30;
        const h = 15;
        gfx.roundRect(-w / 2, -h / 2, w, h, 2).fill(0x2ecc71)
          .stroke({ color: 0xffffff, alpha: 0.4, width: 1 });
        gfx.rect(-1, -h / 2, 2, h).fill({ color: 0xffffff, alpha: 0.2 });
        bill.addChild(gfx);
      }
      bill.visible = false;
      this.particles.addChild(bill);
      this.billPool.push(bill);
    }
  }

  private getObtainedCoin(): Graphics {
    let coin = this.coinPool.pop();
    if (!coin) {
      coin = new Graphics();
      const size = 8;
      coin.circle(0, 0, size).fill(0xffd700);
      coin.circle(0, 0, size * 0.7).fill(0xffec80);
      coin.circle(-size * 0.2, -size * 0.2, size * 0.25).fill({ color: 0xffffff, alpha: 0.6 });
      coin.rect(-1, -size * 0.4, 2, size * 0.8).fill({ color: 0xb8860b, alpha: 0.5 });
      this.particles.addChild(coin);
    }
    coin.visible = true;
    coin.alpha = 1;
    coin.scale.set(1);
    coin.rotation = 0;
    return coin;
  }

  private returnCoin(coin: Graphics): void {
    coin.visible = false;
    this.coinPool.push(coin);
  }

  private getObtainedBill(tex?: any): Container {
    let bill = this.billPool.pop();
    if (!bill) {
      bill = new Container();
      if (tex) {
        const spr = new Sprite(tex);
        spr.anchor.set(0.5);
        bill.addChild(spr);
      } else {
        const gfx = new Graphics();
        const w = 30;
        const h = 15;
        gfx.roundRect(-w / 2, -h / 2, w, h, 2).fill(0x2ecc71)
          .stroke({ color: 0xffffff, alpha: 0.4, width: 1 });
        gfx.rect(-1, -h / 2, 2, h).fill({ color: 0xffffff, alpha: 0.2 });
        bill.addChild(gfx);
      }
      this.particles.addChild(bill);
    }
    bill.visible = true;
    bill.alpha = 1;
    bill.scale.set(1);
    bill.rotation = 0;
    return bill;
  }

  private returnBill(bill: Container): void {
    bill.visible = false;
    this.billPool.push(bill);
  }

  private updateParticles = (dt: number): void => {
    const canvas = document.querySelector("canvas");
    const screenHeight = canvas ? canvas.clientHeight : (window.innerHeight ?? 900);
    const screenWidth = canvas ? canvas.clientWidth : (window.innerWidth ?? 1024);
    const colWidth = screenWidth / this.numCols;

    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.elapsed += dt;

      const t = p.elapsed - p.delay;
      if (t <= 0) {
        p.view.alpha = 0;
        p.view.visible = false;
        continue;
      }

      p.view.visible = true;

      if (p.isBill) {
        if (this.shouldStack) {
          // Stacking logic for Grand and Max wins
          const colIndex = Math.max(0, Math.min(this.numCols - 1, Math.floor(p.view.x / colWidth)));
          const currentPile = this.pileHeights[colIndex] ?? 0;

          const bottomLimit = screenHeight;
          const pileOffset = p.pileOffset ?? 0;
          const landingY = bottomLimit - pileOffset - currentPile;

          if (p.stacked) {
            // Smoothly settle the bill over 300ms using simple easing interpolation
            if (p.elapsedAfterStacked === undefined) {
              p.elapsedAfterStacked = 0;
            }
            p.elapsedAfterStacked += dt;

            if (p.elapsedAfterStacked < 0.3) {
              p.view.x += (p.x0 - p.view.x) * 0.15;
              p.view.y += (p.y0 - p.view.y) * 0.15;
              p.view.rotation += ((p.targetRotation ?? 0) - p.view.rotation) * 0.15;
            } else {
              p.view.position.set(p.x0, p.y0);
              p.view.rotation = p.targetRotation ?? 0;
            }
            p.view.alpha = 1;
          } else {
            const distToLand = landingY - p.view.y;

            if (p.view.y >= landingY || distToLand <= 0) {
              // Landed! Set target values and mark stacked
              p.stacked = true;
              p.y0 = landingY;
              p.x0 = p.view.x;
              p.targetRotation = (Math.random() - 0.5) * 0.45; // slight tilt
              p.elapsedAfterStacked = 0;

              // Add height to pile map and distribute to neighbors for natural mound formation
              const increment = this.maxWinActive ? 5.5 : 3.5;
              this.pileHeights[colIndex] += increment;
              if (colIndex > 0) this.pileHeights[colIndex - 1] += increment * 0.4;
              if (colIndex < this.numCols - 1) this.pileHeights[colIndex + 1] += increment * 0.4;
            } else {
              let currentVy = p.vy;
              let currentVx = p.vx;
              let currentSpin = p.spin;

              if (distToLand < 100) {
                const f = Math.max(0.15, distToLand / 100);
                currentVy *= f;
                currentVx *= f;
                currentSpin *= f;
              }

              p.driftX = (p.driftX ?? 0) + currentVx * dt;
              p.view.y += currentVy * dt;
              // Organic per-bill sway (desynchronized) instead of a uniform wave
              const flutter = Math.sin(p.elapsed * (p.flutterFreq ?? 2) + (p.flutterPhase ?? 0)) * (p.flutterAmp ?? 30);
              p.view.x = p.x0 + (p.driftX ?? 0) + flutter;
              p.view.rotation += currentSpin * dt;

              p.view.alpha = Math.min(1, t * 6.5);
            }
          }
        } else {
          // No stacking (Big & Mega wins fall past the screen and fade out smoothly)
          p.driftX = (p.driftX ?? 0) + p.vx * dt;
          p.view.y += p.vy * dt;
          const flutter = Math.sin(p.elapsed * (p.flutterFreq ?? 2) + (p.flutterPhase ?? 0)) * (p.flutterAmp ?? 30);
          p.view.x = p.x0 + (p.driftX ?? 0) + flutter;
          p.view.rotation += p.spin * dt;

          const fadeIn = Math.min(1, t * 6.5);
          let fadeOut = 1;
          if (p.view.y > screenHeight - 150) {
            fadeOut = Math.max(0, 1 - (p.view.y - (screenHeight - 150)) / 150);
          }
          p.view.alpha = fadeIn * fadeOut;

          if (p.view.y >= screenHeight + 50 || p.view.alpha <= 0) {
            p.view.visible = false;
            this.returnBill(p.view as Container);
            this.activeParticles.splice(i, 1);
          }
        }
      } else {
        // Coins do not stack (standard physics + fade out at bottom)
        p.view.y += p.vy * dt;
        p.view.x += p.vx * dt;
        p.view.rotation += p.spin * dt;

        const fadeIn = Math.min(1, t * 6.5);
        let fadeOut = 1;
        if (p.view.y > screenHeight - 120) {
          fadeOut = Math.max(0, 1 - (p.view.y - (screenHeight - 120)) / 120);
        }

        p.view.alpha = fadeIn * fadeOut;

        if (p.view.y >= screenHeight || p.view.alpha <= 0) {
          p.view.visible = false;
          this.returnCoin(p.view as Graphics);
          this.activeParticles.splice(i, 1);
        }
      }
    }

    if (this.activeParticles.length === 0) {
      ambientTicker.remove(this.updateParticles);
    }
  };

  /* ─────────────────────────────────────────────────
   *  BANNER — the main win/event announcement
   *  Now with cash rain, screen flash, and gold coins
   * ───────────────────────────────────────────────── */
  async banner(message: string, amount: string, rect: Rect, turbo: boolean, intensity: "low" | "mid" | "high" | "grand" = "low"): Promise<void> {
    const group = new Container();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    const viewport = logicalViewport(window.innerWidth, window.innerHeight);
    const veil = new Graphics().rect(0, 0, viewport.width, viewport.height)
      .fill({ color: 0x070a12, alpha: amount ? .62 : .5 });
    veil.alpha = 0;
    this.addChild(veil);
    const tier = { low: 0, mid: 1, high: 2, grand: 3 }[intensity];
    const width = Math.min(rect.width * .98, 850);
    const titleLines: Record<string, string> = {
      "BUST THE STASH": "BUST THE\nSTASH", "GETAWAY DRIVER": "GETAWAY\nDRIVER",
      "PRESTIGE RANK UP!": "PRESTIGE\nRANK UP!", "GALLERY MASTERED": "GALLERY\nMASTERED",
      "REWARD UNLOCKED": "REWARD\nUNLOCKED",
    };
    const titleText = titleLines[message.toUpperCase()] ?? message.toUpperCase();
    const multiline = titleText.includes("\n");
    const height = multiline ? (amount ? 256 : Math.min(260, Math.max(190, width*.44))) : amount ? 174 : 120;
    group.position.set(cx, cy);
    const art = new AnnouncementArt(width, height, tier);
    group.addChild(art);
    const featureSize = Math.min(amount ? 76 : 96, width*.16);
    const titleStyle = announcementTitleStyle(multiline ? featureSize : amount ? 50 + tier * 6 : 56, tier);
    if (multiline) titleStyle.lineHeight = featureSize;
    const title = new Text({ text: titleText, style: titleStyle });
    title.skew.x = -.08;
    title.anchor.set(.5);
    title.y = amount ? -height * (multiline ? .18 : .22) : 0;
    title.scale.set(Math.min(1, width * .84 / Math.max(1, title.width)));
    group.addChild(title);
    if (amount) {
      const value = new Text({ text: amount, style: new TextStyle({
        fontFamily: DISPLAY_FONT, fontWeight: "400", fontSize: 48 + tier * 5,
        fill: 0xffdf98, stroke: { color: 0x292137, width: 4 },
        dropShadow: { color: 0x130f26, alpha: .8, distance: 3, blur: 2 },
      }) });
      value.anchor.set(.5);
      value.y = height * (multiline ? .29 : .16);
      value.scale.set(Math.min(1, width * .65 / Math.max(1, value.width)));
      group.addChild(value);
    }
    const content = new Container();
    content.addChild(group);
    this.addChild(content);
    const untrack = this.trackAnnouncement(content, veil, rect, amount ? .62 : .5);
    group.alpha = 0;
    await tween(turbo ? 45 : 110, p => {
      veil.alpha = p;
      group.alpha = p * .7;
      group.x = cx - (1-p) * width * .12;
      group.scale.set(.82 - .025 * p);
      art.pose(p * .5);
    }, easeOutCubic);
    this.emit("banner_impact", intensity);
    art.impact(0);
    await tween(turbo ? 95 : 240, p => {
      group.alpha = 1;
      group.x = cx;
      group.scale.set(1.10 - .10 * p);
      art.pose(p);
      art.impact(p);
    }, easeOutCubic);
    await wait(turbo ? 450 * Math.max(1, getTimeScale()) : [580, 780, 980, 1250][tier]);
    await tween(turbo ? 100 : 240, p => {
      veil.alpha = 1-p;
      group.alpha = 1-p;
      group.x = cx + p * width * .07;
      group.y = cy - p * 9;
    }, easeInOutCubic);
    untrack();
    veil.destroy();
    content.destroy({ children: true });
  }

  /* ─────────────────────────────────────────────────
   *  SPAWN SINGLE BILL — spawns one bill for continuous rain
   * ───────────────────────────────────────────────── */
  spawnSingleBill(rect: Rect, fullScreen: boolean): void {
    const activeBillsCount = this.activeParticles.filter(p => p.isBill).length;
    // Cap at 300 active bills to avoid performance issues
    if (activeBillsCount >= 300) return;

    const billTex = getExtraTexture("real_bill");
    const width = window.innerWidth || 1024;
    const startX = 0;
    const startY = 0;

    const startActive = this.activeParticles.length === 0;

    const bill = this.getObtainedBill(billTex);
    // Increase size slightly to fill space better
    const targetWidth = 75 + Math.random() * 40;
    const baseW = billTex ? billTex.width : 30;
    bill.scale.set(targetWidth / baseW);

    const x0 = startX - 50 + Math.random() * (width + 100);
    const y0 = startY - 100 - Math.random() * 120;
    bill.position.set(x0, y0);
    bill.visible = false;
    bill.alpha = 0;

    this.activeParticles.push({
      view: bill,
      isBill: true,
      x0,
      y0,
      vx: (Math.random() - 0.5) * 36,
      vy: 220 + Math.random() * 150, // slower, smoother fall speed
      spin: (Math.random() - 0.5) * 1.5, // slower rotation
      delay: Math.random() * 0.05, // very short delay for continuous flow
      elapsed: 0,
      fullScreen: true,
      rect,
      stacked: false,
      pileOffset: -12 + Math.random() * 24,
      driftX: 0,
      // Each bill flutters on its own phase/freq/amplitude so the rain reads as
      // independent falling cash, never a synchronized wave.
      flutterPhase: Math.random() * Math.PI * 2,
      flutterFreq: 1.4 + Math.random() * 1.8,
      flutterAmp: 16 + Math.random() * 32
    });

    if (startActive && this.activeParticles.length > 0) {
      ambientTicker.add(this.updateParticles);
    }
  }

  /* ─────────────────────────────────────────────────
   *  GOLD COIN BURST — coins explode from center
   * ───────────────────────────────────────────────── */
  async goldCoinBurst(cx: number, cy: number, rect: Rect, turbo: boolean): Promise<void> {
    if (turbo) return;
    const coinCount = 24;
    const coins: Graphics[] = [];
    const coinData: Array<{ angle: number; speed: number; spin: number; size: number }> = [];

    for (let i = 0; i < coinCount; i++) {
      const coin = this.getObtainedCoin();
      const size = 5 + Math.random() * 7;
      coin.scale.set(size / 8);

      coin.position.set(cx, cy);
      coin.alpha = 0;
      coins.push(coin);
      coinData.push({
        angle: (Math.PI * 2 * i) / coinCount + (Math.random() - 0.5) * 0.4,
        speed: 150 + Math.random() * 250,
        spin: (Math.random() - 0.5) * 10,
        size
      });
    }

    await tween(800, (p) => {
      coins.forEach((coin, i) => {
        const d = coinData[i];
        const fadeIn = Math.min(1, p * 5);
        const fadeOut = p > 0.5 ? 1 - (p - 0.5) / 0.5 : 1;
        coin.alpha = fadeIn * fadeOut;
        const dist = d.speed * p;
        coin.x = cx + Math.cos(d.angle) * dist;
        coin.y = cy + Math.sin(d.angle) * dist + 100 * p * p; // gravity
        coin.rotation = d.spin * 0.6 * p;
        coin.scale.set((d.size / 8) * (1 - p * 0.4));
      });
    }, easeOutCubic);
    coins.forEach((c) => this.returnCoin(c));
  }

  /* ─────────────────────────────────────────────────
   *  SCREEN SHAKE — quick rumble effect
   * ───────────────────────────────────────────────── */
  async screenShake(target: Container, turbo: boolean): Promise<void> {
    if (turbo) return;
    const origX = target.x;
    const origY = target.y;
    const intensity = 20; // Massive thud displacement
    const duration = 450;  // Longer duration for smooth springy decay
    await tween(duration, (p) => {
      const decay = Math.exp(-p * 4.5); // Organic physical decay curve
      const dx = Math.sin(p * Math.PI * 5) * intensity * decay;
      const dy = Math.cos(p * Math.PI * 4) * intensity * decay * 0.8;
      target.x = origX + dx;
      target.y = origY + dy;
    }, linear);
    target.x = origX;
    target.y = origY;
  }

  /* ─────────────────────────────────────────────────
   *  CASH SPRAY — bills burst from win positions
   * ───────────────────────────────────────────────── */
  async cashSpray(rect: Rect, positions: Position[], turbo: boolean): Promise<void> {
    if (turbo) return;
    const count = Math.min(positions.length * 8, 60);
    const bills: Container[] = [];
    const velocities: Array<{ vx: number; vy: number; spin: number }> = [];
    const billTex = getExtraTexture("real_bill");

    for (let i = 0; i < count; i += 1) {
      const bill = this.getObtainedBill(billTex);
      const targetWidth = 35 + Math.random() * 15;
      const baseW = billTex ? billTex.width : 30;
      bill.scale.set(targetWidth / baseW);

      bill.position.set(
        rect.x + rect.width * (0.15 + Math.random() * 0.7),
        rect.y + rect.height * (0.25 + Math.random() * 0.5)
      );
      bill.rotation = Math.random() * Math.PI;
      bill.alpha = 0;
      bills.push(bill);
      velocities.push({
        vx: (Math.random() - 0.5) * 220,
        vy: -(80 + Math.random() * 180),
        spin: (Math.random() - 0.5) * 10
      });
    }

    // Gold coins mixed in
    const coinCount = Math.min(positions.length * 3, 20);
    for (let i = 0; i < coinCount; i++) {
      const coin = this.getObtainedCoin();
      const size = 4 + Math.random() * 5;
      coin.scale.set(size / 8);
      coin.position.set(
        rect.x + rect.width * (0.2 + Math.random() * 0.6),
        rect.y + rect.height * (0.3 + Math.random() * 0.4)
      );
      coin.alpha = 0;
      bills.push(coin);
      velocities.push({
        vx: (Math.random() - 0.5) * 200,
        vy: -(100 + Math.random() * 160),
        spin: (Math.random() - 0.5) * 12
      });
    }

    await simulate(800, (k, progress) => {
      bills.forEach((bill, index) => {
        const v = velocities[index];
        const fadeIn = Math.min(1, progress * 5);
        const fadeOut = progress > 0.55 ? 1 - (progress - 0.55) / 0.45 : 1;
        bill.alpha = fadeIn * fadeOut;
        bill.x += v.vx * 0.014 * k;
        bill.y += v.vy * 0.014 * k;
        v.vy += 280 * 0.014 * k; // gravity
        bill.rotation += v.spin * 0.014 * k;
        bill.scale.set(1 - progress * 0.3);
      });
    });
    bills.forEach((bill) => {
      if (bill instanceof Graphics) {
        this.returnCoin(bill);
      } else {
        this.returnBill(bill);
      }
    });
  }

  /* ─────────────────────────────────────────────────
   *  SIREN SWEEP — red/blue police strobe
   * ───────────────────────────────────────────────── */
  async sirenSweep(rect: Rect, turbo: boolean): Promise<void> {
    if (turbo) return;
    const sweep = new Graphics();

    await tween(400, (progress) => {
      sweep.clear();
      const redAlpha = 0.22 * Math.sin(progress * Math.PI * 3);
      const blueAlpha = 0.22 * Math.sin(progress * Math.PI * 3 + Math.PI);
      sweep.rect(rect.x, rect.y, rect.width / 2, rect.height).fill({ color: 0xffb000, alpha: Math.max(0, redAlpha) });
      sweep.rect(rect.x + rect.width / 2, rect.y, rect.width / 2, rect.height).fill({ color: 0x7cf595, alpha: Math.max(0, blueAlpha) });
      sweep.alpha = 1 - progress * 0.3;
    }, linear);

    this.addChild(sweep);
    await tween(200, (progress) => {
      sweep.alpha = (1 - progress) * 0.7;
    });
    sweep.destroy();
  }

  /* ─────────────────────────────────────────────────
   *  WIN PARTICLES — colored dots burst from cells
   * ───────────────────────────────────────────────── */
  async winParticles(rect: Rect, positions: Position[], cellWidth: number, cellHeight: number, gap: number): Promise<void> {
    const dots: Graphics[] = [];
    for (const [col, row] of positions) {
      const cx = rect.x + gap + col * (cellWidth + gap) + cellWidth / 2;
      const cy = rect.y + gap + row * (cellHeight + gap) + cellHeight / 2;
      for (let i = 0; i < 8; i++) {
        const dot = new Graphics();
        const size = 2 + Math.random() * 4;
        const color = [0xffdf65, 0xffb000, 0x62ffa7, 0x9ae64e, 0xffd700][i % 5];
        dot.circle(0, 0, size).fill(color);
        dot.position.set(cx, cy);
        dot.alpha = 0;
        dots.push(dot);
        this.particles.addChild(dot);
      }
    }

    const velocities = dots.map(() => ({
      vx: (Math.random() - 0.5) * 160,
      vy: -(60 + Math.random() * 100),
    }));

    await simulate(600, (k, progress) => {
      dots.forEach((dot, i) => {
        const v = velocities[i];
        const fadeIn = Math.min(1, progress * 6);
        const fadeOut = progress > 0.5 ? 1 - (progress - 0.5) / 0.5 : 1;
        dot.alpha = fadeIn * fadeOut * 0.9;
        dot.x += v.vx * 0.014 * k;
        dot.y += v.vy * 0.014 * k;
        v.vy += 200 * 0.014 * k;
      });
    });
    dots.forEach((d) => d.destroy());
  }

  /* ─────────────────────────────────────────────────
   *  KEY BEAM — laser lines from key to safes
   * ───────────────────────────────────────────────── */
  async keyBeam(from: { x: number; y: number }, targets: Array<{ x: number; y: number }>, turbo: boolean, color: number = 0x9ae64e): Promise<void> {
    const beams = new Graphics();
    this.addChild(beams);

    const glowBeams = new Graphics();
    this.addChild(glowBeams);

    await tween(turbo ? 120 : 360, (progress) => {
      beams.clear();
      glowBeams.clear();
      for (const target of targets) {
        const ex = from.x + (target.x - from.x) * progress;
        const ey = from.y + (target.y - from.y) * progress;
        glowBeams.moveTo(from.x, from.y).lineTo(ex, ey);
        beams.moveTo(from.x, from.y).lineTo(ex, ey);
      }
      glowBeams.stroke({ color: color, width: 12, alpha: 0.25 });
      beams.stroke({ color: color, width: 3, alpha: 0.95 });
    });

    await tween(150, (progress) => {
      beams.alpha = 1 - progress;
      glowBeams.alpha = 1 - progress;
    });

    beams.destroy();
    glowBeams.destroy();
  }

  /* ─────────────────────────────────────────────────
   *  CLUSTER LINK — glowing trails connecting
   *  matching symbols so you SEE the cluster
   * ───────────────────────────────────────────────── */
  async clusterLink(centers: Array<{ x: number; y: number }>, color: number, turbo: boolean, given?: Array<[number, number]>): Promise<void> {
    if (centers.length < 2) return;

    const group = new Container();
    const glow = new Graphics();
    const line = new Graphics();
    glow.blendMode = "add";
    line.blendMode = "add";
    const sparks: Graphics[] = [];
    group.addChild(glow, line);
    this.addChild(group);

    // Adjacency pairs: the caller's grid-true neighbours when given, else a
    // pixel-distance guess.
    const pairs: Array<[number, number]> = given ? [...given] : [];
    if (!given) for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const dx = Math.abs(centers[i].x - centers[j].x);
        const dy = Math.abs(centers[i].y - centers[j].y);
        // Only connect adjacent cells (roughly 1 cell apart)
        if (dx < 200 && dy < 200 && (dx + dy) < 300) {
          pairs.push([i, j]);
        }
      }
    }
    if (pairs.length === 0) {
      // Fallback: connect all to center
      for (let i = 1; i < centers.length; i++) pairs.push([0, i]);
    }

    // Traveling sparks along the lines
    const sparkCount = Math.min(pairs.length * 3, 18);
    for (let i = 0; i < sparkCount; i++) {
      const spark = new Graphics();
      const s = 2 + Math.random() * 3;
      spark.circle(0, 0, s).fill(0xffffff);
      spark.circle(0, 0, s * 1.8).fill({ color, alpha: 0.3 });
      spark.alpha = 0;
      group.addChild(spark);
      sparks.push(spark);
    }

    // Phase 1: Lines draw in
    await tween(turbo ? 80 : 200, (p) => {
      glow.clear();
      line.clear();
      for (const [a, b] of pairs) {
        const ax = centers[a].x, ay = centers[a].y;
        const bx = ax + (centers[b].x - ax) * p;
        const by = ay + (centers[b].y - ay) * p;
        glow.moveTo(ax, ay).lineTo(bx, by);
        line.moveTo(ax, ay).lineTo(bx, by);
      }
      glow.stroke({ color, width: 12, alpha: 0.35 * p });
      line.stroke({ color: 0xffffff, width: 2.5, alpha: 0.8 * p });
    }, easeOutCubic);

    // Phase 2: Lines pulse + sparks travel along them
    await tween(turbo ? 120 : 400, (p) => {
      const pulseAlpha = 0.6 + Math.sin(p * Math.PI * 3) * 0.3;
      glow.alpha = pulseAlpha;
      line.alpha = 0.5 + Math.sin(p * Math.PI * 3) * 0.4;

      // Move sparks along random pairs
      sparks.forEach((spark, i) => {
        const pair = pairs[i % pairs.length];
        const t = (p * 2 + i * 0.15) % 1;
        const ax = centers[pair[0]].x, ay = centers[pair[0]].y;
        const bx = centers[pair[1]].x, by = centers[pair[1]].y;
        spark.x = ax + (bx - ax) * t;
        spark.y = ay + (by - ay) * t;
        spark.alpha = Math.sin(t * Math.PI) * 0.9;
        spark.scale.set(0.6 + Math.sin(t * Math.PI) * 0.4);
      });
    }, linear);

    // Phase 3: Fade out
    await tween(turbo ? 60 : 150, (p) => {
      group.alpha = 1 - p;
    });

    group.destroy({ children: true });
  }

  /**
   * A cluster's payout popping up on the cluster: punches in with an
   * overshoot over a soft accent bloom, hangs to be read, drifts up and fades.
   */
  async floatValue(x: number, y: number, text: string, color: number, rect: Rect, turbo: boolean): Promise<void> {
    const size = Math.max(22, Math.min(44, rect.height * 0.085));
    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: DISPLAY_FONT, fontSize: size, fill: 0xfff1c2, letterSpacing: 1,
        stroke: { color: 0x2a1a08, width: 5, join: "round" },
        dropShadow: { color: 0x000000, alpha: 0.75, blur: 0, distance: 3, angle: Math.PI / 2 },
        padding: 6,
      }),
    });
    label.anchor.set(0.5);
    const bloom = new Sprite(softGlowTexture());
    bloom.anchor.set(0.5);
    bloom.blendMode = "add";
    bloom.tint = color;
    bloom.width = label.width * 1.6;
    bloom.height = label.height * 1.9;
    const group = new Container();
    group.addChild(bloom, label);
    const cx = Math.max(rect.x + label.width / 2 + 6, Math.min(rect.x + rect.width - label.width / 2 - 6, x));
    group.position.set(cx, y);
    group.scale.set(0.35);
    group.alpha = 0;
    this.addChild(group);
    const bw = bloom.scale.x;
    const bh = bloom.scale.y;
    const rise = Math.min(46, rect.height * 0.09);
    await tween(turbo ? 520 : 1250, (p) => {
      const pop = Math.min(1, p / 0.2);
      group.scale.set(0.35 + 0.65 * easeOutBack(pop));
      group.alpha = p < 0.08 ? p / 0.08 : p > 0.72 ? (1 - p) / 0.28 : 1;
      group.y = y - rise * easeOutCubic(Math.max(0, (p - 0.15) / 0.85));
      bloom.alpha = 0.65 * (1 - p);
      bloom.scale.set(bw * (1 + 0.25 * p), bh * (1 + 0.25 * p));
    }, linear);
    group.destroy({ children: true });
  }

  async cinematicWin(
    targetMultiplier: number,
    betAmount: number,
    rect: Rect,
    turbo: boolean,
    currency: string,
    onUpdate: (amount: number) => void,
    /** Autoplay/replay: the max-win hold must dismiss itself — no tap is coming. */
    autoDismiss = false
  ): Promise<void> {
    const group = new Container();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    // Tap/Click skip area covering the whole board
    const interactionBlock = new Graphics();
    const viewport = logicalViewport(window.innerWidth, window.innerHeight);
    interactionBlock.rect(0, 0, viewport.width, viewport.height)
      .fill({ color: 0x030711, alpha: .68 });
    interactionBlock.alpha = 0;
    interactionBlock.eventMode = "static";
    interactionBlock.cursor = "pointer";
    group.addChild(interactionBlock);
    const content = new Container();
    group.addChild(content);
    const untrack = this.trackAnnouncement(content, interactionBlock, rect, .68);

    let slammed = false;
    let doubleClicked = false;
    let counterStopped = false;
    const stopCounter = () => {
      if (counterStopped) return;
      counterStopped = true;
      this.emit("win_counter_end");
    };
    const onTap = () => {
      if (slammed) {
        doubleClicked = true;
      } else {
        slammed = true;
        stopCounter();
      }
    };
    interactionBlock.on("pointerdown", onTap);

    // Keyboard listener for Space/Enter skip
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (slammed) {
          doubleClicked = true;
        } else {
          slammed = true;
          stopCounter();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);

    const stripW = Math.min(rect.width * .98, 900);
    const stripH = Math.min(190, Math.max(128, rect.height * .36));

    // Sunburst behind everything: slowly turning light rays that brighten and
    // warm with every tier — the escalation reads from across the room.
    const rays = new Sprite(raysTexture());
    rays.anchor.set(0.5);
    rays.blendMode = "add";
    rays.position.set(cx, cy);
    const raysBase = (Math.max(stripW * 1.25, rect.height * 1.6)) / 512;
    rays.scale.set(raysBase * 0.6);
    rays.alpha = 0;
    content.addChild(rays);

    const announcement = new AnnouncementArt(stripW, stripH, 1);
    announcement.position.set(cx, cy);
    content.addChild(announcement);

    // Title glow: an additive bloom that flares on every tier slam (replaces the
    // full-screen bloom/RGB-split pulses, which washed the title out to white).
    const titleBurst = new Sprite(softGlowTexture());
    titleBurst.anchor.set(0.5);
    titleBurst.blendMode = "add";
    titleBurst.position.set(cx, cy - stripH * .27);
    titleBurst.alpha = 0;
    content.addChild(titleBurst);

    // --- Title text --- (a 20x+ win opens as a BIG WIN — never "NICE WIN 0.00")
    const msgText = new Text({ text: "BIG WIN", style: announcementTitleStyle(82, 1) });
    msgText.skew.x = -.08;
    msgText.anchor.set(0.5, 0.5);
    const fitTitle = (): number => {
      msgText.scale.set(1);
      return Math.min(1, stripW * .76 / Math.max(1, msgText.width));
    };
    let titleFit = fitTitle();
    msgText.scale.set(titleFit);
    msgText.position.set(cx, cy - stripH * .27);
    content.addChild(msgText);

    // Keep precision stable throughout the roll, including fractional wagers.
    const finalAmount = targetMultiplier * betAmount;
    const formatCount = winCountFormatter(finalAmount);
    // --- Win amount text --- (hard shadow, no blur: it re-rasterises as it
    // counts, and a 12px canvas blur on every digit change was a frame-time hog)
    const amtText = new Text({
      text: formatCount(0) + " " + currency,
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: DISPLAY_FONT,
        fontSize: 68,
        stroke: { color: 0x292239, width: 6, join: "round" },
        fontWeight: "400",
        letterSpacing: 1,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 0, distance: 4, angle: Math.PI / 2 },
        padding: 8,
      })
    });
    amtText.anchor.set(0.5, 0.5);
    amtText.position.set(cx, cy + stripH * .19);
    content.addChild(amtText);

    this.addChild(group);

    await tween(turbo ? 70 : 200, p => {
      interactionBlock.alpha = p;
      msgText.alpha = p;
      amtText.alpha = p;
      rays.alpha = p * 0.3;
      rays.scale.set(raysBase * (0.6 + 0.4 * p));
      announcement.alpha = .35 + p * .65;
      announcement.scale.set(.94 + p * .06);
      announcement.pose(p);
    }, easeOutCubic);
    this.emit("banner_impact", targetMultiplier >= 500 ? "grand" : "mid");
    void tween(turbo ? 120 : 320, p => announcement.impact(p), easeOutCubic);

    // Pacing (max 6 seconds in normal mode).
    const duration = turbo ? 800 : Math.min(6000, 1500 + targetMultiplier * 10);
    let lastTier: "none" | "big" | "mega" | "grand" | "max" = "none";
    let billSpawnTimer = 0;
    let coinSpawnTimer = 0;
    let isDone = false;

    this.pileHeights = new Array(this.numCols).fill(0);
    this.maxWinActive = targetMultiplier >= 5000;
    this.shouldStack = targetMultiplier >= 500; // Grand/Max wins stack, Big/Mega do not
    this.particles.alpha = 1;

    const targetTier = targetMultiplier >= 5000 ? "max" : targetMultiplier >= 500 ? "grand" : targetMultiplier >= 100 ? "mega" : targetMultiplier >= 20 ? "big" : "none";
    const tierTint = { none: 0xffd48a, big: 0xffd48a, mega: 0xffb35c, grand: 0xff8fc8, max: 0x8ff6ff };
    const tierRays = { none: .3, big: .32, mega: .42, grand: .52, max: .62 };

    // Continuous money rain + the turning rays, both until the hold ends.
    let raysSpin = 0.22;
    const spawner = (dt: number) => {
      rays.rotation += dt * raysSpin;
      if (isDone || turbo) return;
      if (targetTier !== "none") {
        const isGrandRain = targetTier === "grand" || targetTier === "max";
        const billInterval = targetTier === "max" ? 45 : targetTier === "grand" ? 65 : targetTier === "mega" ? 90 : 130;
        const coinInterval = targetTier === "max" ? 650 : targetTier === "grand" ? 850 : targetTier === "mega" ? 1100 : 1500;
        billSpawnTimer += dt * 1000;
        coinSpawnTimer += dt * 1000;
        if (billSpawnTimer >= billInterval) {
          billSpawnTimer = 0;
          this.spawnSingleBill(rect, isGrandRain);
        }
        if (coinSpawnTimer >= coinInterval) {
          coinSpawnTimer = 0;
          void this.goldCoinBurst(cx, cy, rect, false);
        }
      }
    };
    ambientTicker.add(spawner);

    // Tier promotion: the title SLAMS in (big → settle), the light flares, the
    // rays brighten and spin up, coins burst and the screen thumps.
    const promote = (tier: "big" | "mega" | "grand" | "max"): void => {
      const artTier = { big: 1, mega: 2, grand: 3, max: 4 }[tier];
      msgText.text = { big: "BIG WIN", mega: "MEGA WIN", grand: "GRAND WIN", max: "MAX WIN" }[tier];
      msgText.style = announcementTitleStyle(82 + artTier * 8, artTier);
      titleFit = fitTitle();
      announcement.setTier(artTier);
      rays.tint = tierTint[tier];
      raysSpin = 0.22 + artTier * 0.07;
      void tween(turbo ? 120 : 300, p => announcement.impact(p), easeOutCubic);
      const r0 = rays.alpha;
      void tween(turbo ? 160 : 420, (p) => {
        rays.alpha = r0 + (tierRays[tier] - r0) * p + Math.sin(p * Math.PI) * 0.25;
      }, easeOutCubic);
      titleBurst.tint = tierTint[tier];
      titleBurst.width = stripW * 0.9;
      titleBurst.height = stripH * 1.1;
      const bw = titleBurst.scale.x;
      const bh = titleBurst.scale.y;
      void tween(turbo ? 200 : 520, (p) => {
        if (titleBurst.destroyed) return;
        titleBurst.alpha = 0.85 * (1 - p) * (1 - p);
        titleBurst.scale.set(bw * (0.7 + 0.6 * p), bh * (0.7 + 0.5 * p));
      }, easeOutCubic);
      void tween(turbo ? 160 : 380, (pt) => {
        if (!msgText.destroyed) msgText.scale.set(titleFit * (1 + 0.5 * (1 - easeOutBack(pt))));
      }, linear).then(() => { if (!msgText.destroyed) msgText.scale.set(titleFit); });
      if (!turbo) {
        void this.screenShake(this.parent as Container, turbo);
        void this.goldCoinBurst(cx, cy, rect, turbo);
      }
    };

    // Count curve, split by tier: each tier gets its own stretch of the roll,
    // fast out of the gate and easing into the next threshold, so promotions
    // are evenly spaced instead of all firing in the last second (the old
    // t^2.5 curve also sat near 0.00 for the first half).
    const bounds = [0, ...[100, 500, 5000].filter((b) => b < targetMultiplier), targetMultiplier];
    const segW: number[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const lo = Math.max(1, bounds[i]!), hi = bounds[i + 1]!;
      const nextTier = [100, 500, 5000, Infinity].find((b) => b > lo) ?? Infinity;
      const isLast = i === bounds.length - 2;
      segW.push(isLast && Number.isFinite(nextTier) && hi < nextTier
        ? Math.max(0.45, Math.log(hi / lo) / Math.log(nextTier / lo))
        : 1);
    }
    const totalW = segW.reduce((a, b) => a + b, 0);
    const valueAt = (t: number): number => {
      let acc = 0;
      for (let i = 0; i < segW.length; i++) {
        const w = segW[i]! / totalW;
        if (t <= acc + w || i === segW.length - 1) {
          const u = Math.min(1, Math.max(0, (t - acc) / w));
          const lo = bounds[i]!, hi = bounds[i + 1]!;
          const isLast = i === segW.length - 1;
          return lo + (hi - lo) * (isLast ? easeOutCubic(u) : 1 - (1 - u) * (1 - u));
        }
        acc += w;
      }
      return targetMultiplier;
    };

    if (!turbo) this.emit("win_counter_start");
    const startTime = performance.now();
    let lastHud = 0;
    let lastShown = "";

    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const elapsed = now - startTime;
        let t = Math.min(1, elapsed / duration);
        if (slammed) t = 1;
        const currentMult = t >= 1 ? targetMultiplier : valueAt(t);
        const currentAmount = currentMult * betAmount;
        const p = currentMult / targetMultiplier;

        const shown = formatCount(currentAmount) + " " + currency;
        if (shown !== lastShown) {
          lastShown = shown;
          amtText.text = shown;
          amtText.scale.set(1);
          amtText.scale.set(Math.min(1, stripW * .65 / Math.max(1, amtText.width)));
        }
        // The bar's WIN readout follows at ~15 fps — it is small, and every
        // update re-rasterises its text too.
        if (now - lastHud > 66 || t >= 1) {
          lastHud = now;
          onUpdate(Number(formatCount(currentAmount)));
        }

        let activeTier: "none" | "big" | "mega" | "grand" | "max" = "big";
        if (currentMult >= 5000) activeTier = "max";
        else if (currentMult >= 500) activeTier = "grand";
        else if (currentMult >= 100) activeTier = "mega";

        if (activeTier !== lastTier) {
          // A skip can jump straight to the final tier: promote once, to it.
          lastTier = activeTier;
          this.emit("win_tier_changed", activeTier);
          promote(activeTier as "big" | "mega" | "grand" | "max");
        }

        this.emit("win_counter_progress", p, activeTier);

        if (t < 1 && !slammed) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    // Final confirmations
    amtText.text = formatCount(finalAmount) + " " + currency;
    amtText.scale.set(1);
    amtText.scale.set(Math.min(1, stripW * .65 / Math.max(1, amtText.width)));
    onUpdate(finalAmount);
    // Land the total with a punch.
    if (!turbo) {
      const s0 = amtText.scale.x;
      void tween(320, (p) => { if (!amtText.destroyed) amtText.scale.set(s0 * (1 + 0.14 * Math.sin(p * Math.PI) * (1 - p * 0.4))); }, linear)
        .then(() => { if (!amtText.destroyed) amtText.scale.set(s0); });
    }

    stopCounter();
    this.emit("win_climax", lastTier);

    // Stop spawning new money immediately when the money counter stops!
    isDone = true;

    // While the result is on screen it keeps breathing — rays keep turning
    // (spawner stays on the ticker for that), the title pulses, the light
    // swells. A dead-still frame read as frozen.
    let idleT = 0;
    const idle = (dt: number) => {
      idleT += dt;
      if (msgText.destroyed) return;
      const b = Math.sin(idleT * 3.2);
      msgText.scale.set(titleFit * (1 + 0.03 * b));
      titleBurst.alpha = 0.12 + 0.08 * (0.5 + 0.5 * b);
    };
    ambientTicker.add(idle);

    const isMaxWin = this.maxWinActive;
    try {
      if (isMaxWin) {
        // For max win, we wait for a second tap/click or keyboard press to dismiss
        let dismissed = doubleClicked;
        interactionBlock.off("pointerdown", onTap);
        const onDismissTap = () => { dismissed = true; };
        interactionBlock.on("pointerdown", onDismissTap);
        window.removeEventListener("keydown", onKeyDown);
        const onDismissKeyDown = (e: KeyboardEvent) => {
          if (e.code === "Space" || e.code === "Enter") {
            e.preventDefault();
            dismissed = true;
          }
        };
        window.addEventListener("keydown", onDismissKeyDown);
        // Unattended runs (autoplay/replay) get a generous read-time then
        // continue on their own — the sequence must never freeze.
        const holdStart = performance.now();
        const autoDismissMs = turbo ? 2000 : 4000;
        let nextBurst = performance.now() + 900;
        while (!dismissed) {
          await wait(50);
          if (!turbo && performance.now() > nextBurst) {
            nextBurst = performance.now() + 1100;
            void this.goldCoinBurst(cx, cy, rect, false);
          }
          if (autoDismiss && performance.now() - holdStart > autoDismissMs) break;
        }
        interactionBlock.off("pointerdown", onDismissTap);
        window.removeEventListener("keydown", onDismissKeyDown);
      } else {
        // Normal win hold - wait for hold duration or 2nd click to dismiss immediately
        const holdStart = performance.now();
        const holdMax = slammed ? 750 : turbo ? 550 : 1200;
        while (!doubleClicked && performance.now() - holdStart < holdMax) {
          await wait(30);
        }
        window.removeEventListener("keydown", onKeyDown);
        interactionBlock.off("pointerdown", onTap);
      }

      // Fade out banner and piled particles together
      await tween(turbo ? 300 : 520, (p) => {
        group.alpha = 1 - p;
        this.particles.alpha = 1 - p;
      });
    } finally {
      ambientTicker.remove(idle);
      ambientTicker.remove(spawner);
    }

    // Reset particles alpha and return all active/stacked particles to pools
    this.particles.alpha = 1;
    this.activeParticles.forEach(p => {
      if (p.isBill) this.returnBill(p.view as Container);
      else this.returnCoin(p.view as Graphics);
    });
    this.activeParticles.length = 0;

    untrack();
    group.destroy({ children: true });
  }
}
