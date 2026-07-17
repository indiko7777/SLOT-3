import { Application } from "pixi.js";
import { EventAudioBus } from "./audio";
import { displayCurrency, uiStrings, type GameEvent, type RoundRecord } from "./domain";
import { isModalOpen, showChoiceModal, showToast } from "./modals";
import { formatWin } from "./rgs/client";
import { hideLoader, showLoader, updateLoader } from "./loader";
import { applyEvent, INITIAL_SNAPSHOT, type PlaybackSnapshot } from "./playback";
import { GIRLS, type PieceGain, collectWild as collectWildPiece, consumeGetawayStars, sanitize as sanitizeGallery, emptyGallery, type GalleryData } from "./meta/collection";
import {
  activeTier,
  addPoints,
  consumeHeadStart,
  effectiveTier,
  recordSpin,
  routeMode,
  NUM_CARDS,
  type PowerState
} from "./meta/powerLevel";
import { createPlayerStateStore } from "./meta/PlayerStateStore";
import type { GalleryProgress } from "./pixi/types";
import { loadSymbolTextures } from "./pixi/assets";
import { PixiGameScene } from "./pixi/PixiGameScene";
import { setTimeScale } from "./pixi/tween";
import { RadioWheel } from "./radio";
import { RgsClient, RgsError, toDisplay } from "./rgs/client";
import { readSession } from "./rgs/session";
import type { BetModeObject, Jurisdiction } from "./rgs/types";
import { showConfirmPopup } from "./confirmPopup";
import { SettingsMenu, type TurboMode } from "./settingsMenu";

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

let pixi: Application;
let scene: PixiGameScene;
let radioWheel: RadioWheel;
let settingsMenu: SettingsMenu;
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
let isPlaying = false;
let isReplayActive = false;
let snapshot: PlaybackSnapshot = INITIAL_SNAPSHOT;
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
function loadGallery(): GalleryData {
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    if (!raw) return emptyGallery();
    return sanitizeGallery(JSON.parse(raw) as Partial<GalleryData>);
  } catch {
    return emptyGallery();
  }
}
function saveGallery(data: GalleryData): void {
  try { localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(data)); } catch { /* quota/private */ }
}
let gallery: GalleryData = loadGallery();

// Per-spin collection context, set in playRound before replay.
let spinBet = 0; // the spin's base bet — one WILD awards exactly this many points
let spinOrganic = false; // base/ante/tier spin (points accrue) vs a bought bonus

const currentBet = (): number => betLevels[betIndex] ?? 0;

/** Stake.US social casino — flips every restricted word in the UI. Replay
 *  launches carry no authenticate/jurisdiction, so the social currencies
 *  (XGC/XSC) imply it there — the replay window must stay restricted-word
 *  free too. */
const isSocial = (): boolean =>
  Boolean(jurisdiction?.socialCasino) ||
  (isReplayActive && (currency === "XGC" || currency === "XSC"));
/** Currency code for DISPLAY (XGC→GC, XSC→SC); wire calls keep the raw code. */
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
    (scene?.isPaytableOpen() ?? false) ||
    (scene?.isGalleryOpen() ?? false)
  );
}

/** Called once per WILD that lands. Uses the 1:1 collection.ts system:
 *  every single WILD reveals exactly one body part — always, immediately.
 *  Also adds power-level points for the head-start routing (separate system). */
function onWildCollected(): PieceGain | null {
  // Always call collectWild so every WILD reveals a piece, regardless of bet mode.
  const { data: nextGallery, gain } = collectWildPiece(gallery);
  gallery = nextGallery;
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
/** Solid-gold head-start stars in effect for the CURRENT bet: the points-based
 *  power tier (bet-locked) PLUS the unconditional girl-completion stars. */
function headStartStars(): number {
  return Math.min(5, effectiveTier(power, currentBet()) + galleryStars());
}
/** All armed stars including the points tier that the current bet currently dims. */
function activeStars(): number {
  return Math.min(5, activeTier(power) + galleryStars());
}

/** Project the 1:1 gallery state onto the HUD/gallery's view. */
function galleryProgress(): GalleryProgress {
  const { currentGirl: girlIdx, pieces } = gallery;
  const mastered = girlIdx >= GIRLS.length;
  const idx = Math.min(girlIdx, GIRLS.length - 1);
  const girl = GIRLS[idx] ?? GIRLS[GIRLS.length - 1]!;
  const completedGirls = gallery.completed.length;
  return {
    girlId: girl.id,
    girlName: girl.name,
    artPrefix: girl.artPrefix,
    pieces: mastered ? girl.pieces : Math.min(pieces, girl.pieces),
    totalPieces: girl.pieces,
    completedGirls,
    totalGirls: GIRLS.length,
    mastered
  };
}

void boot();

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

  await Promise.all([loadSymbolTextures(), audioBus.prefetch()]);
  updateLoader(0.55);

  let resume: RoundRecord | null = null;
  try {
    if (session.isReplayMode) {
      isReplayActive = true;
      currency = session.currencyHint || "USD";
      balance = 0; // Balance hidden in replay
      jurisdiction = null;
      betLevels = [session.replayAmount > 0 ? session.replayAmount : 0.01];
      betIndex = 0;

      activeModeKey = session.replayMode || "base";
      anteEnabled = activeModeKey === "ante";
      const replayData = await client.getReplayData(
        "heat-chase", "1", activeModeKey, session.replayEvent
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
        // The interrupted round dictates the bet: round.amount is the total
        // debit, so divide the mode's cost multiplier back out to recover the
        // selected bet level (e.g. a 100x feature at 2.00 → amount 200.00).
        const costMult = betModes[activeModeKey]?.costMultiplier || 1;
        const activeBet = toDisplay(auth.round.amount) / costMult;
        if (activeBet > 0) {
          betIndex = Math.max(0, indexOfClosest(betLevels, activeBet));
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
    onBonusHeat: (level) => {
      if (!muted) audioBus.setBonusHeat(level);
    },
    onReelStop: (col, total) => audioBus.reelStop(col, total, muted),
    onAnticipation: () => audioBus.anticipation(muted),
    onTransform: () => {
      if (!muted) audioBus.fire("poker_machine_win", 1.15);
    },
    onAnticipationMiss: () => {
      if (!muted) audioBus.deadSpin(0);
    },
    onDeadSpin: (heat) => {
      if (!muted) audioBus.deadSpin(heat);
    },
    playAudio: (track, volumeScale) => {
      if (!muted) {
        if (track === "win_tick_low") audioBus.playWinTick("normal");
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
    previewRecord: PREVIEW_RECORD
  });

  scene.resize();
  scene.renderSnapshot(snapshot);
  hideLoader();

  // DEV-only test button (stripped from production builds): replays the entire
  // WILD-collection flow — every body part flying in, each girl completing, the
  // gold WANTED stars arming, and the crossfade to the next girl — through the
  // REAL gallery, so it exercises exactly what a run of real spins would.
  if (import.meta.env.DEV) {
    (window as any).scene = scene;
    mountCollectionFlowTest();
    mountWinTests();
  }

  radioWheel = new RadioWheel(
    (stationId) => {
      if (stationId === "off") {
        muted = true;
        audioBus.selectStation("off");
      } else {
        muted = false;
        audioBus.selectStation(stationId);
      }
      scene.renderSnapshot(snapshot); // refresh the radio button state
    },
    "heat",
    () => audioBus.playUI("ui_click", muted)
  );

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
      disabledAutoplay: Boolean(jurisdiction?.disabledAutoplay)
    }),
    playClick: () => { if (!muted) audioBus.playUI("click", false); },
    // GAME INFO tab content sources (same data the Pixi paytable used).
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
      scene.renderSnapshot(snapshot);
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
        { label: s.baseBetLabel, value: `${formatWin(betAmount)} ${cur}` },
        { label: s.finalMultLabel, value: `${formatWin(record.payoutMultiplier)}x` }
      ],
      text: "Your last round was interrupted. Watch it play out, or skip straight to the result — the outcome is already decided and will be credited either way.",
      buttons: [
        { key: "watch", label: "Watch Round", primary: true },
        { key: "skip", label: "Skip to Result" }
      ]
    },
    () => { if (!muted) audioBus.playUI("click", false); }
  );

  isPlaying = true;
  snapshot = { ...snapshot, betAmount };
  try {
    if (choice === "watch") {
      await replayRound(record, true);
    } else {
      // Apply every event silently to reach the final state, settle, then
      // present the result in one popup.
      for (const event of record.events as GameEvent[]) {
        snapshot = applyEvent(snapshot, event, record);
      }
      snapshot = { ...snapshot, state: "idle" };
      try {
        const end = await client.endRound();
        balance = toDisplay(end.balance.amount);
      } catch { /* a later authenticate reconciles */ }
      scene.renderSnapshot(snapshot);
      const total = record.payoutMultiplier * betAmount;
      await showChoiceModal(
        {
          title: "Round Result",
          lines: [
            { label: "Total Win", value: `${formatWin(total)} ${cur}` },
            { label: s.finalMultLabel, value: `${formatWin(record.payoutMultiplier)}x` }
          ],
          buttons: [{ key: "ok", label: "Continue", primary: true }]
        },
        () => { if (!muted) audioBus.playUI("click", false); }
      );
    }
  } finally {
    isPlaying = false;
    scene.renderSnapshot(snapshot);
  }
}

/**
 * Replay mode: intro popup states the play cost (base amount, the feature's
 * cost multiplier and the resulting total) before anything runs; the end
 * popup shows the final result and offers to replay the same event again.
 */
async function runReplayFlow(record: RoundRecord): Promise<void> {
  const s = ui();
  const cur = displayCur();
  const betAmount = currentBet();
  const costMult = betModes[activeModeKey]?.costMultiplier ?? 1;
  const totalCost = betAmount * costMult;
  const modeLabel = activeModeKey.replaceAll("_", " ").toUpperCase();

  for (;;) {
    await showChoiceModal(
      {
        title: "Replay",
        lines: [
          { label: "Mode", value: modeLabel },
          { label: s.baseBetLabel, value: `${formatWin(betAmount)} ${cur}` },
          { label: s.costMultLabel, value: `${formatWin(costMult)}x` },
          { label: s.totalCostLabel, value: `${formatWin(totalCost)} ${cur}` }
        ],
        buttons: [{ key: "start", label: "Start Replay", primary: true }]
      },
      () => { if (!muted) audioBus.playUI("click", false); }
    );

    snapshot = { ...INITIAL_SNAPSHOT, betAmount };
    scene.resetRound(snapshot);
    await replayRound(record, false);

    const total = record.payoutMultiplier * betAmount;
    const again = await showChoiceModal(
      {
        title: "Replay Finished",
        lines: [
          { label: "Total Win", value: `${formatWin(total)} ${cur}` },
          { label: s.finalMultLabel, value: `${formatWin(record.payoutMultiplier)}x` }
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
  if (isReplayActive) return; // Prevent any interaction during replay
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
  if (anteEnabled && betModes.ante) return "ante";
  // Combine the points-based head-start (bet-locked) with the unconditional
  // girl-completion stars, then route to the highest certified table available.
  const tier = Math.min(3, effectiveTier(power, currentBet()) + galleryStars());
  for (let t = tier; t >= 1; t--) {
    if (betModes[`base_tier${t}`]) return `base_tier${t}`;
  }
  return routeMode(power, currentBet());
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
  // The points-based head-start the bet actually unlocked (the table tier may be
  // HIGHER because girl-completion stars also contribute to routing — those are
  // consumed separately, so never feed the gallery stars into this).
  const powerEffTier = effectiveTier(power, betAmount);

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
    await replayRound(record, res.round.active);
    // The collection advances DURING replay: each WILD calls runtime.collectWild()
    // from the scene, adding value-weighted points and revealing a card on cross.
  } catch (e) {
    isPlaying = false;
    // Surface the failure — a silent stall reads as a frozen game. Connection
    // errors additionally tell the player to reload so the round can recover.
    if (e instanceof RgsError) {
      showToast(
        e.code === "ERR_NETWORK"
          ? "CONNECTION LOST — PLEASE RELOAD THE GAME"
          : e.code === "ERR_IPB"
            ? "INSUFFICIENT BALANCE"
            : `SERVER ERROR (${e.code}) — PLEASE TRY AGAIN`,
        4200
      );
    } else {
      showToast("SOMETHING WENT WRONG — PLEASE TRY AGAIN", 4200);
    }
    snapshot = { ...snapshot, state: "idle" };
    scene.renderSnapshot(snapshot);
    return;
  }
  isPlaying = false;

  // Consume head-starts when the Getaway triggers. The bonus has just settled
  // (/wallet/end-round, inside replayRound).
  if (record.events.some((e) => e.type === "bonus_trigger")) {
    // Points-based head-start: spend only the tier the bet actually unlocked.
    // Spending the Tier 3 head-start wipes the entire gallery (the Grand Reset).
    if (powerEffTier > 0) {
      const { state, grandReset, consumedTier } = consumeHeadStart(power, powerEffTier);
      power = state;
      powerStore.save(power);
      snapshot = {
        ...snapshot,
        lastMessage: grandReset
          ? "GRAND ESCAPE — gallery reset to zero!"
          : `Tier ${consumedTier} head-start used`
      };
    }
    // Girl-completion gold stars: a NATURAL Getaway (an organic spin whose live
    // wanted level reached 5★) burns ALL of them. A bought bonus never does.
    if (spinOrganic && (gallery.getawayStars ?? 0) > 0) {
      gallery = consumeGetawayStars(gallery);
      saveGallery(gallery);
    }
  }

  scene.renderSnapshot(snapshot);
}

/** DEV-only: a single floating button that replays the whole collection flow. */
function mountCollectionFlowTest(): void {
  const btn = document.createElement("button");
  btn.textContent = "▶ TEST COLLECTION FLOW";
  Object.assign(btn.style, {
    position: "fixed", left: "12px", top: "12px", zIndex: "99999",
    padding: "10px 14px", font: "700 13px Impact, system-ui, sans-serif",
    letterSpacing: "1px", color: "#0a0a0a", background: "#9ae64e",
    border: "2px solid #2ea847", borderRadius: "8px", cursor: "pointer",
    boxShadow: "0 2px 10px rgba(0,0,0,0.5)"
  } as Partial<CSSStyleDeclaration>);
  let running = false;
  btn.addEventListener("click", async () => {
    if (running) return;
    running = true;
    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.textContent = "RUNNING…";
    try {
      await runCollectionFlowTest();
    } finally {
      running = false;
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.textContent = "▶ TEST COLLECTION FLOW";
    }
  });
  document.body.appendChild(btn);
}

function mountWinTests(): void {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed", left: "12px", top: "60px", zIndex: "99999",
    display: "flex", flexDirection: "column", gap: "8px"
  } as Partial<CSSStyleDeclaration>);

  const testWins = [
    { name: "NICE WIN", mult: 10 },
    { name: "BIG WIN", mult: 50 },
    { name: "MEGA WIN", mult: 200 },
    { name: "GRAND WIN", mult: 1000 },
    { name: "MAX WIN", mult: 5000 }
  ];

  let running = false;
  for (const w of testWins) {
    const btn = document.createElement("button");
    btn.textContent = `▶ TEST ${w.name}`;
    Object.assign(btn.style, {
      padding: "10px 14px", font: "700 13px Impact, system-ui, sans-serif",
      letterSpacing: "1px", color: "#0a0a0a", background: "#f1c40f",
      border: "2px solid #f39c12", borderRadius: "8px", cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,0.5)"
    } as Partial<CSSStyleDeclaration>);
    btn.addEventListener("click", async () => {
      if (running || isPlaying) return;
      running = true;
      btn.disabled = true;
      btn.style.opacity = "0.5";
      try {
        const betAmount = currentBet() || 1;
        const testSnapshot = { ...snapshot, betAmount };
        await scene.playEvent({
          type: "round_end",
          payoutMultiplier: w.mult,
          capApplied: false
        }, testSnapshot);
      } finally {
        running = false;
        btn.disabled = false;
        btn.style.opacity = "1";
      }
    });
    container.appendChild(btn);
  }
  document.body.appendChild(container);
}

/** Drive every WILD for all three girls through the REAL gallery path — each part
 *  flying in, every girl completing, the gold WANTED stars arming, and the
 *  crossfade to the next silhouette. Resets the gallery first so it always starts
 *  from girl 1 with an empty meter. */
async function runCollectionFlowTest(): Promise<void> {
  gallery = emptyGallery();
  saveGallery(gallery);
  snapshot = { ...snapshot, collectionCount: 0 };
  scene.renderSnapshot(snapshot);
  await delay(450);
  for (;;) {
    const { data, gain } = collectWildPiece(gallery);
    gallery = data;
    saveGallery(gallery);
    if (!gain) break; // gallery mastered — nothing left to reveal
    await scene.playCollectionStep(gain);
    await delay(350);
  }
  scene.renderSnapshot(snapshot);
}

async function replayRound(record: RoundRecord, active: boolean): Promise<void> {
  for (const event of record.events as GameEvent[]) {
    snapshot = applyEvent(snapshot, event, record);
    audioBus.playEvent(event, muted, isTurbo());
    await scene.playEvent(event, snapshot);
  }
  // Settle the round with the RGS; the final balance is whatever it returns.
  // Zero-win rounds arrive with active=false (the RGS settles them itself), so
  // no end-round request is ever sent for them.
  if (active && !isReplayActive) {
    try {
      const end = await client.endRound();
      balance = toDisplay(end.balance.amount);
    } catch {
      /* keep last RGS balance; a future authenticate reconciles it */
    }
  }
}

function turboDisabled(): boolean {
  return Boolean(jurisdiction?.disabledTurbo || jurisdiction?.disabledSpacebar);
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
  div.textContent = `Cannot start game — ${message}`;
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
