import { Application, Container, Sprite, Graphics, Text, TextStyle, Texture } from "pixi.js";
import { GRID_COLUMNS, GRID_ROWS, type Board, type GameEvent, type Position, type SymbolId } from "../domain";
import type { PlaybackSnapshot } from "../playback";
import type { PieceGain } from "../meta/collection";
import { rewardFor } from "../meta/rewards";
import { getPrestigeTitle, GIRLS } from "../meta/collection";
import { revealPiece, girlIntro, nextTarget, GIRL_ACCENT } from "./girlReveal";
import { BoardView } from "./BoardView";
import { BonusView } from "./BonusView";
import { EffectsLayer } from "./EffectsLayer";
import { HudView } from "./HudView";
import { PaytableView } from "./PaytableView";
import { SymbolView, WIN_ACCENT, DEFAULT_ACCENT } from "./SymbolView";
import { computeLayout, logicalViewport, wantedStarsGeometry } from "./layout";
import { getExtraTexture, silhouetteOffset } from "./assets";
import { tween, wait, linear, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, simulate } from "./tween";
import type { LayoutMetrics, SceneRuntime } from "./types";
import { OutlineFilter } from "pixi-filters";
import { CardPeekView } from "./CardPeekView";
import { GalleryView } from "./GalleryView";
import { formatWin as formatWinClient } from "../rgs/client";

/** Collection voice lines per girl, indexed by GIRLS[] id, in PLAY ORDER.
 *  The file names are inconsistent ("milstone1", "mileston3", and girl 1's set
 *  starting at 2), so order is defined here explicitly rather than parsed from
 *  the names. playGirlMilestoneSound spreads these across the girl's pieces. */
const GIRL_VOICE_LINES: string[][] = [
  ["milestone2_girl1", "mileston3_girl1", "mileston4_girl1"],
  ["milstone1_girl2", "milestone2_girl2", "mileston3_girl2", "mileston4_girl2"],
  ["mileston1_girl3", "mileston2_girl3", "mileston3_girl3", "mileston4_girl3"],
];

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
    this.layout = this.measureLayout();

    // Disable hit-testing on the particle layer to avoid hit-testing overhead
    this.particleLayer.eventMode = "none";

    this.hud = new HudView(runtime, {
      bg: this.bgLayer,
      underParticles: this.underParticlesLayer
    });
    this.paytable = new PaytableView(runtime);
    this.effects = new EffectsLayer(this.particleLayer);

    // Authored clip cues (gunshot, casing tink, cartridge rattle…) → audio.
    SymbolView.foleySink = runtime.onSymbolFoley
      ? (id, cue, turbo) => runtime.onSymbolFoley?.(id, cue, turbo)
      : null;
    // Getaway moments (reels, landings, fuse, blast, ×2, meter) on their frames.
    this.bonus.onCue = (cue) => runtime.onGetawayCue?.(cue, runtime.isTurbo());

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

    // Bonus covers the complete base scene, including controls, during its exit dissolve.
    this.root.addChild(
      this.bgLayer,
      this.board,
      this.cardPeek,
      this.underParticlesLayer,
      this.particleLayer,
      this.hud,
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

    // Every win banner (like NICE WIN) fires a banner_impact.
    this.effects.on("banner_impact", (intensity: "low" | "mid" | "high" | "grand") => {
      if (intensity === "low") this.runtime.playAudio?.("win_big_lowest");
      // The entrance has its own contact before the count crosses a tier.
      // Keep it lighter than the existing big/mega/grand/max tier stingers.
      else this.runtime.bannerImpact?.("low");
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
  private measureLayout(): LayoutMetrics {
    const viewport = logicalViewport(this.app.screen.width, this.app.screen.height);
    this.root.scale.set(viewport.scale);
    return computeLayout(viewport.width, viewport.height);
  }

  /** Lay the board out, and give its "[n/8]" counter its reserved slot at the
   *  right end of the wanted-stars strip (on top of the reel frame). */
  private layoutBoard(): void {
    this.board.layout(this.layout.board);
    this.effects.resize(this.layout.board, this.layout);
    const bar = this.layout.starsBar;
    const g = bar ? wantedStarsGeometry(bar) : null;
    this.board.setCounterSlot(g ? { x: g.counterX, y: g.counterY } : null);
  }

  resize(): void {
    this.layout = this.measureLayout();
    this.layoutBoard();
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
      this.hud.visible = !this.bonusActive;
    }
  }

  resetRound(snapshot: PlaybackSnapshot): void {
    this.collectedWilds.clear();
    this.currentSnapshot = snapshot;
    this.bonus.hide();
    this.board.visible = true;
    // DON'T rebuild the board here — the spin animation will handle it.
    // Only update the HUD status text.
    this.hud.draw(this.layout, snapshot);
  }

  /** True while a Getaway bonus is live on screen (intro → spins → result). The
   *  spacebar-turbo path checks this so it never re-renders the base snapshot on
   *  top of a running bonus cinematic. */
  isBonusActive(): boolean {
    return this.bonusActive;
  }

  renderSnapshot(snapshot: PlaybackSnapshot): void {
    this.currentSnapshot = snapshot;
    snapshot.collectionCount = this.runtime.getCollectionCount();
    // Recompute layout and re-lay the board out to the new dimensions.
    // The HUD is also redrawn inside resize() if currentSnapshot is set,
    // so we don't need a second draw() call — just do it once below.
    this.layout = this.measureLayout();
    this.layoutBoard();
    this.bonus.layout({ x: 0, y: 0, width: this.layout.width, height: this.layout.height });
    this.board.updateCollectionCounter(snapshot.collectionCount, this.runtime.getGalleryProgress().totalPieces);

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
    this.hud.visible = !(this.bonusActive || isBonusActive);
    this.board.visible = !(this.bonusActive || isBonusActive);
    // Only rebuild the board if we don't already have one showing.
    // After a spin/tumble round the board is already in the correct state
    // from the animations — rebuilding would cause a visible flash.
    if (!this.hasBoard) {
      const board = snapshot.board ?? previewBoard(this.runtime);
      this.board.setInstant(board);
      this.hasBoard = true;
    }
    // Re-show the bonus ONLY when resuming an interrupted round we did NOT animate
    // ourselves. During LIVE bonus playback (bonusActive) the async animation
    // methods (intro / playSpin / crack / finish) own the view — calling
    // showStatic or hide here (e.g. from a spacebar-turbo re-render, or a resize,
    // fired mid-intro) rebuilds/tears down the containers mid-tween and crashes
    // the whole game. So while a bonus is live, never touch its structure here.
    if (this.bonusActive) {
      if (snapshot.bonusGrid) this.bonus.setMoneyContext(snapshot.betAmount, this.runtime.getCurrency());
    } else if (snapshot.bonusGrid && snapshot.state.startsWith("bonus")) {
      this.bonus.setMoneyContext(snapshot.betAmount, this.runtime.getCurrency());
      this.bonus.showStatic(snapshot.bonusGrid);
    } else {
      this.bonus.hide();
    }

    if (this.runtime.isReplayActive?.()) {
      const compact = this.layout.width < this.layout.height;
      const badgeWidth = compact ? 62 : 140;
      const badgeHeight = compact ? 23 : 36;
      if (!this.replayIndicator) {
        this.replayIndicator = new Container();
        const bg = new Graphics();
        const txt = new Text({
          text: "REPLAY MODE",
          style: new TextStyle({ fill: 0xffffff, fontFamily: "Impact, sans-serif", fontSize: 18, letterSpacing: 1 })
        });
        txt.anchor.set(0.5);
        txt.position.set(70, 18);
        this.replayIndicator.addChild(bg, txt);
        this.root.addChild(this.replayIndicator);
      }
      const bg = this.replayIndicator.children[0] as Graphics;
      const label = this.replayIndicator.children[1] as Text;
      bg.clear().roundRect(0, 0, badgeWidth, badgeHeight, 5).fill({ color: 0x000000, alpha: 0.7 }).stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
      label.text = compact ? "REPLAY" : "REPLAY MODE";
      label.style.fontSize = compact ? 11 : 18;
      label.position.set(badgeWidth / 2, badgeHeight / 2);
      this.replayIndicator.position.set(this.layout.width - badgeWidth - 10, 10);
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

  /** Full-screen warm white-out used to bridge the Wanted-star detonation into
   *  the Getaway intro. Added at the top of the scene so it sits over the HUD
   *  and the bonus; it snaps to near-opaque, then bleeds off while the intro
   *  cross-fades in beneath it — the chase emerges out of the flash. Fire and
   *  forget: it destroys itself. */
  private triggerWhiteout(turbo: boolean): void {
    const g = new Graphics();
    g.rect(0, 0, this.layout.width, this.layout.height).fill(0xfff4d6);
    g.alpha = 0;
    this.root.addChild(g);
    // Fully lit on its very first frame (a fade-up let the hand-off frame show
    // through as an empty screen), then a long ease-out bleed.
    g.alpha = 0.95;
    const dur = turbo ? 420 : 820;
    void tween(dur, (p) => {
      g.alpha = 0.95 * (1 - easeOutCubic(p) * 0.15) * (1 - p);
    }, linear).then(() => g.destroy());
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
    // Link only cells that actually touch (up/down/left/right) — that IS how a
    // cluster pays. The old premium "beam" fanned lasers from one corner across
    // unrelated symbols, and pixel-distance pairing drew diagonal X lattices.
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++) {
        const [c1, r1] = positions[i]!;
        const [c2, r2] = positions[j]!;
        if (Math.abs(c1 - c2) + Math.abs(r1 - r2) === 1) pairs.push([i, j]);
      }
    return this.effects.clusterLink(centers, isGreen ? 0xffd95c : accent, turbo, pairs);
  }

  /** Where a cluster's win value should pop: the cell nearest its centroid, so
   *  it always sits ON the cluster even when the shape is an L or a ring. */
  private clusterAnchor(positions: Position[]): { x: number; y: number } {
    const centers = positions.map((p) => this.board.centerOf(p));
    const mx = centers.reduce((a, c) => a + c.x, 0) / centers.length;
    const my = centers.reduce((a, c) => a + c.y, 0) / centers.length;
    let best = centers[0]!;
    for (const c of centers) if (Math.hypot(c.x - mx, c.y - my) < Math.hypot(best.x - mx, best.y - my)) best = c;
    return { x: (best.x + mx) / 2, y: (best.y + my) / 2 };
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
        // The cluster's own payout pops up ON the cluster (round total still
        // counts in the bar) — the player sees what each combination was worth.
        const amount = event.payout * (snapshot.betAmount || 0);
        if (amount > 0 && event.positions.length) {
          const at = this.clusterAnchor(event.positions);
          const accent = WIN_ACCENT[event.symbol] ?? DEFAULT_ACCENT;
          void wait(turbo ? 40 : 160).then(() =>
            this.effects.floatValue(at.x, at.y, formatCash(amount), accent, this.layout.board, turbo));
        }
        await this.board.highlight(event.positions, turbo);
        return;
      }
      case "tumble_remove":
        // Clear winning symbols and leave the holes — tumble_drop refills them
        // from the authoritative RGS board so symbols fall down with no blanks.
        await this.board.clearWins(event.positions, turbo);
        return;
      case "tumble_drop":
        await this.board.tumbleTo(event.board, turbo);
        this.runtime.playAudio?.("approved_refill");
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
        // The previous cluster's dimming must not carry into the stash reveal.
        this.board.undimAll(turbo);
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
      case "bonus_trigger": {
        this.bonusDeadSpins = 0;
        this.bonusActive = true;
        // Gold bars / meter / result show REAL money for this bet, not bare multipliers.
        this.bonus.setMoneyContext(snapshot.betAmount, this.runtime.getCurrency());
        this.cardPeek.visible = false;
        // Two clearly-distinct trigger beats so the player always knows WHAT
        // triggered the Getaway. The book tells us which: a scatter trigger
        // carries the 3+ truck positions; the Wanted-meter trigger carries none.
        const viaScatter = event.scatterPositions.length >= 3;
        // Hide the base game only once the chase fully covers it.
        const hideBase = (): void => {
          this.hud.visible = false;
          this.board.visible = false;
        };
        if (viaScatter) {
          // 3+ armored trucks: they rev and tear off the board — engine audio,
          // exhaust, speed lines, and a screen shake as they launch.
          this.runtime.onTruckDriveOff?.();
          await Promise.all([
            this.board.truckDriveOff(event.scatterPositions, turbo),
            this.effects.screenShake(this.root, turbo),
          ]);
          this.bonus.prepare();
          await this.bonus.intro(
            turbo,
            this.runtime.onTypewriterStart,
            this.runtime.onTypewriterStop,
            () => this.runtime.onTruckDoors?.(),
            hideBase
          );
        } else {
          // Wanted path: the five filled stars themselves ignite and detonate
          // into the chase, so the meter — not the cyan/armor wild that merely
          // helped fill it — visibly triggers the feature. A warm white-out
          // covers the seam while the intro cross-fades in beneath it, so the
          // stars cleanly *become* the Getaway. No trigger text, by request.
          this.runtime.onWantedIgnite?.();
          // Build the chase while the stars charge, so the detonation frame
          // never stalls into an empty screen.
          this.bonus.prepare();
          await this.hud.igniteWantedStars(
            (i) => this.runtime.onWantedStarBeat?.(i),
            turbo
          );
          this.triggerWhiteout(turbo);
          void this.effects.screenShake(this.root, turbo);
          await this.bonus.intro(
            turbo,
            this.runtime.onTypewriterStart,
            this.runtime.onTypewriterStop,
            () => this.runtime.onTruckDoors?.(),
            hideBase
          );
        }
        return;
      }
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
          this.runtime.onSafeLand
        );
        return;
      }
      case "safe_lock":
        // Value is shown on the gold bar and added to COLLECTED — no banner.
        return;
      case "master_key_crack":
        // Dynamite: the fuse burns while its targets light up, BOOM, each
        // neighbour doubles on its own beat, then the cell is a blank again.
        // (A dynamite with no neighbour gets no event — playSpin fizzles it.)
        await this.bonus.crack(
          event.keyPosition,
          event.affectedSafes.map((safe) => ({ position: safe.position, newValue: safe.newValue })),
          turbo
        );
        return;
      case "bonus_end":
        this.runtime.onBonusHeat?.(0);
        // A separate payout stage replaces the chase without shaking its text.
        await this.bonus.finish(event.filledScreen, event.totalPayout, turbo, this.unattended(), {
          open: () => this.runtime.getawayResultOpen?.(),
          start: () => this.runtime.getawayResultStart?.(),
          progress: (p) => this.runtime.getawayResultProgress?.(p),
          tier: (level) => this.runtime.getawayResultTier?.(level),
          end: () => this.runtime.getawayResultEnd?.(),
          exit: () => this.runtime.getawayResultExit?.(),
          cancel: () => this.runtime.getawayResultCancel?.(),
        });
        return;
      case "round_end": {
        if (this.bonusActive) {
          await this.bonus.fadeOutAndHide(turbo, () => {
            // Run only once the result's cover is opaque. Clearing bonusActive
            // before renderSnapshot also prevents key-up/resize hiding the HUD.
            this.bonusActive = false;
            this.renderSnapshot(snapshot);
            this.hud.visible = true;
            this.cardPeek.visible = true;
            this.runtime.onBonusExit?.();
          });
          return;
        }
        this.hud.draw(this.layout, snapshot);
        this.board.undimAll(turbo);
        this.board.clearMarks();
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
    // Each girl's voice lines IN ORDER. Note girl 1 only ever had three files
    // (her set starts at "milestone2"), which is why the old fixed mapping left
    // her silent until the 4th piece — it looked for a "milestone1" that does
    // not exist. Ordering by file, not by name, makes that a non-issue.
    const lines = GIRL_VOICE_LINES[gain.girlId];
    if (!lines?.length || !this.runtime.playAudio) return;

    // Spread the lines across her pieces: the FIRST line lands on the very
    // first piece revealed, the LAST always lands on completion, the rest sit
    // evenly between. Derived from totalPieces so girls with different piece
    // counts (Sapphire 8, Roxy 7, Vega 8) each stay evenly paced.
    const n = lines.length;
    if (gain.completedGirl) {
      this.runtime.playAudio(lines[n - 1]!);
      return;
    }
    const total = Math.max(2, gain.totalPieces);
    for (let i = 0; i < n - 1; i++) {
      const piece = i === 0 ? 1 : Math.round(1 + (i * (total - 1)) / (n - 1));
      if (gain.pieceIndex === piece) {
        this.runtime.playAudio(lines[i]!);
        return;
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
    // The energy orb launches from the WILD that earned the piece.
    const from = this.board.centerOf(pos);
    let flownPiece: Container | null = null;
    if (this.layout.portrait) {
      await this.runCollectionPortrait(prefix, newCount, completed, gain, turbo, from);
    } else {
      flownPiece = await this.runCollectionLandscape(prefix, newCount, completed, gain, turbo, from);
    }

    this.board.updateCollectionCounter(newCount, gain.totalPieces, !turbo);

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
    if (gain.prestigeAdvanced) {
      const pTitle = getPrestigeTitle(gain.prestige);
      await this.effects.banner("PRESTIGE RANK UP!", pTitle || "PRESTIGE I", this.layout.board, turbo, "grand");
    } else if (gain.galleryComplete) {
      const master = rewardFor("gallery_master");
      await this.effects.banner("GALLERY MASTERED", master?.name ?? "VIP", this.layout.board, turbo, "grand");
    }
    // A single girl's reward is shown on her own name card (girlIntro).
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

  private girlInfo(gain: PieceGain): { name: string; accent: number; reward: string | null } {
    return {
      name: GIRLS[gain.girlId]?.name ?? "",
      accent: GIRL_ACCENT[gain.girlId] ?? 0xffd36a,
      reward: rewardFor(gain.unlockId)?.name ?? null,
    };
  }

  private collectionCue(cue: "lock" | "snap" | "sweep" | "shutter" | "name", turbo: boolean): void {
    this.runtime.onCollectionCue?.(cue, turbo);
  }

  /** --- LANDSCAPE: the piece seats itself on the art-panel girl; the last
   *  piece runs her character intro. Returns the holder for a non-completing
   *  piece (the caller destroys it after the HUD repaint bakes the part in). */
  private async runCollectionLandscape(prefix: string, newCount: number, completed: boolean, gain: PieceGain, turbo: boolean, from: { x: number; y: number }): Promise<Container | null> {
    const t = this.artCharTransform(prefix);
    if (!t) return null;
    const pieceTex = getExtraTexture(`${prefix}_piece_${newCount}`);
    if (!pieceTex) return null;
    const info = this.girlInfo(gain);
    const stage = { parent: this.root, cx: t.cx, cy: t.cy, scale: t.scale };

    this.runtime.playAudio?.("piece_whoosh");
    const holder = await revealPiece(stage, pieceTex, {
      from, accent: info.accent, label: `${newCount}/${gain.totalPieces}`, turbo,
      onLaunch: () => this.collectionCue("lock", turbo),
      onImpact: () => { this.collectionCue("snap", turbo); this.runtime.bannerImpact?.("low"); },
    });
    if (!completed) {
      this.playGirlMilestoneSound(gain);
      await wait(turbo ? 60 : 300);
      return holder;
    }

    const fullTex = getExtraTexture(`${prefix}_full`);
    if (!fullTex) return holder;
    await wait(turbo ? 60 : 260);
    const b = this.layout.board;
    const art = this.layout.artPanel!;
    const cardW = Math.min(520, art.x - b.x + 24);
    await girlIntro({
      root: this.root, width: this.layout.width, height: this.layout.height,
      stage, fullTex, name: info.name, accent: info.accent, reward: info.reward,
      card: { x: art.x - cardW + 6, y: b.y + b.height / 2 - 78, width: cardW, height: 156 },
      turbo,
      onCover: () => { holder.visible = false; this.hud.setArtCharVisible(false); },
      onSweep: () => this.collectionCue("sweep", turbo),
      onShutter: () => this.collectionCue("shutter", turbo),
      onName: () => { this.collectionCue("name", turbo); this.playGirlMilestoneSound(gain); },
      beforeExit: () => {
        // Paint the NEXT girl's silhouette underneath before the stage clears.
        holder.destroy({ children: true });
        if (this.currentSnapshot) this.hud.draw(this.layout, this.currentSnapshot);
      },
    });
    // ...and the next girl is locked on as the new target.
    const next = this.runtime.getGalleryProgress();
    const nextSil = getExtraTexture(`${next.artPrefix}_silhouette`);
    const nt = this.artCharTransform(next.artPrefix);
    if (!turbo && !next.mastered && nextSil && nt && next.artPrefix !== prefix) {
      this.collectionCue("lock", turbo);
      await nextTarget({ parent: this.root, ...nt }, nextSil, silhouetteOffset(next.artPrefix, nextSil),
        next.girlName, GIRL_ACCENT[next.girlId] ?? info.accent);
    }
    return null;
  }

  /** --- PORTRAIT: full-screen stage (the art panel is hidden on phones). */
  private async runCollectionPortrait(prefix: string, newCount: number, completed: boolean, gain: PieceGain, turbo: boolean, from: { x: number; y: number }): Promise<void> {
    const width = this.layout.width;
    const height = this.layout.height;
    const silTex = getExtraTexture(`${prefix}_silhouette`);
    if (!silTex) return;
    const info = this.girlInfo(gain);

    const overlay = new Container();
    const overlayBg = new Graphics();
    overlayBg.rect(0, 0, width, height).fill({ color: 0x05030b, alpha: 0.86 });
    overlay.addChild(overlayBg);
    overlay.alpha = 0;
    this.root.addChild(overlay);

    const charContainer = new Container();
    const silSprite = new Sprite(silTex);
    silSprite.anchor.set(0.5);
    // Register the silhouette with the pieces (girl 1's is drawn off-centre).
    const silOff = silhouetteOffset(prefix, silTex);
    silSprite.x = silOff.x;
    silSprite.y = silOff.y;
    silSprite.tint = 0x000000;
    const outline = new OutlineFilter({ thickness: 2, color: 0xffffff, quality: 1.0 });
    outline.resolution = window.devicePixelRatio || 1;
    silSprite.filters = [outline];
    charContainer.addChild(silSprite);
    for (let i = 1; i < newCount; i++) {
      const tex = getExtraTexture(`${prefix}_piece_${i}`);
      if (tex) { const s = new Sprite(tex); s.anchor.set(0.5); charContainer.addChild(s); }
    }
    const rawSilScale = Math.min((width - 40) / silTex.width, (height - 300) / silTex.height);
    const silScale = prefix !== "char" ? rawSilScale * 1.25 : rawSilScale;
    charContainer.scale.set(silScale);
    charContainer.position.set(width / 2, height / 2 - 40);
    overlay.addChild(charContainer);

    await tween(turbo ? 120 : 240, (p) => { overlay.alpha = p; });

    const pieceTex = getExtraTexture(`${prefix}_piece_${newCount}`);
    if (pieceTex) {
      const stage = { parent: overlay, cx: charContainer.x, cy: charContainer.y, scale: silScale };
      this.runtime.playAudio?.("piece_whoosh");
      const holder = await revealPiece(stage, pieceTex, {
        from, accent: info.accent, label: `${newCount}/${gain.totalPieces}`, turbo,
        onLaunch: () => this.collectionCue("lock", turbo),
        onImpact: () => { this.collectionCue("snap", turbo); this.runtime.bannerImpact?.("low"); },
      });
      const placed = new Sprite(pieceTex);
      placed.anchor.set(0.5);
      charContainer.addChild(placed);
      holder.destroy({ children: true });

      const fullTex = completed ? getExtraTexture(`${prefix}_full`) : null;
      if (fullTex) {
        await wait(turbo ? 60 : 240);
        await girlIntro({
          root: overlay, width, height, stage, fullTex,
          name: info.name, accent: info.accent, reward: info.reward,
          card: { x: 14, y: height - Math.min(150, height * 0.17) - 30, width: width - 28, height: Math.min(150, height * 0.17) },
          turbo,
          onCover: () => { charContainer.visible = false; },
          onSweep: () => this.collectionCue("sweep", turbo),
          onShutter: () => this.collectionCue("shutter", turbo),
          onName: () => { this.collectionCue("name", turbo); this.playGirlMilestoneSound(gain); },
        });
      } else {
        this.playGirlMilestoneSound(gain);
        await wait(turbo ? 150 : 520);
      }
    }

    await tween(turbo ? 160 : 300, (p) => { overlay.alpha = 1 - p; });
    overlay.destroy({ children: true });
  }
}

/** Money with two decimals and grouping: "2.40", "1,250.00". */
function formatCash(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function previewBoard(runtime: SceneRuntime): Board {
  const settle = runtime.previewRecord.events.find((event): event is Extract<GameEvent, { type: "board_settle" }> => event.type === "board_settle");
  if (!settle) throw new Error("Preview record is missing board_settle");
  return settle.board;
}

