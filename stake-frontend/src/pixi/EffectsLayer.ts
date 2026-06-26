import { Container, Graphics, Text, TextStyle, Sprite } from "pixi.js";
import type { Position } from "../domain";
import type { Rect } from "./types";
import { makeText } from "./text";
import { tween, wait, easeOutBack, easeOutCubic, easeInOutCubic, easeOutElastic, linear } from "./tween";
import { pulseBloom, pulseChromaticAberration } from "../vfx/Shaders";
import { getExtraTexture } from "./assets";

export class EffectsLayer extends Container {
  private readonly particles = new Container();

  constructor() {
    super();
    this.addChild(this.particles);
  }

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
   *  CASH RAIN — big green bills fall from the top
   * ───────────────────────────────────────────────── */
  async cashRain(rect: Rect, turbo: boolean): Promise<void> {
    if (turbo) return;
    const billCount = 40;
    const bills: Container[] = [];
    const billData: Array<{ vx: number; vy: number; spin: number; delay: number }> = [];

    const billTex = getExtraTexture("real_bill");

    for (let i = 0; i < billCount; i++) {
      let bill: Container;

      if (billTex) {
        const spr = new Sprite(billTex);
        spr.anchor.set(0.5);
        const targetWidth = 65 + Math.random() * 25;
        spr.scale.set(targetWidth / billTex.width);
        bill = new Container();
        bill.addChild(spr);
      } else {
        const gfx = new Graphics();
        // Big fat bills like the cartoon reference
        const w = 44 + Math.random() * 20;
        const h = 22 + Math.random() * 10;
        const shade = [0x1a8f3f, 0x22a849, 0x178a38, 0x1b9e42, 0x0f7a2e][i % 5];
        const lightShade = [0x2ecc71, 0x34d678, 0x28c066, 0x3ddc84, 0x27ae60][i % 5];

        // Bill body
        gfx.roundRect(-w / 2, -h / 2, w, h, 3).fill(shade);
        // Inner border
        gfx.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 2)
          .stroke({ color: lightShade, width: 1.5, alpha: 0.6 });
        // Center circle (like real bills)
        const circR = Math.min(w, h) * 0.28;
        gfx.circle(0, 0, circR).fill({ color: lightShade, alpha: 0.35 });
        gfx.circle(0, 0, circR * 0.6).fill({ color: lightShade, alpha: 0.2 });
        // Dollar sign
        gfx.roundRect(-2, -h * 0.3, 4, h * 0.6, 1).fill({ color: 0xffffff, alpha: 0.35 });
        gfx.roundRect(-w * 0.12, -2, w * 0.24, 4, 1).fill({ color: 0xffffff, alpha: 0.25 });
        // Corner marks
        gfx.rect(-w / 2 + 5, -h / 2 + 5, 6, 4).fill({ color: 0xffffff, alpha: 0.2 });
        gfx.rect(w / 2 - 11, h / 2 - 9, 6, 4).fill({ color: 0xffffff, alpha: 0.2 });
        bill = gfx;
      }

      bill.position.set(
        rect.x - 30 + Math.random() * (rect.width + 60),
        rect.y - 40 - Math.random() * 120
      );
      bill.rotation = (Math.random() - 0.5) * 1.2;
      bill.alpha = 0;
      bills.push(bill);
      this.particles.addChild(bill);
      billData.push({
        vx: (Math.random() - 0.5) * 50,
        vy: 100 + Math.random() * 160,
        spin: (Math.random() - 0.5) * 3,
        delay: Math.random() * 0.35
      });
    }

    await tween(1500, (p) => {
      bills.forEach((bill, i) => {
        const d = billData[i];
        const t = Math.max(0, p - d.delay) / (1 - d.delay);
        if (t <= 0) return;
        bill.alpha = t < 0.08 ? t * 12 : t > 0.65 ? (1 - t) / 0.35 : 1;
        bill.x += d.vx * 0.013;
        bill.y += d.vy * 0.013;
        d.vx += (Math.random() - 0.5) * 3; // flutter sideways
        bill.rotation += d.spin * 0.013;
      });
    }, linear);
    bills.forEach((b) => b.destroy());
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
      const coin = new Graphics();
      const size = 5 + Math.random() * 7;
      // Gold coin with highlight
      coin.circle(0, 0, size).fill(0xffd700);
      coin.circle(0, 0, size * 0.7).fill(0xffec80);
      coin.circle(-size * 0.2, -size * 0.2, size * 0.25).fill({ color: 0xffffff, alpha: 0.6 });
      // Dollar sign
      coin.rect(-1, -size * 0.4, 2, size * 0.8).fill({ color: 0xb8860b, alpha: 0.5 });

      coin.position.set(cx, cy);
      coin.alpha = 0;
      coins.push(coin);
      this.particles.addChild(coin);
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
        coin.scale.set(1 - p * 0.4);
      });
    }, easeOutCubic);
    coins.forEach((c) => c.destroy());
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
      let bill: Container;
      if (billTex) {
        const spr = new Sprite(billTex);
        spr.anchor.set(0.5);
        const targetWidth = 35 + Math.random() * 15;
        spr.scale.set(targetWidth / billTex.width);
        bill = new Container();
        bill.addChild(spr);
      } else {
        const gfx = new Graphics();
        const w = 16 + Math.random() * 12;
        const h = 7 + Math.random() * 5;
        const shade = [0x62ffa7, 0x4de89a, 0x2ecc71, 0x27ae60][i % 4];
        gfx.roundRect(-w / 2, -h / 2, w, h, 2).fill(shade)
          .stroke({ color: 0xffffff, alpha: 0.4, width: 1 });
        gfx.rect(-1, -h / 2, 2, h).fill({ color: 0xffffff, alpha: 0.2 });
        bill = gfx;
      }
      
      bill.position.set(
        rect.x + rect.width * (0.15 + Math.random() * 0.7),
        rect.y + rect.height * (0.25 + Math.random() * 0.5)
      );
      bill.rotation = Math.random() * Math.PI;
      bill.alpha = 0;
      bills.push(bill);
      this.particles.addChild(bill);
      velocities.push({
        vx: (Math.random() - 0.5) * 220,
        vy: -(80 + Math.random() * 180),
        spin: (Math.random() - 0.5) * 10
      });
    }

    // Gold coins mixed in
    const coinCount = Math.min(positions.length * 3, 20);
    for (let i = 0; i < coinCount; i++) {
      const coin = new Graphics();
      const size = 4 + Math.random() * 5;
      coin.circle(0, 0, size).fill(0xffd700);
      coin.circle(0, 0, size * 0.65).fill(0xffec80);
      coin.position.set(
        rect.x + rect.width * (0.2 + Math.random() * 0.6),
        rect.y + rect.height * (0.3 + Math.random() * 0.4)
      );
      coin.alpha = 0;
      bills.push(coin);
      this.particles.addChild(coin);
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
    bills.forEach((bill) => bill.destroy());
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
  async keyBeam(from: { x: number; y: number }, targets: Array<{ x: number; y: number }>, turbo: boolean): Promise<void> {
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
      glowBeams.stroke({ color: 0x9ae64e, width: 12, alpha: 0.25 });
      beams.stroke({ color: 0x9ae64e, width: 3, alpha: 0.95 });
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
}
