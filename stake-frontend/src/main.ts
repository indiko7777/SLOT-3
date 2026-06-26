import { Application } from "pixi.js";
import { EventAudioBus } from "./audio";
import type { GameEvent, RoundRecord } from "./domain";
import { hideLoader, showLoader, updateLoader } from "./loader";
import { applyEvent, INITIAL_SNAPSHOT, type PlaybackSnapshot } from "./playback";
import { GIRLS, type PieceGain, collectWild as collectWildPiece, sanitize as sanitizeGallery, emptyGallery, type GalleryData } from "./meta/collection";
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
    const auth = await client.authenticate();
    currency = auth.balance.currency;
    balance = toDisplay(auth.balance.amount);
    betModes = auth.config.betModes ?? {};
    jurisdiction = auth.config.jurisdiction ?? null;
    betLevels = (auth.config.betLevels ?? []).map(toDisplay);
    if (betLevels.length === 0)
      betLevels = [toDisplay(auth.config.defaultBetLevel || 1_000_000)];
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
    getBetLevel: () => betLevels[betIndex] ?? 0,
    getCredit: () => balance,
    getCurrency: () => currency,
    getCostMultiplier: (mode) => betModes[mode]?.costMultiplier ?? 1,
    getWantedLevel: () => snapshot.heatLevel, // stars = live in-spin cascade Heat (0–5)
    getCollectionCount: () => galleryProgress().pieces,
    collectWild: onWildCollected,
    getGalleryProgress: galleryProgress,
    // Head-start Power Level: unlocked tier, and the stars in effect for the
    // current bet (0 = dimmed because the bet is above this tier's average lock).
    getActiveTier: () => activeTier(power),
    getHeadStartStars: () => effectiveTier(power, currentBet()),
    isHeadStartActive: () => effectiveTier(power, currentBet()) > 0,
    onAction: handleAction,
    onSafeLand: (index, total) => {
      if (!muted) audioBus.fireSafeLand(index, total);
    },
    onBonusHeat: (level) => {
      if (!muted) audioBus.setBonusHeat(level);
    },
    onReelStop: (col, total) => audioBus.reelStop(col, total, muted),
    onAnticipation: () => audioBus.anticipation(muted),
    playAudio: (track, volumeScale) => {
      if (!muted) {
        if (track === "win_tick_low") audioBus.playWinTick("normal");
        else if (track === "win_tick_mid") audioBus.playWinTick("medium");
        else if (track === "win_tick_high") audioBus.playWinTick("high");
        else audioBus.fire(track as any, volumeScale);
      }
    },
    previewRecord: PREVIEW_RECORD
  });

  scene.resize();
  scene.renderSnapshot(snapshot);
  hideLoader();

  // DEV-only on-screen feature tester (stripped from production builds): fire any
  // win / combination / bonus animation from a button panel — no spinning needed.
  if (import.meta.env.DEV) {
    (window as any).scene = scene;
    (window as any).pixi = pixi;
    const { mountDebugPanel } = await import("./debugPanel");
    mountDebugPanel((action) => { void scene?.debugPlay(action); });
  }

  radioWheel = new RadioWheel((stationId) => {
    if (stationId === "off") {
      muted = true;
      audioBus.selectStation("off");
    } else {
      muted = false;
      audioBus.selectStation(stationId);
    }
    scene.renderSnapshot(snapshot); // refresh the radio button state
  }, "heat");

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
    playClick: () => { if (!muted) audioBus.playUI("click", false); }
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
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !turboDisabled()) {
      event.preventDefault();
      turboHeld = true;
      scene.renderSnapshot(snapshot);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      turboHeld = false;
      scene.renderSnapshot(snapshot);
    }
  });

  if (resume) await replayRound(resume, true);
}

async function handleAction(action: string): Promise<void> {
  if (isPlaying && ["spin", "buy", "super_buy"].includes(action)) return;

  switch (action) {
    case "info":
      scene.togglePaytable();
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
    case "buy":
    case "super_buy":
      if (jurisdiction?.disabledBuyFeature) return;
      if (!betModes[action]) return;
      const confirmed = await showConfirmPopup(
        action,
        betLevels[betIndex],
        currency,
        () => {
          if (!muted) audioBus.playUI("click", false);
        },
        betModes[action]?.costMultiplier ?? (action === "super_buy" ? 500 : 100)
      );
      if (confirmed) {
        await playRound(action);
      }
      return;
    case "spin":
      // A manual spin while autoplay is running stops the autoplay sequence.
      if (autoplayRemaining > 0) {
        stopAutoplay();
        return;
      }
      await playRound(spinModeForUser());
      return;
  }
}

/** The bet mode a user "spin" should request: ante if enabled, else the
 *  collection-routed base table (base / base_tierN). */
function spinModeForUser(): string {
  if (anteEnabled && betModes.ante) return "ante";
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
  if (jurisdiction?.disabledAutoplay) return;
  if (autoplayRemaining > 0) return; // already running
  autoplayStop = false;
  autoplayRemaining = count;
  while (autoplayRemaining > 0 && !autoplayStop) {
    if (isPlaying) break; // safety — should never happen (we await each round)
    const mode = spinModeForUser();
    const bet = currentBet();
    const cost = bet * (betModes[mode]?.costMultiplier ?? 1);
    if (cost <= 0 || cost > balance) break; // out of funds for the next spin
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

async function playRound(modeKey: string, free = false): Promise<void> {
  const betAmount = betLevels[betIndex];
  if (betAmount == null) return;

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
    const res = await client.play(betAmount, currency, modeKey, free);
    // Debit reflected by the RGS — never computed locally.
    balance = toDisplay(res.balance.amount);
    // Count this paid spin toward the current tier's average bet (organic play).
    if (spinOrganic && !free) {
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
    const msg = e instanceof RgsError ? `${e.code}: ${e.message}` : String(e);
    snapshot = { ...snapshot, state: "idle", lastMessage: msg };
    scene.renderSnapshot(snapshot);
    return;
  }
  isPlaying = false;

  // Consume the head-start when the Getaway triggered on an active-tier spin.
  // The bonus has just settled (/wallet/end-round, inside replayRound); spending
  // the Tier 3 head-start wipes the entire gallery (the Grand Reset).
  if (effTier > 0 && record.events.some((e) => e.type === "bonus_trigger")) {
    const { state, grandReset, consumedTier } = consumeHeadStart(power, effTier);
    power = state;
    powerStore.save(power);
    snapshot = {
      ...snapshot,
      lastMessage: grandReset
        ? "GRAND ESCAPE — gallery reset to zero!"
        : `Tier ${consumedTier} head-start used`
    };
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
  if (active) {
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
