import { Container, Graphics, Text, TextStyle, Sprite } from "pixi.js";
import type { Position } from "../domain";
import type { Rect } from "./types";
import { makeText } from "./text";
import { tween, wait, easeOutBack, easeOutCubic, easeInOutCubic, easeOutElastic, linear, ambientTicker } from "./tween";
import { pulseBloom, pulseChromaticAberration } from "../vfx/Shaders";
import { getExtraTexture } from "./assets";

export class EffectsLayer extends Container {
  public readonly particles = new Container();
  private readonly coinPool: Graphics[] = [];
  private readonly billPool: Container[] = [];
  private pileHeights: number[] = [];
  private readonly numCols = 15;
  private maxWinActive = false;
  private shouldStack = false;

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
    const big = intensity === "mid" || intensity === "high" || intensity === "grand";

    // Tier-scaled config
    const cfg = {
      low:   { titleSize: 22, amtSize: 40, flashAlpha: 0,    holdMs: 250,  rays: false, coins: 0 },
      mid:   { titleSize: 28, amtSize: 52, flashAlpha: 0.30, holdMs: 450,  rays: true,  coins: 24 },
      high:  { titleSize: 34, amtSize: 60, flashAlpha: 0.40, holdMs: 700,  rays: true,  coins: 40 },
      grand: { titleSize: 42, amtSize: 72, flashAlpha: 0.50, holdMs: 1100, rays: true,  coins: 60 },
    }[intensity];

    // --- Screen flash ---
    if (cfg.flashAlpha > 0 && !turbo) {
      const flash = new Graphics();
      flash.rect(rect.x - 50, rect.y - 50, rect.width + 100, rect.height + 100)
        .fill({ color: intensity === "grand" ? 0xff88ff : 0xffdf65, alpha: cfg.flashAlpha });
      group.addChild(flash);
      tween(300, (p) => { flash.alpha = (1 - p) * cfg.flashAlpha; });
    }

    // --- Radial light rays behind text ---
    if (cfg.rays && !turbo) {
      const rays = new Graphics();
      const rayCount = intensity === "grand" ? 18 : 12;
      for (let i = 0; i < rayCount; i++) {
        const angle = (Math.PI * 2 * i) / rayCount;
        const inner = 30;
        const outer = rect.width * (intensity === "grand" ? 0.65 : 0.5);
        const spread = 0.08;
        rays.moveTo(cx + Math.cos(angle - spread) * inner, cy + Math.sin(angle - spread) * inner);
        rays.lineTo(cx + Math.cos(angle - spread) * outer, cy + Math.sin(angle - spread) * outer);
        rays.lineTo(cx + Math.cos(angle + spread) * outer, cy + Math.sin(angle + spread) * outer);
        rays.lineTo(cx + Math.cos(angle + spread) * inner, cy + Math.sin(angle + spread) * inner);
        rays.fill({ color: intensity === "grand" ? 0xff88ff : 0xffdf65, alpha: 0.06 });
      }
      rays.alpha = 0;
      group.addChild(rays);
      tween(400, (p) => {
        rays.alpha = Math.sin(p * Math.PI) * 0.8;
        rays.rotation = p * 0.3;
      });
    }

    // --- Background glow burst ---
    const glowBurst = new Graphics();
    const glowR = big ? 0.45 : 0.35;
    glowBurst.circle(0, 0, rect.width * glowR)
      .fill({ color: 0xffdf65, alpha: 0.12 });
    glowBurst.circle(0, 0, rect.width * glowR * 0.55)
      .fill({ color: 0xffdf65, alpha: 0.08 });
    glowBurst.position.set(cx, cy);
    glowBurst.alpha = 0;
    group.addChild(glowBurst);

    // --- Dark overlay strip ---
    const strip = new Graphics();
    const stripH = amount ? (big ? 120 : 100) : 55;
    strip.rect(rect.x, cy - stripH / 2, rect.width, stripH)
      .fill({ color: 0x000000, alpha: 0.85 });
    strip.alpha = 0;
    group.addChild(strip);

    // --- Gold accent lines ---
    const lineThick = big ? 4 : 3;
    const lineTop = new Graphics();
    lineTop.rect(rect.x, cy - stripH / 2, rect.width, lineThick)
      .fill({ color: intensity === "grand" ? 0xff88ff : 0xffdf65, alpha: 0.9 });
    lineTop.alpha = 0;
    group.addChild(lineTop);

    const lineBot = new Graphics();
    lineBot.rect(rect.x, cy + stripH / 2 - lineThick, rect.width, lineThick)
      .fill({ color: intensity === "grand" ? 0xff88ff : 0xffdf65, alpha: 0.9 });
    lineBot.alpha = 0;
    group.addChild(lineBot);

    // --- Message text (styled) ---
    const msgText = new Text({
      text: message.toUpperCase(),
      style: new TextStyle({
        fill: intensity === "grand" ? 0xff88ff : 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: amount ? cfg.titleSize : cfg.titleSize + 6,
        fontWeight: "900",
        letterSpacing: intensity === "grand" ? 6 : 3,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.8, blur: big ? 8 : 4, distance: 2 }
      })
    });
    msgText.anchor.set(0.5, 0.5);
    msgText.position.set(cx, cy - (amount ? stripH * 0.22 : 0));
    msgText.alpha = 0;
    msgText.scale.set(0.3);
    group.addChild(msgText);

    // --- Win amount (big gold) ---
    let amtText: Text | null = null;
    if (amount) {
      amtText = new Text({
        text: amount,
        style: new TextStyle({
          fill: intensity === "grand" ? 0xffaaff : 0xffdf65,
          fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
          fontSize: cfg.amtSize,
          fontWeight: "900",
          letterSpacing: 2,
          stroke: { color: intensity === "grand" ? 0x6a1a6a : 0x8b4513, width: big ? 4 : 3 },
          dropShadow: { color: intensity === "grand" ? 0xff44ff : 0xff6a00, alpha: 0.6, blur: big ? 16 : 12, distance: 0 }
        })
      });
      amtText.anchor.set(0.5, 0.5);
      amtText.position.set(cx, cy + stripH * 0.2);
      amtText.alpha = 0;
      amtText.scale.set(0.1);
      group.addChild(amtText);
    }

    this.addChild(group);

    // GPU bloom + chromatic-aberration glitch on the win moment. Applied to THIS
    // (the mask-free effects layer) — filtering the masked board/root blanks the
    // canvas in Pixi v8, so the banner + rays + coins carry the surge instead.
    if (!turbo && (intensity === "mid" || intensity === "high" || intensity === "grand")) {
      void pulseBloom(this, { scale: intensity === "grand" ? 1.7 : intensity === "high" ? 1.2 : 0.8, duration: 900 });
      if (intensity === "grand" || intensity === "high") {
        void pulseChromaticAberration(this, { intensity: intensity === "grand" ? 10 : 6, duration: 600 });
      }
    }

    // === Phase 1: Burst in ===
    await tween(turbo ? 80 : 220, (p) => {
      glowBurst.alpha = p * 0.8;
      glowBurst.scale.set(0.3 + p * 0.7);
      strip.alpha = p;
      lineTop.alpha = p;
      lineBot.alpha = p;
      msgText.alpha = Math.min(1, p * 2);
      msgText.scale.set(0.3 + 0.7 * p);
    }, easeOutBack);

    // === Phase 2: Amount punches in ===
    if (amtText) {
      await tween(turbo ? 60 : 200, (p) => {
        amtText!.alpha = Math.min(1, p * 2);
        amtText!.scale.set(0.1 + 1.1 * p);
      }, easeOutBack);
      amtText.scale.set(1);
    }

    // === Hold ===
    await wait(turbo ? 60 : cfg.holdMs);

    // === Phase 3: Fade out ===
    await tween(turbo ? 80 : 250, (p) => {
      group.alpha = 1 - p;
      glowBurst.scale.set(1 + p * 0.3);
      if (amtText) amtText.scale.set(1 + p * 0.08);
      msgText.y = cy - (amount ? stripH * 0.22 : 0) - p * 20;
      if (amtText) amtText.y = cy + stripH * 0.2 - p * 20;
    }, easeInOutCubic);

    group.destroy({ children: true });
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
        coin.rotation += d.spin * 0.012;
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

    await tween(800, (progress) => {
      bills.forEach((bill, index) => {
        const v = velocities[index];
        const fadeIn = Math.min(1, progress * 5);
        const fadeOut = progress > 0.55 ? 1 - (progress - 0.55) / 0.45 : 1;
        bill.alpha = fadeIn * fadeOut;
        bill.x += v.vx * 0.014;
        bill.y += v.vy * 0.014;
        v.vy += 280 * 0.014; // gravity
        bill.rotation += v.spin * 0.014;
        bill.scale.set(1 - progress * 0.3);
      });
    }, linear);
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

    await tween(600, (progress) => {
      dots.forEach((dot, i) => {
        const v = velocities[i];
        const fadeIn = Math.min(1, progress * 6);
        const fadeOut = progress > 0.5 ? 1 - (progress - 0.5) / 0.5 : 1;
        dot.alpha = fadeIn * fadeOut * 0.9;
        dot.x += v.vx * 0.014;
        dot.y += v.vy * 0.014;
        v.vy += 200 * 0.014;
      });
    }, linear);
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
  async clusterLink(centers: Array<{ x: number; y: number }>, color: number, turbo: boolean): Promise<void> {
    if (centers.length < 2) return;

    const group = new Container();
    const glow = new Graphics();
    const line = new Graphics();
    const sparks: Graphics[] = [];
    group.addChild(glow, line);
    this.addChild(group);

    // Build adjacency pairs (connect neighbors in the cluster)
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < centers.length; i++) {
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
      glow.stroke({ color, width: 10, alpha: 0.2 * p });
      line.stroke({ color: 0xffffff, width: 2, alpha: 0.7 * p });
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

  async cinematicWin(
    targetMultiplier: number,
    betAmount: number,
    rect: Rect,
    turbo: boolean,
    currency: string,
    onUpdate: (amount: number) => void
  ): Promise<void> {
    const group = new Container();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    // Tap/Click skip area covering the whole board
    const interactionBlock = new Graphics();
    interactionBlock.rect(rect.x, rect.y, rect.width, rect.height)
      .fill({ color: 0x000000, alpha: 0.0001 }); // invisible block
    interactionBlock.eventMode = "static";
    interactionBlock.cursor = "pointer";
    group.addChild(interactionBlock);

    let slammed = false;
    const onTap = () => {
      slammed = true;
    };
    interactionBlock.on("pointerdown", onTap);

    // Keyboard listener for Space/Enter skip
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        slammed = true;
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // --- Dark overlay strip (spans full width of the screen) ---
    const strip = new Graphics();
    const stripH = 140;
    const stripX = 0;
    const stripW = window.innerWidth || 1024;
    strip.rect(stripX, cy - stripH / 2, stripW, stripH)
      .fill({ color: 0x000000, alpha: 0.88 });
    group.addChild(strip);

    // --- Accent lines ---
    const lineTop = new Graphics();
    const lineBot = new Graphics();
    group.addChild(lineTop, lineBot);

    // Set initial lines to soft gold
    lineTop.rect(stripX, cy - stripH / 2, stripW, 3.5).fill({ color: 0xffdf65, alpha: 0.8 });
    lineBot.rect(stripX, cy + stripH / 2 - 3.5, stripW, 3.5).fill({ color: 0xffdf65, alpha: 0.8 });

    // --- Title text ---
    const msgText = new Text({
      text: "WINNING",
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 28,
        fontWeight: "900",
        letterSpacing: 3,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 8, distance: 2 }
      })
    });
    msgText.anchor.set(0.5, 0.5);
    msgText.position.set(cx, cy - 26);
    group.addChild(msgText);

    // --- Win amount text ---
    const amtText = new Text({
      text: "0.00",
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 48,
        fontWeight: "900",
        letterSpacing: 2,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 12, distance: 0 }
      })
    });
    amtText.anchor.set(0.5, 0.5);
    amtText.position.set(cx, cy + 28);
    group.addChild(amtText);

    this.addChild(group);

    // Pacing calculations (max 6 seconds in normal mode)
    const duration = turbo ? 800 : Math.min(6000, 1500 + targetMultiplier * 10);
    let lastTier: "none" | "big" | "mega" | "grand" = "none";
    let lastTickTime = 0;
    const tickInterval = 75; // ms between ticks
    let billSpawnTimer = 0;
    let coinSpawnTimer = 0;
    let elapsedMs = 0;
    let isDone = false;

    this.pileHeights = new Array(this.numCols).fill(0);
    this.maxWinActive = targetMultiplier >= 5000;
    this.shouldStack = targetMultiplier >= 500; // Grand/Max wins stack, Big/Mega do not
    this.particles.alpha = 1;

    // Use target multiplier from the start to determine the continuous flow tier
    const targetTier = targetMultiplier >= 5000 ? "max" : targetMultiplier >= 500 ? "grand" : targetMultiplier >= 100 ? "mega" : targetMultiplier >= 20 ? "big" : "none";

    // Continuous spawner running in background based on target tier until fadeout starts
    const spawner = (dt: number) => {
      if (isDone || turbo) return;
      elapsedMs += dt * 1000;

      if (targetTier !== "none") {
        const isGrandRain = targetTier === "grand" || targetTier === "max";
        
        // Target spawn intervals in ms (significantly faster for dense continuous flow)
        const billInterval = targetTier === "max" ? 6 : targetTier === "grand" ? 12 : targetTier === "mega" ? 20 : 35;
        const coinInterval = targetTier === "max" ? 80 : targetTier === "grand" ? 120 : targetTier === "mega" ? 180 : 250;

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

    const startTime = performance.now();

    await new Promise<void>((resolve) => {
      let animFrame = 0;

      const tick = (now: number) => {
        const elapsed = now - startTime;
        let t = Math.min(1, elapsed / duration);

        // Apply ease-in curve (accelerating velocity) so the count up starts slow
        // (allowing the big and mega win banners to be clearly seen) and speeds up.
        let p = Math.pow(t, 2.5);

        if (slammed) {
          p = 1;
          t = 1;
        }

        const currentMult = targetMultiplier * p;
        const currentAmount = currentMult * betAmount;

        amtText.text = currentAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
        onUpdate(currentAmount);

        // Determine current tier
        let activeTier: "none" | "big" | "mega" | "grand" = "none";
        if (currentMult >= 500) activeTier = "grand";
        else if (currentMult >= 100) activeTier = "mega";
        else if (currentMult >= 20) activeTier = "big";

        if (activeTier !== lastTier) {
          lastTier = activeTier;
          this.emit("win_tier_changed", activeTier);

          // Transition pop and effects
          if (activeTier === "big") {
            msgText.text = "BIG WIN";
            msgText.style.fill = 0xffdf65; // Gold
            lineTop.clear().rect(stripX, cy - stripH / 2, stripW, 4).fill({ color: 0xffdf65 });
            lineBot.clear().rect(stripX, cy + stripH / 2 - 4, stripW, 4).fill({ color: 0xffdf65 });
            
            if (!turbo) {
              void this.screenShake(this.parent as Container, turbo);
              void this.goldCoinBurst(cx, cy, rect, turbo);
            }
          } else if (activeTier === "mega") {
            msgText.text = "MEGA WIN";
            msgText.style.fill = 0xe056fd; // Magenta/Purple
            lineTop.clear().rect(stripX, cy - stripH / 2, stripW, 4).fill({ color: 0xe056fd });
            lineBot.clear().rect(stripX, cy + stripH / 2 - 4, stripW, 4).fill({ color: 0xe056fd });

            if (!turbo) {
              void this.screenShake(this.parent as Container, turbo);
              void this.goldCoinBurst(cx, cy, rect, turbo);
              void pulseBloom(this, { scale: 1.2, duration: 900 });
            }
          } else if (activeTier === "grand") {
            msgText.text = "GRAND WIN";
            msgText.style.fill = 0xff4757; // Vibrant Neon Red
            lineTop.clear().rect(stripX, cy - stripH / 2, stripW, 4).fill({ color: 0xff4757 });
            lineBot.clear().rect(stripX, cy + stripH / 2 - 4, stripW, 4).fill({ color: 0xff4757 });

            if (!turbo) {
              void this.screenShake(this.parent as Container, turbo);
              void this.goldCoinBurst(cx, cy, rect, turbo);
              void pulseBloom(this, { scale: 1.7, duration: 900 });
              void pulseChromaticAberration(this, { intensity: 10, duration: 600 });
            }
          }

          // Pop title text
          msgText.scale.set(1.4);
          void tween(200, (pt) => {
            msgText.scale.set(1.4 - 0.4 * pt);
          });
        }

        // Ticking audio triggers (throttle using elapsed time)
        if (!slammed && (elapsed - lastTickTime >= tickInterval)) {
          lastTickTime = elapsed;
          this.emit("win_tick", activeTier);
        }

        // Text bounce during updates
        amtText.scale.set(1.0 + Math.sin(p * Math.PI * 8) * 0.05);

        if (t < 1 && !slammed) {
          animFrame = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };

      animFrame = requestAnimationFrame(tick);
    });

    // Final confirmations
    const finalAmount = targetMultiplier * betAmount;
    amtText.text = finalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
    amtText.scale.set(1);
    onUpdate(finalAmount);

    // Climax jingle triggers
    this.emit("win_climax", lastTier);

    // Stop spawning new money immediately when the money counter stops!
    isDone = true;
    ambientTicker.remove(spawner);

    const isMaxWin = this.maxWinActive;

    if (isMaxWin) {
      // For max win, we wait for a second tap/click or keyboard press to dismiss
      let dismissed = false;

      // Update interaction block event handler for dismissal
      interactionBlock.off("pointerdown", onTap);
      const onDismissTap = () => {
        dismissed = true;
      };
      interactionBlock.on("pointerdown", onDismissTap);

      // Update keyboard listener
      window.removeEventListener("keydown", onKeyDown);
      const onDismissKeyDown = (e: KeyboardEvent) => {
        if (e.code === "Space" || e.code === "Enter") {
          e.preventDefault();
          dismissed = true;
        }
      };
      window.addEventListener("keydown", onDismissKeyDown);

      // Keep running until dismissed
      while (!dismissed) {
        await wait(50);
      }

      // Cleanup the dismiss listeners
      interactionBlock.off("pointerdown", onDismissTap);
      window.removeEventListener("keydown", onDismissKeyDown);
    } else {
      // Normal win hold - wait for normal hold duration
      await wait(slammed ? 750 : turbo ? 300 : 1200);

      // Cleanup listeners
      window.removeEventListener("keydown", onKeyDown);
      interactionBlock.off("pointerdown", onTap);
    }

    // Fade out banner and piled particles together
    await tween(600, (p) => {
      group.alpha = 1 - p;
      this.particles.alpha = 1 - p;
    });

    // Reset particles alpha and return all active/stacked particles to pools
    this.particles.alpha = 1;
    this.activeParticles.forEach(p => {
      if (p.isBill) this.returnBill(p.view as Container);
      else this.returnCoin(p.view as Graphics);
    });
    this.activeParticles.length = 0;

    group.destroy({ children: true });
  }
}
