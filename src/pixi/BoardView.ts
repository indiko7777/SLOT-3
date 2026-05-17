import { Container, Graphics, Sprite } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type Position, type SymbolId } from "../domain";
import { SYMBOL_ASSETS, getSymbolTexture } from "./assets";
import { SymbolView } from "./SymbolView";
import { tween, wait, easeOutCubic, easeOutBounce, easeInCubic, linear, ambientTicker } from "./tween";
import type { Rect } from "./types";

const ALL_SYMBOLS: SymbolId[] = ["BRASS", "KNIFE", "PISTOL", "AMMO", "DUFFEL", "CASH", "WATCH", "DIAMOND", "BIKE"];

const easeOutBack: (t: number) => number = (t) => {
  const c = 1.2;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

export class BoardView extends Container {
  private readonly background = new Graphics();
  private readonly reelMask = new Graphics();
  private readonly reelContainer = new Container();
  private readonly glassOverlay = new Graphics();
  private readonly symbols = new Map<string, SymbolView>();
  private rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
  private cellWidth = 0;
  private cellHeight = 0;
  private gap = 4;
  private currentBoard: Board | null = null;
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;

  constructor() {
    super();
    this.addChild(this.background, this.reelContainer);
    this.reelContainer.mask = this.reelMask;
    this.addChild(this.reelMask);
    this.addChild(this.glassOverlay);
  }

  layout(rect: Rect): void {
    this.rect = rect;
    this.position.set(rect.x, rect.y);
    this.cellWidth = (rect.width - this.gap * (GRID_COLUMNS + 1)) / GRID_COLUMNS;
    this.cellHeight = (rect.height - this.gap * (GRID_ROWS + 1)) / GRID_ROWS;
    this.drawBackground();
    this.drawMask();
    this.drawGlassOverlay();
    this.layoutSymbols();
  }

  setInstant(board: Board): void {
    this.currentBoard = board;
    this.rebuildSymbols(board);
    this.startAmbient();
  }

  async settle(board: Board, turbo: boolean, scatterCols?: Set<number>): Promise<void> {
    this.stopAmbient();
    this.currentBoard = board;
    await this.spinReels(board, turbo, scatterCols);
    this.startAmbient();
  }

  async highlight(positions: Position[], turbo: boolean): Promise<void> {
    this.markPositions(positions, "highlight");
    await Promise.all(
      positions.map((p) => this.symbols.get(keyOf(p))?.winCelebrate(turbo) ?? Promise.resolve())
    );
    await wait(turbo ? 30 : 80);
  }

  async scatterTease(positions: Position[], turbo: boolean): Promise<void> {
    this.markPositions(positions, "alert");
    await Promise.all(positions.map((p) => this.symbols.get(keyOf(p))?.punch() ?? Promise.resolve()));
    await wait(turbo ? 60 : 200);
  }

  /* ─── REMOVE: flash + collapse winning symbols, then gravity-drop survivors ─── */
  async remove(positions: Position[], turbo: boolean): Promise<void> {
    this.markPositions(positions, "highlight");
    await Promise.all(
      positions.map((p) => this.symbols.get(keyOf(p))?.vanish(turbo) ?? Promise.resolve())
    );
    for (const p of positions) {
      const v = this.symbols.get(keyOf(p));
      if (v) { v.destroy({ children: true }); this.symbols.delete(keyOf(p)); }
    }
    await this.collapseColumns(turbo);
  }

  private async collapseColumns(turbo: boolean): Promise<void> {
    const animations: Promise<void>[] = [];
    const cellStep = this.cellHeight + this.gap;

    for (let col = 0; col < GRID_COLUMNS; col++) {
      const survivors: SymbolView[] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        const view = this.symbols.get(keyOf([col, row]));
        if (view) {
          survivors.push(view);
          this.symbols.delete(keyOf([col, row]));
        }
      }

      const emptyCount = GRID_ROWS - survivors.length;

      // Survivors fall to the bottom of the column
      for (let i = 0; i < survivors.length; i++) {
        const view = survivors[i];
        const newRow = emptyCount + i;
        const targetY = this.cellY(newRow);
        const startY = view.y;
        this.symbols.set(keyOf([col, newRow]), view);
        if (Math.abs(startY - targetY) > 1) {
          const fallDist = targetY - startY;
          const dur = turbo ? 80 : Math.min(280, 100 + fallDist * 0.5);
          animations.push(
            tween(dur, (p) => { view.y = startY + fallDist * p; }, easeOutBounce)
              .then(() => { view.y = targetY; })
          );
        }
      }

      // Fill empty cells at top with new random symbols sliding in from above
      for (let i = 0; i < emptyCount; i++) {
        const newRow = i;
        const id = ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)];
        const view = new SymbolView(id);
        view.layout(this.cellWidth, this.cellHeight);
        const startY = -(emptyCount - i) * cellStep;
        const targetY = this.cellY(newRow);
        view.x = this.cellX(col);
        view.y = startY;
        this.reelContainer.addChild(view);
        this.symbols.set(keyOf([col, newRow]), view);
        const fallDist = targetY - startY;
        const dur = turbo ? 100 : Math.min(350, 140 + fallDist * 0.5);
        animations.push(
          tween(dur, (p) => { view.y = startY + fallDist * p; }, easeOutBounce)
            .then(() => { view.y = targetY; })
        );
      }
    }
    if (animations.length > 0) await Promise.all(animations);
  }

  /* ─── CASCADE: gravity-drop survivors + slide new symbols from above ─── */
  async tumbleTo(board: Board, turbo: boolean): Promise<void> {
    this.currentBoard = board;
    const cellStep = this.cellHeight + this.gap;
    const animations: Promise<void>[] = [];

    for (let col = 0; col < GRID_COLUMNS; col++) {
      // Gather surviving symbols in this column (top to bottom order)
      const survivors: SymbolView[] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        const key = keyOf([col, row]);
        const view = this.symbols.get(key);
        if (view) {
          survivors.push(view);
          this.symbols.delete(key);
        }
      }

      const newCount = GRID_ROWS - survivors.length;

      // Survivors fall to the BOTTOM of the column, keeping relative order
      for (let i = 0; i < survivors.length; i++) {
        const view = survivors[i];
        const newRow = newCount + i;
        const targetY = this.cellY(newRow);
        const startY = view.y;

        this.symbols.set(keyOf([col, newRow]), view);

        if (Math.abs(startY - targetY) > 1) {
          const fallDist = targetY - startY;
          const dur = turbo ? 100 : Math.min(380, 140 + fallDist * 0.7);
          animations.push(
            tween(dur, (p) => {
              view.y = startY + fallDist * p;
            }, easeOutBounce).then(() => { view.y = targetY; })
          );
        }
      }

      // New symbols enter from ABOVE the board
      for (let i = 0; i < newCount; i++) {
        const newRow = i;
        const id = board[col][newRow];
        const view = new SymbolView(id);
        view.layout(this.cellWidth, this.cellHeight);

        // Stagger start positions above the board
        const startY = -(newCount - i) * cellStep - this.gap;
        view.position.set(this.cellX(col), startY);
        view.alpha = 0.7;
        this.reelContainer.addChild(view);

        const targetY = this.cellY(newRow);
        const fallDist = targetY - startY;
        const delay = i * (turbo ? 10 : 25);
        const dur = turbo ? 120 : Math.min(420, 160 + fallDist * 0.5);

        animations.push(
          wait(delay).then(() =>
            tween(dur, (p) => {
              view.y = startY + fallDist * p;
              view.alpha = 0.7 + 0.3 * Math.min(1, p * 2);
            }, easeOutBounce)
          ).then(() => { view.y = targetY; view.alpha = 1; })
        );

        this.symbols.set(keyOf([col, newRow]), view);
      }
    }

    await Promise.all(animations);
  }

  async transform(board: Board, positions: Position[], turbo: boolean): Promise<void> {
    this.currentBoard = board;
    // Only rebuild the specific transformed positions
    for (const [col, row] of positions) {
      const key = keyOf([col, row]);
      const old = this.symbols.get(key);
      if (old) { old.destroy({ children: true }); this.symbols.delete(key); }
      const id = board[col][row];
      const view = new SymbolView(id);
      view.layout(this.cellWidth, this.cellHeight);
      view.position.set(this.cellX(col), this.cellY(row));
      this.symbols.set(key, view);
      this.reelContainer.addChild(view);
    }
    this.markPositions(positions, "transform");
    await Promise.all(positions.map((p) => this.symbols.get(keyOf(p))?.winCelebrate(turbo) ?? Promise.resolve()));
    await wait(turbo ? 40 : 150);
  }

  async megaWild(board: Board, positions: Position[], turbo: boolean): Promise<void> {
    this.currentBoard = board;
    for (const [col, row] of positions) {
      const key = keyOf([col, row]);
      const old = this.symbols.get(key);
      if (old) { old.destroy({ children: true }); this.symbols.delete(key); }
      const id = board[col][row];
      const view = new SymbolView(id);
      view.layout(this.cellWidth, this.cellHeight);
      view.position.set(this.cellX(col), this.cellY(row));
      this.symbols.set(key, view);
      this.reelContainer.addChild(view);
    }
    this.markPositions(positions, "alert");
    const views = positions.map((p) => this.symbols.get(keyOf(p))).filter((v): v is SymbolView => Boolean(v));
    await tween(turbo ? 140 : 360, (p) => {
      const s = 1 + Math.sin(p * Math.PI) * 0.2;
      views.forEach((v) => v.scale.set(s));
    });
    views.forEach((v) => v.scale.set(1));
  }

  centerOf(position: Position): { x: number; y: number } {
    const [col, row] = position;
    return {
      x: this.rect.x + this.gap + col * (this.cellWidth + this.gap) + this.cellWidth / 2,
      y: this.rect.y + this.gap + row * (this.cellHeight + this.gap) + this.cellHeight / 2
    };
  }

  /* ─── REEL SPIN — per-column stopping with scatter anticipation ─── */
  private async spinReels(finalBoard: Board, turbo: boolean, scatterCols?: Set<number>): Promise<void> {
    const cellStep = this.cellHeight + this.gap;
    const baseFillerCount = turbo ? 10 : 20;

    // 1. Move old symbols into a throw-away wrapper
    const oldWrapper = new Container();
    for (const [, view] of this.symbols) {
      oldWrapper.addChild(view);
    }
    this.symbols.clear();
    this.reelContainer.addChild(oldWrapper);

    // 2. Calculate per-reel stop delays (scatter anticipation)
    let scattersSeen = 0;
    let anticipation = false;
    const baseStagger = turbo ? 50 : 140;
    const stopDelays: number[] = [];
    let cumDelay = 0;

    for (let col = 0; col < GRID_COLUMNS; col++) {
      if (col > 0) {
        cumDelay += anticipation && !turbo ? 500 : baseStagger;
      }
      stopDelays.push(cumDelay);
      if (scatterCols?.has(col)) {
        scattersSeen++;
        if (scattersSeen >= 2) anticipation = true;
      }
    }

    // 3. Build one strip per column (allows independent stopping)
    interface ReelData {
      strip: Container;
      views: Map<string, SymbolView>;
      scrollDist: number;
    }
    const reels: ReelData[] = [];

    for (let col = 0; col < GRID_COLUMNS; col++) {
      const strip = new Container();
      const views = new Map<string, SymbolView>();

      // Final symbols
      for (let row = 0; row < GRID_ROWS; row++) {
        const id = finalBoard[col][row];
        const view = new SymbolView(id);
        view.layout(this.cellWidth, this.cellHeight);
        view.position.set(this.cellX(col), this.cellY(row));
        strip.addChild(view);
        views.set(keyOf([col, row]), view);
      }

      // Filler — extra rows for reels that need to keep spinning during anticipation
      const extraFiller = Math.ceil(stopDelays[col] / (turbo ? 25 : 55));
      const totalFiller = baseFillerCount + extraFiller;
      const fillerStartY = this.cellY(GRID_ROWS - 1) + this.cellHeight + this.gap;
      for (let i = 0; i < totalFiller; i++) {
        const id = ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)];
        const tile = this.createSpinTile(id);
        tile.position.set(this.cellX(col), fillerStartY + i * cellStep);
        strip.addChild(tile);
      }

      const scrollDist = fillerStartY + totalFiller * cellStep;
      strip.y = -scrollDist;
      this.reelContainer.addChild(strip);
      reels.push({ strip, views, scrollDist });
    }

    // 4. Shared spin phase — all reels move together
    const minScroll = Math.min(...reels.map((r) => r.scrollDist));
    const sharedTravel = minScroll * 0.80;
    const spinDuration = turbo ? 400 : 1000;

    // Accelerate (15%)
    await tween(spinDuration * 0.15, (p) => {
      const d = sharedTravel * 0.08 * p;
      oldWrapper.y = d;
      for (const r of reels) r.strip.y = -r.scrollDist + d;
    }, easeInCubic);

    // Constant speed (55%)
    const afterAccel = sharedTravel * 0.08;
    const constTravel = sharedTravel * 0.72;
    await tween(spinDuration * 0.55, (p) => {
      const d = afterAccel + constTravel * p;
      oldWrapper.y = d;
      for (const r of reels) r.strip.y = -r.scrollDist + d;
    }, linear);

    // Old wrapper off-screen, destroy it
    oldWrapper.destroy({ children: true });

    // 5. Per-reel deceleration — each column stops independently
    const sharedDist = afterAccel + constTravel;
    const reelPromises: Promise<void>[] = [];

    for (let col = 0; col < GRID_COLUMNS; col++) {
      const reel = reels[col];
      const currentY = -reel.scrollDist + sharedDist;
      const remaining = 0 - currentY;
      const delay = stopDelays[col];
      const decelDur = turbo ? 120 : 280;

      reelPromises.push((async () => {
        if (delay > 0) {
          // Crawl at reduced speed during stagger/anticipation wait
          const crawlDist = remaining * 0.5;
          await tween(delay, (p) => {
            reel.strip.y = currentY + crawlDist * p;
          }, linear);
          // Final deceleration with overshoot snap
          const postY = currentY + crawlDist;
          const finalDist = 0 - postY;
          await tween(decelDur, (p) => {
            reel.strip.y = postY + finalDist * p;
          }, easeOutBack);
        } else {
          // First reel — just decelerate straight to position
          await tween(decelDur, (p) => {
            reel.strip.y = currentY + remaining * p;
          }, easeOutBack);
        }
        reel.strip.y = 0;
      })());
    }

    await Promise.all(reelPromises);

    // 6. Re-parent final symbols + bounce landing
    const landAnimations: Promise<void>[] = [];
    for (const reel of reels) {
      for (const [key, view] of reel.views) {
        this.reelContainer.addChild(view);
        this.symbols.set(key, view);
        const baseY = view.y;
        landAnimations.push(
          tween(turbo ? 60 : 140, (p) => {
            const bounce = Math.sin(p * Math.PI) * 4 * (1 - p);
            view.y = baseY + bounce;
            view.scale.set(1 + Math.sin(p * Math.PI) * 0.03 * (1 - p));
          }).then(() => { view.y = baseY; view.scale.set(1); })
        );
      }
      reel.strip.destroy({ children: false });
    }
    await Promise.all(landAnimations);
  }

  private createSpinTile(id: SymbolId): Container {
    const c = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, this.cellWidth, this.cellHeight, 10)
      .fill({ color: 0x0a0e1e, alpha: 0.6 });
    c.addChild(g);

    const tex = getSymbolTexture(id);
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const padding = 6;
      const scale = Math.min(
        (this.cellWidth - padding * 2) / tex.width,
        (this.cellHeight - padding * 2) / tex.height
      );
      sprite.scale.set(scale);
      sprite.position.set(this.cellWidth / 2, this.cellHeight / 2);
      c.addChild(sprite);
    }

    return c;
  }

  private startAmbient(): void {
    this.stopAmbient();
    for (const s of this.symbols.values()) s.startIdleShimmer();
    this.ambientCb = (_dt, elapsed) => {
      const pulse = 0.3 + Math.sin(elapsed * 2.2) * 0.08;
      this.background.alpha = 0.92 + pulse * 0.08;
    };
    ambientTicker.add(this.ambientCb);
  }

  private stopAmbient(): void {
    for (const s of this.symbols.values()) s.stopIdleShimmer();
    if (this.ambientCb) { ambientTicker.remove(this.ambientCb); this.ambientCb = null; }
    this.background.alpha = 1;
  }

  private rebuildSymbols(board: Board): void {
    this.symbols.forEach((s) => s.destroy({ children: true }));
    this.symbols.clear();
    for (let col = 0; col < GRID_COLUMNS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const id = board[col][row];
        const view = new SymbolView(id);
        view.layout(this.cellWidth, this.cellHeight);
        view.position.set(this.cellX(col), this.cellY(row));
        this.symbols.set(keyOf([col, row]), view);
        this.reelContainer.addChild(view);
      }
    }
  }

  private layoutSymbols(): void {
    for (const [key, view] of this.symbols) {
      const [col, row] = key.split(":").map(Number);
      view.layout(this.cellWidth, this.cellHeight);
      view.position.set(this.cellX(col), this.cellY(row));
    }
  }

  private drawBackground(): void {
    const w = this.rect.width;
    const h = this.rect.height;
    this.background.clear();
    this.background.roundRect(0, 0, w, h, 6).fill(0x0a0a1a);

    const colW = w / GRID_COLUMNS;
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const x = col * colW;
      const shade = col % 2 === 0 ? 0x0e0e22 : 0x0a0a1a;
      this.background.rect(x, 0, colW, h).fill({ color: shade, alpha: 0.5 });
    }

    for (let col = 1; col < GRID_COLUMNS; col++) {
      const x = col * colW;
      this.background.rect(x - 1.5, 4, 3, h - 8).fill({ color: 0x48e5ff, alpha: 0.06 });
      this.background.rect(x - 0.5, 4, 1, h - 8).fill({ color: 0x48e5ff, alpha: 0.12 });
    }

    this.background.rect(0, 0, w, 30).fill({ color: 0xffffff, alpha: 0.03 });
    this.background.rect(0, 0, w, 8).fill({ color: 0xffffff, alpha: 0.02 });
    this.background.rect(0, h - 20, w, 20).fill({ color: 0x000000, alpha: 0.15 });
    this.background.roundRect(0, 0, w, h, 6).stroke({ color: 0x48e5ff, alpha: 0.15, width: 1 });
  }

  private drawMask(): void {
    this.reelMask.clear();
    this.reelMask.rect(0, 0, this.rect.width, this.rect.height).fill(0xffffff);
  }

  private drawGlassOverlay(): void {
    const w = this.rect.width;
    const h = this.rect.height;
    this.glassOverlay.clear();
    this.glassOverlay.rect(0, 0, w, 18).fill({ color: 0x000000, alpha: 0.25 });
    this.glassOverlay.rect(0, 0, w, 6).fill({ color: 0x000000, alpha: 0.15 });
    this.glassOverlay.rect(0, h - 18, w, 18).fill({ color: 0x000000, alpha: 0.25 });
    this.glassOverlay.rect(0, h - 6, w, 6).fill({ color: 0x000000, alpha: 0.15 });
    this.glassOverlay.rect(0, 0, w, 3).fill({ color: 0xffffff, alpha: 0.06 });
  }

  private markPositions(positions: Position[], mode: "highlight" | "transform" | "alert"): void {
    const active = new Set(positions.map(keyOf));
    for (const [key, view] of this.symbols) {
      view.redraw(mode === "highlight" && active.has(key), mode === "transform" && active.has(key), mode === "alert" && active.has(key));
    }
  }

  private cellX(col: number): number { return this.gap + col * (this.cellWidth + this.gap); }
  private cellY(row: number): number { return this.gap + row * (this.cellHeight + this.gap); }
}

export function keyOf([col, row]: Position): string { return `${col}:${row}`; }
