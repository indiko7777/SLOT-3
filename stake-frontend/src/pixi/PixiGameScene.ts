import { Application, Container, Sprite, Graphics, Text, TextStyle } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type BonusCell, type GameEvent, type Position, type SymbolId } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import { BoardView } from "./BoardView";
import { BonusView } from "./BonusView";
import { EffectsLayer } from "./EffectsLayer";
import { HudView } from "./HudView";
import { PaytableView } from "./PaytableView";
import { SymbolView } from "./SymbolView";
import { computeLayout } from "./layout";
import { getExtraTexture } from "./assets";
import { tween, wait, easeInOutCubic, easeOutBack } from "./tween";
import type { LayoutMetrics, SceneRuntime } from "./types";
import { OutlineFilter } from "pixi-filters";

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
  private readonly collectedWilds = new Set<SymbolView>();

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

  /** Called on window resize — recomputes layout and immediately redraws all panels. */
  resize(): void {
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    this.board.layout(this.layout.board);
    // The Getaway bonus is a full-screen POV chase.
    this.bonus.layout({ x: 0, y: 0, width: this.layout.width, height: this.layout.height });
    // Redraw the HUD so all panels, text, and controls move immediately to their
    // new positions. Without this the HUD only updates on the next renderSnapshot
    // call, causing a visible lag where the board and HUD are misaligned.
    if (this.currentSnapshot) {
      this.hud.draw(this.layout, this.currentSnapshot);
    }
  }

  resetRound(snapshot: PlaybackSnapshot): void {
    this.collectedWilds.clear();
    this.currentSnapshot = snapshot;
    this.bonus.hide();
    // DON'T rebuild the board here — the spin animation will handle it.
    // Only update the HUD status text.
    this.hud.draw(this.layout, snapshot);
  }

  renderSnapshot(snapshot: PlaybackSnapshot): void {
    this.currentSnapshot = snapshot;
    snapshot.collectionCount = this.runtime.getCollectionCount();
    // Recompute layout and re-lay the board out to the new dimensions.
    // The HUD is also redrawn inside resize() if currentSnapshot is set,
    // so we don't need a second draw() call — just do it once below.
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    this.board.layout(this.layout.board);
    this.bonus.layout({ x: 0, y: 0, width: this.layout.width, height: this.layout.height });
    this.board.updateCollectionCounter(snapshot.collectionCount);
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
    this.collectedWilds.clear();
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
        const pool: SymbolId[] = ["BRASS", "KNIFE", "PISTOL", "AMMO", "DUFFEL", "DIAMOND", "BIKE"];
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

      case "collection": {
        if (arg === "next") {
          const board = this.currentSnapshot?.board || this.uniformBoard("BRASS");
          let wildPos: Position = [2, 2];
          let found = false;
          for (let col = 0; col < GRID_COLUMNS; col++) {
            for (let row = 0; row < GRID_ROWS; row++) {
              if (board[col][row] === "WILD") {
                wildPos = [col, row];
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (!found) {
            board[2][2] = "WILD";
            this.board.setInstant(board);
            this.hasBoard = true;
          }
          await this.runCollectionAnimation(wildPos, turbo);
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
        await this.checkAndPlayCollectionAnimation(event.board, turbo);
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
        // Clear winning symbols and leave the holes — tumble_drop refills them
        // from the authoritative RGS board so symbols fall down with no blanks.
        await this.board.clearWins(event.positions, turbo);
        return;
      case "tumble_drop":
        await this.board.tumbleTo(event.board, turbo);
        await this.checkAndPlayCollectionAnimation(event.board, turbo);
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
          // The chase result card waits for the player's tap inside finish(), so
          // by the time we reach round_end they've acknowledged it — fade straight out.
          this.bonusActive = false;
          await wait(turbo ? 40 : 140);
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

  private async checkAndPlayCollectionAnimation(board: Board, turbo: boolean): Promise<void> {
    const wildPositions: Position[] = [];
    for (let col = 0; col < GRID_COLUMNS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        if (board[col][row] === "WILD") {
          const symbolView = this.board.getSymbolView([col, row]);
          if (symbolView && !this.collectedWilds.has(symbolView)) {
            wildPositions.push([col, row]);
            this.collectedWilds.add(symbolView);
          }
        }
      }
    }
    if (wildPositions.length === 0) return;
    for (const pos of wildPositions) {
      await this.runCollectionAnimation(pos, turbo);
    }
  }

  private async runCollectionAnimation(pos: Position, turbo: boolean): Promise<void> {
    const symbolView = this.board.getSymbolView(pos);
    if (!symbolView) return;

    // 1. Increment collection count (1 to 7, wraps for test)
    const newCount = this.runtime.incrementCollectionCount();

    // 2. Glowing Wild symbol pops out of the reel frame
    if (symbolView.parent) {
      symbolView.parent.addChild(symbolView);
    }
    const origScaleX = symbolView.scale.x;
    const origScaleY = symbolView.scale.y;

    await tween(turbo ? 120 : 300, (p) => {
      const s = 1 + 0.45 * Math.sin(p * Math.PI);
      symbolView.scale.set(origScaleX * s, origScaleY * s);
    }, easeOutBack);

    const width = this.layout.width;
    const height = this.layout.height;
    const boardCenter = this.board.centerOf(pos);
    const sourceX = boardCenter.x;
    const sourceY = boardCenter.y;

    if (this.layout.portrait) {
      // --- PORTRAIT MODE: POP-UP OVERLAY ---
      const overlay = new Container();
      const overlayBg = new Graphics();
      overlayBg.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.85 });
      overlay.addChild(overlayBg);
      overlay.alpha = 0;
      this.root.addChild(overlay);

      const silTex = getExtraTexture("char_silhouette");
      if (silTex) {
        const charContainer = new Container();
        const silSprite = new Sprite(silTex);
        silSprite.anchor.set(0.5);
        silSprite.x = 57.5; // Shift shadow right to align with the pieces
        silSprite.y = 27.5; // Shift shadow down to align with the pieces
        silSprite.tint = 0x000000;
        const outline = new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1.0 });
        outline.resolution = window.devicePixelRatio || 1;
        silSprite.filters = [outline];
        charContainer.addChild(silSprite);

        // Add already-collected pieces
        for (let i = 1; i < newCount; i++) {
          const pieceTex = getExtraTexture(`char_piece_${i}`);
          if (pieceTex) {
            const pieceSprite = new Sprite(pieceTex);
            pieceSprite.anchor.set(0.5);
            charContainer.addChild(pieceSprite);
          }
        }

        const silScale = Math.min((width * 0.8) / silTex.width, (height * 0.6) / silTex.height);
        charContainer.scale.set(silScale);
        charContainer.position.set(width / 2, height / 2 - 40);
        overlay.addChild(charContainer);

        // Fade in overlay
        await tween(200, (p) => {
          overlay.alpha = p;
        });

        const pieceTex = getExtraTexture(`char_piece_${newCount}`);
        if (pieceTex) {
          const flySprite = new Sprite(pieceTex);
          flySprite.anchor.set(0.5);
          flySprite.position.set(sourceX, sourceY);
          const startScale = 0.25;
          const endScale = silScale;
          flySprite.scale.set(startScale);
          overlay.addChild(flySprite);

          const targetX = charContainer.x;
          const targetY = charContainer.y;

          await tween(turbo ? 250 : 550, (p) => {
            flySprite.x = sourceX + (targetX - sourceX) * p;
            flySprite.y = sourceY + (targetY - sourceY) * p;
            flySprite.scale.set(startScale + (endScale - startScale) * p);
            flySprite.rotation = (1 - p) * 0.4;
          }, easeInOutCubic);

          flySprite.destroy();

          const pieceSprite = new Sprite(pieceTex);
          pieceSprite.anchor.set(0.5);
          charContainer.addChild(pieceSprite);

          await this.triggerSnapImpact(targetX, targetY, overlay, newCount);

          if (newCount === 8) {
            await this.triggerCompletionOverlay(charContainer, silScale, targetX, targetY, overlay);
          }

          await wait(turbo ? 200 : 500);
        }

        await tween(300, (p) => {
          overlay.alpha = 1 - p;
        });
        overlay.destroy({ children: true });
      }
    } else {
      // --- LANDSCAPE MODE: PERSISTENT FILL ---
      const artRect = this.layout.artPanel;
      if (artRect) {
        const silTex = getExtraTexture("char_silhouette");
        if (silTex) {
          const boxW = artRect.width - 24;
          const boxH = artRect.height - 84;
          const endScale = Math.min(boxW / silTex.width, boxH / silTex.height);
          const targetX = artRect.x + artRect.width / 2;
          const targetY = artRect.y + 60 + (artRect.height - 60) / 2;

          const pieceTex = getExtraTexture(`char_piece_${newCount}`);
          if (pieceTex) {
            const flySprite = new Sprite(pieceTex);
            flySprite.anchor.set(0.5);
            flySprite.position.set(sourceX, sourceY);
            const startScale = 0.25;
            flySprite.scale.set(startScale);
            this.root.addChild(flySprite);

            await tween(turbo ? 250 : 550, (p) => {
              flySprite.x = sourceX + (targetX - sourceX) * p;
              flySprite.y = sourceY + (targetY - sourceY) * p;
              flySprite.scale.set(startScale + (endScale - startScale) * p);
              flySprite.rotation = (1 - p) * 0.4;
            }, easeInOutCubic);

            flySprite.destroy();

            await this.triggerSnapImpact(targetX, targetY, this.root, newCount);

            if (newCount === 8) {
              const celebrationContainer = new Container();
              const fullTex = getExtraTexture("char_full");
              if (fullTex) {
                const fullSprite = new Sprite(fullTex);
                fullSprite.anchor.set(0.5);
                fullSprite.scale.set(endScale);
                fullSprite.position.set(targetX, targetY);
                celebrationContainer.addChild(fullSprite);
                this.root.addChild(celebrationContainer);

                // Update state beforehand so HUD is drawn fully under the FX
                if (this.currentSnapshot) {
                  this.currentSnapshot.collectionCount = newCount;
                  this.hud.draw(this.layout, this.currentSnapshot);
                }

                await this.triggerCompletionOverlay(celebrationContainer, endScale, targetX, targetY, this.root);
                await wait(800);
                celebrationContainer.destroy({ children: true });
              }
            }
          }
        }
      }
    }

    this.board.updateCollectionCounter(newCount);

    if (this.currentSnapshot) {
      this.currentSnapshot.collectionCount = newCount;
      this.hud.draw(this.layout, this.currentSnapshot);
    }

    await tween(100, (p) => {
      symbolView.scale.set(origScaleX * (1.45 - 0.45 * p), origScaleY * (1.45 - 0.45 * p));
    });
    symbolView.scale.set(origScaleX, origScaleY);
  }

  private async triggerSnapImpact(x: number, y: number, parentContainer: Container, count: number): Promise<void> {
    this.effects.screenShake(this.root, false);

    const flash = new Graphics();
    flash.rect(0, 0, this.layout.width, this.layout.height).fill({ color: 0xffffff, alpha: 0.5 });
    parentContainer.addChild(flash);
    void tween(200, (p) => {
      flash.alpha = 0.5 * (1 - p);
    }).then(() => flash.destroy());

    const particlesContainer = new Container();
    parentContainer.addChild(particlesContainer);

    const particles: Array<{ sprite: Graphics; vx: number; vy: number; scaleSpeed: number }> = [];
    const colors = [0xffd95c, 0x9ae64e, 0xffffff];
    for (let i = 0; i < 24; i++) {
      const p = new Graphics();
      const color = colors[Math.floor(Math.random() * colors.length)]!;
      const r = 3 + Math.random() * 5;
      p.circle(0, 0, r).fill({ color });
      p.x = x;
      p.y = y;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      particlesContainer.addChild(p);
      particles.push({
        sprite: p,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        scaleSpeed: 0.02 + Math.random() * 0.03
      });
    }

    await tween(400, (progress) => {
      for (const p of particles) {
        p.sprite.x += p.vx;
        p.sprite.y += p.vy;
        p.sprite.alpha = 1 - progress;
        p.sprite.scale.set(Math.max(0, 1 - progress * p.scaleSpeed * 10));
      }
    });

    particlesContainer.destroy({ children: true });
  }

  private async triggerCompletionOverlay(
    charContainer: Container,
    scale: number,
    targetX: number,
    targetY: number,
    parentContainer: Container
  ): Promise<void> {
    const fullTex = getExtraTexture("char_full");
    if (!fullTex) return;

    const fullSprite = new Sprite(fullTex);
    fullSprite.anchor.set(0.5);
    fullSprite.alpha = 0;
    charContainer.addChild(fullSprite);

    await tween(400, (p) => {
      fullSprite.alpha = p;
    });

    const sweepContainer = new Container();
    parentContainer.addChild(sweepContainer);

    const particles: Array<{ sprite: Graphics; vx: number; vy: number; rotSpeed: number }> = [];
    for (let i = 0; i < 45; i++) {
      const p = new Graphics();
      const r = 4 + Math.random() * 6;
      p.poly([0, -r, r / 2, -r / 2, r, 0, r / 2, r / 2, 0, r, -r / 2, r / 2, -r, 0, -r / 2, -r / 2]).fill({ color: 0xffd95c });
      p.x = targetX;
      p.y = targetY;
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 8;
      sweepContainer.addChild(p);
      particles.push({
        sprite: p,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotSpeed: 0.05 + Math.random() * 0.1
      });
    }

    const textGlow = new Text({
      text: "BEACH GIRL COMPLETED!",
      style: new TextStyle({
        fill: 0xffd95c,
        fontFamily: "Impact, 'Arial Black', Arial, sans-serif",
        fontSize: 36,
        fontWeight: "900",
        letterSpacing: 2,
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 8, distance: 0 }
      })
    });
    textGlow.anchor.set(0.5);
    textGlow.position.set(this.layout.width / 2, this.layout.height / 2 - 140);
    textGlow.scale.set(0.2);
    textGlow.alpha = 0;
    parentContainer.addChild(textGlow);

    void tween(400, (p) => {
      textGlow.alpha = p;
      textGlow.scale.set(0.2 + 0.8 * p);
    }, easeOutBack);

    await tween(1200, (p) => {
      for (const pt of particles) {
        pt.sprite.x += pt.vx;
        pt.sprite.y += pt.vy * 0.8 + 2.0;
        pt.sprite.rotation += pt.rotSpeed;
        pt.sprite.alpha = Math.max(0, 1.2 - p);
      }
      textGlow.style.fill = p % 0.2 < 0.1 ? 0xffffff : 0xffd95c;
    });

    void tween(300, (p) => {
      textGlow.alpha = 1 - p;
    }).then(() => {
      textGlow.destroy();
      sweepContainer.destroy({ children: true });
    });
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
