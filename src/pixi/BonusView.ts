import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type BonusCell, type Position } from "../domain";
import { getSymbolTexture } from "./assets";
import { makeText } from "./text";
import { tween, wait, easeOutBack, easeOutElastic, easeInOutCubic, easeOutCubic, linear, ambientTicker } from "./tween";
import type { Rect } from "./types";

export class BonusView extends Container {
  private readonly overlay = new Graphics();
  private readonly gridLayer = new Container();
  private readonly effectsLayer = new Container();
  private readonly ambientLayer = new Container();
  private rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
  private gap = 6;
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;

  constructor() {
    super();
    this.visible = false;
    this.addChild(this.overlay, this.gridLayer, this.effectsLayer, this.ambientLayer);
  }

  layout(rect: Rect): void {
    this.rect = rect;
    this.position.set(rect.x, rect.y);
  }

  async intro(turbo: boolean): Promise<void> {
    this.visible = true;
    this.alpha = 0;
    this.scale.set(0.85);
    this.drawShell(3);

    await tween(turbo ? 120 : 500, (progress) => {
      this.alpha = Math.min(1, progress * 1.3);
      this.scale.set(0.85 + 0.15 * progress);
    }, easeOutBack);
    this.scale.set(1);
    this.alpha = 1;
    this.startAmbient();
  }

  setGrid(grid: BonusCell[][], respins: number, highlighted: Position[], cracked: Position[]): void {
    this.visible = true;
    this.drawShell(respins);
    this.drawGrid(grid, highlighted, cracked);
    this.startAmbient();
  }

  async grandReveal(grid: BonusCell[][], positions: Position[], respins: number, turbo: boolean, onSafeLand?: (index: number, total: number) => void): Promise<void> {
    this.visible = true;
    this.startAmbient();

    const emptyGrid = this.makeEmptyGrid();
    this.drawShell(respins);
    this.drawGrid(emptyGrid, [], []);

    // Shuffle positions for unpredictable reveal
    const order = [...positions];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const top = 72;
    const cellWidth = (this.rect.width - this.gap * (GRID_COLUMNS + 1)) / GRID_COLUMNS;
    const cellHeight = (this.rect.height - 86 - this.gap * (GRID_ROWS + 1)) / GRID_ROWS;
    const total = order.length;

    let runningTotal = 0;

    for (let i = 0; i < total; i++) {
      const [col, row] = order[i];
      const cell = grid[col][row];
      runningTotal += cell.value ?? 0;

      const progress = i / (total - 1);
      // Crescendo: 450ms → 60ms
      const delayMs = turbo ? 30 : Math.round(450 - 390 * progress);

      const cx = this.gap + col * (cellWidth + this.gap) + cellWidth / 2;
      const cy = top + this.gap + row * (cellHeight + this.gap) + cellHeight / 2;
      const x = this.gap + col * (cellWidth + this.gap);
      const y = top + this.gap + row * (cellHeight + this.gap);

      // Draw the safe cell
      this.drawSingleCell(x, y, cellWidth, cellHeight, cell, true);
      onSafeLand?.(i, total);

      // Impact flash
      const flash = new Graphics();
      flash.roundRect(x - 6, y - 6, cellWidth + 12, cellHeight + 12, 12)
        .fill({ color: 0xffdf65, alpha: 0.5 });
      this.effectsLayer.addChild(flash);

      // Slam animation on the cell contents
      const cellContainer = this.gridLayer.children[this.gridLayer.children.length - 1] as Container;
      if (cellContainer) {
        const slamScale = 1.3 - progress * 0.15;
        cellContainer.pivot?.set(0, 0);

        await tween(turbo ? 40 : Math.max(80, 160 - progress * 80), (p) => {
          flash.alpha = (1 - p) * 0.5;
          // Shake intensity increases with progress
          const shakeIntensity = (2 + progress * 4) * (1 - p);
          const shakeX = Math.sin(p * Math.PI * 6) * shakeIntensity;
          const shakeY = Math.cos(p * Math.PI * 4) * shakeIntensity * 0.5;
          this.gridLayer.x = shakeX;
          this.gridLayer.y = shakeY;
        }, easeOutCubic);

        this.gridLayer.x = 0;
        this.gridLayer.y = 0;
      }

      flash.destroy();

      // Strobe flash every 5 safes
      if ((i + 1) % 5 === 0 && !turbo) {
        const strobe = new Graphics();
        strobe.rect(0, 0, this.rect.width, this.rect.height)
          .fill({ color: 0xffdf65, alpha: 0.2 });
        this.effectsLayer.addChild(strobe);
        tween(200, (p) => { strobe.alpha = (1 - p) * 0.2; }).then(() => strobe.destroy());
      }

      // Running total counter
      this.updateRevealCounter(runningTotal);

      if (i < total - 1) await wait(delayMs);
    }

    // === GRAND FINALE ===
    await this.grandFinale(turbo);
  }

  private updateRevealCounter(total: number): void {
    const existing = this.effectsLayer.getChildByLabel("revealCounter");
    if (existing) existing.destroy();

    const counter = new Text({
      text: `${total}x`,
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 28,
        fontWeight: "900",
        letterSpacing: 2,
        stroke: { color: 0x8b4513, width: 3 },
        dropShadow: { color: 0xff6a00, alpha: 0.7, blur: 10, distance: 0 }
      })
    });
    counter.anchor.set(0.5, 0);
    counter.position.set(this.rect.width / 2, this.rect.height - 40);
    counter.label = "revealCounter";
    this.effectsLayer.addChild(counter);
  }

  private async grandFinale(turbo: boolean): Promise<void> {
    const w = this.rect.width;
    const h = this.rect.height;

    // Full-screen golden flash
    const flash = new Graphics();
    flash.rect(0, 0, w, h).fill({ color: 0xffdf65, alpha: 0.6 });
    this.effectsLayer.addChild(flash);

    // Heavy screen shake
    const origX = this.gridLayer.x;
    const origY = this.gridLayer.y;

    await tween(turbo ? 100 : 500, (p) => {
      flash.alpha = (1 - p) * 0.6;
      const decay = 1 - p;
      const intensity = 10 * decay;
      this.gridLayer.x = origX + Math.sin(p * Math.PI * 12) * intensity;
      this.gridLayer.y = origY + Math.cos(p * Math.PI * 8) * intensity * 0.6;
    }, linear);
    this.gridLayer.x = origX;
    this.gridLayer.y = origY;
    flash.destroy();

    // Radial gold burst
    const burst = new Graphics();
    const cx = w / 2;
    const cy = h / 2;
    this.effectsLayer.addChild(burst);

    await tween(turbo ? 80 : 400, (p) => {
      burst.clear();
      const radius = Math.max(w, h) * 0.5 * p;
      burst.circle(cx, cy, radius).fill({ color: 0xffdf65, alpha: 0.15 * (1 - p) });
      burst.circle(cx, cy, radius * 0.6).fill({ color: 0xffffff, alpha: 0.1 * (1 - p) });
    }, easeOutCubic);
    burst.destroy();

    // Gold particle explosion
    const particles: Graphics[] = [];
    const particleData: Array<{ vx: number; vy: number; spin: number }> = [];
    const particleCount = turbo ? 10 : 40;

    for (let i = 0; i < particleCount; i++) {
      const p = new Graphics();
      const size = 3 + Math.random() * 5;
      const color = [0xffdf65, 0xffd700, 0xffec80, 0xff6a00, 0xffffff][i % 5];
      p.circle(0, 0, size).fill(color);
      p.position.set(cx, cy);
      p.alpha = 0;
      particles.push(p);
      this.effectsLayer.addChild(p);
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      particleData.push({
        vx: Math.cos(angle) * (150 + Math.random() * 200),
        vy: Math.sin(angle) * (150 + Math.random() * 200),
        spin: (Math.random() - 0.5) * 8
      });
    }

    await tween(turbo ? 200 : 800, (p) => {
      particles.forEach((particle, i) => {
        const d = particleData[i];
        const fadeIn = Math.min(1, p * 4);
        const fadeOut = p > 0.4 ? 1 - (p - 0.4) / 0.6 : 1;
        particle.alpha = fadeIn * fadeOut * 0.9;
        particle.x = cx + d.vx * p;
        particle.y = cy + d.vy * p + 80 * p * p;
        particle.rotation += d.spin * 0.012;
        particle.scale.set(1 - p * 0.5);
      });
    }, easeOutCubic);
    particles.forEach((p) => p.destroy());

    // Sustained gold glow pulse
    const glow = new Graphics();
    this.effectsLayer.addChild(glow);
    await tween(turbo ? 100 : 600, (p) => {
      glow.clear();
      const alpha = Math.sin(p * Math.PI * 3) * 0.12;
      glow.roundRect(4, 4, w - 8, h - 8, 10)
        .fill({ color: 0xffdf65, alpha: Math.max(0, alpha) });
    });
    glow.destroy();

    // Clean up counter
    const counter = this.effectsLayer.getChildByLabel("revealCounter");
    if (counter) counter.destroy();
  }

  async pulse(positions: Position[], turbo: boolean): Promise<void> {
    if (!positions.length) return wait(turbo ? 40 : 100);

    await tween(turbo ? 100 : 320, (progress) => {
      const s = 1 + Math.sin(progress * Math.PI) * 0.06;
      this.gridLayer.scale.set(s);
    }, easeInOutCubic);
    this.gridLayer.scale.set(1);
  }

  hide(): void {
    this.visible = false;
    this.gridLayer.removeChildren();
    this.effectsLayer.removeChildren();
    this.ambientLayer.removeChildren();
    this.stopAmbient();
  }

  centerOf(position: Position): { x: number; y: number } {
    const top = 72;
    const cellWidth = (this.rect.width - this.gap * (GRID_COLUMNS + 1)) / GRID_COLUMNS;
    const cellHeight = (this.rect.height - 86 - this.gap * (GRID_ROWS + 1)) / GRID_ROWS;
    const [column, row] = position;
    return {
      x: this.rect.x + this.gap + column * (cellWidth + this.gap) + cellWidth / 2,
      y: this.rect.y + top + this.gap + row * (cellHeight + this.gap) + cellHeight / 2
    };
  }

  private makeEmptyGrid(): BonusCell[][] {
    return Array.from({ length: GRID_COLUMNS }, () =>
      Array.from({ length: GRID_ROWS }, () => ({ symbol: "EMPTY" as const }))
    );
  }

  private startAmbient(): void {
    this.stopAmbient();
    this.ambientCb = (_dt, elapsed) => {
      this.ambientLayer.removeChildren();
      const w = this.rect.width;
      const h = this.rect.height;

      const sweep = new Graphics();
      const spotX = (Math.sin(elapsed * 0.8) * 0.5 + 0.5) * w;
      const spotWidth = w * 0.25;
      sweep.rect(spotX - spotWidth / 2, 70, spotWidth, h - 90)
        .fill({ color: 0xffdf65, alpha: 0.03 + Math.sin(elapsed * 1.5) * 0.01 });
      this.ambientLayer.addChild(sweep);

      const pulseAlpha = 0.15 + Math.sin(elapsed * 3) * 0.08;
      const alarm = new Graphics();
      alarm.roundRect(6, 6, w - 12, h - 12, 10)
        .stroke({ color: 0xff3158, alpha: pulseAlpha, width: 1 });
      this.ambientLayer.addChild(alarm);
    };
    ambientTicker.add(this.ambientCb);
  }

  private stopAmbient(): void {
    if (this.ambientCb) {
      ambientTicker.remove(this.ambientCb);
      this.ambientCb = null;
    }
    this.ambientLayer.removeChildren();
  }

  private drawShell(respins: number): void {
    const w = this.rect.width;
    const h = this.rect.height;

    this.overlay.clear();
    this.overlay.rect(0, 0, w, h).fill({ color: 0x040810, alpha: 0.97 });
    this.overlay.circle(w / 2, h / 2, Math.max(w, h) * 0.4)
      .fill({ color: 0x0a1a3a, alpha: 0.6 });
    this.overlay.roundRect(4, 4, w - 8, h - 8, 10)
      .stroke({ color: 0xffdf65, alpha: 0.7, width: 3 });
    this.overlay.roundRect(8, 8, w - 16, h - 16, 8)
      .stroke({ color: 0xffdf65, alpha: 0.2, width: 1 });

    const rivetPositions = [
      [16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]
    ];
    for (const [rx, ry] of rivetPositions) {
      this.overlay.circle(rx, ry, 4).fill({ color: 0x2a3a5a, alpha: 1 });
      this.overlay.circle(rx, ry, 4).stroke({ color: 0x4a6a9a, width: 1 });
      this.overlay.circle(rx - 1, ry - 1, 1.5).fill({ color: 0x6a8aba, alpha: 0.6 });
    }

    this.overlay.rect(12, 12, w - 24, 52).fill({ color: 0x0a0e22, alpha: 0.8 });
    this.overlay.rect(12, 62, w - 24, 2).fill({ color: 0xffdf65, alpha: 0.3 });
    this.overlay.rect(12, h - 16, w - 24, 1).fill({ color: 0xffdf65, alpha: 0.15 });

    this.gridLayer.removeChildren();

    const titleSize = Math.min(38, w / 16);
    const titleGlow = new Text({
      text: "THE GETAWAY",
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: titleSize,
        fontWeight: "900",
        letterSpacing: 4,
        align: "center",
        dropShadow: { color: 0xff6a00, alpha: 0.6, blur: 14, distance: 0 }
      })
    });
    titleGlow.anchor.set(0.5, 0);
    titleGlow.position.set(w / 2, 18);
    this.gridLayer.addChild(titleGlow);

    const titleMain = new Text({
      text: "THE GETAWAY",
      style: new TextStyle({
        fill: 0xffdf65,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: titleSize,
        fontWeight: "900",
        letterSpacing: 4,
        align: "center",
        stroke: { color: 0x8b4513, width: 2 }
      })
    });
    titleMain.anchor.set(0.5, 0);
    titleMain.position.set(w / 2, 18);
    this.gridLayer.addChild(titleMain);

    const badgeW = Math.min(140, w * 0.22);
    const badgeH = 30;
    const badgeX = w - badgeW - 16;
    const badgeY = 24;
    const badge = new Graphics();
    badge.roundRect(badgeX, badgeY, badgeW, badgeH, 6)
      .fill(respins <= 1 ? 0x4a0a0a : 0x0a1a3a)
      .stroke({ color: respins <= 1 ? 0xff3158 : 0x48e5ff, width: 2 });
    this.gridLayer.addChild(badge);

    const respinText = new Text({
      text: `${respins} RESPINS`,
      style: new TextStyle({
        fill: respins <= 1 ? 0xff3158 : 0x9fe8ff,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: Math.min(18, badgeW * 0.14),
        fontWeight: "900",
        letterSpacing: 2
      })
    });
    respinText.anchor.set(0.5, 0.5);
    respinText.position.set(badgeX + badgeW / 2, badgeY + badgeH / 2);
    this.gridLayer.addChild(respinText);
  }

  private drawSingleCell(x: number, y: number, cellWidth: number, cellHeight: number, cell: BonusCell, active: boolean): void {
    const g = new Graphics();

    if (cell.symbol === "SAFE" || cell.symbol === "MASTER_KEY") {
      const cellColor = cell.symbol === "SAFE" ? 0x3a2a0a : 0x0a2a4a;

      if (active) {
        g.roundRect(x - 4, y - 4, cellWidth + 8, cellHeight + 8, 12)
          .fill({ color: 0xffdf65, alpha: 0.2 });
      }

      g.roundRect(x, y, cellWidth, cellHeight, 8).fill(cellColor);
      g.roundRect(x + 1, y + cellHeight * 0.6, cellWidth - 2, cellHeight * 0.4, 6)
        .fill({ color: 0x000000, alpha: 0.25 });
      g.roundRect(x + 2, y + 2, cellWidth - 4, cellHeight * 0.35, 6)
        .fill({ color: 0xffffff, alpha: 0.06 });

      const borderColor = active ? 0xffdf65 : 0x5a4a2a;
      g.roundRect(x, y, cellWidth, cellHeight, 8)
        .stroke({ color: borderColor, width: active ? 3 : 1.5, alpha: active ? 0.9 : 0.6 });

      this.gridLayer.addChild(g);

      const tex = getSymbolTexture(cell.symbol);
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        const padding = 4;
        const scale = Math.min((cellWidth - padding * 2) / tex.width, (cellHeight - padding * 2) / tex.height);
        sprite.scale.set(scale);
        sprite.position.set(x + cellWidth / 2, y + cellHeight / 2);
        this.gridLayer.addChild(sprite);
      }

      if (cell.value) {
        const valueBg = new Graphics();
        valueBg.roundRect(x + 4, y + cellHeight - 30, cellWidth - 8, 26, 4)
          .fill({ color: 0x000000, alpha: 0.7 });
        this.gridLayer.addChild(valueBg);
        this.gridLayer.addChild(makeText(
          `${cell.value}x`,
          Math.min(22, cellWidth / 3.5), 0xffdf65,
          x + cellWidth / 2, y + cellHeight - 29, "center"
        ));
      }
    }
  }

  private drawGrid(grid: BonusCell[][], highlighted: Position[], cracked: Position[]): void {
    const highlightedSet = new Set(highlighted.map(([column, row]) => `${column}:${row}`));
    const crackedSet = new Set(cracked.map(([column, row]) => `${column}:${row}`));
    const top = 72;
    const cellWidth = (this.rect.width - this.gap * (GRID_COLUMNS + 1)) / GRID_COLUMNS;
    const cellHeight = (this.rect.height - 86 - this.gap * (GRID_ROWS + 1)) / GRID_ROWS;

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let column = 0; column < GRID_COLUMNS; column += 1) {
        const cell = grid[column][row];
        const key = `${column}:${row}`;
        const x = this.gap + column * (cellWidth + this.gap);
        const y = top + this.gap + row * (cellHeight + this.gap);
        const isActive = highlightedSet.has(key) || crackedSet.has(key);
        const isCracked = crackedSet.has(key);

        if (cell.symbol === "SAFE" || cell.symbol === "MASTER_KEY") {
          const g = new Graphics();
          const cellColor = cell.symbol === "SAFE" ? 0x3a2a0a : 0x0a2a4a;

          if (isActive) {
            const glowColor = isCracked ? 0xffdf65 : 0x48e5ff;
            g.roundRect(x - 4, y - 4, cellWidth + 8, cellHeight + 8, 12)
              .fill({ color: glowColor, alpha: 0.2 });
          }

          g.roundRect(x, y, cellWidth, cellHeight, 8).fill(cellColor);
          g.roundRect(x + 1, y + cellHeight * 0.6, cellWidth - 2, cellHeight * 0.4, 6)
            .fill({ color: 0x000000, alpha: 0.25 });
          g.roundRect(x + 2, y + 2, cellWidth - 4, cellHeight * 0.35, 6)
            .fill({ color: 0xffffff, alpha: 0.06 });

          const borderColor = isCracked ? 0xffdf65 : isActive ? 0x68f7ff : 0x5a4a2a;
          g.roundRect(x, y, cellWidth, cellHeight, 8)
            .stroke({ color: borderColor, width: isActive ? 3 : 1.5, alpha: isActive ? 0.9 : 0.6 });

          this.gridLayer.addChild(g);

          const tex = getSymbolTexture(cell.symbol);
          if (tex) {
            const sprite = new Sprite(tex);
            sprite.anchor.set(0.5);
            const padding = 4;
            const scale = Math.min((cellWidth - padding * 2) / tex.width, (cellHeight - padding * 2) / tex.height);
            sprite.scale.set(scale);
            sprite.position.set(x + cellWidth / 2, y + cellHeight / 2);
            this.gridLayer.addChild(sprite);
          } else {
            this.gridLayer.addChild(makeText(
              cell.symbol === "MASTER_KEY" ? "KEY" : "SAFE",
              Math.min(18, cellWidth / 4), 0xffffff,
              x + cellWidth / 2, y + cellHeight * 0.3, "center"
            ));
          }

          if (cell.value) {
            const valueBg = new Graphics();
            valueBg.roundRect(x + 4, y + cellHeight - 30, cellWidth - 8, 26, 4)
              .fill({ color: 0x000000, alpha: 0.7 });
            this.gridLayer.addChild(valueBg);
            this.gridLayer.addChild(makeText(
              `${cell.value}x`,
              Math.min(22, cellWidth / 3.5), 0xffdf65,
              x + cellWidth / 2, y + cellHeight - 29, "center"
            ));
          }
        } else {
          const g = new Graphics();
          g.roundRect(x, y, cellWidth, cellHeight, 8)
            .fill({ color: 0x0a1228, alpha: 0.9 });
          g.roundRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4, 6)
            .stroke({ color: 0x1a2a4a, alpha: 0.4, width: 1 });

          const cx = x + cellWidth / 2;
          const cy = y + cellHeight / 2;
          const lockSize = Math.min(cellWidth, cellHeight) * 0.15;
          g.roundRect(cx - lockSize, cy - lockSize * 0.2, lockSize * 2, lockSize * 1.6, 3)
            .fill({ color: 0x1a2a4a, alpha: 0.5 });
          g.roundRect(cx - lockSize, cy - lockSize * 0.2, lockSize * 2, lockSize * 1.6, 3)
            .stroke({ color: 0x2a3a5a, alpha: 0.4, width: 1 });
          g.arc(cx, cy - lockSize * 0.2, lockSize * 0.7, Math.PI, 0)
            .stroke({ color: 0x2a3a5a, alpha: 0.4, width: 2 });
          g.circle(cx, cy + lockSize * 0.3, lockSize * 0.2)
            .fill({ color: 0x0a1228, alpha: 0.8 });
          g.roundRect(x, y, cellWidth, cellHeight, 8)
            .stroke({ color: 0x1a2a4a, alpha: 0.3, width: 1 });

          this.gridLayer.addChild(g);
        }
      }
    }
  }
}
