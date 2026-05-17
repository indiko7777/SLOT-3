import { Application } from "pixi.js";
import { EventAudioBus } from "./audio";
import type { BetMode } from "./domain";
import { showLoader, updateLoader, hideLoader } from "./loader";
import { applyEvent, INITIAL_SNAPSHOT, type PlaybackSnapshot } from "./playback";
import { loadSymbolTextures } from "./pixi/assets";
import { PixiGameScene } from "./pixi/PixiGameScene";
import { PrecomputedBookOutcomeProvider } from "./rgs";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const mount = root;

document.documentElement.style.width = "100%";
document.documentElement.style.height = "100%";
document.documentElement.style.margin = "0";
document.documentElement.style.overflow = "hidden";
document.body.style.width = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "#050816";
root.style.width = "100%";
root.style.height = "100%";

const outcomeProvider = new PrecomputedBookOutcomeProvider();
const audioBus = new EventAudioBus();

const BET_LEVELS = [0.20, 0.40, 0.60, 1.00, 2.00, 4.00, 6.00, 10.00, 20.00, 40.00, 60.00, 100.00];

let pixi: Application;
let scene: PixiGameScene;
let mode: BetMode = "base";
let anteEnabled = false;
let turbo = false;
let muted = false;
let isPlaying = false;
let snapshot: PlaybackSnapshot = INITIAL_SNAPSHOT;
let betIndex = 4; // default 2.00
let credit = 100_000;

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
  updateLoader(0.3);

  pixi.canvas.style.display = "block";
  mount.appendChild(pixi.canvas);

  // Load textures + pre-fetch audio in parallel
  await Promise.all([
    loadSymbolTextures(),
    audioBus.prefetch()
  ]);
  updateLoader(0.7);

  scene = new PixiGameScene(pixi, {
    getMode: () => mode,
    isAnteEnabled: () => anteEnabled,
    isMuted: () => muted,
    isTurbo: () => turbo,
    isPlaying: () => isPlaying,
    getBetLevel: () => BET_LEVELS[betIndex],
    getCredit: () => credit,
    onAction: handleAction,
    onSafeLand: (index, total) => {
      if (!muted) audioBus.fireSafeLand(index, total);
    },
    previewRecord: outcomeProvider.getPreviewBoard()
  });

  scene.resize();
  scene.renderSnapshot(snapshot);
  hideLoader();

  window.addEventListener("resize", () => {
    scene.resize();
    scene.renderSnapshot(snapshot);
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      turbo = true;
      scene.renderSnapshot(snapshot);
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      turbo = false;
      scene.renderSnapshot(snapshot);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__gameAction = handleAction;
}

async function handleAction(action: string): Promise<void> {
  if (isPlaying && ["spin", "buy", "super_buy"].includes(action)) return;

  if (action === "info") {
    scene.togglePaytable();
    return;
  }

  if (action === "ante") {
    anteEnabled = !anteEnabled;
    mode = anteEnabled ? "ante" : "base";
    scene.renderSnapshot(snapshot);
    return;
  }

  if (action === "mute") {
    muted = !muted;
    if (!muted) await audioBus.unlock();
    scene.renderSnapshot(snapshot);
    return;
  }

  if (action === "plus") {
    if (betIndex < BET_LEVELS.length - 1) {
      betIndex++;
      scene.renderSnapshot(snapshot);
    }
    return;
  }

  if (action === "minus") {
    if (betIndex > 0) {
      betIndex--;
      scene.renderSnapshot(snapshot);
    }
    return;
  }

  if (action === "menu") {
    scene.togglePaytable();
    return;
  }

  if (action === "buy" || action === "super_buy") {
    mode = action;
    await playRound();
    return;
  }

  if (action === "spin") {
    mode = anteEnabled ? "ante" : "base";
    await playRound();
  }
}

async function playRound(): Promise<void> {
  const bet = BET_LEVELS[betIndex];
  const stakeMultiplier = mode === "buy" ? 100 : mode === "super_buy" ? 500 : anteEnabled ? 1.5 : 1;
  const totalCost = bet * stakeMultiplier;

  if (credit < totalCost) return; // insufficient funds

  isPlaying = true;
  credit -= totalCost;
  snapshot = INITIAL_SNAPSHOT;
  scene.resetRound(snapshot);

  const record = await outcomeProvider.requestOutcome({
    mode,
    stakeMultiplier
  });

  for (const event of record.events) {
    snapshot = applyEvent(snapshot, event, record);
    audioBus.playEvent(event, muted, turbo);
    await scene.playEvent(event, snapshot);
  }

  // Credit the win (payout × bet)
  const winAmount = record.payoutMultiplier * bet;
  credit += winAmount;

  isPlaying = false;
  scene.renderSnapshot(snapshot);
}
