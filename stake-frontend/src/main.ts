import { Application } from "pixi.js";
import { loadUiFonts } from "./typography";
import { EventAudioBus } from "./audio";
import { SoundToggle } from "./audio/SoundToggle";
import { MAX_WIN_MULTIPLIER, displayCurrency, isSocialCurrency, uiStrings, type BonusCell, type Board, type GameEvent, type Position, type RoundRecord, type SymbolId } from "./domain";
import { isModalOpen, showChoiceModal, showToast } from "./modals";
import { formatAmount, formatMultiplier } from "./format";
import { hideLoader, showLoader, updateLoader } from "./loader";
import { showIntro } from "./intro";
import { applyEvent, INITIAL_SNAPSHOT, type PlaybackSnapshot } from "./playback";
import { GIRLS, type PieceGain, collectWild as collectWildPiece, consumeGetawayStars, sanitize as sanitizeGallery, emptyGallery, type GalleryData } from "./meta/collection";
import {
  addPoints,
  recordSpin,
  type PowerState
} from "./meta/powerLevel";
import { createPlayerStateStore } from "./meta/PlayerStateStore";
import type { GalleryProgress } from "./pixi/types";
import { loadSymbolTextures } from "./pixi/assets";
import { warmUpGpu } from "./pixi/warmup";
import { GetawayResult } from "./pixi/GetawayResult";
import { PixiGameScene } from "./pixi/PixiGameScene";
import { setTimeScale } from "./pixi/tween";
import { RadioWheel } from "./radio";
import { RgsClient, RgsError, toDisplay } from "./rgs/client";
import { readSession } from "./rgs/session";
import type { BetModeObject, Jurisdiction } from "./rgs/types";
import { showConfirmPopup, prewarmConfirmPopups } from "./confirmPopup";
import { SettingsMenu, type TurboMode } from "./settingsMenu";
import { selectSpinMode, starsForMode } from "./meta/starModes";
import { cosmeticThemeFor } from "./meta/rewards";
import { countRoundWilds, receiptKey, sanitizeReceipts, type CollectionReceipts } from "./meta/roundCollection";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app root");
const mount = root;

for (const el of [document.documentElement, document.body]) {
  Object.assign(el.style, { width: "100%", height: "100%", margin: "0", overflow: "hidden" });
}
document.body.style.background = "#050816";
root.style.width = "100%";
root.style.height = "100%";

const session = readSession();
const client = new RgsClient(session);
const audioBus = new EventAudioBus();

// --- Wallet & config: EVERYTHING below is owned by the RGS, never hardcoded ---
let currency = session.currencyHint;
let balance = 0; // display units, only ever set from an RGS response
let betLevels: number[] = []; // display units, from authenticate.config.betLevels
let betIndex = 0;
let betModes: Record<string, BetModeObject> = {};
let jurisdiction: Jurisdiction | null = null;

/** Fixed cost multipliers for the feature/ante modes, mirroring the math bundle
 *  (stake-math MODES) and the mock RGS. Used only as a fallback when the live
 *  RGS config omits a mode, so the always-visible buy/ante buttons never become
 *  dead controls. See the synthesis step in boot(). */
const FEATURE_MODE_COSTS: Record<string, number> = {
  ante: 1.5,
  getaway: 100,
  super_getaway: 500,
};

let pixi: Application;
let scene: PixiGameScene;
let radioWheel: RadioWheel;
let settingsMenu: SettingsMenu;
let soundToggle: SoundToggle | undefined;
let activeModeKey = "base";
let anteEnabled = false;
// Spin speed: persistent mode set from the ☰ menu (Normal / Turbo / Extra Turbo)
// plus a momentary hold via the spacebar. Extra Turbo additionally time-scales
// the whole animation layer (see applyTurboMode).
let turboMode: TurboMode = "off";
let turboHeld = false;
// Autoplay: number of spins remaining (Infinity = endless until stopped/funds out).
let autoplayRemaining = 0;
let autoplayStop = false;
let muted = false;
let lastAudibleStation = "heat";
let isPlaying = false;
let isReplayActive = false;
let snapshot: PlaybackSnapshot = INITIAL_SNAPSHOT;
function syncSoundToggle(): void {
  soundToggle?.update(isReplayActive || snapshot.state.startsWith('bonus'), muted);
}
/**
 * The WANTED LEVEL stars are the LIVE in-spin Heat (cascade depth, 0–5): the
 * player watches them climb as the cascade chain builds, and at 5 stars (a
 * 5-cascade chain) the Getaway triggers IN-BOOK on that same paid spin — a real,
 * earned, fully-verifiable trigger (see docs/MATH_DESIGN.md §6). There is no
 * client-side cross-spin meter and no client-funded free bonus (that would leak
 * RTP). The stars reset to 0 at the start of each spin.
 */
// Persistent Power-Level collection (cosmetic, $0 EV; RTP-neutral head-start).
// player_state is loaded here at init (right after authenticate) and saved on
// every change. WILDs add value-weighted points; crossing a threshold reveals a
// card and arms a head-start that routes eligible base spins to base_tierN.
const powerStore = createPlayerStateStore();
let power: PowerState = powerStore.load();

// Separate 1:1 gallery state (1 WILD = 1 body part revealed).
// This is the collection.ts system — completely distinct from powerLevel points.
const GALLERY_STORAGE_KEY = "heatchase.gallery.v1";
let collectionReceipts: CollectionReceipts = {};
let collectionRoundKey = "";
let collectionWildOrdinal = 0;
function loadGallery(): GalleryData {
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    if (!raw) return emptyGallery();
    const saved = JSON.parse(raw) as Partial<GalleryData> & { receipts?: unknown };
    collectionReceipts = sanitizeReceipts(saved.receipts);
    return sanitizeGallery(saved);
  } catch {
    return emptyGallery();
  }
}
function saveGallery(data: GalleryData): void {
  collectionReceipts = sanitizeReceipts(collectionReceipts);
  // Progress and its duplicate guard are persisted together in one write.
  try { localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify({ ...data, receipts: collectionReceipts })); } catch { /* quota/private */ }
}
let gallery: GalleryData = loadGallery();

// Per-spin collection context, set in playRound before replay.
let spinBet = 0; // the spin's base bet — one WILD awards exactly this many points
let spinOrganic = false; // base/ante/tier spin (points accrue) vs a bought bonus

const currentBet = (): number => betLevels[betIndex] ?? 0;

/** Social casino (stake.us) — flips every restricted word in the UI. Replay
 *  launches carry no authenticate/jurisdiction, so `social=true` or a social
 *  currency (XGC/XSC/XEC) implies it there — the replay window must stay
 *  restricted-word free too. */
const isSocial = (): boolean =>
  session.social ||
  Boolean(jurisdiction?.socialCasino) ||
  (isReplayActive && isSocialCurrency(currency));
/** Currency code for DISPLAY (XGC→GC, XSC/XEC→SC); wire calls keep the raw code. */
const displayCur = (): string => displayCurrency(currency);
const ui = () => uiStrings(isSocial());

/** Total debit of a spin in `mode` at the current bet (bet × cost multiplier). */
function modeCost(modeKey: string): number {
  return currentBet() * (betModes[modeKey]?.costMultiplier ?? 1);
}

/** Guard shared by spin/feature actions: block and toast when the balance
 *  cannot cover the play — the RGS must never even receive the request. */
function hasFundsFor(modeKey: string): boolean {
  const cost = modeCost(modeKey);
  if (cost <= 0) return false;
  if (cost > balance + 1e-9) {
    if (!muted) audioBus.playApprovedEffect("uierror");
    showToast("INSUFFICIENT BALANCE");
    return false;
  }
  return true;
}

/** True while any window sits over the board — the spacebar must do nothing. */
function anyOverlayOpen(): boolean {
  return (
    isModalOpen() ||
    (settingsMenu?.isOpen() ?? false) ||
    (radioWheel?.isOpen() ?? false) ||
    (scene?.isGalleryOpen() ?? false)
  );
}

/** Called once per WILD that lands. Uses the 1:1 collection.ts system:
 *  every single WILD reveals exactly one body part — always, immediately.
 *  Also adds power-level points for the head-start routing (separate system). */
function onWildCollected(): PieceGain | null {
  // Watching a shared result must not change the viewer's saved collection.
  if (isReplayActive) return null;
  const ordinal = ++collectionWildOrdinal;
  if (collectionRoundKey && ordinal <= (collectionReceipts[collectionRoundKey]?.wilds ?? 0)) return null;
  // Always call collectWild so every WILD reveals a piece, regardless of bet mode.
  const { data: nextGallery, gain } = collectWildPiece(gallery);
  gallery = nextGallery;
  if (collectionRoundKey) collectionReceipts[collectionRoundKey] = { wilds: ordinal, consumed: collectionReceipts[collectionRoundKey]?.consumed ?? false };
  saveGallery(gallery);

  // Also add power-level points (head-start routing), but only on organic spins.
  if (spinOrganic && spinBet > 0) {
    const { state } = addPoints(power, spinBet);
    power = state;
    powerStore.save(power);
  }

  return gain; // null only when the entire gallery is already mastered
}

/** Gold WANTED stars armed by completing girls — persistent, unconditional,
 *  burned only by a natural Getaway (live wanted level reaching 5★). */
function galleryStars(): number {
  return Math.max(0, Math.min(5, gallery.getawayStars ?? 0));
}
/** Solid-gold head-start stars — now a SINGLE unified system: the girl-completion
 *  stars (getawayStars). These both fill the WANTED meter AND route base spins to
 *  the matching base_tierN table. (The old points-based power tier no longer feeds
 *  the meter, so the two systems can never desync.) */
function headStartStars(): number {
  // The current book was already selected. A card completed during its
  // animation may arm the NEXT round, but cannot rewrite this round's meter.
  return starsForMode(isPlaying || isReplayActive ? activeModeKey : spinModeForUser());
}
/** All armed head-start stars — same single girl-completion source now. */
function activeStars(): number {
  return galleryStars();
}

/** Project the 1:1 gallery state onto the HUD/gallery's view. */
function galleryProgress(): GalleryProgress {
  const { currentGirl: girlIdx, pieces, prestige = 0 } = gallery;
  // "mastered" is ONLY the transient all-three-done state before collectWild loops
  // back to girl 1. It must NOT include `prestige > 0` — once you've completed the
  // gallery once, prestige stays > 0 forever, which latched `mastered` permanently
  // true and made the deck/HUD never reset to the first girl's black silhouette on
  // the next loop (the "active girl" render is gated on `!mastered`). The prestige
  // badge/hint conveys "completed N times" separately.
  const mastered = girlIdx >= GIRLS.length;
  const idx = Math.min(girlIdx >= GIRLS.length ? 0 : girlIdx, GIRLS.length - 1);
  const girl = GIRLS[idx] ?? GIRLS[0]!;
  const completedGirls = gallery.completed.length;
  return {
    girlId: girl.id,
    girlName: girl.name,
    artPrefix: girl.artPrefix,
    pieces: Math.min(pieces, girl.pieces),
    totalPieces: girl.pieces,
    completedGirls,
    totalGirls: GIRLS.length,
    mastered,
    prestige
  };
}

// Art review only; never intercept a production/RGS launch.
if (import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "loading") {
  showLoader();
  updateLoader(0.55);
} else {
  void boot().catch((error: unknown) => {
    hideLoader();
    showFatal(error instanceof Error ? error.message : String(error));
  });
}

async function boot(): Promise<void> {
  mount.textContent = "";
  showLoader();

  pixi = new Application();
  await pixi.init({
    background: "#050816",
    antialias: true,
    resizeTo: window,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true
  });
  updateLoader(0.25);
  pixi.canvas.style.display = "block";
  mount.appendChild(pixi.canvas);

  // Boot gates ONLY on the symbol textures. The ~6 MB of background music used
  // to be awaited here, freezing the loader on slow connections; it now streams
  // in the background and unlock() waits on it before the first sound plays.
  await Promise.all([loadSymbolTextures(), loadUiFonts()]);
  // Shader compiles + texture uploads happen here, behind the loader, instead
  // of as freezes on the first spin / big win / Getaway intro.
  warmUpGpu(pixi.renderer);
  GetawayResult.prewarm();
  prewarmConfirmPopups();
  void audioBus.prefetch();
  updateLoader(0.55);

  let resume: RoundRecord | null = null;
  try {
    if (session.isReplayMode) {
      isReplayActive = true;
      currency = session.currencyHint || "USD";
      balance = 0; // Balance hidden in replay
      jurisdiction = null;
      betLevels = [session.replayAmount > 0 ? session.replayAmount : 1];
      betIndex = 0;

      activeModeKey = session.replayMode || "base";
      anteEnabled = activeModeKey === "ante";
      const replayData = await client.getReplayData(
        session.replayGame, session.replayVersion, activeModeKey, session.replayEvent
      );
      if (replayData && replayData.state) {
        resume = {
          id: replayData.roundID || 0,
          payoutMultiplier: replayData.payoutMultiplier || 0,
          events: replayData.state
        };
        if (typeof replayData.mode === "string" && replayData.mode) {
          activeModeKey = replayData.mode;
        }
        if (replayData.costMultiplier) {
          betModes[activeModeKey] = {
            mode: activeModeKey,
            costMultiplier: Number(replayData.costMultiplier) || 1,
            feature: false
          };
        }
      }
    } else {
      const auth = await client.authenticate();
      currency = auth.balance.currency;
      balance = toDisplay(auth.balance.amount);
      betModes = auth.config.betModes ?? {};
      // ROBUSTNESS — the BUY GETAWAY / SUPER / ANTE buttons are drawn
      // unconditionally, so their bet modes MUST exist or a click silently does
      // nothing (reads as "bonus modes do not work"). If the live RGS omitted a
      // known feature mode from its config, synthesize it from its fixed cost so
      // the play request is still sent. The RGS stays the authority: if it truly
      // doesn't support the mode it rejects the play and the player sees a toast,
      // instead of pressing a dead button. On a correct bundle this is a no-op.
      for (const [mode, costMultiplier] of Object.entries(FEATURE_MODE_COSTS)) {
        if (!betModes[mode]) {
          betModes[mode] = { mode, costMultiplier, feature: mode !== "base" };
        }
      }
      jurisdiction = auth.config.jurisdiction ?? null;
      betLevels = (auth.config.betLevels ?? []).map(toDisplay);
      if (betLevels.length === 0)
        betLevels = [toDisplay(auth.config.defaultBetLevel || 1_000_000)];
      // Fresh sessions ALWAYS start on the currency's RGS default bet level —
      // nothing is ever restored from local state.
      const def = toDisplay(
        auth.config.defaultBetLevel || auth.config.betLevels?.[0] || 0
      );
      betIndex = Math.max(0, indexOfClosest(betLevels, def));
      if (auth.round?.active && auth.round.state?.length) {
        resume = {
          id: auth.round.roundID,
          payoutMultiplier: auth.round.payoutMultiplier,
          events: auth.round.state
        };
        activeModeKey = auth.round.mode || "base";
        anteEnabled = activeModeKey === "ante";
        // The interrupted round dictates the bet. round.amount is the BASE bet
        // the play request sent (the RGS debits it × the mode's cost, and the
        // round pays amount × payoutMultiplier), so it maps straight onto a bet
        // level. Older RGS builds reported the total debit instead, so a value
        // that only matches once the cost multiplier is divided out is accepted
        // too; anything else is added as the session's exact bet.
        const costMult = betModes[activeModeKey]?.costMultiplier || 1;
        const roundAmount = toDisplay(auth.round.amount);
        if (roundAmount > 0) {
          let idx = betLevels.findIndex((level) => sameAmount(level, roundAmount));
          if (idx < 0 && costMult !== 1) idx = betLevels.findIndex((level) => sameAmount(level, roundAmount / costMult));
          if (idx < 0) {
            betLevels = [...betLevels, roundAmount].sort((a, b) => a - b);
            idx = betLevels.indexOf(roundAmount);
          }
          betIndex = idx;
        }
      }
    }
  } catch (e) {
    hideLoader();
    showFatal(e instanceof RgsError ? `${e.code}: ${e.message}` : String(e));
    return;
  }
  updateLoader(0.8);

  scene = new PixiGameScene(pixi, {
    getMode: () => activeModeKey,
    getCosmeticTheme: () => cosmeticThemeFor(gallery.unlocks),
    isAnteEnabled: () => anteEnabled,
    isMuted: () => muted,
    isTurbo: () => isTurbo(),
    isPlaying: () => isPlaying,
    isReplayActive: () => isReplayActive,
    getBetLevel: () => betLevels[betIndex] ?? 0,
    getCredit: () => balance,
    getCurrency: () => displayCur(),
    getCostMultiplier: (mode) => betModes[mode]?.costMultiplier ?? 1,
    isSocial: () => isSocial(),
    getUiStrings: () => ui(),
    getBetModes: () => betModes,
    isAutoplayActive: () => autoplayRemaining > 0,
    getAutoplayRemaining: () => autoplayRemaining,
    getWantedLevel: () => snapshot.heatLevel, // stars = live in-spin cascade Heat (0–5)
    getCollectionCount: () => galleryProgress().pieces,
    collectWild: onWildCollected,
    getGalleryProgress: galleryProgress,
    // Head-start Power Level: unlocked tier, and the stars in effect for the
    // current bet (0 = dimmed because the bet is above this tier's average lock).
    getActiveTier: () => activeStars(),
    getHeadStartStars: () => headStartStars(),
    isHeadStartActive: () => headStartStars() > 0,
    onAction: (action) => {
      if (!muted && action !== "getaway" && action !== "super_getaway") {
        audioBus.playUI("ui_click", false);
      }
      return handleAction(action);
    },
    onSafeLand: (index, total) => {
      if (!muted) audioBus.fireSafeLand(index, total);
    },
    onSymbolFoley: (id, cue, turbo) => {
      if (!muted) audioBus.symbolFoley(id, cue, turbo);
    },
    onCollectionCue: (cue, turbo) => {
      if (!muted) audioBus.collectionCue(cue, turbo);
    },
    onGetawayCue: (cue, turbo) => {
      if (!muted) audioBus.getawayCue(cue, turbo);
    },
    onBonusHeat: (level) => {
      if (!muted) audioBus.setBonusHeat(level);
    },
    onReelStop: (col, total) => audioBus.reelStop(col, total, muted),
    onAnticipation: () => audioBus.anticipation(muted),
    onTransform: () => {
      if (!muted) audioBus.fire("poker_machine_win", 1.15);
    },
    onAnticipationMiss: () => {
      // Its own sting, not deadSpin(0) — a scatter reel stopping short deserves
      // a bigger letdown than a bonus spin that landed nothing.
      if (!muted) audioBus.anticipationMiss();
    },
    onTruckDriveOff: () => {
      if (!muted) audioBus.truckDriveOff();
    },
    onTruckDoors: () => {
      if (!muted) audioBus.truckDoors();
    },
    onWantedIgnite: () => {
      // A short rising sting under the star charge — the heat boiling over.
      if (!muted) audioBus.fire("heat_rise", 1.0, 1.1);
    },
    onWantedStarBeat: (i) => {
      if (muted) return;
      // i = 0..4: ascending pitched ticks as each star locks (reusing the
      // gold-bar lock tone, which pitches up by index). i = 5: the detonation.
      if (i >= 5) audioBus.bannerImpact("grand");
      else audioBus.fireSafeLand(i, 5);
    },
    onDeadSpin: (heat) => {
      if (!muted) audioBus.deadSpin(heat);
    },
    playAudio: (track, volumeScale) => {
      if (!muted) {
        if (track.startsWith("approved_")) audioBus.playApprovedEffect(track.slice(9));
        else if (track === "win_tick_low") audioBus.playWinTick("normal");
        else if (track === "win_tick_mid") audioBus.playWinTick("medium");
        else if (track === "win_tick_high") audioBus.playWinTick("high");
        else if (track === "piece_whoosh") audioBus.pieceWhoosh();
        else audioBus.fire(track as any, volumeScale);
      }
    },
    onTypewriterStart: () => { if (!muted) audioBus.startTypewriter(); },
    onTypewriterStop: () => { audioBus.stopTypewriter(); },
    bannerImpact: (intensity) => { if (!muted) audioBus.bannerImpact(intensity); },
    winCounterStart: () => { if (!muted) audioBus.startWinCounter(); },
    winCounterUpdate: (p, tier) => { if (!muted) audioBus.updateWinCounter(p, tier); },
    winCounterEnd: () => audioBus.stopWinCounter(),
    winCounterCancel: () => audioBus.cancelWinCounter(),
    onBonusExit: () => audioBus.finishBonus(),
    getawayResultOpen: () => audioBus.openGetawayResult(),
    getawayResultStart: () => audioBus.startGetawayResultCount(),
    getawayResultProgress: (p) => audioBus.updateGetawayResultCount(p),
    getawayResultTier: (level) => audioBus.getawayResultTier(level),
    getawayResultEnd: () => audioBus.endGetawayResultCount(),
    getawayResultExit: () => audioBus.getawayResultExit(),
    getawayResultCancel: () => audioBus.cancelGetawayResult(),
    playWinTick: (level) => { if (!muted) audioBus.playWinTick(level); },
    previewRecord: PREVIEW_RECORD
  });

  scene.resize();
  scene.renderSnapshot(snapshot);
  hideLoader();

  // DEV-only: preview either Getaway trigger beat on demand (stripped from prod).
  //   __trigger("stars")  → the five Wanted stars fill, ignite and detonate into
  //                         the bonus (the natural star-path trigger).
  //   __trigger("trucks") → three armored trucks drive off into the bonus.
  // Lets us (and the player) verify the trigger is unmistakably the STARS, not a
  // reel symbol. Reload to reset afterwards.
  if (import.meta.env.DEV) {
    const filler = (): Board =>
      Array.from({ length: 5 }, () => ["BRASS", "KNIFE", "PISTOL", "AMMO"] as SymbolId[]);
    (window as unknown as { __trigger: (via?: "stars" | "trucks") => Promise<void> }).__trigger =
      async (via: "stars" | "trucks" = "stars") => {
        if (isPlaying) return;
        const rec: RoundRecord = { id: 0, payoutMultiplier: 0, events: [] };
        const play = async (ev: GameEvent) => {
          snapshot = applyEvent(snapshot, ev, rec);
          await scene.playEvent(ev, snapshot);
        };
        snapshot = { ...INITIAL_SNAPSHOT, betAmount: betLevels[betIndex] ?? 1 };
        await play({ type: "round_start", mode: "base", boardSeedLabel: "dev", turboProfile: "normal" });
        await play({ type: "board_settle", board: filler() });
        if (via === "trucks") {
          await play({ type: "bonus_trigger", mode: "getaway", scatterPositions: [[0, 0], [2, 1], [4, 2]] });
        } else {
          for (let to = 1; to <= 5; to++) {
            await play({ type: "heat_advance", from: to - 1, to, reason: "win_tumble" });
          }
          await play({ type: "bonus_trigger", mode: "getaway", scatterPositions: [] });
        }
      };
    // __getaway() → a scripted Getaway through the real audio + scene path, built
    // by the engine's rules: two bars in one column, a big bar, a live dynamite
    // doubling two bars, a dud with nothing beside it, dead spins down to the
    // last spin, then the result stage.
    // __getaway("max") plays the same script with bar values high enough to
    // end on the capped max win (the escape ending, never BUSTED).
    (window as unknown as { __getaway: (mode?: "max") => Promise<void> }).__getaway = async (mode) => {
      const k = mode === "max" ? 120 : 1;
      if (isPlaying) return;
      isPlaying = true;
      try {
        const grid: BonusCell[][] = Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ({ symbol: "EMPTY" as const })));
        const clone = (): BonusCell[][] => grid.map((col) => col.map((cell) => ({ ...cell })));
        const rec: RoundRecord = { id: 0, payoutMultiplier: 0, events: [] };
        const play = async (ev: GameEvent) => {
          snapshot = applyEvent(snapshot, ev, rec);
          audioBus.playEvent(ev, muted, isTurbo());
          await scene.playEvent(ev, snapshot);
        };
        let respins = 5;
        const spin = async (lands: Array<{ symbol: "SAFE" | "MASTER_KEY"; position: Position; value?: number }>) => {
          for (const l of lands) grid[l.position[0]]![l.position[1]] = l.symbol === "SAFE" ? { symbol: "SAFE", value: l.value } : { symbol: "MASTER_KEY" };
          const before = respins;
          if (!lands.length) respins -= 1;
          await play({ type: "bonus_spin", respinsBefore: before, respinsAfter: respins, landedSymbols: lands, lockedGrid: clone() });
          for (const l of lands) if (l.symbol === "SAFE") await play({ type: "safe_lock", position: l.position, value: l.value! });
          for (const l of lands) {
            if (l.symbol !== "MASTER_KEY") continue;
            const [c, r] = l.position;
            const affected = ([[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]] as Position[])
              .filter(([x, y]) => grid[x]?.[y]?.symbol === "SAFE")
              .map(([x, y]) => { const oldValue = grid[x]![y]!.value!; grid[x]![y] = { symbol: "SAFE", value: oldValue * 2 }; return { position: [x, y] as Position, oldValue, newValue: oldValue * 2 }; });
            if (affected.length) await play({ type: "master_key_crack", keyPosition: l.position, affectedSafes: affected });
            grid[c]![r] = { symbol: "EMPTY" };
          }
        };
        snapshot = { ...INITIAL_SNAPSHOT, betAmount: betLevels[betIndex] ?? 1 };
        await play({ type: "round_start", mode: "getaway", boardSeedLabel: "dev", turboProfile: "normal" });
        await play({ type: "board_settle", board: filler() });
        await play({ type: "bonus_trigger", mode: "getaway", scatterPositions: [[0, 0], [2, 1], [4, 2]] });
        await spin([
          { symbol: "SAFE", position: [1, 1], value: 2 * k }, { symbol: "SAFE", position: [1, 2], value: 5 * k },
          { symbol: "SAFE", position: [2, 0], value: 3 * k }, { symbol: "MASTER_KEY", position: [2, 1] },
          { symbol: "SAFE", position: [3, 0], value: 30 * k }, { symbol: "MASTER_KEY", position: [4, 3] },
        ]);
        await spin([]); await spin([]); await spin([]);
        await spin([{ symbol: "SAFE", position: [0, 3], value: 1 }]);
        await spin([]); await spin([]);
        const total = Math.min(MAX_WIN_MULTIPLIER, grid.flat().reduce((s, cell) => s + (cell.symbol === "SAFE" ? cell.value ?? 0 : 0), 0));
        await play({ type: "bonus_end", totalPayout: total, filledScreen: false });
        await play({ type: "round_end", payoutMultiplier: total, capApplied: false });
      } finally {
        isPlaying = false;
      }
    };
    (window as unknown as { __scene: PixiGameScene }).__scene = scene;
    // __play([...events]) → replay any scripted event list through the real
    // audio + scene path (mega wilds, transforms, cascades…) for inspection.
    (window as unknown as { __play: (events: GameEvent[]) => Promise<void> }).__play = async (events) => {
      if (isPlaying) return;
      isPlaying = true;
      try {
        const rec: RoundRecord = { id: 0, payoutMultiplier: 0, events: [] };
        for (const ev of events) {
          snapshot = applyEvent(snapshot, ev, rec);
          audioBus.playEvent(ev, muted, isTurbo());
          await scene.playEvent(ev, snapshot);
        }
      } finally {
        isPlaying = false;
      }
    };
    // Slow-motion for inspecting fast beats (1 = normal). __slow(0.2) = 5x slower.
    (window as unknown as { __slow: (s?: number) => void }).__slow = (s = 0.2) => setTimeScale(s);
    // Explicit local presentation harness; compiled out of publication builds.
    if (new URLSearchParams(location.search).get("qa") === "presentation") {
      const panel = document.createElement("div");
      panel.setAttribute("aria-label", "Presentation QA");
      Object.assign(panel.style, { position: "fixed", top: "0", left: "0", zIndex: "10001", display: "flex", flexWrap: "wrap", gap: "3px", maxWidth: "100%", background: "#263442", padding: "4px" });
      const add = (label: string, action: () => Promise<void> | void) => {
        const button = document.createElement("button");
        button.textContent = label;
        button.onclick = async () => {
          button.disabled = true;
          try { await audioBus.unlock(); await action(); }
          finally { button.disabled = false; }
        };
        panel.appendChild(button);
      };
      const dev = window as unknown as { __getaway: (mode?: "max") => Promise<void>; __trigger: (via: "stars" | "trucks") => Promise<void> };
      add("QA Getaway", () => dev.__getaway());
      add("QA Max Getaway", () => dev.__getaway("max"));
      add("QA Stars", () => dev.__trigger("stars"));
      add("QA Trucks", () => dev.__trigger("trucks"));
      add("QA Stash", async () => {
        if (isPlaying) return;
        isPlaying = true;
        try { await scene.playEvent({ type: "heat_transform", sourceSymbols: [], targetSymbol: "CASH", positions: [], board: snapshot.board ?? filler() }, snapshot); }
        finally { isPlaying = false; }
      });
      add("QA Cash", async () => {
        if (isPlaying) return;
        isPlaying = true;
        const board = filler();
        const positions: Position[] = [[1,1],[2,1],[3,1],[2,0],[2,2]];
        for (const [c,r] of positions) board[c]![r] = "CASH";
        const preview = { ...snapshot, board };
        try {
          scene.resetRound(preview);
          await scene.playEvent({ type: "board_settle", board }, preview);
          await scene.playEvent({ type: "cluster_win", winId: "qa-cash", symbol: "CASH", positions,
            baseMultiplier: 1, heatLevel: 0, appliedGlobalMultiplier: 1, payout: 1 }, preview);
          await scene.playEvent({ type: "tumble_remove", positions }, preview);
        } finally { scene.resetRound(snapshot); isPlaying = false; }
      });
      for (const [label, payout] of [["Nice", 10], ["Big", 40], ["Mega", 180], ["Grand", 800], ["Max", 5000]] as const) {
        add(`QA ${label}`, async () => {
          if (isPlaying) return;
          isPlaying = true;
          try {
            await scene.playEvent({ type: "round_end", payoutMultiplier: payout, capApplied: payout === 5000 }, { ...snapshot, betAmount: 1 });
          } finally { isPlaying = false; }
        });
      }
      add("QA Slow", () => setTimeScale(.1));
      for (const [label, mode] of [["Normal", "off"], ["Turbo", "turbo"], ["Extra Turbo", "super"]] as const) {
        add(`QA ${label}`, () => { turboMode = mode; applyTurboMode(); });
      }
      add("QA Mute", () => { muted = true; audioBus.setMuted(true); });
      add("QA Sound", () => { muted = false; audioBus.setMuted(false); });
      document.body.appendChild(panel);
    }
    // eslint-disable-next-line no-console
    console.info("[dev] __trigger('stars'|'trucks'), __slow(0.2) — preview/inspect trigger beats");
  }

  // Feature-preview splash — shown once per fresh session after the loader, the
  // way high-tier slots explain themselves before the first spin. Skipped for
  // replays (the player is reviewing a specific round, not starting a session).
  // Never allowed to block boot if it throws.
  if (!isReplayActive) {
    // Unlock audio on ENTER (a user gesture): creating the AudioContext and
    // decoding the sound bank used to happen on the first spin and froze it.
    try { await showIntro(() => { void audioBus.unlock(); }); } catch { /* non-fatal — go straight to the game */ }
  }



  radioWheel = new RadioWheel(
    (stationId) => {
      if (stationId === "off") {
        muted = true;
        audioBus.selectStation("off");
      } else {
        muted = false;
        lastAudibleStation = stationId;
        audioBus.selectStation(stationId);
      }
      scene.renderSnapshot(snapshot); // refresh the radio button state
      syncSoundToggle();
    },
    "heat",
    () => audioBus.playUI("ui_click", muted)
  );

  soundToggle = new SoundToggle(async () => {
    await audioBus.unlock();
    muted = !muted;
    if (!muted && audioBus.getStation() === "off") audioBus.selectStation(lastAudibleStation);
    else audioBus.setMuted(muted);
    syncSoundToggle();
  });
  syncSoundToggle();

  // ☰ burger-menu popup: spin speed (Turbo / Extra Turbo) + Autoplay. All options
  // respect the RGS jurisdiction flags so a disabled feature is greyed out.
  settingsMenu = new SettingsMenu({
    getTurboMode: () => turboMode,
    setTurboMode: (mode) => {
      turboMode = mode;
      applyTurboMode();
      scene.renderSnapshot(snapshot);
    },
    isAutoplayActive: () => autoplayRemaining > 0,
    startAutoplay: (count) => void startAutoplay(count),
    stopAutoplay,
    getFlags: () => ({
      disabledTurbo: Boolean(jurisdiction?.disabledTurbo),
      disabledSuperTurbo: Boolean(jurisdiction?.disabledSuperTurbo),
      disabledAutoplay: isReplayActive || Boolean(jurisdiction?.disabledAutoplay)
    }),
    playClick: () => { if (!muted) audioBus.playUI("click", false); },
    // GAME INFO tab content sources.
    getUiStrings: () => ui(),
    isSocial: () => isSocial(),
    getBetModes: () => betModes
  });

  // Observe the canvas directly with ResizeObserver for smooth, continuous,
  // real-time layout updates. A plain 'resize' event fires lazily (only on
  // pointer-up in some browsers), causing the layout to snap rather than track.
  // rAF-debounce prevents calling renderSnapshot faster than one frame at a time.
  let resizeScheduled = false;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      // renderSnapshot() recomputes layout + redraws HUD + relays the board
      // all in one pass — no need for a separate scene.resize() call.
      scene.renderSnapshot(snapshot);
    });
  });
  resizeObserver.observe(pixi.canvas);
  // Spacebar: bound to SPIN whenever the main board is idle and in focus.
  // While a spin is already running, holding it acts as momentary turbo.
  // It must do nothing when any overlay/menu is open, in replay mode, or when
  // the jurisdiction disables the spacebar entirely.
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    if (jurisdiction?.disabledSpacebar) return;
    event.preventDefault();
    if (event.repeat) return;
    if (anyOverlayOpen() || isReplayActive) return;
    if (!isPlaying && autoplayRemaining === 0) {
      void handleAction("spin");
      return;
    }
    if (!turboDisabled()) {
      turboHeld = true;
      // Never re-render the base snapshot on top of a LIVE bonus cinematic — that
      // path rebuilds/tears down the bonus view mid-animation and crashes the game.
      // Turbo still applies to the bonus: it's read live per-event via isTurbo(),
      // so holding space still fast-forwards it. (renderSnapshot is also guarded
      // internally, but skipping the work entirely is cleaner.)
      if (!scene.isBonusActive()) scene.renderSnapshot(snapshot);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space" && turboHeld) {
      turboHeld = false;
      scene.renderSnapshot(snapshot);
    }
  });

  if (resume) {
    if (isReplayActive) {
      await runReplayFlow(resume);
    } else {
      await resumeInterruptedRound(resume);
    }
  }
}

/**
 * Interrupted-round recovery: authenticate returned an active round. Offer the
 * player the choice of watching it play out or jumping straight to the result;
 * either way the round is settled with the RGS afterwards, never before.
 */
async function resumeInterruptedRound(record: RoundRecord): Promise<void> {
  const s = ui();
  const cur = displayCur();
  const betAmount = currentBet();
  const choice = await showChoiceModal(
    {
      title: "Unfinished Round",
      lines: [
        { label: s.baseBetLabel, value: `${formatAmount(betAmount)} ${cur}` },
        { label: s.finalMultLabel, value: `${formatMultiplier(record.payoutMultiplier)}x` }
      ],
      text: "Your last round was interrupted. Watch it play out, or skip straight to the result — the outcome is already decided and is added to your balance either way.",
      buttons: [
        { key: "watch", label: "Watch Round", primary: true },
        { key: "skip", label: "Skip to Result" }
      ]
    },
    () => { if (!muted) audioBus.playUI("click", false); }
  );

  isPlaying = true;
  collectionRoundKey = receiptKey(record);
  collectionWildOrdinal = 0;
  spinOrganic = activeModeKey === "base" || activeModeKey === "ante" || starsForMode(activeModeKey) > 0;
  spinBet = betAmount;
  snapshot = { ...snapshot, betAmount };
  try {
    if (choice === "watch") {
      await replayRound(record, true);
    } else {
      // Complete only the missing collection reveals when skipping animation.
      for (let i = 0; i < countRoundWilds(record.events); i++) onWildCollected();
      // Apply every event silently to reach the final state, settle, then
      // present the result in one popup.
      for (const event of record.events as GameEvent[]) {
        snapshot = applyEvent(snapshot, event, record);
      }
      snapshot = { ...snapshot, state: "idle" };
      const end = await client.endRound();
      balance = toDisplay(end.balance.amount);
      scene.renderSnapshot(snapshot);
      const total = record.payoutMultiplier * betAmount;
      await showChoiceModal(
        {
          title: "Round Result",
          lines: [
            { label: s.totalWinLabel, value: `${formatAmount(total)} ${cur}` },
            { label: s.finalMultLabel, value: `${formatMultiplier(record.payoutMultiplier)}x` }
          ],
          buttons: [{ key: "ok", label: "Continue", primary: true }]
        },
        () => { if (!muted) audioBus.playUI("click", false); }
      );
    }
    consumeRoundStars(record);
  } finally {
    isPlaying = false;
    scene.renderSnapshot(snapshot);
  }
}

/**
 * Replay mode: the intro popup states everything about the round up front —
 * mode, base bet, the feature's cost multiplier, the resulting total cost,
 * AND the round's total win and payout multiplier (known from the replay
 * response) — before anything runs. The end popup repeats the result and
 * offers to replay the same event again.
 */
async function runReplayFlow(record: RoundRecord): Promise<void> {
  const s = ui();
  const cur = displayCur();
  const betAmount = currentBet();
  const costMult = betModes[activeModeKey]?.costMultiplier ?? 1;
  const totalCost = betAmount * costMult;
  const totalWin = record.payoutMultiplier * betAmount;
  const modeLabel = activeModeKey.replaceAll("_", " ").toUpperCase();
  const resultLines = [
    { label: s.totalWinLabel, value: `${formatAmount(totalWin)} ${cur}` },
    { label: s.finalMultLabel, value: `${formatMultiplier(record.payoutMultiplier)}x` }
  ];

  for (;;) {
    await showChoiceModal(
      {
        title: "Replay",
        lines: [
          { label: "Mode", value: modeLabel },
          { label: s.baseBetLabel, value: `${formatAmount(betAmount)} ${cur}` },
          { label: s.costMultLabel, value: `${formatMultiplier(costMult)}x` },
          { label: s.totalCostLabel, value: `${formatAmount(totalCost)} ${cur}` },
          ...resultLines
        ],
        buttons: [{ key: "start", label: "Start Replay", primary: true }]
      },
      () => { if (!muted) audioBus.playUI("click", false); }
    );

    snapshot = { ...INITIAL_SNAPSHOT, betAmount };
    scene.resetRound(snapshot);
    await replayRound(record, false);

    const again = await showChoiceModal(
      {
        title: "Replay Finished",
        lines: [
          { label: s.totalCostLabel, value: `${formatAmount(totalCost)} ${cur}` },
          ...resultLines
        ],
        buttons: [
          { key: "again", label: "Replay Event", primary: true },
          { key: "done", label: "Close" }
        ]
      },
      () => { if (!muted) audioBus.playUI("click", false); }
    );
    if (again !== "again") break;
  }
}

async function handleAction(action: string): Promise<void> {
  // Replay disables wagering; sound, rules and playback speed remain available.
  if (isReplayActive && !["mute", "menu", "info"].includes(action)) return;
  // Stopping autoplay must work at ANY moment — including mid-round — so it
  // is handled before every playing/lock gate below.
  if (action === "spin" && autoplayRemaining > 0) {
    stopAutoplay();
    return;
  }
  if (isPlaying && ["spin", "getaway", "super_getaway"].includes(action)) return;
  // Bet sizing, ante and feature plays are locked while a round is running
  // and for the entire autoplay session — only the menu/info/sound buttons
  // (and stopping autoplay via SPIN) stay live.
  const lockedDuringPlay = ["plus", "minus", "ante", "getaway", "super_getaway"];
  if ((isPlaying || autoplayRemaining > 0) && lockedDuringPlay.includes(action)) return;

  switch (action) {
    case "info": // ⓘ — same GTA pause menu, opened directly on the PAYTABLE tab
      settingsMenu.toggle("paytable");
      return;
    case "menu": // ☰ — open the game menu (spin speed + autoplay)
      settingsMenu.toggle();
      return;
    case "mute": // repurposed: open the GTA-style radio wheel
      await audioBus.unlock();
      radioWheel.setCurrent(muted ? "off" : audioBus.getStation());
      radioWheel.toggle();
      return;
    case "ante":
      if (!betModes.ante) return; // RGS did not offer an ante mode
      anteEnabled = !anteEnabled;
      activeModeKey = anteEnabled ? "ante" : "base";
      scene.renderSnapshot(snapshot);
      return;
    case "plus":
      if (betIndex < betLevels.length - 1) {
        betIndex++;
        scene.renderSnapshot(snapshot);
      }
      return;
    case "minus":
      if (betIndex > 0) {
        betIndex--;
        scene.renderSnapshot(snapshot);
      }
      return;
    case "getaway":
    case "super_getaway": {
      if (jurisdiction?.disabledBuyFeature) return;
      if (!betModes[action]) return;
      // Feature plays cost far more than 2x — a confirmation step is mandatory
      // and the popup must show the full price before anything is charged.
      const confirmed = await showConfirmPopup(
        action,
        betLevels[betIndex],
        displayCur(),
        () => {
          if (!muted) audioBus.playUI("click", false);
        },
        betModes[action]?.costMultiplier ?? (action === "super_getaway" ? 500 : 100),
        isSocial()
      );
      if (confirmed) {
        await playRound(action);
      }
      return;
    }
    case "spin":
      await playRound(spinModeForUser());
      return;
  }
}

/** The bet mode a user "spin" should request: ante if enabled, else the
 *  collection-routed base table (base / base_tierN). */
function spinModeForUser(): string {
  return selectSpinMode(anteEnabled, galleryStars(), betModes);
}

/** True when animations should run at turbo speed (persistent mode or held space). */
function isTurbo(): boolean {
  return turboMode !== "off" || turboHeld;
}

/** Apply the persistent turbo mode to the global animation time-scale. Extra
 *  Turbo compresses the whole playback; Turbo/Normal run at 1x (Turbo already
 *  picks the fast per-animation branches via isTurbo()). */
function applyTurboMode(): void {
  setTimeScale(turboMode === "super" ? 2 : 1);
}

/** Start an autoplay run of `count` spins (Infinity = endless). */
async function startAutoplay(count: number): Promise<void> {
  if (isReplayActive) return;
  if (jurisdiction?.disabledAutoplay) return;
  if (autoplayRemaining > 0) return; // already running
  if (isPlaying) return; // a round is mid-flight — must not stack on top
  autoplayStop = false;
  autoplayRemaining = count;
  while (autoplayRemaining > 0 && !autoplayStop) {
    if (isPlaying) break; // safety — should never happen (we await each round)
    const mode = spinModeForUser();
    const cost = modeCost(mode);
    if (cost <= 0 || cost > balance + 1e-9) {
      // The player must be told WHY autoplay stopped, not left staring at a
      // stalled sequence.
      showToast("AUTOPLAY STOPPED — INSUFFICIENT BALANCE", 4200);
      if (!muted) audioBus.playApprovedEffect("uierror");
      break;
    }
    await playRound(mode);
    if (autoplayStop) break;
    if (autoplayRemaining !== Infinity) autoplayRemaining -= 1;
    if (autoplayRemaining > 0) await delay(turboMode === "super" ? 120 : 320);
  }
  autoplayRemaining = 0;
  autoplayStop = false;
  scene.renderSnapshot(snapshot);
}

function stopAutoplay(): void {
  autoplayStop = true;
  autoplayRemaining = 0;
  scene.renderSnapshot(snapshot);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function playRound(modeKey: string): Promise<void> {
  const betAmount = betLevels[betIndex];
  if (betAmount == null) return;
  // Never send a play request the wallet cannot cover.
  if (!hasFundsFor(modeKey)) return;

  // Spin context for the collection: which Power-Level table we're playing, and
  // whether points accrue (organic base/ante/tier play, not a bought bonus).
  spinBet = betAmount;
  const effTier = modeKey.startsWith("base_tier") ? Number(modeKey.slice(-1)) || 0 : 0;
  spinOrganic = modeKey === "base" || modeKey === "ante" || effTier > 0;
  isPlaying = true;
  activeModeKey = modeKey;
  snapshot = {
    ...INITIAL_SNAPSHOT,
    collectionCount: galleryProgress().pieces,
    betAmount // base bet wagered → win counter shows the real money amount
  };
  scene.resetRound(snapshot);

  let record: RoundRecord;
  try {
    const res = await client.play(betAmount, currency, modeKey);
    // Debit reflected by the RGS — never computed locally.
    balance = toDisplay(res.balance.amount);
    // Count this paid spin toward the current tier's average bet (organic play).
    if (spinOrganic) {
      power = recordSpin(power, betAmount);
      powerStore.save(power);
    }
    record = {
      id: res.round.roundID,
      payoutMultiplier: res.round.payoutMultiplier,
      events: res.round.state
    };
    collectionRoundKey = receiptKey(record);
    collectionWildOrdinal = 0;
    await replayRound(record, res.round.active);
    // The collection advances DURING replay: each WILD calls runtime.collectWild()
    // from the scene, adding value-weighted points and revealing a card on cross.
  } catch (e) {
    isPlaying = false;
    if (!muted) audioBus.playApprovedEffect("uierror");
    autoplayStop = true;
    autoplayRemaining = 0;
    // A timed-out play or settlement may already exist on the server. Never
    // place another spin until authentication has recovered that round.
    if (!(e instanceof RgsError) || e.code !== "ERR_IPB") {
      showFatal(e instanceof Error ? e.message : String(e));
      return;
    }
    showToast("INSUFFICIENT BALANCE", 4200);
    snapshot = { ...snapshot, state: "idle" };
    scene.renderSnapshot(snapshot);
    return;
  }
  isPlaying = false;
  consumeRoundStars(record);
  scene.renderSnapshot(snapshot);
}

function consumeRoundStars(record: RoundRecord): void {
  const key = receiptKey(record);
  if (collectionReceipts[key]?.consumed) return;
  if (record.events.some((e) => e.type === "bonus_trigger")) {
    // Unified head-start: a NATURAL Getaway (an organic spin whose live wanted
    // level reached 5★) spends ALL the girl-completion stars — that IS the
    // head-start being consumed. A bought bonus never burns them.
    if (spinOrganic && (gallery.getawayStars ?? 0) > 0) {
      const spent = gallery.getawayStars ?? 0;
      gallery = consumeGetawayStars(gallery);
      collectionReceipts[key] = { wilds: collectionReceipts[key]?.wilds ?? 0, consumed: true };
      saveGallery(gallery);
      snapshot = { ...snapshot, lastMessage: `${spent}★ head-start used` };
    }
  }

}



async function replayRound(record: RoundRecord, active: boolean): Promise<void> {
  for (const event of record.events as GameEvent[]) {
    snapshot = applyEvent(snapshot, event, record);
    syncSoundToggle();
    audioBus.playEvent(event, muted, isTurbo());
    await scene.playEvent(event, snapshot);
  }
  // Settle the round with the RGS; the final balance is whatever it returns.
  // Zero-win rounds arrive with active=false (the RGS settles them itself), so
  // no end-round request is ever sent for them.
  if (active && !isReplayActive) {
    const end = await client.endRound();
    balance = toDisplay(end.balance.amount);
  }
}

function turboDisabled(): boolean {
  return Boolean(jurisdiction?.disabledTurbo || jurisdiction?.disabledSpacebar);
}

/** Money equality on the RGS micro-unit grid (6 decimals). */
function sameAmount(a: number, b: number): boolean {
  return Math.round(a * 1_000_000) === Math.round(b * 1_000_000);
}

function indexOfClosest(levels: number[], target: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs(levels[i]! - target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function showFatal(message: string): void {
  const div = document.createElement("div");
  Object.assign(div.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#050816",
    color: "#ff6b6b",
    font: "16px Impact, system-ui, sans-serif",
    textAlign: "center",
    padding: "24px",
    zIndex: "99999"
  });
  div.style.flexDirection = "column";
  div.style.gap = "20px";
  div.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = "LET’S GET YOU BACK IN";
  title.style.fontSize = "26px";
  title.style.color = "#f6c3a2";
  const detail = document.createElement("p");
  detail.style.cssText = "max-width:540px;font:14px/1.6 Arial,sans-serif;color:#ccd5da;overflow-wrap:anywhere";
  detail.textContent = import.meta.env.DEV
    ? `The local game could not finish loading. Ensure the mock server is ready, then retry. ${message}`
    : "The game could not finish loading. Check your connection and retry. If the problem continues, relaunch from the casino.";
  const retry = document.createElement("button");
  retry.className = "intro-enter";
  retry.textContent = "RETRY CONNECTION";
  retry.onclick = () => window.location.reload();
  div.append(title, detail, retry);
  document.body.appendChild(div);
}

/** Purely decorative idle board (never a real outcome — the RGS owns those). */
const PREVIEW_RECORD: RoundRecord = {
  id: 0,
  payoutMultiplier: 0,
  events: [
    {
      type: "board_settle",
      board: [
        ["BIKE", "CASH", "CASH", "KNIFE"],
        ["PISTOL", "DIAMOND", "DUFFEL", "AMMO"],
        ["CASH", "BRASS", "CAR_WILD", "PISTOL"],
        ["CASH", "AMMO", "DIAMOND", "DUFFEL"],
        ["DIAMOND", "CASH", "PISTOL", "BIKE"]
      ]
    }
  ]
};
