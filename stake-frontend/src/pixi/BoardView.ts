import { Container, FillGradient, Graphics, Sprite, Text, TextStyle, BlurFilter } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type Position, type SymbolId } from "../domain";
import { getSymbolTexture } from "./assets";
import { SymbolView, WIN_ACCENT, DEFAULT_ACCENT } from "./SymbolView";
import { tween, wait, easeOutBack, easeOutCubic, easeInCubic, linear, ambientTicker, simulate } from "./tween";
import { softGlowTexture, streakTexture } from "./fxTextures";
import { planColumn, gravityEase, TUMBLE_TIMING, type FallSpec } from "./tumblePlan";
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
  /** Unmasked layer above the reels for bursts that may spill past the frame. */
  private readonly fxLayer = new Container();
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
    this.fxLayer.eventMode = "none";
    this.addChild(this.fxLayer);

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

    this.placeCounter();

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
    // Everything that did NOT win steps back, so the cluster reads instantly.
    const active = new Set(positions.map(keyOf));
    for (const [key, view] of this.symbols) if (!active.has(key)) view.setDimmed(true, turbo);
    // Winners light up in a short ripple out from the cluster's centre rather
    // than all on one frame — reads as energy spreading through the cluster.
    const mc = positions.reduce((a, p) => a + p[0], 0) / Math.max(1, positions.length);
    const mr = positions.reduce((a, p) => a + p[1], 0) / Math.max(1, positions.length);
    const order = [...positions].sort((a, b) => Math.hypot(a[0] - mc, a[1] - mr) - Math.hypot(b[0] - mc, b[1] - mr));
    const step = turbo ? 8 : 26;
    const cap = turbo ? 40 : 170;
    await Promise.all(
      order.map(async (p, i) => {
        const view = this.symbols.get(keyOf(p));
        await wait(Math.min(cap, i * step));
        if (view && !view.destroyed) await view.winCelebrate(turbo);
      })
    );
    await wait(turbo ? 30 : 80);
  }

  /** Bring every dimmed symbol back to full strength. */
  undimAll(turbo: boolean): void {
    for (const view of this.symbols.values()) view.setDimmed(false, turbo);
  }

  /** Drop every win / alert / transform frame on the board. */
  clearMarks(): void {
    for (const view of this.symbols.values()) view.redraw(false, false, false);
  }

  async scatterTease(positions: Position[], turbo: boolean): Promise<void> {
    // Per request: NO per-symbol zoom/punch and NO per-scatter audio. The tease
    // is carried entirely by the on-screen banner (shown by the caller). We just
    // give the scatters a static alert highlight so they're clearly flagged.
    this.markPositions(positions, "alert");
    await wait(turbo ? 40 : 150);
  }

  /* ─── GETAWAY TRIGGER: the armored trucks rev and tear off the board ─── */
  /** 3+ scatters just triggered The Getaway. Each truck plays its skeletal
   *  engine-rev (squat, nose-up, building shudder), belches exhaust, then
   *  accelerates off the LEFT edge — the Brinks art faces left, so that is
   *  forward. The reel mask clips them cleanly at the frame. Staggered
   *  left-to-right so it reads as a convoy peeling out, not a formation. */
  async truckDriveOff(positions: Position[], turbo: boolean): Promise<void> {
    const trucks = positions
      .map((p) => ({ key: keyOf(p), col: p[0], view: this.symbols.get(keyOf(p)) }))
      .filter((t): t is { key: string; col: number; view: SymbolView } => !!t.view)
      .sort((a, b) => a.col - b.col);
    if (!trucks.length) return;

    const exitX = -this.cellWidth * 1.9; // fully past the left mask edge
    const revMs = turbo ? 260 : 880;
    const driveMs = turbo ? 240 : 500;

    await Promise.all(trucks.map(async ({ key, view }, i) => {
      await wait(turbo ? i * 70 : i * 160);
      view.revEngine(turbo);
      this.spawnExhaust(view, revMs + driveMs, turbo);
      await wait(revMs);
      this.spawnSpeedLines(view, driveMs);
      const startX = view.x;
      const startY = view.y;
      await tween(driveMs, (p) => {
        const e = p * p * p; // hard launch: nothing, nothing, GONE
        view.x = startX + (exitX - startX) * e;
        view.y = startY - 5 * Math.min(1, p * 1.6);
        view.scale.set(1 + 0.16 * p, 1 - 0.08 * p);   // speed stretch
        view.rotation = 0.055 * Math.min(1, p * 2);    // nose lifts (art faces left)
      }, linear);
      this.symbols.delete(key);
      view.destroy({ children: true });
    }));
  }

  /** Exhaust puffs from the truck's rear (right side of the cell) while it revs
   *  and launches. Added to the masked reel container so smoke never leaves the
   *  board frame. */
  private spawnExhaust(view: SymbolView, durMs: number, turbo: boolean): void {
    const stepMs = turbo ? 60 : 90;
    const n = Math.max(4, Math.floor(durMs / stepMs));
    for (let i = 0; i < n; i++) {
      void wait(i * stepMs).then(() => {
        if (view.destroyed) return;
        const puff = new Graphics();
        const r0 = 3.5 + Math.random() * 4;
        puff.circle(0, 0, r0).fill({ color: 0x353b46, alpha: 0.5 });
        puff.position.set(
          view.x + this.cellWidth * (0.82 + Math.random() * 0.12),
          view.y + this.cellHeight * (0.68 + Math.random() * 0.14)
        );
        this.reelContainer.addChild(puff);
        const dx = 14 + Math.random() * 22;  // drifts right — away from the launch
        const dy = -(6 + Math.random() * 12);
        void simulate(380 + Math.random() * 220, (k, p) => {
          puff.x += dx * 0.02 * k;
          puff.y += dy * 0.02 * k;
          puff.scale.set(1 + 1.8 * p);
          puff.alpha = 0.5 * (1 - p);
        }).then(() => puff.destroy());
      });
    }
  }

  /** Horizontal speed streaks trailing off the accelerating truck. */
  private spawnSpeedLines(view: SymbolView, durMs: number): void {
    for (let i = 0; i < 7; i++) {
      void wait(Math.random() * durMs * 0.5).then(() => {
        const line = new Graphics();
        const len = 26 + Math.random() * 46;
        line.rect(0, 0, len, 1.6).fill({ color: i % 3 === 0 ? 0xbfe9ff : 0xffffff, alpha: 0.55 });
        line.position.set(
          view.destroyed ? this.rect.width * Math.random() : view.x + this.cellWidth * (0.5 + Math.random() * 0.6),
          (view.destroyed ? this.rect.height * Math.random() : view.y) + this.cellHeight * (0.15 + Math.random() * 0.7)
        );
        this.reelContainer.addChild(line);
        void simulate(200 + Math.random() * 140, (k, p) => {
          line.x += 9 * k;         // streaks fall behind the leftward launch
          line.alpha = 0.55 * (1 - p);
          line.scale.x = 1 + p * 0.8;
        }).then(() => line.destroy());
      });
    }
  }

  /* ─── CLEAR WINS: flash + vanish winning symbols, leaving gaps behind ─── */
  // Used by the real cascade (tumble_remove): the holes are filled afterwards by
  // tumbleTo() using the authoritative RGS board, so we must NOT refill here.
  async clearWins(positions: Position[], turbo: boolean): Promise<void> {
    const gone: Promise<void>[] = [];
    for (const p of positions) {
      const key = keyOf(p);
      const view = this.symbols.get(key);
      if (!view) continue;
      // The symbol bursts as it goes: flash, ring and shards from its cell.
      this.cellBurst(p[0], p[1], WIN_ACCENT[view.id] ?? DEFAULT_ACCENT, turbo);
      // The cell is free for the refill at once; the view finishes its own
      // destroy clip on screen and then cleans itself up.
      this.symbols.delete(key);
      gone.push(view.vanish(turbo).then(() => {
        if (!view.destroyed) view.destroy({ children: true });
      }));
    }
    // Let the burst land and the destroy get going, then hand the holes to the
    // refill while those clips finish underneath — no dead, empty board beat.
    await Promise.race([Promise.all(gone), wait(turbo ? 90 : 320)]);
  }

  /* ─── CASCADE: gravity-drop survivors + drop new symbols from above ───
   * The board owns the fall: a clean constant-gravity drop (tumblePlan), no
   * bounce. At touchdown each symbol's rig performs its OWN impact through
   * SymbolView.touchdown → the skeletal `land` clip (brass thuds, cartridges
   * chatter, the duffel squashes, paper flutters…). The clip never animates
   * the fall, so nothing is double-animated. Landing reactions play on past
   * the resolve, overlapping the next event like a real settle would. */
  async tumbleTo(board: Board, turbo: boolean): Promise<void> {
    this.currentBoard = board;
    this.undimAll(turbo);
    const cellStep = this.cellHeight + this.gap;
    const animations: Promise<void>[] = [];

    const drop = (view: SymbolView, spec: FallSpec): Promise<void> => {
      if (spec.fallMs <= 0 || Math.abs(spec.targetY - spec.startY) <= 1) {
        view.y = spec.targetY;
        return Promise.resolve();
      }
      const dist = spec.targetY - spec.startY;
      const fall = (): Promise<void> => tween(spec.fallMs, (p) => {
        if (!view.destroyed) view.y = spec.startY + dist * p;
      }, gravityEase).then(() => {
        if (view.destroyed) return;
        view.y = spec.targetY;
        view.touchdown("tumble", turbo);
      });
      return spec.delay > 0 ? wait(spec.delay).then(fall) : fall();
    };

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
      const plan = planColumn(
        survivors.map((v) => v.y), GRID_ROWS, (r) => this.cellY(r), cellStep, this.gap, turbo
      );

      // Survivors fall to the BOTTOM of the column, keeping relative order.
      // Any that were still holding a win pose (won but not removed) let go.
      for (let i = 0; i < survivors.length; i++) {
        const view = survivors[i]!;
        view.releaseHold();
        this.symbols.set(keyOf([col, newCount + i]), view);
        animations.push(drop(view, plan.survivors[i]!));
      }

      // New symbols enter from ABOVE the board (clipped by the reel mask).
      for (let i = 0; i < newCount; i++) {
        const spec = plan.fresh[i]!;
        const view = new SymbolView(board[col][i]);
        view.layout(this.cellWidth, this.cellHeight);
        view.position.set(this.cellX(col), spec.startY);
        this.reelContainer.addChild(view);
        this.symbols.set(keyOf([col, i]), view);
        animations.push(drop(view, spec));
      }
    }

    await Promise.all(animations);
    const settle = (turbo ? TUMBLE_TIMING.turbo : TUMBLE_TIMING.normal).settleMs;
    if (settle > 0) await wait(settle);
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
    // Each stash cell erupts in gold light as its new symbol arrives.
    transformed.forEach(([col, row], i) => {
      void wait(i * (turbo ? 20 : 55)).then(() => this.cellBurst(col, row, 0xffd24a, turbo, 1.3));
    });

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

    // Brief border so the player sees what changed — then it is cleared, it
    // must never linger into the next cascade or past the round.
    this.markPositions(transformed, "transform");
    await wait(turbo ? 60 : 280);
    this.clearMarks();
  }

  /**
   * 2×2 mega wild. The four cells cave in, then ONE giant symbol slams down
   * across the block (shake, flash, shock ring, shards), holds for a beat
   * playing its win, and settles into the four live cells under a shared frame
   * that fades away. The board keeps per-cell views (the block can be broken
   * up by later cascades); the big symbol is presentation only.
   */
  async megaWild(board: Board, positions: Position[], turbo: boolean): Promise<void> {
    this.currentBoard = board;
    if (!positions.length) return;
    const cols = positions.map((p) => p[0]);
    const rows = positions.map((p) => p[1]);
    const c0 = Math.min(...cols), c1 = Math.max(...cols);
    const r0 = Math.min(...rows), r1 = Math.max(...rows);
    const x0 = this.cellX(c0), y0 = this.cellY(r0);
    const bw = this.cellX(c1) + this.cellWidth - x0;
    const bh = this.cellY(r1) + this.cellHeight - y0;
    const bcx = x0 + bw / 2, bcy = y0 + bh / 2;
    const id = board[c0]![r0]!;

    // 1. The old symbols cave in toward the block centre.
    const olds = positions
      .map((p) => ({ p, v: this.symbols.get(keyOf(p)) }))
      .filter((o): o is { p: Position; v: SymbolView } => !!o.v);
    await tween(turbo ? 80 : 200, (t) => {
      const e = easeInCubic(t);
      for (const { p, v } of olds) {
        if (v.destroyed) continue;
        const s = 1 - 0.45 * e;
        const cx = this.cellX(p[0]) + this.cellWidth / 2;
        const cy = this.cellY(p[1]) + this.cellHeight / 2;
        const tx = cx + (bcx - cx) * 0.4 * e;
        const ty = cy + (bcy - cy) * 0.4 * e;
        v.scale.set(s);
        v.position.set(tx - (this.cellWidth * s) / 2, ty - (this.cellHeight * s) / 2);
        v.alpha = 1 - e;
      }
    }, linear);

    // 2. Real per-cell views go in underneath, hidden until the hand-off.
    const views: SymbolView[] = [];
    for (const [col, row] of positions) {
      const key = keyOf([col, row]);
      this.symbols.get(key)?.destroy({ children: true });
      const view = new SymbolView(board[col]![row]!);
      view.layout(this.cellWidth, this.cellHeight);
      view.position.set(this.cellX(col), this.cellY(row));
      view.alpha = 0;
      this.symbols.set(key, view);
      this.reelContainer.addChild(view);
      views.push(view);
    }

    // 3. One giant symbol drops onto the block.
    const holder = new Container();
    holder.position.set(bcx, bcy);
    const big = new SymbolView(id);
    big.layout(bw, bh);
    big.position.set(-bw / 2, -bh / 2);
    holder.addChild(big);
    this.reelContainer.addChild(holder);
    holder.scale.set(1.55);
    holder.alpha = 0;
    await tween(turbo ? 110 : 240, (t) => {
      holder.alpha = Math.min(1, t * 3);
      holder.scale.set(1.55 - 0.55 * easeInCubic(t));
    }, linear);
    holder.scale.set(1);
    this.blockSlamFx(bcx, bcy, bw, bh, WIN_ACCENT[id] ?? DEFAULT_ACCENT, turbo);
    // Squash on contact, then recover.
    void tween(turbo ? 90 : 200, (t) => {
      const k = Math.sin(t * Math.PI) * (1 - t);
      holder.scale.set(1 + 0.08 * k, 1 - 0.1 * k);
    }, linear).then(() => holder.scale.set(1));

    // 4. Hold the big symbol for a beat — it plays its own win.
    const celebrate = big.winCelebrate(turbo);
    await Promise.race([celebrate, wait(turbo ? 260 : 700)]);

    // 5. Hand off to the four live cells under one shared frame.
    const frame = new Graphics();
    frame.roundRect(x0 + 1, y0 + 1, bw - 2, bh - 2, 14)
      .fill({ color: 0x9ae64e, alpha: 0.08 })
      .stroke({ color: 0x9ae64e, width: 3, alpha: 0.95 });
    frame.roundRect(x0 + 4, y0 + 4, bw - 8, bh - 8, 11).stroke({ color: 0xffffff, width: 1, alpha: 0.35 });
    frame.alpha = 0;
    this.fxLayer.addChild(frame);
    await tween(turbo ? 90 : 220, (t) => {
      holder.alpha = 1 - t;
      for (const v of views) if (!v.destroyed) v.alpha = t;
      frame.alpha = t;
    }, linear);
    holder.destroy({ children: true });
    for (const v of views) if (!v.destroyed) v.alpha = 1;
    void wait(turbo ? 200 : 650)
      .then(() => tween(turbo ? 120 : 320, (t) => { frame.alpha = 1 - t; }, linear))
      .then(() => frame.destroy());
  }

  /** Impact for the mega-wild slam: block-sized flash, shock ring, shards. */
  private blockSlamFx(cx: number, cy: number, w: number, h: number, color: number, turbo: boolean): void {
    const flash = new Sprite(softGlowTexture());
    flash.anchor.set(0.5);
    flash.blendMode = "add";
    flash.tint = 0xffffff;
    flash.position.set(cx, cy);
    flash.width = w * 1.1;
    flash.height = h * 1.1;
    this.fxLayer.addChild(flash);
    const f0 = flash.scale.x;
    void tween(turbo ? 160 : 340, (t) => {
      flash.scale.set(f0 * (1 + 0.6 * t));
      flash.alpha = (1 - t) * (1 - t);
    }, easeOutCubic).then(() => flash.destroy());

    const ring = new Graphics();
    ring.roundRect(-w / 2, -h / 2, w, h, 18).stroke({ color, width: 5 });
    ring.blendMode = "add";
    ring.position.set(cx, cy);
    this.fxLayer.addChild(ring);
    void tween(turbo ? 200 : 420, (t) => {
      ring.scale.set(1 + 0.35 * t);
      ring.alpha = 1 - t;
    }, easeOutCubic).then(() => ring.destroy());

    // Shards burst from the four corners of the block.
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      this.shards(cx + (dx * w) / 2.6, cy + (dy * h) / 2.6, color, turbo ? 3 : 6, Math.atan2(dy, dx), 1.1);
    }
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
    const hold = turbo ? 120 : 250;               // ms at full speed before first stop
    // Wind-up: each reel nudges UP a fraction of a cell, then launches down —
    // the start of a physical reel, instead of jumping from rest to full speed.
    const kickMs = turbo ? 0 : 110;
    const kickAmp = cellStep * 0.13;
    const kickStagger = turbo ? 0 : 24;
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
    this.destroyAllSymbols();
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
      filter.strengthX = 0;
      filter.strengthY = 0; // ramps up with reel speed (sharp during the wind-up)
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
      reel.container.y = 0;

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
            reel.filter.strengthY = 10;
          } else if (p <= 0.34) {
            reel.filter.strengthY = 10 * (1 - (p - 0.22) / 0.12);
          } else {
            reel.filter.strengthY = 0;
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
            landed = this.handOffColumn(reel, finalBoard, turbo);
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
          landed = landed ?? this.handOffColumn(reel, finalBoard, turbo);
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
          // Clear anticipation overlay drawing
          this.anticipationOverlay.clear();

          for (const reel of reels) {
            if (reel.state !== "spin") continue;
            const kt = elapsed - reel.col * kickStagger;
            if (kt < kickMs) {
              // Wind-up: ease up off the rest position.
              const u = Math.max(0, kt) / kickMs;
              reel.container.y = -kickAmp * Math.sin(u * Math.PI / 2);
            } else {
              const ramp = Math.min(1, (kt - kickMs) / accelTime);
              const vel = Vmax * ramp * ramp; // easeIn ramp-up
              // The wind-up offset unwinds into the launch.
              reel.container.y = -kickAmp * Math.max(0, 1 - ramp) * Math.max(0, 1 - ramp);
              reel.filter.strengthY = 10 * ramp;
              this.advanceReel(reel, vel * dt, cellStep, wrapSpan);
            }

            // Draw pulsing red border if column is currently in anticipation spin
            if (isAnticipationCol[reel.col] && elapsed >= kickMs + accelTime + hold + stagger[reel.col - 1]!) {
              const rx = this.cellX(reel.col) - 2;
              const ry = 2;
              const rw = this.cellWidth + 4;
              const rh = this.rect.height - 4;
              const pulse = 0.5 + Math.sin(performance.now() * 0.015) * 0.4;
              // Soft outer halo + crisp edge, so the frame glows rather than
              // reading as a flat outline.
              this.anticipationOverlay.roundRect(rx - 3, ry - 3, rw + 6, rh + 6, 9)
                .stroke({ color: 0xff1f2e, width: 8, alpha: 0.2 * pulse });
              this.anticipationOverlay.roundRect(rx, ry, rw, rh, 6)
                .stroke({ color: 0xff1f2e, width: 3, alpha: 0.8 * pulse })
                .fill({ color: 0xff1f2e, alpha: 0.08 * pulse });
            }

            if (elapsed >= kickMs + accelTime + hold + stagger[reel.col]!) startDecel(reel);
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
        for (const { view, baseY } of this.handOffColumn(reel, finalBoard, turbo)) view.y = baseY;
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
  private handOffColumn(reel: Reel, finalBoard: Board, turbo: boolean): { view: SymbolView; baseY: number }[] {
    if (reel.container.destroyed) return [];
    reel.filter.strengthY = 0;
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
      // The column has just slammed: each symbol answers with a softened
      // version of its own landing (rig only — the slam still owns position).
      view.touchdown("reel", turbo);
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

  /** Empty the symbol map FIRST, then destroy each view on its own, so one
   *  failing view can never leave destroyed views behind in the map (every
   *  later layout would then crash on them). */
  private destroyAllSymbols(): void {
    const views = [...this.symbols.values()];
    this.symbols.clear();
    for (const v of views) {
      if (v.destroyed) continue;
      try {
        v.destroy({ children: true });
      } catch (err) {
        console.error("[BoardView] symbol teardown failed:", err);
      }
    }
  }

  private rebuildSymbols(board: Board): void {
    this.destroyAllSymbols();
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

  /** "[n/total]" — punches when a new piece lands. */
  updateCollectionCounter(count: number, total = 8, punch = false): void {
    this.counterText.text = `[${count}/${total}]`;
    if (!punch) return;
    const t = this.counterText;
    void tween(420, (p) => {
      if (t.destroyed) return;
      const k = Math.sin(p * Math.PI) * (1 - 0.3 * p);
      t.scale.set(1 + 0.45 * k);
    }, linear).then(() => { if (!t.destroyed) t.scale.set(1); });
  }

  /** Screen-space slot for the "[n/8]" counter (from wantedStarsGeometry): the
   *  wanted-stars strip's top-right corner, clear of the stars. */
  private counterSlot: { x: number; y: number } | null = null;

  setCounterSlot(slot: { x: number; y: number } | null): void {
    this.counterSlot = slot;
    this.placeCounter();
  }

  private placeCounter(): void {
    const s = this.counterSlot;
    if (!s) {
      this.counterText.position.set(this.rect.width - 10, -20);
      return;
    }
    // board-local: the board container sits at (rect.x, rect.y)
    this.counterText.position.set(s.x - this.rect.x, s.y - this.rect.y);
  }

  getSymbolView(pos: Position): SymbolView | null {
    return this.symbols.get(keyOf(pos)) ?? null;
  }

  private drawBackground(): void {
    const w = this.rect.width;
    const h = this.rect.height;
    this.background.clear();
    // The dark frosted pane itself lives under the board (cabinet.ts). Here:
    // reel lanes that catch a little light in the middle, and engraved dividers.
    const colW = w / GRID_COLUMNS;
    const lane = new FillGradient({
      type: "linear", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: "local",
      colorStops: [
        { offset: 0, color: "rgba(255,255,255,0)" },
        { offset: 0.5, color: "rgba(255,236,214,0.04)" },
        { offset: 1, color: "rgba(255,255,255,0)" },
      ],
    });
    for (let col = 0; col < GRID_COLUMNS; col++) {
      this.background.rect(col * colW, 0, colW, h).fill(lane);
    }
    const divider = (alpha: number): FillGradient => new FillGradient({
      type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: "local",
      colorStops: [
        { offset: 0, color: `rgba(255,232,210,0)` },
        { offset: 0.5, color: `rgba(255,232,210,${alpha})` },
        { offset: 1, color: `rgba(255,232,210,0)` },
      ],
    });
    for (let col = 1; col < GRID_COLUMNS; col++) {
      const x = Math.round(col * colW);
      this.background.rect(x - 1, 6, 1, h - 12).fill({ color: 0x000000, alpha: 0.45 });
      this.background.rect(x, 6, 1, h - 12).fill(divider(0.16));
    }
  }

  private drawMask(): void {
    this.reelMask.clear();
    this.reelMask.rect(0, 0, this.rect.width, this.rect.height).fill(0xffffff);
  }

  private drawGlassOverlay(): void {
    // Glass over the reels: the bezel's shadow falling on the top rows, a soft
    // gloss on the upper pane and a dark lip at the bottom — the reels read as
    // set INTO the machine rather than printed on it. Kept faint so symbols
    // stay crisp.
    const w = this.rect.width;
    const h = this.rect.height;
    const g = this.glassOverlay;
    g.clear();
    const v = (stops: [number, string][]): FillGradient => new FillGradient({
      type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: "local",
      colorStops: stops.map(([offset, color]) => ({ offset, color })),
    });
    g.rect(0, 0, w, Math.min(26, h * 0.08)).fill(v([[0, "rgba(4,2,10,0.55)"], [1, "rgba(4,2,10,0)"]]));
    g.rect(0, h - Math.min(18, h * 0.05), w, Math.min(18, h * 0.05)).fill(v([[0, "rgba(4,2,10,0)"], [1, "rgba(4,2,10,0.45)"]]));
    g.rect(0, 0, w, h * 0.38).fill(v([[0, "rgba(255,255,255,0.045)"], [1, "rgba(255,255,255,0)"]]));
    // a single diagonal glint across the pane
    g.poly([w * 0.58, 0, w * 0.7, 0, w * 0.42, h, w * 0.3, h]).fill({ color: 0xffffff, alpha: 0.018 });
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

  /**
   * A winning symbol bursting out of its cell: an additive accent flash with a
   * white core, an expanding ring and a spray of light shards. Sprites from
   * shared textures, time-based motion, everything destroys itself.
   */
  private cellBurst(col: number, row: number, color: number, turbo: boolean, power = 1): void {
    const cx = this.cellX(col) + this.cellWidth / 2;
    const cy = this.cellY(row) + this.cellHeight / 2;
    const size = Math.min(this.cellWidth, this.cellHeight);

    const flash = new Sprite(softGlowTexture());
    flash.anchor.set(0.5);
    flash.blendMode = "add";
    flash.tint = color;
    flash.position.set(cx, cy);
    flash.width = flash.height = size * 0.75 * power;
    this.fxLayer.addChild(flash);
    const fs = flash.scale.x;
    void tween(turbo ? 150 : 300, (t) => {
      flash.scale.set(fs * (1 + 1.1 * t));
      flash.alpha = 0.95 * (1 - t) * (1 - t);
    }, easeOutCubic).then(() => flash.destroy());

    const core = new Sprite(softGlowTexture());
    core.anchor.set(0.5);
    core.blendMode = "add";
    core.position.set(cx, cy);
    core.width = core.height = size * 0.42 * power;
    this.fxLayer.addChild(core);
    const cs = core.scale.x;
    void tween(turbo ? 110 : 200, (t) => {
      core.scale.set(cs * (1 + 0.5 * t));
      core.alpha = 1 - t;
    }, easeOutCubic).then(() => core.destroy());

    const ring = new Graphics();
    ring.circle(0, 0, size * 0.4).stroke({ color, width: 3 });
    ring.blendMode = "add";
    ring.position.set(cx, cy);
    ring.scale.set(0.45);
    this.fxLayer.addChild(ring);
    void tween(turbo ? 170 : 330, (t) => {
      ring.scale.set(0.45 + 0.85 * power * t);
      ring.alpha = 1 - t;
    }, easeOutCubic).then(() => ring.destroy());

    if (!turbo) this.shards(cx, cy, color, Math.round(9 * power), null, power);
  }

  /** Light shards flying out of a point (full circle, or a cone around `dir`). */
  private shards(cx: number, cy: number, color: number, count: number, dir: number | null, power: number): void {
    const tex = streakTexture();
    const list: { s: Sprite; vx: number; vy: number; len: number }[] = [];
    for (let i = 0; i < count; i++) {
      const s = new Sprite(tex);
      s.anchor.set(1, 0.5);
      s.blendMode = "add";
      s.tint = i % 3 === 0 ? 0xffffff : color;
      s.position.set(cx, cy);
      const a = dir === null ? (i / count) * Math.PI * 2 + Math.random() * 0.5 : dir + (Math.random() - 0.5) * 1.3;
      const sp = (4 + Math.random() * 5) * power;
      const len = 0.35 + Math.random() * 0.45;
      s.scale.set(len, 0.55 + Math.random() * 0.35);
      s.rotation = a;
      this.fxLayer.addChild(s);
      list.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len });
    }
    void simulate(480, (k, t) => {
      const drag = Math.pow(0.9, k);
      for (const d of list) {
        d.s.x += d.vx * k;
        d.s.y += d.vy * k;
        d.vx *= drag;
        d.vy = d.vy * drag + 0.22 * k;
        d.s.rotation = Math.atan2(d.vy, d.vx);
        d.s.scale.x = d.len * (1 - 0.6 * t);
        d.s.alpha = 1 - t * t;
      }
    }).then(() => list.forEach((d) => d.s.destroy()));
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

    // ~32 frames at 60 fps, but time-based so 120/144 Hz screens match.
    void simulate(530, (k) => {
      for (const sp of sparkList) {
        if (sp.sprite.alpha < 0.04) { sp.sprite.visible = false; continue; }
        sp.sprite.x += sp.vx * k;
        sp.sprite.y += sp.vy * k;
        sp.vx *= Math.pow(0.92, k);
        sp.vy += 0.45 * k;
        sp.sprite.alpha *= Math.pow(0.91, k);
        sp.sprite.scale.set(sp.sprite.scale.x * Math.pow(0.97, k));
      }
    }).then(() => sparks.destroy({ children: true }));

    // Layer C - soft glow bloom
    const glow = new Sprite(softGlowTexture());
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
