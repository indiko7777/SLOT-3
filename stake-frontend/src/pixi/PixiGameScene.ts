import { Application, Container } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type BonusCell, type GameEvent, type Position, type SymbolId } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import { BoardView } from "./BoardView";
import { BonusView } from "./BonusView";
import { EffectsLayer } from "./EffectsLayer";
import { HudView } from "./HudView";
import { PaytableView } from "./PaytableView";
import { computeLayout } from "./layout";
import { wait } from "./tween";
import type { LayoutMetrics, SceneRuntime } from "./types";

export class PixiGameScene {
  private readonly root = new Container();
  private readonly hud: HudView;
  private readonly board = new BoardView();
  private readonly bonus = new BonusView();
  private readonly effects = new EffectsLayer();
  private readonly paytable = new PaytableView();
  private layout: LayoutMetrics;
  private currentSnapshot: PlaybackSnapshot | null = null;
  private hasBoard = false;
  private bonusDeadSpins = 0;
  private bonusActive = false;

  constructor(private readonly app: Application, private readonly runtime: SceneRuntime) {
    this.layout = computeLayout(app.screen.width, app.screen.height);
    this.hud = new HudView(runtime);
    this.board.setAudioHooks({
      onReelStop: (col, total) => runtime.onReelStop?.(col, total),
      onAnticipation: () => runtime.onAnticipation?.(),
    });
    this.root.addChild(this.hud, this.board, this.bonus, this.effects, this.paytable);
    this.app.stage.addChild(this.root);
  }

  /** Called on window resize only */
  resize(): void {
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    this.board.layout(this.layout.board);
    // The Getaway bonus is a full-screen POV chase.
    this.bonus.layout({ x: 0, y: 0, width: this.layout.width, height: this.layout.height });
  }

  resetRound(snapshot: PlaybackSnapshot): void {
    this.currentSnapshot = snapshot;
    this.bonus.hide();
    // DON'T rebuild the board here — the spin animation will handle it.
    // Only update the HUD status text.
    this.hud.draw(this.layout, snapshot);
  }

  /** Full rebuild — only for initial load and post-round idle state */
  renderSnapshot(snapshot: PlaybackSnapshot): void {
    this.currentSnapshot = snapshot;
    this.resize();
    this.hud.draw(this.layout, snapshot);
    // Only rebuild the board if we don't already have one showing.
    // After a spin/tumble round the board is already in the correct state
    // from the animations — rebuilding would cause a visible flash.
    if (!this.hasBoard) {
      const board = snapshot.board ?? previewBoard(this.runtime);
      this.board.setInstant(board);
      this.hasBoard = true;
    }
    // Only re-show the bonus when resuming an ACTIVE bonus round (not after it ends).
    if (snapshot.bonusGrid && snapshot.state.startsWith("bonus")) {
      this.bonus.showStatic(snapshot.bonusGrid);
    } else {
      this.bonus.hide();
    }
  }

  togglePaytable(): void {
    this.paytable.toggle(this.layout.width, this.layout.height);
  }

  /* ─────────────────────────────────────────────────────────────────
   *  DEV FEATURE TESTER (gated to import.meta.env.DEV in main.ts).
   *  Fires any single animation on demand so every win / combination /
   *  bonus state can be previewed without spinning. See DebugPanel.
   * ───────────────────────────────────────────────────────────────── */

  private allPositions(): Position[] {
    const out: Position[] = [];
    for (let c = 0; c < GRID_COLUMNS; c++) for (let r = 0; r < GRID_ROWS; r++) out.push([c, r]);
    return out;
  }

  private uniformBoard(id: SymbolId): Board {
    const b: Board = [];
    for (let c = 0; c < GRID_COLUMNS; c++) {
      const col: SymbolId[] = [];
      for (let r = 0; r < GRID_ROWS; r++) col.push(id);
      b.push(col);
    }
    return b;
  }

  private emptyGrid(): BonusCell[][] {
    return Array.from({ length: GRID_COLUMNS }, () =>
      Array.from({ length: GRID_ROWS }, () => ({ symbol: "EMPTY" }) as BonusCell)
    );
  }

  private async ensureBonusVisible(): Promise<void> {
    if (!this.bonus.visible) { this.bonusActive = true; await this.bonus.intro(true); }
  }

  /** Restore a clean idle base board (used by the panel's Reset). */
  private debugReset(): void {
    this.bonus.hide();
    this.bonusActive = false;
    if (this.currentSnapshot) { this.hasBoard = false; this.renderSnapshot(this.currentSnapshot); }
  }

  /** Big-win cinematic for a tier (banner + bloom + chromatic glitch). */
  async debugBigWin(intensity: "mid" | "high" | "grand"): Promise<void> {
    const title = intensity === "grand" ? "GRAND WIN" : intensity === "high" ? "MEGA WIN" : "BIG WIN";
    const amount = intensity === "grand" ? "5,000x" : intensity === "high" ? "250x" : "25x";
    void this.board.highlight(this.allPositions(), false);
    this.effects.cashRain(this.layout.board, false);
    this.effects.screenShake(this.root, false);
    await this.effects.banner(title, amount, this.layout.board, false, intensity);
  }

  /** Single dispatcher for the dev feature tester. */
  async debugPlay(action: string): Promise<void> {
    const turbo = false;
    const board = this.layout.board;
    const pos = this.allPositions();
    const [kind, arg] = action.split(":") as [string, string | undefined];

    switch (kind) {
      case "reset":
        this.debugReset();
        return;

      case "win": {
        // Show one symbol's win celebration across the whole board.
        this.bonus.hide();
        this.board.setInstant(this.uniformBoard(arg as SymbolId));
        this.hasBoard = true;
        await this.board.highlight(pos, turbo);
        return;
      }

      case "tier":
        await this.debugBigWin((arg ?? "mid") as "mid" | "high" | "grand");
        return;

      case "fx": {
        const centers = [pos[0], pos[2], pos[6], pos[8], pos[12]].map((p) => this.board.centerOf(p));
        if (arg === "clusterLink") await this.effects.clusterLink(centers, 0xffd95c, turbo);
        else if (arg === "cashSpray") await this.effects.cashSpray(board, pos.slice(0, 6), turbo);
        else if (arg === "coinBurst") await this.effects.goldCoinBurst(board.x + board.width / 2, board.y + board.height / 2, board, turbo);
        else if (arg === "siren") await this.effects.sirenSweep(this.layout.boardFrame, turbo);
        else if (arg === "shake") await this.effects.screenShake(this.root, turbo);
        else if (arg === "keyBeam") await this.effects.keyBeam(this.board.centerOf(pos[6]), [pos[0], pos[4], pos[19]].map((p) => this.board.centerOf(p)), turbo);
        else if (arg === "scatterTease") { this.board.setInstant(this.uniformBoard("PHONE_SCATTER")); this.hasBoard = true; await this.board.scatterTease(pos.slice(0, 3), turbo); }
        return;
      }

      case "cascade": {
        // Show the tumble clearly: a VARIED board (so the clear + refill is
        // visible) with a distinct CASH cluster. It links up, lights, clears,
        // then survivors drop and fresh symbols cascade in from the top.
        this.bonus.hide();
        const pool: SymbolId[] = ["BRASS", "KNIFE", "PISTOL", "AMMO", "DUFFEL", "WATCH", "DIAMOND", "BIKE"];
        const b: Board = [];
        let k = 0;
        for (let c = 0; c < GRID_COLUMNS; c++) {
          const col: SymbolId[] = [];
          for (let r = 0; r < GRID_ROWS; r++) col.push(pool[k++ % pool.length]!);
          b.push(col);
        }
        const win: Position[] = [[0, 3], [1, 3], [2, 3], [0, 2], [1, 2], [2, 2], [1, 1]];
        for (const [c, r] of win) b[c]![r] = "CASH";
        this.board.setInstant(b);
        this.hasBoard = true;
        await wait(350);                                  // see the board first
        void this.effects.clusterLink(win.map((p) => this.board.centerOf(p)), 0xffd95c, turbo);
        await this.board.highlight(win, turbo);           // light the combination
        await wait(300);
        await this.board.remove(win, turbo);              // clear + gravity refill
        return;
      }

      case "heat": {
        if (arg === "transform") {
          const b = this.uniformBoard("BRASS");
          const targets = [pos[0], pos[1], pos[5], pos[6]];
          for (const [c, r] of targets) b[c]![r] = "CASH";
          this.board.setInstant(this.uniformBoard("BRASS")); this.hasBoard = true;
          await this.board.transform(b, targets, turbo);
        } else if (arg === "megawild") {
          const b = this.uniformBoard("CASH");
          const occ: Position[] = [[1, 1], [2, 1], [1, 2], [2, 2]];
          for (const [c, r] of occ) b[c]![r] = "CAR_WILD";
          this.board.setInstant(this.uniformBoard("CASH")); this.hasBoard = true;
          await this.board.megaWild(b, occ, turbo);
        }
        return;
      }

      case "bonus": {
        if (arg === "intro") { this.bonusActive = true; await this.bonus.intro(turbo); return; }
        if (arg === "hide") { await this.bonus.fadeOutAndHide(turbo); this.bonusActive = false; return; }
        await this.ensureBonusVisible();
        if (arg === "hit") {
          const grid = this.emptyGrid();
          grid[0]![3] = { symbol: "SAFE", value: 2 };
          grid[4]![0] = { symbol: "SAFE", value: 5 };
          const landed: Position[] = [[1, 1], [2, 2], [3, 1]];
          grid[1]![1] = { symbol: "SAFE", value: 3 };
          grid[2]![2] = { symbol: "SAFE", value: 25 };
          grid[3]![1] = { symbol: "SAFE", value: 1 };
          await this.bonus.playSpin(grid, landed, 4, 0, turbo, this.runtime.onSafeLand);
        } else if (arg === "dead") {
          const grid = this.emptyGrid();
          grid[0]![3] = { symbol: "SAFE", value: 2 };
          grid[4]![0] = { symbol: "SAFE", value: 5 };
          this.runtime.onBonusHeat?.(2);
          await this.bonus.playSpin(grid, [], 2, 2, turbo);
        } else if (arg === "crack") {
          // Land a dynamite with gold neighbours, then detonate it.
          const grid = this.emptyGrid();
          grid[1]![1] = { symbol: "SAFE", value: 5 };
          grid[3]![1] = { symbol: "SAFE", value: 10 };
          grid[2]![0] = { symbol: "SAFE", value: 3 };
          grid[2]![2] = { symbol: "SAFE", value: 8 };
          grid[2]![1] = { symbol: "MASTER_KEY" };
          await this.bonus.playSpin(grid, [[2, 1]], 4, 0, turbo);
          await this.bonus.crack([2, 1], [
            { position: [1, 1], newValue: 10 },
            { position: [3, 1], newValue: 20 },
            { position: [2, 0], newValue: 6 },
            { position: [2, 2], newValue: 16 },
          ], turbo);
        } else if (arg === "grand") {
          await this.bonus.finish(true, 5000, turbo);
        } else if (arg === "bust") {
          await this.bonus.finish(false, 42.5, turbo);
        }
        return;
      }
    }
  }

  async playEvent(event: GameEvent, snapshot: PlaybackSnapshot): Promise<void> {
    this.currentSnapshot = snapshot;
    // Only update the HUD — do NOT resize or rebuild the board
    this.hud.updateStatus(this.layout, snapshot);

    const turbo = this.runtime.isTurbo();

    switch (event.type) {
      case "round_start":
        // No siren sweep at spin start — keeps the round clean and red-free.
        return;
      case "board_settle": {
        const scatterCols = new Set<number>();
        for (let col = 0; col < GRID_COLUMNS; col++) {
          for (let row = 0; row < GRID_ROWS; row++) {
            if (event.board[col][row] === "PHONE_SCATTER") {
              scatterCols.add(col);
            }
          }
        }
        await this.board.settle(event.board, turbo, scatterCols.size >= 2 ? scatterCols : undefined);
        this.hasBoard = true;
        return;
      }
      case "scatter_tease":
        await this.board.scatterTease(event.positions, turbo);
        await this.effects.banner(snapshot.lastMessage, "", this.layout.board, turbo);
        return;
      case "cluster_win": {
        // Glowing trails connect the winning symbols so you SEE the combination.
        const centers = event.positions.map((p) => this.board.centerOf(p));
        void this.effects.clusterLink(centers, 0xffd95c, turbo);
        await this.board.highlight(event.positions, turbo);
        await this.effects.banner(snapshot.lastMessage, formatMultiplier(event.payout), this.layout.board, turbo);
        return;
      }
      case "tumble_remove":
        await this.board.remove(event.positions, turbo);
        return;
      case "tumble_drop":
        await this.board.tumbleTo(event.board, turbo);
        return;
      case "heat_advance":
        // No red police siren on a win any more — the cluster links carry the
        // combination feedback; the heat meter still updates in the HUD.
        this.hud.draw(this.layout, snapshot);
        return;
      case "heat_transform":
        await this.board.transform(event.board, event.positions, turbo);
        await this.effects.cashSpray(this.layout.board, event.positions, turbo);
        await this.effects.banner("Bust the Stash", "", this.layout.board, turbo);
        return;
      case "mega_wild_place":
        await this.board.megaWild(event.board, event.occupiedPositions, turbo);
        await this.effects.banner("Getaway Driver", "", this.layout.board, turbo);
        return;
      case "global_multiplier_apply":
        this.hud.draw(this.layout, snapshot);
        await this.effects.banner("Max Heat", `${event.value}x`, this.layout.board, turbo);
        return;
      case "bonus_trigger":
        this.bonusDeadSpins = 0;
        this.bonusActive = true;
        await this.board.scatterTease(event.scatterPositions, turbo);
        await this.bonus.intro(turbo);
        return;
      case "bonus_spin": {
        const landed = event.landedSymbols.map((s) => s.position);
        // Dead spin (nothing landed) stacks the heat; a hit resets it.
        if (landed.length > 0) this.bonusDeadSpins = 0;
        else this.bonusDeadSpins += 1;
        const heat = landed.length > 0 ? 0 : Math.min(3, this.bonusDeadSpins);
        this.runtime.onBonusHeat?.(heat);
        await this.bonus.playSpin(event.lockedGrid, landed, event.respinsAfter, this.bonusDeadSpins, turbo, this.runtime.onSafeLand);
        return;
      }
      case "safe_lock":
        // Value is shown on the gold bar and added to COLLECTED — no banner.
        return;
      case "master_key_crack":
        // Dynamite: shockwave, double neighbours, then it vanishes.
        await this.bonus.crack(
          event.keyPosition,
          event.affectedSafes.map((safe) => ({ position: safe.position, newValue: safe.newValue })),
          turbo
        );
        return;
      case "bonus_end":
        this.runtime.onBonusHeat?.(0);
        this.effects.screenShake(this.root, turbo);
        // The bonus shows its own clean, centered result card (no board-rect banner).
        await this.bonus.finish(event.filledScreen, event.totalPayout, turbo);
        return;
      case "round_end": {
        this.hud.draw(this.layout, snapshot);
        if (this.bonusActive) {
          // The chase already showed its centered result — hold, then fade out
          // smoothly back to the base board.
          this.bonusActive = false;
          await wait(turbo ? 150 : 550);
          await this.bonus.fadeOutAndHide(turbo);
          return;
        }
        if (event.payoutMultiplier === 0) {
          await wait(turbo ? 20 : 80);
          return;
        }
        const tier = winTier(event.payoutMultiplier);
        if (tier.intensity !== "low") {
          this.effects.cashRain(this.layout.board, turbo);
          this.effects.screenShake(this.root, turbo);
        }
        // GPU bloom + chromatic aberration are applied inside effects.banner (on the
        // mask-free effects layer) based on the win tier.
        await this.effects.banner(tier.title, formatMultiplier(event.payoutMultiplier), this.layout.board, turbo, tier.intensity);
        await wait(turbo ? 40 : 120);
        return;
      }
      default:
        return;
    }
  }
}

function previewBoard(runtime: SceneRuntime): Board {
  const settle = runtime.previewRecord.events.find((event): event is Extract<GameEvent, { type: "board_settle" }> => event.type === "board_settle");
  if (!settle) throw new Error("Preview record is missing board_settle");
  return settle.board;
}

function formatMultiplier(value: number): string {
  if (!value) return "";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
}

type WinIntensity = "low" | "mid" | "high" | "grand";

function winTier(mult: number): { title: string; intensity: WinIntensity } {
  if (mult >= 5000) return { title: "GRAND WIN", intensity: "grand" };
  if (mult >= 100)  return { title: "MEGA WIN", intensity: "high" };
  if (mult >= 20)   return { title: "BIG WIN", intensity: "mid" };
  if (mult >= 5)    return { title: "NICE WIN", intensity: "low" };
  return { title: "WIN", intensity: "low" };
}
