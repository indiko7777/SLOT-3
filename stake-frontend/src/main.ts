import { Application } from "pixi.js";
import { EventAudioBus } from "./audio";
import type { GameEvent, RoundRecord } from "./domain";
import { hideLoader, showLoader, updateLoader } from "./loader";
import { applyEvent, INITIAL_SNAPSHOT, type PlaybackSnapshot } from "./playback";
import { loadSymbolTextures } from "./pixi/assets";
import { PixiGameScene } from "./pixi/PixiGameScene";
import { RgsClient, RgsError, toDisplay } from "./rgs/client";
import { readSession } from "./rgs/session";
import type { BetModeObject, Jurisdiction } from "./rgs/types";

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
let activeModeKey = "base";
let anteEnabled = false;
let turbo = false;
let muted = false;
let isPlaying = false;
let snapshot: PlaybackSnapshot = INITIAL_SNAPSHOT;

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
    isTurbo: () => turbo,
    isPlaying: () => isPlaying,
    getBetLevel: () => betLevels[betIndex] ?? 0,
    getCredit: () => balance,
    getCurrency: () => currency,
    onAction: handleAction,
    onSafeLand: (index, total) => {
      if (!muted) audioBus.fireSafeLand(index, total);
    },
    previewRecord: PREVIEW_RECORD
  });

  scene.resize();
  scene.renderSnapshot(snapshot);
  hideLoader();

  window.addEventListener("resize", () => {
    scene.resize();
    scene.renderSnapshot(snapshot);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !turboDisabled()) {
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

  if (resume) await replayRound(resume, true);
}

async function handleAction(action: string): Promise<void> {
  if (isPlaying && ["spin", "buy", "super_buy"].includes(action)) return;

  switch (action) {
    case "info":
    case "menu":
      scene.togglePaytable();
      return;
    case "mute":
      muted = !muted;
      if (!muted) await audioBus.unlock();
      scene.renderSnapshot(snapshot);
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
      await playRound(action);
      return;
    case "spin":
      await playRound(anteEnabled && betModes.ante ? "ante" : "base");
      return;
  }
}

async function playRound(modeKey: string): Promise<void> {
  const betAmount = betLevels[betIndex];
  if (betAmount == null) return;

  isPlaying = true;
  activeModeKey = modeKey;
  snapshot = INITIAL_SNAPSHOT;
  scene.resetRound(snapshot);

  try {
    const res = await client.play(betAmount, currency, modeKey);
    // Debit reflected by the RGS — never computed locally.
    balance = toDisplay(res.balance.amount);
    const record: RoundRecord = {
      id: res.round.roundID,
      payoutMultiplier: res.round.payoutMultiplier,
      events: res.round.state
    };
    await replayRound(record, res.round.active);
  } catch (e) {
    isPlaying = false;
    const msg = e instanceof RgsError ? `${e.code}: ${e.message}` : String(e);
    snapshot = { ...snapshot, state: "idle", lastMessage: msg };
    scene.renderSnapshot(snapshot);
    return;
  }
  isPlaying = false;
  scene.renderSnapshot(snapshot);
}

async function replayRound(record: RoundRecord, active: boolean): Promise<void> {
  for (const event of record.events as GameEvent[]) {
    snapshot = applyEvent(snapshot, event, record);
    audioBus.playEvent(event, muted, turbo);
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
        ["BIKE", "CASH", "WATCH", "KNIFE"],
        ["PISTOL", "DIAMOND", "DUFFEL", "AMMO"],
        ["CASH", "BRASS", "CAR_WILD", "PISTOL"],
        ["WATCH", "AMMO", "DIAMOND", "DUFFEL"],
        ["DIAMOND", "CASH", "PISTOL", "BIKE"]
      ]
    }
  ]
};
