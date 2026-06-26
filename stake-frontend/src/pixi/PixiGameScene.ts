import { Application, Container, Sprite, Graphics, Text, TextStyle } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type BonusCell, type GameEvent, type Position, type SymbolId } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import type { PieceGain } from "../meta/collection";
import { rewardFor } from "../meta/rewards";
import { BoardView } from "./BoardView";
import { BonusView } from "./BonusView";
import { EffectsLayer } from "./EffectsLayer";
import { HudView } from "./HudView";
import { PaytableView } from "./PaytableView";
import { SymbolView, WIN_ACCENT, DEFAULT_ACCENT } from "./SymbolView";
import { computeLayout } from "./layout";
import { getExtraTexture } from "./assets";
import { tween, wait, easeInOutCubic, easeOutBack, easeOutCubic } from "./tween";
import type { LayoutMetrics, SceneRuntime } from "./types";
import { OutlineFilter } from "pixi-filters";
import { CardPeekView } from "./CardPeekView";
import { GalleryView } from "./GalleryView";

export class PixiGameScene {
  private readonly root = new Container();
  private readonly hud: HudView;
  private readonly board = new BoardView();
  private readonly bonus = new BonusView();
  private readonly effects = new EffectsLayer();
  private readonly paytable = new PaytableView();
  private readonly cardPeek: CardPeekView;
  private readonly gallery: GalleryView;
  private layout: LayoutMetrics;
  private currentSnapshot: PlaybackSnapshot | null = null;
  private hasBoard = false;
  private bonusDeadSpins = 0;
  private bonusActive = false;
  /** WILDs already counted toward the collection this round (dedup across tumbles). */
  private readonly collectedWilds = new Set<SymbolView>();
  /** DEV-only: drives the debug panel's "Trigger Next Piece" preview animation. */
  private debugPieceCounter = 0;

  private devGalleryProgress: any = null;

  constructor(private readonly app: Application, private readonly runtime: SceneRuntime) {
    this.layout = computeLayout(app.screen.width, app.screen.height);
    const runtimeProxy = {
      ...runtime,
      getGalleryProgress: () => this.devGalleryProgress || runtime.getGalleryProgress()
    };
    this.hud = new HudView(runtimeProxy);
    this.board.setAudioHooks({
      onReelStop: (col, total) => runtime.onReelStop?.(col, total),
      onAnticipation: () => runtime.onAnticipation?.(),
    });
    this.cardPeek = new CardPeekView(runtimeProxy, () => {
      this.gallery.toggle(this.layout.width, this.layout.height);
    });
    this.gallery = new GalleryView(runtimeProxy);
    
    // Layer order: hud, board, and cardPeek are base layers.
    // bonus, effects are transient overlays on top.
    // paytable and gallery are fullscreen modals covering everything.
    this.root.addChild(
      this.hud,
      this.board,
      this.cardPeek,
      this.bonus,
      this.effects,
      this.paytable,
      this.gallery
    );
    this.app.stage.addChild(this.root);

    // Cinematic win event listeners to bridge EffectsLayer to HUD & Audio
    this.effects.on("win_count_update", (amount: number) => {
      this.hud.setWinAmountDirect(amount);
    });
    this.effects.on("win_tick", (tier: string) => {
      if (this.runtime.playAudio) {
        const soundKey = tier === "grand" ? "win_tick_high" : tier === "mega" ? "win_tick_mid" : "win_tick_low";
        this.runtime.playAudio(soundKey);
      }
    });
    this.effects.on("win_tier_changed", (tier: string) => {
      if (this.runtime.playAudio) {
        const soundKey = tier === "grand" ? "win_tick_high" : tier === "mega" ? "win_tick_mid" : "win_tick_low";
        this.runtime.playAudio(soundKey);
      }
    });
    this.effects.on("win_climax", (tier: string) => {
      if (this.runtime.playAudio) {
        const soundKey = tier === "grand" ? "mega_win" : tier === "mega" ? "win_big" : "win_big";
        this.runtime.playAudio(soundKey, 1.0);
      }
    });
  }

  /** Called on window resize — recomputes layout and immediately redraws all panels. */
  resize(): void {
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height);
    this.board.layout(this.layout.board);
    // The Getaway bonus is a full-screen POV chase.
    this.bonus.layout({ x: 0, y: 0, width: this.layout.width, height: this.layout.height });
    this.cardPeek.layout(this.layout);
    if (this.gallery.visible) {
      this.gallery.show(this.layout.width, this.layout.height);
    }
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
    
    // Position/update the card peek view and gallery view
    const isBonusActive = snapshot.bonusGrid && snapshot.state.startsWith("bonus");
    this.cardPeek.visible = !isBonusActive && !this.bonusActive;
    this.cardPeek.layout(this.layout);
    if (this.gallery.visible) {
      this.gallery.show(this.layout.width, this.layout.height);
    }

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
    this.debugPieceCounter = 0;
    this.devGalleryProgress = null;
    this.bonus.hide();
    this.bonusActive = false;
    if (this.currentSnapshot) { this.hasBoard = false; this.renderSnapshot(this.currentSnapshot); }
  }

  /** Big-win cinematic for a tier (banner + bloom + chromatic glitch). */
  async debugBigWin(intensity: "mid" | "high" | "grand"): Promise<void> {
    const mult = intensity === "grand" ? 5000 : intensity === "high" ? 250 : 25;
    const bet = 1.0;
    const currency = this.runtime.getCurrency();
    void this.board.highlight(this.allPositions(), false);

    // Reset HUD win display to 0 for debugging count up
    this.hud.setWinAmountDirect(0);
    await this.effects.cinematicWin(
      mult,
      bet,
      this.layout.board,
      false,
      currency,
      (amt) => this.hud.setWinAmountDirect(amt)
    );
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
        void this.playCombinationAnimation("CASH", win, turbo);
        await this.board.highlight(win, turbo);           // light the combination
        await wait(300);
        await this.board.remove(win, turbo);              // clear + gravity refill
        return;
      }

      case "cascade_flow": {
        // Full 3-cascade chain exactly as a real spin plays it, including the
        // Heat-3 "Bust the Stash" transform. Layout:
        //   Cascade 1 — CASH cluster rows 2-3 of cols 0-2
        //   Cascade 2 — CASH cluster rows 0-1 of cols 0-2 (fell in from above)
        //   Cascade 3 — same cluster forms again → Heat 3 → transform cols 3-4 rows 0-1
        this.bonus.hide();

        // ── boards ──────────────────────────────────────────────────────────────
        const b0: Board = [
          ["BRASS", "KNIFE", "CASH", "CASH"],
          ["AMMO",  "DUFFEL","CASH", "CASH"],
          ["PISTOL","BRASS", "CASH", "CASH"],
          ["KNIFE", "AMMO",  "DUFFEL","BRASS"],
          ["DUFFEL","PISTOL","BRASS", "KNIFE"],
        ];
        const win1: Position[] = [[0,2],[0,3],[1,2],[1,3],[2,2],[2,3]];

        // after clearing win1: survivors fall to rows 2-3; CASH drops into rows 0-1
        const b1: Board = [
          ["CASH","CASH","BRASS","KNIFE"],
          ["CASH","CASH","AMMO", "DUFFEL"],
          ["CASH","CASH","PISTOL","BRASS"],
          ["KNIFE","AMMO","DUFFEL","BRASS"],
          ["DUFFEL","PISTOL","BRASS","KNIFE"],
        ];
        const win2: Position[] = [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]];

        // after clearing win2: survivors stay at rows 2-3; more CASH at rows 0-1
        const b2: Board = [
          ["CASH","CASH","BRASS","KNIFE"],
          ["CASH","CASH","AMMO", "DUFFEL"],
          ["CASH","CASH","PISTOL","BRASS"],
          ["KNIFE","AMMO","DUFFEL","BRASS"],
          ["DUFFEL","PISTOL","BRASS","KNIFE"],
        ];
        const win3: Position[] = [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]];

        // heat_transform board: cols 3-4 rows 0-1 flip to CASH (winning cluster still present)
        const b2t: Board = [
          ["CASH","CASH","BRASS","KNIFE"],
          ["CASH","CASH","AMMO", "DUFFEL"],
          ["CASH","CASH","PISTOL","BRASS"],
          ["CASH","CASH","DUFFEL","BRASS"],   // ← transformed
          ["CASH","CASH","BRASS","KNIFE"],    // ← transformed
        ];
        const transformPos: Position[] = [[3,0],[3,1],[4,0],[4,1]];

        // after clearing win3 (cols 0-2 rows 0-1): survivors fall; cols 3-4 keep CASH
        const b3: Board = [
          ["AMMO","KNIFE","BRASS","KNIFE"],
          ["BRASS","DUFFEL","AMMO","DUFFEL"],
          ["DUFFEL","AMMO","PISTOL","BRASS"],
          ["CASH","CASH","DUFFEL","BRASS"],   // transformed CASH survives!
          ["CASH","CASH","BRASS","KNIFE"],
        ];

        // ── play ────────────────────────────────────────────────────────────────
        this.board.setInstant(b0);
        this.hasBoard = true;
        await wait(turbo ? 120 : 500);

        // Cascade 1
        void this.playCombinationAnimation("CASH", win1, turbo);
        await this.board.highlight(win1, turbo);
        await this.board.clearWins(win1, turbo);
        await this.board.tumbleTo(b1, turbo);
        await wait(turbo ? 80 : 300);

        // Cascade 2
        void this.playCombinationAnimation("CASH", win2, turbo);
        await this.board.highlight(win2, turbo);
        await this.board.clearWins(win2, turbo);
        await this.board.tumbleTo(b2, turbo);
        await wait(turbo ? 80 : 300);

        // Cascade 3 — Heat 3 fires: Bust the Stash
        void this.playCombinationAnimation("CASH", win3, turbo);
        await this.board.highlight(win3, turbo);
        // Banner announces Bust the Stash before the board changes
        await this.effects.banner("Bust the Stash", "", this.layout.board, turbo);
        // heat_transform: non-winning symbols morph to CASH
        await this.board.transform(b2t, transformPos, turbo);
        // tumble_remove + tumble_drop
        await this.board.clearWins(win3, turbo);
        await this.board.tumbleTo(b3, turbo);

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
          // DEV preview only — animates the next piece without touching the real
          // persistent gallery (that is driven by shards in main.ts).
          this.debugPieceCounter = (this.debugPieceCounter % 8) + 1;
          const completedGirl = this.debugPieceCounter === 8;
          const gain: PieceGain = {
            girlId: 0,
            pieceIndex: this.debugPieceCounter,
            totalPieces: 8,
            artPrefix: "char",
            completedGirl,
            galleryComplete: false,
            unlockId: completedGirl ? "skin_neon" : null
          };
          this.devGalleryProgress = {
            girlId: 0,
            girlName: "Sapphire",
            artPrefix: "char",
            pieces: this.debugPieceCounter,
            totalPieces: 8,
            completedGirls: 0,
            totalGirls: 3,
            mastered: false
          };
          
          if (completedGirl) this.debugPieceCounter = 0;
          await this.runCollectionAnimation([2, 2], gain, turbo);
        } else if (arg === "flow") {
          const { GIRLS } = await import("../meta/collection");
          for (let girlId = 0; girlId < 3; girlId++) {
            const girl = GIRLS[girlId];
            const maxPieces = girl.pieces;
            for (let piece = 1; piece <= maxPieces; piece++) {
              const completedGirl = piece === maxPieces;
              const galleryComplete = girlId === 2 && completedGirl;
              const gain: PieceGain = {
                girlId,
                pieceIndex: piece,
                totalPieces: maxPieces,
                artPrefix: girl.artPrefix,
                completedGirl,
                galleryComplete,
                unlockId: completedGirl ? girl.unlockId : null
              };
              this.devGalleryProgress = {
                girlId,
                girlName: girl.name,
                artPrefix: girl.artPrefix,
                pieces: piece,
                totalPieces: maxPieces,
                completedGirls: girlId,
                totalGirls: 3,
                mastered: galleryComplete
              };
              
              await this.runCollectionAnimation([2, 2], gain, turbo);
              await wait(turbo ? 150 : 400);
            }
          }
          // Do not reset devGalleryProgress so the user can see the final state
          if (this.currentSnapshot) this.hud.draw(this.layout, this.currentSnapshot);
        }
        return;
      }
    }
  }

  playCombinationAnimation(symbolId: SymbolId, positions: Position[], turbo: boolean): Promise<void> {
    const accent = WIN_ACCENT[symbolId] ?? DEFAULT_ACCENT;
    const centers = positions.map((p) => this.board.centerOf(p));
    const isGreen = symbolId === "WILD" || symbolId === "CAR_WILD" || accent === 0x9ae64e;

    if (isGreen) {
      return this.effects.clusterLink(centers, 0xffd95c, turbo);
    } else if (accent === 0xe056fd) {
      if (centers.length > 1) {
        return this.effects.keyBeam(centers[0], centers.slice(1), turbo, accent);
      } else {
        return this.effects.clusterLink(centers, accent, turbo);
      }
    } else {
      return this.effects.clusterLink(centers, accent, turbo);
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

        // Flash every WILD that just landed — this fires regardless of whether
        // a gallery piece unlocks. The WILD must NEVER land silently.
        await this.flashWildLanding(event.board, turbo);

        await this.checkAndPlayCollectionAnimation(event.board, turbo);
        return;
      }
      case "scatter_tease":
        await this.board.scatterTease(event.positions, turbo);
        await this.effects.banner(snapshot.lastMessage, "", this.layout.board, turbo);
        return;
      case "cluster_win": {
        void this.playCombinationAnimation(event.symbol, event.positions, turbo);
        await this.board.highlight(event.positions, turbo);
        // No per-cascade pop-up — total win is shown at round_end like normal slots.
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
      case "heat_advance": {
        // Rebuild HUD so the new star shows as filled, then animate that star in
        // concurrently with the upcoming tumble — player sees the heat climb in real time.
        this.hud.draw(this.layout, snapshot);
        if (!turbo) {
          const headStart = this.runtime.getHeadStartStars?.() ?? 0;
          void this.hud.animateStarFill(headStart + event.to - 1);
        }
        return;
      }
      case "heat_transform":
        // Banner first — player reads "Bust the Stash" before the board changes.
        await this.effects.banner("Bust the Stash", "", this.layout.board, turbo);
        await this.board.transform(event.board, event.positions, turbo);
        return;
      case "mega_wild_place":
        await this.board.megaWild(event.board, event.occupiedPositions, turbo);
        await this.effects.banner("Getaway Driver", "", this.layout.board, turbo);
        return;
      case "global_multiplier_apply":
        this.hud.draw(this.layout, snapshot);
        return;
      case "bonus_trigger":
        this.bonusDeadSpins = 0;
        this.bonusActive = true;
        this.cardPeek.visible = false;
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
          this.cardPeek.visible = true;
          this.cardPeek.layout(this.layout);
          return;
        }
        if (event.payoutMultiplier === 0) {
          await wait(turbo ? 20 : 80);
          return;
        }

        // Only show banners for wins >= 20x, matching industrial slot standards.
        if (event.payoutMultiplier >= 20) {
          const currency = this.runtime.getCurrency();
          // Reset HUD win text to 0 so it counts up in sync with the cinematic win counter
          this.hud.setWinAmountDirect(0);
          await this.effects.cinematicWin(
            event.payoutMultiplier,
            snapshot.betAmount,
            this.layout.board,
            turbo,
            currency,
            (amt) => this.hud.setWinAmountDirect(amt)
          );
        } else {
          // Wins < 20x: No banner, just wait briefly.
          // The total win is already drawn in the bottom panel (the HUD win text) during hud.draw().
          await wait(turbo ? 50 : 250);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Each rare WILD on the board reveals ONE body part. We dedup by symbol-view
   * so a WILD that survives tumbles is only counted once, then ask the gallery
   * (runtime.collectWild) to advance + persist and animate the part it reveals.
   */
  private async checkAndPlayCollectionAnimation(board: Board, turbo: boolean): Promise<void> {
    const newWilds: Position[] = [];
    for (let col = 0; col < GRID_COLUMNS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        if (board[col][row] === "WILD") {
          const view = this.board.getSymbolView([col, row]);
          if (view && !this.collectedWilds.has(view)) {
            this.collectedWilds.add(view);
            newWilds.push([col, row]);
          }
        }
      }
    }
    for (const pos of newWilds) {
      const gain = this.runtime.collectWild();
      if (!gain) continue; // no piece unlocked this WILD — keep looping for others
      await this.runCollectionAnimation(pos, gain, turbo);
    }
  }

  /**
   * Electric green pulse fired on every WILD cell that just landed.
   * Runs concurrently with the collection animation so it never adds wait time.
   */
  private async flashWildLanding(board: Board, turbo: boolean): Promise<void> {
    if (turbo) return;
    const wildPositions: Position[] = [];
    for (let col = 0; col < GRID_COLUMNS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        if (board[col][row] === "WILD") wildPositions.push([col, row]);
      }
    }
    if (wildPositions.length === 0) return;

    // Use the board's winCelebrate highlight so the cell gets the green glow
    // border + shimmer streak — the same treatment any winning symbol gets.
    const celebratePromises = wildPositions.map((p) => {
      const view = this.board.getSymbolView(p);
      return view ? view.winCelebrate(false) : Promise.resolve();
    });

    // Overlay: electric green radial burst on each WILD cell
    const burstCleanup: (() => void)[] = [];
    for (const pos of wildPositions) {
      const center = this.board.centerOf(pos);
      const burst = new Graphics();
      burst.circle(0, 0, 60).fill({ color: 0x9ae64e, alpha: 0.28 });
      burst.circle(0, 0, 36).fill({ color: 0x9ae64e, alpha: 0.18 });
      burst.circle(0, 0, 18).fill({ color: 0xffffff, alpha: 0.22 });
      burst.position.set(center.x, center.y);
      burst.alpha = 0;
      burst.scale.set(0.4);
      this.effects.addChild(burst);
      burstCleanup.push(() => burst.destroy());
      // Fire-and-forget — runs in parallel
      void tween(520, (p) => {
        burst.alpha = p < 0.18 ? p / 0.18 : (1 - p) / 0.82;
        burst.scale.set(0.4 + 1.6 * p);
      }, easeOutCubic).then(() => burst.destroy());
    }

    // Short electric flash banner (non-blocking — it's a quick pop)
    void this.effects.banner("W!LD", "", this.layout.board, false, "low");

    await Promise.all(celebratePromises);
    // Cleanup any bursts that are still alive (shouldn't be, but safety)
    for (const cleanup of burstCleanup) cleanup();
  }

  private async runCollectionAnimation(pos: Position, gain: PieceGain, turbo: boolean): Promise<void> {
    const newCount = gain.pieceIndex;
    const prefix = gain.artPrefix;
    const completed = gain.completedGirl;

    // The piece flies from a board cell if one is showing there; otherwise it
    // simply animates into the assembly (e.g. girls 2/3 before their art exists).
    const symbolView = this.board.getSymbolView(pos);
    const origScaleX = symbolView?.scale.x ?? 1;
    const origScaleY = symbolView?.scale.y ?? 1;

    if (symbolView) {
      if (symbolView.parent) symbolView.parent.addChild(symbolView);
      await tween(turbo ? 120 : 300, (p) => {
        const s = 1 + 0.45 * Math.sin(p * Math.PI);
        symbolView.scale.set(origScaleX * s, origScaleY * s);
      }, easeOutBack);
    }

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

      const silTex = getExtraTexture(`${prefix}_silhouette`);
      if (silTex) {
        const charContainer = new Container();
        const silSprite = new Sprite(silTex);
        silSprite.anchor.set(0.5);
        silSprite.x = prefix === "char" ? 57.5 : 0; // Shift shadow right to align with the pieces
        silSprite.y = prefix === "char" ? 27.5 : 0; // Shift shadow down to align with the pieces
        silSprite.tint = 0x000000;
        const outline = new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1.0 });
        outline.resolution = window.devicePixelRatio || 1;
        silSprite.filters = [outline];
        charContainer.addChild(silSprite);

        // Add already-collected pieces
        for (let i = 1; i < newCount; i++) {
          const pieceTex = getExtraTexture(`${prefix}_piece_${i}`);
          if (pieceTex) {
            const pieceSprite = new Sprite(pieceTex);
            pieceSprite.anchor.set(0.5);
            charContainer.addChild(pieceSprite);
          }
        }

        const rawSilScale = Math.min((this.layout.width - 40) / silTex.width, (this.layout.height - 300) / silTex.height);
        const silScale = prefix !== "char" ? rawSilScale * 1.25 : rawSilScale;
        charContainer.scale.set(silScale);
        charContainer.position.set(width / 2, height / 2 - 40);
        overlay.addChild(charContainer);

        // Fade in overlay
        await tween(200, (p) => {
          overlay.alpha = p;
        });

        const pieceTex = getExtraTexture(`${prefix}_piece_${newCount}`);
        if (pieceTex) {
          const flySprite = new Sprite(pieceTex);
          flySprite.anchor.set(0.5);
          const targetX = charContainer.x;
          const targetY = charContainer.y;
          const startScale = silScale * 3.0; // Start huge!
          flySprite.position.set(sourceX, sourceY);
          flySprite.scale.set(startScale);
          flySprite.alpha = 0;
          overlay.addChild(flySprite);

          await tween(turbo ? 200 : 500, (p) => {
            flySprite.position.set(sourceX + (targetX - sourceX) * p, sourceY + (targetY - sourceY) * p);
            flySprite.scale.set(startScale + (silScale - startScale) * p); // Zoom in
            flySprite.alpha = Math.min(1, p * 2); // Quick fade in
          }, easeOutBack);

          flySprite.destroy();

          const pieceSprite = new Sprite(pieceTex);
          pieceSprite.anchor.set(0.5);
          charContainer.addChild(pieceSprite);

          await this.triggerSnapImpact(targetX, targetY, overlay, newCount);

          if (completed) {
            await this.triggerCompletionOverlay(charContainer, silScale, targetX, targetY, overlay, prefix);
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
        const silTex = getExtraTexture(`${prefix}_silhouette`);
        if (silTex) {
          const boxW = artRect.width - 24;
          const boxH = artRect.height - 84;
          const rawEndScale = Math.min(boxW / silTex.width, boxH / silTex.height);
          const endScale = prefix !== "char" ? rawEndScale * 1.25 : rawEndScale;
          const targetX = artRect.x + artRect.width / 2;
          const targetY = artRect.y + 60 + (artRect.height - 60) / 2;

          const pieceTex = getExtraTexture(`${prefix}_piece_${newCount}`);
          if (pieceTex) {
            const flySprite = new Sprite(pieceTex);
            flySprite.anchor.set(0.5);
            const startScale = endScale * 3.0; // Start huge!
            flySprite.position.set(sourceX, sourceY);
            flySprite.scale.set(startScale);
            flySprite.alpha = 0;
            this.root.addChild(flySprite);

            await tween(turbo ? 200 : 500, (p) => {
              flySprite.position.set(sourceX + (targetX - sourceX) * p, sourceY + (targetY - sourceY) * p);
              flySprite.scale.set(startScale + (endScale - startScale) * p); // Zoom in
              flySprite.alpha = Math.min(1, p * 2); // Quick fade in
            }, easeOutBack);

            flySprite.destroy();

            await this.triggerSnapImpact(targetX, targetY, this.root, newCount);

            if (completed) {
              const celebrationContainer = new Container();
              const fullTex = getExtraTexture(`${prefix}_full`);
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

                await this.triggerCompletionOverlay(celebrationContainer, endScale, targetX, targetY, this.root, prefix);
                await wait(800);
                celebrationContainer.destroy({ children: true });
              }
            }
          }
        }
      }
    }

    this.board.updateCollectionCounter(newCount);
    
    // Refresh card peek & gallery to reflect newly collected parts
    this.cardPeek.layout(this.layout);
    if (this.gallery.visible) {
      this.gallery.show(this.layout.width, this.layout.height);
    }

    if (this.currentSnapshot) {
      this.currentSnapshot.collectionCount = newCount;
      this.hud.draw(this.layout, this.currentSnapshot);
    }

    // Reward moment (RTP-neutral, cosmetic). Mastering the whole gallery is the
    // grand banner; a single girl grants her cosmetic unlock.
    if (gain.galleryComplete) {
      const master = rewardFor("gallery_master");
      await this.effects.banner("GALLERY MASTERED", master?.name ?? "VIP", this.layout.board, turbo, "grand");
    } else if (completed) {
      const reward = rewardFor(gain.unlockId);
      if (reward) {
        await this.effects.banner("REWARD UNLOCKED", reward.name, this.layout.board, turbo, "high");
      }
    }

    if (symbolView) {
      await tween(100, (p) => {
        symbolView.scale.set(origScaleX * (1.45 - 0.45 * p), origScaleY * (1.45 - 0.45 * p));
      });
      symbolView.scale.set(origScaleX, origScaleY);
    }
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
    parentContainer: Container,
    prefix: string
  ): Promise<void> {
    const fullTex = getExtraTexture(`${prefix}_full`);
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

/** Show the actual win amount. Falls back to multiplier if bet is unknown. */
function formatWin(amount: number, bet: number): string {
  if (!amount) return "";
  if (bet > 0) {
    return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // betAmount not set yet (rare edge case) — fall back to multiplier notation
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}x`;
}

type WinIntensity = "low" | "mid" | "high" | "grand";

function winTier(mult: number): { title: string; intensity: WinIntensity } {
  if (mult >= 5000) return { title: "GRAND WIN", intensity: "grand" };
  if (mult >= 100)  return { title: "MEGA WIN", intensity: "high" };
  if (mult >= 20)   return { title: "BIG WIN", intensity: "mid" };
  if (mult >= 5)    return { title: "NICE WIN", intensity: "low" };
  return { title: "WIN", intensity: "low" };
}
