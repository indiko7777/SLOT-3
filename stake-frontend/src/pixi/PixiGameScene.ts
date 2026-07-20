import { Application, Container, Sprite, Graphics, Text, TextStyle, Texture } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type GameEvent, type Position, type SymbolId } from "../domain";
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
import { tween, wait, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic } from "./tween";
import type { LayoutMetrics, SceneRuntime } from "./types";
import { OutlineFilter } from "pixi-filters";
import { CardPeekView } from "./CardPeekView";
import { GalleryView } from "./GalleryView";
import { formatWin as formatWinClient } from "../rgs/client";

export class PixiGameScene {
  private readonly root = new Container();
  private readonly bgLayer = new Container();
  private readonly underParticlesLayer = new Container();
  private readonly particleLayer = new Container();

  private readonly hud: HudView;
  private readonly board = new BoardView();
  private readonly bonus = new BonusView();
  private readonly effects: EffectsLayer;
  private readonly paytable: PaytableView;
  private readonly cardPeek: CardPeekView;
  private readonly gallery: GalleryView;
  private layout: LayoutMetrics;
  private currentSnapshot: PlaybackSnapshot | null = null;
  private hasBoard = false;
  private bonusDeadSpins = 0;
  private bonusActive = false;
  /** WILDs already counted toward the collection this round (dedup across tumbles). */
  private readonly collectedWilds = new Set<SymbolView>();
  private replayIndicator: Container | null = null;

  constructor(private readonly app: Application, private readonly runtime: SceneRuntime) {
    this.layout = computeLayout(app.screen.width, app.screen.height);

    // Disable hit-testing on the particle layer to avoid hit-testing overhead
    this.particleLayer.eventMode = "none";

    this.hud = new HudView(runtime, {
      bg: this.bgLayer,
      underParticles: this.underParticlesLayer
    });
    this.paytable = new PaytableView(runtime);
    this.effects = new EffectsLayer(this.particleLayer);

    this.board.setAudioHooks({
      onReelStop: (col, total) => {
        // Reel loop stop is handled on impact to sync with the reel stop sound
      },
      onReelImpact: (col, total) => {
        if (this.runtime.playAudio) {
          this.runtime.playAudio("new_reel_stop");
        }
        runtime.onReelStop?.(col, total);
      },
      onAnticipation: () => runtime.onAnticipation?.(),
      onTransform: () => runtime.onTransform?.(),
      onAnticipationMiss: () => runtime.onAnticipationMiss?.(),
    });
    this.cardPeek = new CardPeekView(runtime, () => {
      this.gallery.toggle(this.layout.width, this.layout.height);
    });
    this.gallery = new GalleryView(runtime);
    
    // Layer order: bgLayer, board, cardPeek, bonus, underParticlesLayer, particleLayer, hud, effects, paytable, gallery.
    this.root.addChild(
      this.bgLayer,
      this.board,
      this.cardPeek,
      this.bonus,
      this.underParticlesLayer,
      this.particleLayer,
      this.hud,
      this.effects,
      this.paytable,
      this.gallery
    );
    this.app.stage.addChild(this.root);

    // Cinematic win event listeners to bridge EffectsLayer to HUD & Audio
    this.effects.on("win_count_update", (amount: number) => {
      this.hud.setWinAmountDirect(amount);
    });

    // Every win banner (like NICE WIN) fires a banner_impact.
    this.effects.on("banner_impact", (intensity: "low" | "mid" | "high" | "grand") => {
      if (this.runtime.playAudio) {
        if (intensity === "low") this.runtime.playAudio("win_big_lowest");
      }
    });

    // Continuous money-counter roller, locked to the rising total.
    this.effects.on("win_counter_start", () => {
      this.runtime.winCounterStart?.();
    });
    this.effects.on("win_counter_progress", (p: number, tier: "none" | "big" | "mega" | "grand") => {
      this.runtime.winCounterUpdate?.(p, tier);
    });
    this.effects.on("win_counter_end", () => {
      this.runtime.winCounterEnd?.();
    });
    this.effects.on("win_tier_changed", (tier: "none" | "big" | "mega" | "grand" | "max") => {
      if (this.runtime.playAudio) {
        let soundKey = "";
        if (tier === "big") soundKey = "win_big_lowest";
        else if (tier === "mega" || tier === "grand") soundKey = "win_mega_grand";
        else if (tier === "max") soundKey = "win_max";
        if (soundKey) this.runtime.playAudio(soundKey);
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
      // hud.draw always resets children but does NOT touch .visible.
      // However, guard it explicitly in case behaviour changes.
      if (this.bonusActive) this.hud.visible = false;
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
    // Ensure HUD and cardPeek visibility matches bonus state
    // (e.g. window resize while bonus is running must not reveal the HUD).
    if (this.bonusActive || isBonusActive) {
      this.hud.visible = false;
    }
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
      this.bonus.setMoneyContext(snapshot.betAmount, this.runtime.getCurrency());
      this.bonus.showStatic(snapshot.bonusGrid);
    } else {
      this.bonus.hide();
    }
    
    if (this.runtime.isReplayActive?.()) {
      if (!this.replayIndicator) {
        this.replayIndicator = new Container();
        const bg = new Graphics();
        bg.roundRect(0, 0, 140, 36, 6).fill({ color: 0x000000, alpha: 0.7 }).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
        const txt = new Text({
          text: "REPLAY MODE",
          style: new TextStyle({ fill: 0xffffff, fontFamily: "Impact, sans-serif", fontSize: 18, letterSpacing: 1 })
        });
        txt.anchor.set(0.5);
        txt.position.set(70, 18);
        this.replayIndicator.addChild(bg, txt);
        this.root.addChild(this.replayIndicator);
      }
      this.replayIndicator.position.set(this.layout.width - 150, 10);
      this.root.setChildIndex(this.replayIndicator, this.root.children.length - 1);
    }
  }

  togglePaytable(): void {
    this.paytable.toggle(this.layout.width, this.layout.height);
  }

  /** Overlay-state helpers — the spacebar must be dead while these are open. */
  isPaytableOpen(): boolean {
    return this.paytable.visible;
  }
  isGalleryOpen(): boolean {
    return this.gallery.visible;
  }

  /** True when nobody is at the wheel (autoplay or replay): tap-gated screens
   *  must auto-dismiss so the run can never freeze. */
  private unattended(): boolean {
    return (
      (this.runtime.isAutoplayActive?.() ?? false) ||
      (this.runtime.isReplayActive?.() ?? false)
    );
  }

  /** Play one collection reveal for an already-applied gain — used by the DEV
   *  "Test Collection Flow" button to replay the full flow via the real gallery. */
  async playCollectionStep(gain: PieceGain): Promise<void> {
    await this.runCollectionAnimation([2, 2], gain, this.runtime.isTurbo());
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
        // Safety net: a new round must never start with last round's Getaway
        // still on screen. round_end normally tears it down, but if that path
        // was skipped (interrupted playback, resume, an error mid-bonus) the
        // stale bonus art would sit over the base game.
        if (!this.bonusActive && this.bonus.visible) {
          this.bonus.hide();
          this.bonus.alpha = 1;
          this.hud.visible = true;
          this.cardPeek.visible = true;
        }
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
        if (this.runtime.playAudio) {
          this.runtime.playAudio("poker_machine_win");
        }
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
        // Gold bars / meter / result show REAL money for this bet, not bare multipliers.
        this.bonus.setMoneyContext(snapshot.betAmount, this.runtime.getCurrency());
        this.cardPeek.visible = false;
        // THE dopamine beat: before anything else, the armored trucks that
        // triggered the feature rev up and tear off the board — engine audio,
        // exhaust, speed lines, and a screen shake as they launch. Only then
        // does the cinematic intro take over.
        this.runtime.onTruckDriveOff?.();
        await Promise.all([
          this.board.truckDriveOff(event.scatterPositions, turbo),
          this.effects.screenShake(this.root, turbo),
        ]);
        // Hide the entire HUD (character, wanted stars, left buttons, bet panel)
        // so the bonus board has the full screen to itself.
        this.hud.visible = false;
        await this.bonus.intro(turbo, this.runtime.onTypewriterStart, this.runtime.onTypewriterStop);
        return;
      case "bonus_spin": {
        const landed = event.landedSymbols.map((s) => s.position);
        // Dead spin (nothing landed) stacks the heat; a hit resets it.
        if (landed.length > 0) this.bonusDeadSpins = 0;
        else this.bonusDeadSpins += 1;
        const heat = landed.length > 0 ? 0 : Math.min(3, this.bonusDeadSpins);
        this.runtime.onBonusHeat?.(heat);
        await this.bonus.playSpin(
          event.lockedGrid,
          landed,
          event.respinsAfter,
          this.bonusDeadSpins,
          turbo,
          this.runtime.onSafeLand,
          () => this.runtime.onDeadSpin?.(Math.min(3, this.bonusDeadSpins))
        );
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
        await this.bonus.finish(event.filledScreen, event.totalPayout, turbo, this.unattended());
        return;
      case "round_end": {
        this.hud.draw(this.layout, snapshot);
        if (this.bonusActive) {
          // The chase result card waits for the player's tap inside finish(), so
          // by the time we reach round_end they've acknowledged it.
          this.bonusActive = false;

          // Bring the base game back FIRST, then dissolve the bonus over it, so
          // the two cross-fade. HudView.visible also toggles the shared bgLayer
          // (the bottom-most layer), so restoring the HUD only AFTER the fade
          // meant the bonus dissolved into nothing — a black screen showing bare
          // reel symbols — and then popped the entire base UI in at the end.
          // hud.draw() above already rebuilt it with the base background, since
          // round_end's state is idle/round_complete/big_win, never "bonus*".
          this.hud.visible = true;
          this.cardPeek.visible = true;
          this.cardPeek.layout(this.layout);

          await wait(turbo ? 40 : 140);
          await this.bonus.fadeOutAndHide(turbo);
          return;
        }
        if (event.payoutMultiplier === 0) {
          await wait(turbo ? 20 : 80);
          return;
        }

        // Win-celebration ladder (multiplier-based, so it's bet-size independent):
        //   >= 20x  → full cinematic count-up banner (BIG / MEGA / GRAND / MAX)
        //   5x–20x  → light "NICE WIN" flourish + coin burst — the frequent little
        //             dopamine hit. Does NOT take over the screen or block the spin.
        //   < 5x    → silent tally in the bottom panel
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
            (amt) => this.hud.setWinAmountDirect(amt),
            this.unattended()
          );
        } else if (event.payoutMultiplier >= 5) {
          // NICE WIN — light, non-blocking celebration with a gold coin burst.
          const currency = this.runtime.getCurrency();
          const winAmount = event.payoutMultiplier * snapshot.betAmount;
          const amtStr = formatWinClient(winAmount) + " " + currency;
          const cx = this.layout.board.x + this.layout.board.width / 2;
          const cy = this.layout.board.y + this.layout.board.height / 2;
          this.hud.setWinAmountDirect(winAmount);
          // Fire the coin burst alongside the banner so they play together.
          void this.effects.goldCoinBurst(cx, cy, this.layout.board, turbo);
          await this.effects.banner("NICE WIN", amtStr, this.layout.board, turbo, "low");
        } else {
          // Wins < 5x: No banner, just wait briefly.
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

    if (this.runtime.playAudio) {
      this.runtime.playAudio("wild_sound");
    }

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

  private playGirlMilestoneSound(gain: PieceGain): void {
    const girlNum = gain.girlId + 1; // 1, 2, 3
    let milestone = 0;

    if (gain.completedGirl) {
      milestone = 4;
    } else if (gain.pieceIndex === 2) {
      milestone = 1;
    } else if (gain.pieceIndex === 4) {
      milestone = 2;
    } else if (gain.pieceIndex === 6) {
      milestone = 3;
    }

    if (milestone > 0) {
      let trackName = "";
      if (girlNum === 1) {
        if (milestone === 2) trackName = "milestone2_girl1";
        else if (milestone === 3) trackName = "mileston3_girl1";
        else if (milestone === 4) trackName = "mileston4_girl1";
      } else if (girlNum === 2) {
        if (milestone === 1) trackName = "milstone1_girl2";
        else if (milestone === 2) trackName = "milestone2_girl2";
        else if (milestone === 3) trackName = "mileston3_girl2";
        else if (milestone === 4) trackName = "mileston4_girl2";
      } else if (girlNum === 3) {
        if (milestone === 1) trackName = "mileston1_girl3";
        else if (milestone === 2) trackName = "mileston2_girl3";
        else if (milestone === 3) trackName = "mileston3_girl3";
        else if (milestone === 4) trackName = "mileston4_girl3";
      }

      if (trackName && this.runtime.playAudio) {
        this.runtime.playAudio(trackName);
      }
    }
  }

  private async runCollectionAnimation(pos: Position, gain: PieceGain, turbo: boolean): Promise<void> {
    const newCount = gain.pieceIndex;
    const prefix = gain.artPrefix;
    const completed = gain.completedGirl;

    // Punch the board WILD in place — a quick scale pop, never a slide in from
    // the side. The reveal itself rushes "out of the screen" onto the body.
    const symbolView = this.board.getSymbolView(pos);
    const origScaleX = symbolView?.scale.x ?? 1;
    const origScaleY = symbolView?.scale.y ?? 1;
    if (symbolView) {
      if (symbolView.parent) symbolView.parent.addChild(symbolView);
      await tween(turbo ? 110 : 240, (p) => {
        const s = 1 + 0.5 * Math.sin(p * Math.PI);
        symbolView.scale.set(origScaleX * s, origScaleY * s);
      }, easeOutBack);
      symbolView.scale.set(origScaleX, origScaleY);
    }

    // The milestone voice line fires INSIDE the orientation flows, right after
    // the piece physically snaps onto the body — the voice reacts to the reveal.
    let flownPiece: Container | null = null;
    if (this.layout.portrait) {
      await this.runCollectionPortrait(prefix, newCount, completed, gain, turbo);
    } else {
      flownPiece = await this.runCollectionLandscape(prefix, newCount, completed, gain, turbo);
    }

    this.board.updateCollectionCounter(newCount);

    // Refresh card peek & gallery to reflect newly collected parts.
    this.cardPeek.layout(this.layout);
    if (this.gallery.visible) {
      this.gallery.show(this.layout.width, this.layout.height);
    }

    // Final authoritative redraw. For a completed girl the landscape path has
    // already swapped the backdrop to the next girl mid-transition, so this is a
    // no-op repaint that keeps both orientations consistent.
    if (this.currentSnapshot) {
      this.currentSnapshot.collectionCount = newCount;
      this.hud.draw(this.layout, this.currentSnapshot);
    }

    // The landscape flight sprite stays on screen until the redraw above bakes
    // the piece into the persistent assembly — releasing it earlier makes the
    // part visibly blink out during the impact FX.
    flownPiece?.destroy({ children: true });

    // Light the freshly-armed gold WANTED star (the girl-completion head-start).
    if (completed && !turbo) {
      const starIdx = (this.runtime.getHeadStartStars?.() ?? 0) - 1;
      if (starIdx >= 0) void this.hud.animateStarFill(starIdx);
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
  }

  /** Landscape art-panel transform for a girl, matching HudView.drawCharacter so
   *  a flown-in piece / the full image lands EXACTLY on the persistent silhouette. */
  private artCharTransform(prefix: string): { cx: number; cy: number; scale: number } | null {
    const rect = this.layout.artPanel;
    if (!rect) return null;
    const silTex = getExtraTexture(`${prefix}_silhouette`);
    if (!silTex) return null;
    const boxW = rect.width - 24;
    const boxH = rect.height - 84;
    const raw = Math.min(boxW / silTex.width, boxH / silTex.height);
    const scale = prefix !== "char" ? raw * 1.25 : raw;
    return { cx: rect.x + rect.width / 2, cy: rect.y + 60 + (rect.height - 60) / 2, scale };
  }

  /**
   * Premium three-phase piece reveal, timed to the piece_whoosh audio riser:
   *   PRESENT (~320ms) — the part eases in huge, right up against the lens,
   *     backlit by a soft additive gold aura, and hangs there for a beat so
   *     the player registers WHAT they just won.
   *   STRIKE (~240ms) — it accelerates hard (easeInCubic) down onto its exact
   *     spot on the silhouette, shedding additive ghost trails as it speeds up.
   *   SETTLE (~140ms) — a small physical overshoot bounce as it seats itself.
   * No lateral travel — it converges dead-on the target, so it reads as coming
   * "out of the screen" and slamming into place.
   *
   * Returns the holder container with the seated piece still visible; the
   * CALLER owns its lifetime (it must survive until the persistent art under
   * it is repainted, otherwise the part blinks out).
   */
  private async flyPieceToBody(
    pieceTex: Texture,
    targetX: number,
    targetY: number,
    endScale: number,
    parent: Container,
    turbo: boolean
  ): Promise<Container> {
    this.runtime.playAudio?.("piece_whoosh");

    const holder = new Container();
    holder.position.set(targetX, targetY);
    parent.addChild(holder);

    const aura = new Graphics();
    const auraR = Math.max(pieceTex.width, pieceTex.height) * endScale * 0.6;
    aura.circle(0, 0, auraR * 1.35).fill({ color: 0xffd95c, alpha: 0.10 });
    aura.circle(0, 0, auraR * 0.85).fill({ color: 0xffe9a0, alpha: 0.12 });
    aura.circle(0, 0, auraR * 0.45).fill({ color: 0xffffff, alpha: 0.10 });
    aura.blendMode = "add";
    aura.alpha = 0;
    holder.addChild(aura);

    const fly = new Sprite(pieceTex);
    fly.anchor.set(0.5);
    fly.alpha = 0;
    holder.addChild(fly);

    const presentScale = endScale * 3.1;
    const tilt = (Math.random() - 0.5) * 0.22;

    if (turbo) {
      fly.scale.set(presentScale);
      await tween(130, (p) => {
        fly.alpha = Math.min(1, p * 4);
        fly.scale.set(presentScale + (endScale - presentScale) * p);
      }, easeInCubic);
      fly.alpha = 1;
      fly.scale.set(endScale);
      aura.destroy();
      return holder;
    }

    // PRESENT — ease in close to the lens and hang for a beat.
    fly.rotation = tilt;
    await tween(320, (p) => {
      fly.alpha = Math.min(1, p * 2.2);
      aura.alpha = p;
      fly.scale.set(presentScale * (0.92 + 0.08 * p));
      fly.rotation = tilt * (1 - 0.35 * p);
    }, easeOutCubic);

    // STRIKE — accelerate hard onto the body, shedding ghost trails. The tween
    // progress is already eased, so the ghosts naturally cluster where the
    // piece moves fastest — a real motion-blur streak.
    let lastGhost = 0;
    await tween(240, (p) => {
      const s = presentScale + (endScale - presentScale) * p;
      fly.scale.set(s);
      fly.rotation = tilt * 0.65 * (1 - p);
      aura.alpha = 1 - p;
      aura.scale.set(1 - 0.5 * p);
      if (p - lastGhost > 0.3 && p < 0.85) {
        lastGhost = p;
        const ghost = new Sprite(pieceTex);
        ghost.anchor.set(0.5);
        ghost.scale.set(s);
        ghost.rotation = fly.rotation;
        ghost.alpha = 0.22;
        ghost.blendMode = "add";
        holder.addChildAt(ghost, holder.getChildIndex(fly));
        void tween(180, (g) => { ghost.alpha = 0.22 * (1 - g); }).then(() => ghost.destroy());
      }
    }, easeInCubic);

    // SETTLE — small overshoot bounce so the landing reads physical.
    await tween(140, (p) => {
      fly.scale.set(endScale * (1 + 0.1 * Math.sin(p * Math.PI)));
    }, easeOutCubic);
    fly.scale.set(endScale);
    fly.rotation = 0;
    aura.destroy();
    return holder;
  }

  /** --- LANDSCAPE: persistent fill, with a smooth completion → next-girl handoff.
   *  Returns the flown-piece holder for a NON-completing piece — the caller
   *  destroys it after the tail hud.draw bakes the part into the assembly. */
  private async runCollectionLandscape(prefix: string, newCount: number, completed: boolean, gain: PieceGain, turbo: boolean): Promise<Container | null> {
    const t = this.artCharTransform(prefix);
    if (!t) return null;
    const pieceTex = getExtraTexture(`${prefix}_piece_${newCount}`);
    if (!pieceTex) return null;

    // 1) Present-and-strike: the piece hangs in front of the lens, then slams
    //    onto the body. The holder keeps the seated part visible from here on.
    const flown = await this.flyPieceToBody(pieceTex, t.cx, t.cy, t.scale, this.root, turbo);
    await this.pieceImpact(t.cx, t.cy, pieceTex, t.scale, this.root, completed, turbo);

    // 2) Voice line REACTS to the snap (it used to fire before anything moved).
    this.playGirlMilestoneSound(gain);

    // Non-completing piece: hand the holder back — the tail hud.draw bakes the
    // part into the persistent assembly, then the caller releases the holder.
    if (!completed) return flown;

    const fullTex = getExtraTexture(`${prefix}_full`);
    if (!fullTex) { flown.destroy({ children: true }); return null; }

    // 3) Reveal the finished girl: fade the seamless full image in over the
    //    assembled parts. Same transform as the silhouette → perfect registration.
    this.runtime.bannerImpact?.("grand");
    const charSpace = new Container();
    charSpace.position.set(t.cx, t.cy);
    charSpace.scale.set(t.scale);
    this.root.addChild(charSpace);
    const fullSprite = new Sprite(fullTex);
    fullSprite.anchor.set(0.5);
    fullSprite.alpha = 0;
    charSpace.addChild(fullSprite);
    await tween(turbo ? 200 : 420, (p) => { fullSprite.alpha = p; });
    flown.destroy({ children: true });

    // 4) Celebrate the completed girl.
    this.completionFx(t.cx, t.cy, this.root);
    await wait(turbo ? 500 : 1100);

    // 5) Smooth hand-off. Redraw the HUD so the NEXT girl's all-black silhouette
    //    is rendered UNDER the overlay (the gallery already advanced), then
    //    crossfade the completed girl out to reveal it — no hard cut, no overlap.
    if (this.currentSnapshot) this.hud.draw(this.layout, this.currentSnapshot);
    await tween(turbo ? 240 : 600, (p) => { charSpace.alpha = 1 - p; }, easeInOutCubic);
    charSpace.destroy({ children: true });
    return null;
  }

  /** --- PORTRAIT: full-screen pop-up reveal (fades fully out when done). */
  private async runCollectionPortrait(prefix: string, newCount: number, completed: boolean, gain: PieceGain, turbo: boolean): Promise<void> {
    const width = this.layout.width;
    const height = this.layout.height;
    const silTex = getExtraTexture(`${prefix}_silhouette`);
    if (!silTex) return;

    const overlay = new Container();
    const overlayBg = new Graphics();
    overlayBg.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.85 });
    overlay.addChild(overlayBg);
    overlay.alpha = 0;
    this.root.addChild(overlay);

    const charContainer = new Container();
    const silSprite = new Sprite(silTex);
    silSprite.anchor.set(0.5);
    silSprite.x = prefix === "char" ? 57.5 : 0; // align shadow with the pieces
    silSprite.y = prefix === "char" ? 27.5 : 0;
    silSprite.tint = 0x000000;
    const outline = new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1.0 });
    outline.resolution = window.devicePixelRatio || 1;
    silSprite.filters = [outline];
    charContainer.addChild(silSprite);

    // Already-collected pieces.
    for (let i = 1; i < newCount; i++) {
      const tex = getExtraTexture(`${prefix}_piece_${i}`);
      if (tex) { const s = new Sprite(tex); s.anchor.set(0.5); charContainer.addChild(s); }
    }

    const rawSilScale = Math.min((width - 40) / silTex.width, (height - 300) / silTex.height);
    const silScale = prefix !== "char" ? rawSilScale * 1.25 : rawSilScale;
    charContainer.scale.set(silScale);
    charContainer.position.set(width / 2, height / 2 - 40);
    overlay.addChild(charContainer);

    await tween(200, (p) => { overlay.alpha = p; });

    const pieceTex = getExtraTexture(`${prefix}_piece_${newCount}`);
    if (pieceTex) {
      // Present-and-strike the new piece onto the body, then bake it in.
      const flown = await this.flyPieceToBody(pieceTex, charContainer.x, charContainer.y, silScale, overlay, turbo);
      const placed = new Sprite(pieceTex);
      placed.anchor.set(0.5);
      charContainer.addChild(placed);
      flown.destroy({ children: true });

      // The whole body absorbs the hit — quick squash-and-recover.
      if (!turbo) {
        void tween(220, (p) => {
          const k = Math.sin(p * Math.PI);
          charContainer.scale.set(silScale * (1 + 0.02 * k), silScale * (1 - 0.03 * k));
        }).then(() => charContainer.scale.set(silScale));
      }
      await this.pieceImpact(charContainer.x, charContainer.y, pieceTex, silScale, overlay, completed, turbo);

      // Voice line reacts to the snap.
      this.playGirlMilestoneSound(gain);

      if (completed) {
        const fullTex = getExtraTexture(`${prefix}_full`);
        if (fullTex) {
          this.runtime.bannerImpact?.("grand");
          const fullSprite = new Sprite(fullTex);
          fullSprite.anchor.set(0.5);
          fullSprite.alpha = 0;
          charContainer.addChild(fullSprite);
          await tween(turbo ? 200 : 420, (p) => { fullSprite.alpha = p; });
          this.completionFx(charContainer.x, charContainer.y, overlay);
          await wait(turbo ? 500 : 1100);
        }
      }
      await wait(turbo ? 150 : 350);
    }

    await tween(300, (p) => { overlay.alpha = 1 - p; });
    overlay.destroy({ children: true });
  }

  /**
   * The moment the piece seats itself on the silhouette. Layered for weight:
   *  - the existing cinematic bannerImpact "bang" (sub-drop + crack) — the
   *    snap was completely SILENT before this;
   *  - a white-hot additive stamp of the piece ITSELF, so the exact body part
   *    the player just won flashes bright on the body (not a generic flash);
   *  - a gold shockwave ring from the landing point;
   *  - a soft gold screen kiss instead of the old harsh 50% white flash;
   *  - additive gold spark debris with gravity.
   * Awaits only long enough for the hit to register — the sparks finish on
   * their own so the flow stays snappy.
   */
  private async pieceImpact(
    x: number,
    y: number,
    pieceTex: Texture,
    pieceScale: number,
    parentContainer: Container,
    completed: boolean,
    turbo: boolean
  ): Promise<void> {
    this.runtime.bannerImpact?.(completed ? "high" : "mid");
    this.effects.screenShake(this.root, turbo);
    if (turbo) return;

    // White-hot stamp of the freshly-placed part.
    const stamp = new Sprite(pieceTex);
    stamp.anchor.set(0.5);
    stamp.position.set(x, y);
    stamp.scale.set(pieceScale);
    stamp.blendMode = "add";
    stamp.alpha = 0.85;
    parentContainer.addChild(stamp);
    void tween(480, (p) => {
      stamp.alpha = 0.85 * (1 - p);
      stamp.scale.set(pieceScale * (1 + 0.05 * p));
    }, easeOutCubic).then(() => stamp.destroy());

    // Gold shockwave ring.
    const ring = new Graphics();
    ring.circle(0, 0, 70).stroke({ color: 0xffe9a0, width: 8 });
    ring.position.set(x, y);
    ring.scale.set(0.25);
    ring.blendMode = "add";
    parentContainer.addChild(ring);
    void tween(480, (p) => {
      ring.scale.set(0.25 + 2.1 * p);
      ring.alpha = 1 - p;
    }, easeOutCubic).then(() => ring.destroy());

    // Soft gold screen kiss (subtle — the old full white flash read as an error).
    const flash = new Graphics();
    flash.rect(0, 0, this.layout.width, this.layout.height).fill({ color: 0xffd95c });
    flash.blendMode = "add";
    flash.alpha = 0.14;
    parentContainer.addChild(flash);
    void tween(240, (p) => { flash.alpha = 0.14 * (1 - p); }).then(() => flash.destroy());

    // Gold spark debris — elongated shards with gravity, additive.
    const sparkLayer = new Container();
    parentContainer.addChild(sparkLayer);
    const sparks: Array<{ g: Graphics; vx: number; vy: number; spin: number }> = [];
    for (let i = 0; i < 18; i++) {
      const s = new Graphics();
      const len = 6 + Math.random() * 10;
      s.roundRect(-len / 2, -1.5, len, 3, 1.5).fill({ color: i % 3 === 0 ? 0xffffff : 0xffd95c });
      s.blendMode = "add";
      s.position.set(x, y);
      const ang = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      s.rotation = ang;
      sparkLayer.addChild(s);
      sparks.push({ g: s, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, spin: (Math.random() - 0.5) * 0.2 });
    }
    void tween(520, (p) => {
      for (const s of sparks) {
        s.g.x += s.vx;
        s.g.y += s.vy;
        s.vy += 0.18;
        s.g.rotation += s.spin;
        s.g.alpha = 1 - p;
      }
    }).then(() => sparkLayer.destroy({ children: true }));

    // Let the hit register before anything else moves.
    await wait(260);
  }

  /** Gold sparkle burst + "GIRL COMPLETED!" banner — pure FX. The caller owns the
   *  full-image sprite and the crossfade to the next girl. */
  private completionFx(targetX: number, targetY: number, parentContainer: Container): void {
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
      text: "GIRL COMPLETED!",
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

    void tween(1200, (p) => {
      for (const pt of particles) {
        pt.sprite.x += pt.vx;
        pt.sprite.y += pt.vy * 0.8 + 2.0;
        pt.sprite.rotation += pt.rotSpeed;
        pt.sprite.alpha = Math.max(0, 1.2 - p);
      }
      textGlow.style.fill = p % 0.2 < 0.1 ? 0xffffff : 0xffd95c;
    }).then(() =>
      tween(300, (p) => { textGlow.alpha = 1 - p; }).then(() => {
        textGlow.destroy();
        sweepContainer.destroy({ children: true });
      })
    );
  }
}

function previewBoard(runtime: SceneRuntime): Board {
  const settle = runtime.previewRecord.events.find((event): event is Extract<GameEvent, { type: "board_settle" }> => event.type === "board_settle");
  if (!settle) throw new Error("Preview record is missing board_settle");
  return settle.board;
}

