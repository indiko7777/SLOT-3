import { Application, Container } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type GameEvent, type Position } from "../domain";
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

  constructor(private readonly app: Application, private readonly runtime: SceneRuntime) {
    this.layout = computeLayout(app.screen.width, app.screen.height);
    this.hud = new HudView(runtime);
    this.root.addChild(this.hud, this.board, this.bonus, this.effects, this.paytable);
    this.app.stage.addChild(this.root);
  }

  /** Called on window resize only */
  resize(): void {
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    this.board.layout(this.layout.board);
    this.bonus.layout(this.layout.board);
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
    if (snapshot.bonusGrid) {
      this.bonus.setGrid(snapshot.bonusGrid, snapshot.respins, snapshot.highlighted, snapshot.cracked);
    }
  }

  togglePaytable(): void {
    this.paytable.toggle(this.layout.width, this.layout.height);
  }

  async playEvent(event: GameEvent, snapshot: PlaybackSnapshot): Promise<void> {
    this.currentSnapshot = snapshot;
    // Only update the HUD — do NOT resize or rebuild the board
    this.hud.updateStatus(this.layout, snapshot);

    const turbo = this.runtime.isTurbo();

    switch (event.type) {
      case "round_start":
        await this.effects.sirenSweep(this.layout.boardFrame, turbo);
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
      case "cluster_win":
        await this.board.highlight(event.positions, turbo);
        await this.effects.banner(snapshot.lastMessage, formatMultiplier(event.payout), this.layout.board, turbo);
        return;
      case "tumble_remove":
        await this.board.remove(event.positions, turbo);
        return;
      case "tumble_drop":
        await this.board.tumbleTo(event.board, turbo);
        return;
      case "heat_advance":
        this.hud.draw(this.layout, snapshot);
        await this.effects.sirenSweep(this.layout.boardFrame, turbo);
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
        await this.effects.sirenSweep(this.layout.boardFrame, turbo);
        await this.effects.banner("Max Heat", `${event.value}x`, this.layout.board, turbo);
        return;
      case "bonus_trigger":
        await this.board.scatterTease(event.scatterPositions, turbo);
        await this.bonus.intro(turbo);
        await this.effects.banner(snapshot.lastMessage, "", this.layout.board, turbo);
        return;
      case "bonus_spin":
        if (event.landedSymbols.length >= GRID_COLUMNS * GRID_ROWS) {
          await this.bonus.grandReveal(event.lockedGrid, event.landedSymbols.map((s) => s.position), event.respinsAfter, turbo, this.runtime.onSafeLand);
        } else {
          this.bonus.setGrid(event.lockedGrid, event.respinsAfter, event.landedSymbols.map((symbol) => symbol.position), []);
          await this.bonus.pulse(event.landedSymbols.map((symbol) => symbol.position), turbo);
        }
        return;
      case "safe_lock":
        await this.effects.banner(snapshot.lastMessage, `${event.value}x`, this.layout.board, turbo);
        return;
      case "master_key_crack": {
        if (snapshot.bonusGrid) {
          this.bonus.setGrid(snapshot.bonusGrid, snapshot.respins, [event.keyPosition], event.affectedSafes.map((safe) => safe.position));
        }
        const from = this.bonus.centerOf(event.keyPosition);
        const targets = event.affectedSafes.map((safe) => this.bonus.centerOf(safe.position));
        await this.effects.keyBeam(from, targets, turbo);
        await this.bonus.pulse(event.affectedSafes.map((safe) => safe.position), turbo);
        await this.effects.banner("Master Key Crack", "", this.layout.board, turbo);
        return;
      }
      case "bonus_end":
        this.effects.cashRain(this.layout.board, turbo);
        this.effects.screenShake(this.root, turbo);
        await this.effects.banner(snapshot.lastMessage, formatMultiplier(event.totalPayout), this.layout.board, turbo);
        return;
      case "round_end": {
        this.hud.draw(this.layout, snapshot);
        if (event.payoutMultiplier === 0) {
          await wait(turbo ? 20 : 80);
          return;
        }
        const tier = winTier(event.payoutMultiplier);
        if (tier.intensity !== "low") {
          this.effects.cashRain(this.layout.board, turbo);
          this.effects.screenShake(this.root, turbo);
        }
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
