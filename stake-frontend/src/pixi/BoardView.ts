import { Container, Graphics, Sprite, Text, TextStyle, BlurFilter, Texture } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type Position, type SymbolId } from "../domain";
import { getSymbolTexture } from "./assets";
import { SymbolView } from "./SymbolView";
import { tween, wait, easeOutBounce, easeOutBack, linear, ambientTicker } from "./tween";
import type { Rect } from "./types";

function slamBounce(r: number): number {
  if (r <= 0) return 0;
  if (r >= 1) return 1;
  if (r < 0.3) {
    const i = r / 0.3;
    return 1 - Math.pow(1 - i, 3);
  }
  const t = (r - 0.3) / 0.7;
  const decay = Math.pow(1 - t, 2);
  return 1 + 0.14 * Math.sin(t * Math.PI * 2.5) * decay;
}

let softGlowTexture: Texture | null = null;
function getSoftGlowTexture(): Texture {
  if (softGlowTexture) return softGlowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  softGlowTexture = Texture.from(canvas);
  return softGlowTexture;
}

/** Symbols that may appear as spinning filler. All have loaded textures, so a
 *  reel cell is never blank. Special symbols (wild/scatter/safe/key) only ever
 *  arrive as final results, never as random filler. */
const ALL_SYMBOLS: SymbolId[] = ["BRASS", "KNIFE", "PISTOL", "AMMO", "DUFFEL", "CASH", "DIAMOND", "BIKE"];

function randomSymbol(): SymbolId {
  return ALL_SYMBOLS[(Math.random() * ALL_SYMBOLS.length) | 0]!;
}

/** One lightweight scrolling reel cell — a single re-textured sprite. */
interface ReelCell {
  container: Container;
  sprite: Sprite | null;
  y: number;
}

/** Per-column reel state for the treadmill spin. */
interface Reel {
  col: number;
  container: Container;
  filter: BlurFilter;
  cells: ReelCell[];
  scroll: number;       // cumulative downward travel (px)
  wrapCount: number;    // number of cells recycled to the top so far
  feed: Map<number, SymbolId>; // wrapIndex → forced symbol (used to land finals)
  state: "spin" | "decel" | "stopped";
}

export class BoardView extends Container {
  private readonly background = new Graphics();
  private readonly counterText: Text;
  private readonly reelMask = new Graphics();
  private readonly reelContainer = new Container();
  private readonly glassOverlay = new Graphics();
  private readonly symbols = new Map<string, SymbolView>();
  private readonly anticipationOverlay = new Graphics();
  private rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
  private cellWidth = 0;
  private cellHeight = 0;
  private gap = 4;
  private currentBoard: Board | null = null;
  private ambientCb: ((dt: number, elapsed: number) => void) | null = null;
  private anticipationMissFired = false; // per-spin latch for the near-miss cue
  private onReelStop?: (col: number, total: number) => void;
  private onReelImpact?: (col: number, total: number) => void;
  private onAnticipation?: () => void;
  private onTransform?: () => void;
  /** Fired once per spin when a scatter anticipation column stops WITHOUT the
   *  scatter — drives the "near miss" negative cue. */
  private onAnticipationMiss?: () => void;

  /** Wire audio cues fired during the reel spin (reel stops, anticipation riser, symbol transforms). */
  setAudioHooks(hooks: { onReelStop?: (col: number, total: number) => void; onReelImpact?: (col: number, total: number) => void; onAnticipation?: () => void; onTransform?: () => void; onAnticipationMiss?: () => void }): void {
    this.onReelStop = hooks.onReelStop;
    this.onReelImpact = hooks.onReelImpact;
    this.onAnticipation = hooks.onAnticipation;
    this.onTransform = hooks.onTransform;
    this.onAnticipationMiss = hooks.onAnticipationMiss;
  }

  constructor() {
    super();
    this.addChild(this.background, this.reelContainer, this.anticipationOverlay);
    this.reelContainer.mask = this.reelMask;
    this.addChild(this.reelMask);
    this.addChild(this.glassOverlay);

    this.counterText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffdf65, // Gold
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: 1.5,
        align: "right",
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 4, distance: 0 }
      })
    });
    this.counterText.anchor.set(1, 0.5);
    this.addChild(this.counterText);
  }

  layout(rect: Rect): void {
    this.rect = rect;
    this.position.set(rect.x, rect.y);
    this.cellWidth = (rect.width - this.gap * (GRID_COLUMNS + 1)) / GRID_COLUMNS;
    this.cellHeight = (rect.height - this.gap * (GRID_ROWS + 1)) / GRID_ROWS;

    this.counterText.position.set(rect.width - 10, -20);

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
    try {
      await this.spinReels(board, turbo, scatterCols);
    } catch (err) {
      // If the spin animation fails mid-flight (e.g. WebGL context loss),
      // this.symbols was cleared but never repopulated → grid appears blank.
      // Rebuild instantly so the player always sees a valid board.
      console.error("[BoardView] spinReels failed — falling back to instant settle:", err);
      this.rebuildSymbols(board);
    }
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
    // Per request: NO per-symbol zoom/punch and NO per-scatter audio. The tease
    // is carried entirely by the on-screen banner (shown by the caller). We just
    // give the scatters a static alert highlight so they're clearly flagged.
    this.markPositions(positions, "alert");
    await wait(turbo ? 40 : 150);
  }

  /* ─── CLEAR WINS: flash + vanish winning symbols, leaving gaps behind ─── */
  // Used by the real cascade (tumble_remove): the holes are filled afterwards by
  // tumbleTo() using the authoritative RGS board, so we must NOT refill here.
  async clearWins(positions: Position[], turbo: boolean): Promise<void> {
    this.markPositions(positions, "highlight");
    await Promise.all(
      positions.map((p) => this.symbols.get(keyOf(p))?.vanish(turbo) ?? Promise.resolve())
    );
    for (const p of positions) {
      const v = this.symbols.get(keyOf(p));
      if (v) { v.destroy({ children: true }); this.symbols.delete(keyOf(p)); }
    }
  }

  /* ─── REMOVE: clear winning symbols, then gravity-refill with random ─── */
  // Self-contained (clear + refill). Used by the debug feature tester only.
  async remove(positions: Position[], turbo: boolean): Promise<void> {
    await this.clearWins(positions, turbo);
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
    // Swap ONLY existing symbols. Holes from a prior tumble_remove stay empty.

    // Sort in diagonal wave order so the morph sweeps top-left → bottom-right.
    const byWave = [...positions].sort(([c1, r1], [c2, r2]) => (c1 + r1) - (c2 + r2));

    // Phase 1 — staggered shrink-out: each old symbol pulses then spins away.
    const outAnims = byWave.map(([col, row], i) => {
      const view = this.symbols.get(keyOf([col, row]));
      if (!view) return Promise.resolve();
      return wait(i * (turbo ? 20 : 45)).then(() =>
        tween(turbo ? 80 : 200, (p) => {
          const s = p < 0.25
            ? 1 + (p / 0.25) * 0.22          // punch up to 1.22×
            : 1.22 * (1 - (p - 0.25) / 0.75); // then shrink to 0
          view.scale.set(Math.max(0, s));
          view.alpha = p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7;
          view.rotation = p * 0.5;
        }, linear)
      ).then(() => { view.scale.set(0); view.alpha = 0; view.rotation = 0; });
    });
    await Promise.all(outAnims);

    // Destroy old views, spawn new ones at scale=0, alpha=0 (invisible so far).
    const transformed: Position[] = [];
    for (const [col, row] of positions) {
      const key = keyOf([col, row]);
      const old = this.symbols.get(key);
      if (!old) continue;
      old.destroy({ children: true });
      this.symbols.delete(key);
      const id = board[col][row];
      const newView = new SymbolView(id);
      newView.layout(this.cellWidth, this.cellHeight);
      newView.position.set(this.cellX(col), this.cellY(row));
      newView.alpha = 0;
      newView.scale.set(0);
      this.symbols.set(key, newView);
      this.reelContainer.addChild(newView);
      transformed.push([col, row]);
    }
    if (transformed.length === 0) return;

    this.onTransform?.();

    // Golden flash burst that blankets the affected cells and fades out while the
    // new symbols pop in — this is the "reveal" moment, not a glitch.
    if (!turbo) {
      const burst = new Graphics();
      for (const [col, row] of transformed) {
        const cx = this.cellX(col) + this.cellWidth / 2;
        const cy = this.cellY(row) + this.cellHeight / 2;
        burst.circle(cx, cy, this.cellWidth * 0.65).fill({ color: 0xffd700, alpha: 0.45 });
        burst.circle(cx, cy, this.cellWidth * 0.32).fill({ color: 0xffffff, alpha: 0.55 });
      }
      burst.alpha = 0;
      this.addChild(burst);
      tween(340, (p) => {
        burst.alpha = p < 0.12 ? p / 0.12 : (1 - p) / 0.88;
      }, linear).then(() => burst.destroy());
    }

    // Phase 2 — staggered pop-in of new symbols with an easeOutBack bounce.
    const sortedIn = [...transformed].sort(([c1, r1], [c2, r2]) => (c1 + r1) - (c2 + r2));
    const inAnims = sortedIn.map(([col, row], i) => {
      const view = this.symbols.get(keyOf([col, row]));
      if (!view) return Promise.resolve();
      return wait(i * (turbo ? 20 : 55)).then(() =>
        tween(turbo ? 100 : 240, (p) => {
          view.alpha = Math.min(1, p * 4);
          view.scale.set(Math.max(0, easeOutBack(p)));
        }, linear)
      ).then(() => { view.alpha = 1; view.scale.set(1); });
    });
    await Promise.all(inAnims);

    // Brief green-border highlight so the player sees what changed.
    this.markPositions(transformed, "transform");
    await wait(turbo ? 60 : 280);
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

  /* ─── REEL SPIN — continuous treadmill reel, per-column staggered stop ───
   *
   * Each column is a vertical "treadmill" of lightweight cells that scroll
   * downward continuously. A cell that drops past the bottom is recycled to the
   * top with a fresh symbol, so a column is NEVER blank and NEVER static. To
   * land the result, the final symbols are fed into the recycle stream at the
   * exact wrap indices that place them in rows 0..3 when the reel comes to rest
   * grid-aligned. Pure position math — no filters, no precomputed mega-strip.
   */
  private async spinReels(finalBoard: Board, turbo: boolean, scatterCols?: Set<number>): Promise<void> {
    console.log("[BoardView] spinReels starting. finalBoard:", JSON.stringify(finalBoard));
    const cellStep = this.cellHeight + this.gap;

    // Reel geometry. A couple of cells live above the viewport (feed-in buffer)
    // and one below (clean exit). N cells fully tile the column at all times.
    const ABOVE = 2;
    const BELOW = 1;
    const VISIBLE = GRID_ROWS;
    const N = ABOVE + VISIBLE + BELOW;
    const topY = this.cellY(0) - ABOVE * cellStep;
    const wrapSpan = N * cellStep;
    const STOP_STEPS = ABOVE + 4;                 // cells of travel during decel

    // Tuning. Deceleration time is derived so the reel slows out of full speed
    // smoothly (no velocity jump at the spin→stop handoff).
    const velCells = turbo ? 30 : 24;             // full speed, in cells/second
    const Vmax = cellStep * velCells;             // px/s
    const accelTime = turbo ? 70 : 150;           // ms ramp-up to full speed
    const hold = turbo ? 120 : 320;               // ms at full speed before first stop
    const baseStagger = turbo ? 70 : 130;         // ms between column stops
    const decelDur = (2000 * STOP_STEPS) / velCells; // ms (easeOutQuad, starts ≈Vmax)

    // ── 1. Snapshot the on-screen board so it scrolls away seamlessly. ──
    const oldIds: (SymbolId | null)[][] = [];
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const colIds: (SymbolId | null)[] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        colIds.push(this.symbols.get(keyOf([col, row]))?.id ?? null);
      }
      oldIds.push(colIds);
    }

    // Tear the old board down and empty the container completely.
    this.symbols.forEach((v) => v.destroy({ children: true }));
    this.symbols.clear();
    for (const child of [...this.reelContainer.children]) {
      this.reelContainer.removeChild(child);
      child.destroy({ children: true });
    }

    // ── 2. Per-reel stop offsets (scatter anticipation slows trailing reels). ──
    let scattersSeen = 0;
    const isAnticipationCol = new Array(GRID_COLUMNS).fill(false);
    const stagger: number[] = [];
    let cum = 0;
    for (let col = 0; col < GRID_COLUMNS; col++) {
      if (col > 0) {
        if (scattersSeen === 2 && (col === 3 || col === 4) && !turbo) {
          isAnticipationCol[col] = true;
          // Spin much longer: add 1800ms stagger!
          cum += 1800;
        } else {
          cum += baseStagger;
        }
      }
      stagger.push(cum);
      
      let hasScatter = false;
      for (let row = 0; row < GRID_ROWS; row++) {
        if (finalBoard[col][row] === "PHONE_SCATTER") {
          hasScatter = true;
          break;
        }
      }
      if (hasScatter) {
        scattersSeen++;
      }
    }
    const hasAnticipation = isAnticipationCol.some(x => x);
    if (hasAnticipation && !turbo) this.onAnticipation?.();
    // Reset the per-spin near-miss latch so the negative cue fires at most once.
    this.anticipationMissFired = false;

    // ── 3. Build the reels. The visible rows start showing the OLD symbols so
    //       the transition into the spin has no pop. ──
    const reels: Reel[] = [];
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const cells: ReelCell[] = [];
      const reelContainer = new Container();
      const filter = new BlurFilter();
      filter.blurX = 0;
      filter.blurY = 10;
      filter.quality = 3;
      reelContainer.filters = [filter];
      this.reelContainer.addChild(reelContainer);
      for (let k = 0; k < N; k++) {
        const container = new Container();
        container.x = this.cellX(col);
        const cell: ReelCell = { container, sprite: null, y: topY + k * cellStep };
        const row = k - ABOVE;
        const initId = row >= 0 && row < VISIBLE && oldIds[col]![row] ? oldIds[col]![row]! : randomSymbol();
        this.paintCell(cell, initId);
        container.y = cell.y;
        reelContainer.addChild(container);
        cells.push(cell);
      }
      reels.push({ col, container: reelContainer, filter, cells, scroll: 0, wrapCount: 0, feed: new Map(), state: "spin" });
    }

    // ── 4. Each reel decelerates onto its result when its stop time arrives. ──
    const decelPromises: Promise<void>[] = [];
    const stopDurMs = 567; // ~34 frames at 60fps
    
    const startDecel = (reel: Reel) => {
      reel.state = "decel";
      
      // Snap target symbols and buffers to the grid
      for (let k = 0; k < N; k++) {
        const cell = reel.cells[k]!;
        const row = k - ABOVE;
        const id = (row >= 0 && row < VISIBLE && finalBoard[reel.col]) 
          ? finalBoard[reel.col]![row]! 
          : randomSymbol();
        this.paintCell(cell, id);
        cell.y = topY + k * cellStep;
        cell.container.y = cell.y;
      }
      
      const startOffset = -1.18 * this.cellHeight;
      let impactFired = false;
      // Live symbols take over from the blurred strip partway through the slam.
      let landed: { view: SymbolView; baseY: number }[] | null = null;

      decelPromises.push(
        tween(stopDurMs, (p) => {
          if (p < 0.22) {
            reel.filter.blurY = 10;
          } else if (p <= 0.34) {
            reel.filter.blurY = 10 * (1 - (p - 0.22) / 0.12);
          } else {
            reel.filter.blurY = 0;
          }

          const sb = slamBounce(p);

          if (!impactFired && sb >= 1.03) {
            impactFired = true;
            this.triggerColumnStopEffect(reel.col);
            this.onReelImpact?.(reel.col, GRID_COLUMNS);
          }

          const offset = startOffset * (1 - sb);

          // Swap to real SymbolViews the moment the blur reaches 0 — NOT at the
          // end of the tween. Past this point the strip is only doing the bounce
          // overshoot (slamBounce(0.34) puts it within ~6% of a cell of final),
          // so the swap is invisible, and it buys the last ~370ms of the slam at
          // full sharpness with the skeletal idle already running. Leaving it to
          // the end meant every column spent that whole window soft and static:
          // the filter stays attached at blur 0, and in Pixi v8 a non-empty
          // filters array keeps resampling the container through a render texture.
          if (!landed && p > 0.34) {
            landed = this.handOffColumn(reel, finalBoard);
          }
          if (landed) {
            for (const { view, baseY } of landed) view.y = baseY + offset;
          } else {
            for (let k = 0; k < N; k++) {
              const cell = reel.cells[k]!;
              cell.container.y = cell.y + offset;
            }
          }
        }, linear).then(() => {
          reel.state = "stopped";
          // Normally the swap already happened at p>0.34; this covers a tween
          // that jumped straight to completion (tab throttling, timeScale).
          landed = landed ?? this.handOffColumn(reel, finalBoard);
          for (const { view, baseY } of landed) view.y = baseY;
          this.onReelStop?.(reel.col, GRID_COLUMNS);
          
          // Trigger a red flash if this column was an anticipation column and missed the scatter
          if (isAnticipationCol[reel.col]) {
            let landedScatter = false;
            for (let row = 0; row < GRID_ROWS; row++) {
              if (finalBoard[reel.col][row] === "PHONE_SCATTER") {
                landedScatter = true;
                break;
              }
            }
            if (!landedScatter) {
              this.triggerRedFlash();
              // The anticipation reel stopped short of the scatter — play the
              // negative "near miss" cue, once per spin, synced to the flash.
              if (!this.anticipationMissFired) {
                this.anticipationMissFired = true;
                this.onAnticipationMiss?.();
              }
            }
          }
        })
      );
    };

    // ── 5. Master loop: ramp up and scroll every free reel until it stops. ──
    // The frame body is guarded: a stray error must never leave the loop hung
    // (which would freeze the reels mid-scroll) — we bail to the handoff below,
    // which always lands the correct final board.
    await new Promise<void>((resolve) => {
      let last = performance.now();
      const start = last;
      const frame = (now: number) => {
        try {
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const elapsed = now - start;
          const ramp = Math.min(1, elapsed / accelTime);
          const vel = Vmax * ramp * ramp; // easeIn ramp-up
          // Clear anticipation overlay drawing
          this.anticipationOverlay.clear();
          
          for (const reel of reels) {
            if (reel.state !== "spin") continue;
            this.advanceReel(reel, vel * dt, cellStep, wrapSpan);
            
            // Draw pulsing red border if column is currently in anticipation spin
            if (isAnticipationCol[reel.col] && elapsed >= accelTime + hold + stagger[reel.col - 1]!) {
              const rx = this.cellX(reel.col) - 2;
              const ry = 2;
              const rw = this.cellWidth + 4;
              const rh = this.rect.height - 4;
              const pulse = 0.5 + Math.sin(performance.now() * 0.015) * 0.4;
              this.anticipationOverlay.roundRect(rx, ry, rw, rh, 6)
                .stroke({ color: 0xff1f2e, width: 3, alpha: 0.8 * pulse })
                .fill({ color: 0xff1f2e, alpha: 0.08 * pulse });
            }
            
            if (elapsed >= accelTime + hold + stagger[reel.col]!) startDecel(reel);
          }
          if (reels.some((r) => r.state === "spin")) requestAnimationFrame(frame);
          else resolve();
        } catch (err) {
          console.error("[BoardView] spin frame error — landing immediately:", err);
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });

    // Tolerate a rejected decel (never blocks the handoff that lands the board).
    await Promise.allSettled(decelPromises);

    // ── 6. Safety net: a decel that threw before handing its column off would
    //       leave that column as a dead strip, so land anything still missing. ──
    for (const reel of reels) {
      if (!reel.container.destroyed) {
        for (const { view, baseY } of this.handOffColumn(reel, finalBoard)) view.y = baseY;
      }
    }
  }

  /**
   * Swap one reel column from spinning strip cells to real SymbolViews
   * (same art, same spot → invisible swap) and tear the strip down.
   *
   * Called mid-slam, as soon as the motion blur reaches 0, so the column
   * finishes its bounce already sharp and already animating. The caller keeps
   * driving the returned views with the remaining slam offset — there is
   * deliberately no second landing tween here, since bouncing the views again
   * on top of the slam is exactly what made the stop feel unpolished.
   *
   * Dropping `filters` is what restores image quality: in Pixi v8 a container
   * with a non-empty `filters` array is rendered through a render texture on
   * EVERY frame, even at blur 0 — that resample is what made symbols look soft
   * and "compressed". It must be null, never [], because an empty array still
   * routes through the filter pipeline.
   */
  private handOffColumn(reel: Reel, finalBoard: Board): { view: SymbolView; baseY: number }[] {
    if (reel.container.destroyed) return [];
    reel.filter.blurY = 0;
    reel.container.filters = null;

    const views: { view: SymbolView; baseY: number }[] = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      const id = finalBoard[reel.col]?.[row];
      if (!id) continue;
      const key = keyOf([reel.col, row]);
      this.symbols.get(key)?.destroy({ children: true }); // never leak on a re-hand-off
      const view = new SymbolView(id);
      view.layout(this.cellWidth, this.cellHeight);
      view.position.set(this.cellX(reel.col), this.cellY(row));
      this.symbols.set(key, view);
      this.reelContainer.addChild(view);
      views.push({ view, baseY: view.y });
    }
    for (const cell of reel.cells) cell.container.destroy({ children: true });
    reel.container.destroy({ children: true });
    return views;
  }

  /** Advance a reel downward by `dy`, recycling cells past the bottom to the top
   *  and pulling forced (final) symbols from the feed map as each wrap occurs. */
  private advanceReel(reel: Reel, dy: number, cellStep: number, wrapSpan: number): void {
    if (dy === 0) return;
    reel.scroll += dy;
    for (const cell of reel.cells) cell.y += dy;
    // Cells move together and stay grid-aligned, so exactly one cell crosses the
    // wrap line per cellStep of travel — recycle the lowest cell each time.
    const targetWraps = Math.floor(reel.scroll / cellStep);
    while (reel.wrapCount < targetWraps) {
      reel.wrapCount++;
      let lowest = reel.cells[0]!;
      for (const c of reel.cells) if (c.y > lowest.y) lowest = c;
      lowest.y -= wrapSpan;
      this.paintCell(lowest, reel.feed.get(reel.wrapCount) ?? randomSymbol());
    }
    for (const cell of reel.cells) cell.container.y = cell.y;
  }

  /** Show `id` in a reel cell, scaling its (re-used) sprite to fill the cell.
   *  A missing/invalid id is coerced to a valid one so a cell is never blank. */
  private paintCell(cell: ReelCell, id: SymbolId): void {
    let tex = getSymbolTexture(id);
    if (!tex) tex = getSymbolTexture(randomSymbol());
    if (tex && tex.width > 0 && tex.height > 0) {
      if (!cell.sprite) {
        cell.sprite = new Sprite();
        cell.sprite.anchor.set(0.5);
        cell.container.addChild(cell.sprite);
      }
      cell.sprite.texture = tex;
      cell.sprite.visible = true;
      const padding = 6;
      const scale = Math.min(
        (this.cellWidth - padding * 2) / tex.width,
        (this.cellHeight - padding * 2) / tex.height
      );
      if (isFinite(scale) && scale > 0) {
        cell.sprite.scale.set(scale);
        cell.sprite.position.set(this.cellWidth / 2, this.cellHeight / 2);
      }
    } else if (cell.sprite) {
      cell.sprite.visible = false;
    }
  }



  private startAmbient(): void {
    this.stopAmbient();
    for (const s of this.symbols.values()) s.startIdleShimmer();
    // No background alpha pulse — grid background is transparent
  }

  private stopAmbient(): void {
    for (const s of this.symbols.values()) s.stopIdleShimmer();
    if (this.ambientCb) { ambientTicker.remove(this.ambientCb); this.ambientCb = null; }
  }

  private rebuildSymbols(board: Board): void {
    this.symbols.forEach((s) => s.destroy({ children: true }));
    this.symbols.clear();
    this.reelContainer.removeChildren(); // Guarantee a completely empty container before rebuilding
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

  updateCollectionCounter(count: number): void {
    this.counterText.text = `[${count}/8]`;
  }

  getSymbolView(pos: Position): SymbolView | null {
    return this.symbols.get(keyOf(pos)) ?? null;
  }

  private drawBackground(): void {
    const w = this.rect.width;
    const h = this.rect.height;
    this.background.clear();

    // Subtle dark-blue semi-transparent base — lets the bg image show through
    // while giving the reel area visual depth and contrast.
    const colW = w / GRID_COLUMNS;
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const x = col * colW;
      const shade = col % 2 === 0 ? 0x000000 : 0x000000;
      this.background.rect(x, 0, colW, h).fill({ color: shade, alpha: 0.52 });
    }

    // Thin neon column separators
    for (let col = 1; col < GRID_COLUMNS; col++) {
      const x = col * colW;
      this.background.rect(x - 1, 4, 1, h - 8).fill({ color: 0x9ae64e, alpha: 0.14 });
    }

    // Vignette top/bottom edges
    this.background.rect(0, 0, w, 6).fill({ color: 0x000000, alpha: 0.3 });
    this.background.rect(0, h - 6, w, 6).fill({ color: 0x000000, alpha: 0.3 });
  }

  private drawMask(): void {
    this.reelMask.clear();
    this.reelMask.rect(0, 0, this.rect.width, this.rect.height).fill(0xffffff);
  }

  private drawGlassOverlay(): void {
    // Transparent reel grid — no glass overlay needed
    this.glassOverlay.clear();
  }

  private markPositions(positions: Position[], mode: "highlight" | "transform" | "alert"): void {
    const active = new Set(positions.map(keyOf));
    for (const [key, view] of this.symbols) {
      view.redraw(mode === "highlight" && active.has(key), mode === "transform" && active.has(key), mode === "alert" && active.has(key));
    }
  }

  private cellX(col: number): number { return this.gap + col * (this.cellWidth + this.gap); }
  private cellY(row: number): number { return this.gap + row * (this.cellHeight + this.gap); }

  async localShake(intensity = 18, duration = 400): Promise<void> {
    const origX = this.x;
    const origY = this.y;
    await tween(duration, (p) => {
      const decay = Math.exp(-p * 4.5);
      const dx = Math.sin(p * Math.PI * 5) * intensity * decay;
      const dy = Math.cos(p * Math.PI * 4) * intensity * decay * 0.8;
      this.x = origX + dx;
      this.y = origY + dy;
    }, linear);
    this.x = origX;
    this.y = origY;
  }

  private triggerRedFlash(): void {
    this.anticipationOverlay.clear();
    this.anticipationOverlay.rect(0, 0, this.rect.width, this.rect.height)
      .fill({ color: 0xff1f2e, alpha: 0.35 });
    
    void tween(280, (p) => {
      this.anticipationOverlay.alpha = 1 - p;
    }, linear).then(() => {
      this.anticipationOverlay.clear();
      this.anticipationOverlay.alpha = 1;
    });
  }

  private triggerColumnStopEffect(col: number): void {
    const cx = this.cellX(col);
    const cw = this.cellWidth;
    const ch = this.cellHeight;
    const bottomY = this.rect.height;

    // Layer A - flash bar
    const flashBar = new Graphics();
    flashBar.blendMode = "add";
    flashBar.rect(cx + 6, bottomY - 8, cw - 12, 8).fill({ color: 0xffd84d, alpha: 0.85 });
    flashBar.rect(cx + 12, bottomY - 4, cw - 24, 4).fill({ color: 0xffffff, alpha: 0.45 });
    this.addChild(flashBar);

    void tween(180, (p) => {
      const ease = 1 - Math.pow(1 - p, 2); // easeOutQuad
      flashBar.alpha = 1 - ease;
    }, linear).then(() => flashBar.destroy());

    // Layer B - spark burst
    const sparkCount = 8 + col * 3;
    const sparks = new Container();
    this.addChild(sparks);
    
    interface Spark { sprite: Graphics; vx: number; vy: number; }
    const sparkList: Spark[] = [];
    for (let i = 0; i < sparkCount; i++) {
      const sp = new Graphics();
      sp.blendMode = "add";
      
      let isHot = Math.random() < 0.35;
      let r = 0;
      if (isHot) {
        r = 1.5 + Math.random() * 2;
        sp.circle(0, 0, r).fill({ color: 0xffffff, alpha: 1 });
      } else {
        r = 2 + Math.random() * 3.5;
        const color = Math.random() < 0.5 ? 0xffd84d : 0xffaa33;
        sp.circle(0, 0, r).fill({ color, alpha: 1 });
      }
      
      sp.x = cx + 8 + Math.random() * (cw - 16);
      sp.y = bottomY;
      
      sparks.addChild(sp);
      sparkList.push({
        sprite: sp,
        vx: (Math.random() - 0.5) * 7,
        vy: -(3 + Math.random() * 7)
      });
    }
    
    let sparkTimer = 0;
    const tick = () => {
      sparkTimer++;
      let active = false;
      for (const sp of sparkList) {
        if (sp.sprite.alpha < 0.04) continue;
        active = true;
        sp.sprite.x += sp.vx;
        sp.sprite.y += sp.vy;
        sp.vx *= 0.92;
        sp.vy += 0.45;
        sp.sprite.alpha *= 0.91;
        sp.sprite.scale.set(sp.sprite.scale.x * 0.97);
      }
      if (active && sparkTimer < 32) {
        requestAnimationFrame(tick);
      } else {
        sparks.destroy({ children: true });
      }
    };
    requestAnimationFrame(tick);

    // Layer C - soft glow bloom
    const glow = new Sprite(getSoftGlowTexture());
    glow.blendMode = "add";
    glow.tint = 0xffd84d;
    glow.anchor.set(0.5, 0.5);
    glow.alpha = 0.55;
    glow.x = cx + cw / 2;
    glow.y = bottomY;
    
    const startW = cw * 1.6;
    const startH = ch * 0.7;
    const endW = cw * 2.2;
    const endH = ch * 1.0;
    glow.width = startW;
    glow.height = startH;
    
    this.addChild(glow);
    void tween(250, (p) => {
      const ease = 1 - Math.pow(1 - p, 2); // easeOutQuad
      glow.alpha = 0.55 * (1 - ease);
      glow.width = startW + (endW - startW) * ease;
      glow.height = startH + (endH - startH) * ease;
    }, linear).then(() => glow.destroy());
  }
}

export function keyOf([col, row]: Position): string { return `${col}:${row}`; }
