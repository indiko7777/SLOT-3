import type { Board, BonusCell, GameEvent, Position, RoundRecord, SymbolId } from "./domain";

export interface PlaybackSnapshot {
  state: string;
  modeLabel: string;
  board: Board | null;
  bonusGrid: BonusCell[][] | null;
  heatLevel: number;
  globalMultiplier: number;
  roundWin: number;
  lastWin: number;
  lastMessage: string;
  highlighted: Position[];
  transformed: Position[];
  cracked: Position[];
  scatterPositions: Position[];
  respins: number;
  capApplied: boolean;
  collectionCount: number;
  /** Base bet (display units) wagered on this round, so the win counter can show
   *  the real money amount (roundWin × betAmount) and stay correct even if the
   *  player changes the bet after the round. 0 until a spin sets it. */
  betAmount: number;
}

export const INITIAL_SNAPSHOT: PlaybackSnapshot = {
  state: "idle",
  modeLabel: "Base Game",
  board: null,
  bonusGrid: null,
  heatLevel: 0,
  globalMultiplier: 1,
  roundWin: 0,
  lastWin: 0,
  lastMessage: "Ready for the chase",
  highlighted: [],
  transformed: [],
  cracked: [],
  scatterPositions: [],
  respins: 3,
  capApplied: false,
  collectionCount: 0,
  betAmount: 0
};

export function applyEvent(snapshot: PlaybackSnapshot, event: GameEvent, record: RoundRecord): PlaybackSnapshot {
  const next: PlaybackSnapshot = {
    ...snapshot,
    highlighted: [],
    transformed: [],
    cracked: [],
    scatterPositions: []
  };

  switch (event.type) {
    case "round_start":
      return {
        ...INITIAL_SNAPSHOT,
        state: "spinning",
        modeLabel: event.mode,
        collectionCount: snapshot.collectionCount,
        betAmount: snapshot.betAmount,
        lastMessage: `Dispatch locked: ${event.boardSeedLabel}`
      };
    case "board_settle":
      return {
        ...next,
        state: "board_settle",
        board: event.board,
        lastMessage: "Board settled"
      };
    case "scatter_tease":
      return {
        ...next,
        state: "cluster_evaluate",
        scatterPositions: event.positions,
        lastMessage: event.count >= 3 ? "Armored Trucks found" : "Scatter tease"
      };
    case "cluster_win":
      return {
        ...next,
        state: event.heatLevel >= 5 ? "big_win" : "win_highlight",
        highlighted: event.positions,
        lastWin: event.payout,
        roundWin: Number((snapshot.roundWin + event.payout).toFixed(2)),
        lastMessage: event.appliedGlobalMultiplier > 1 ? `${event.appliedGlobalMultiplier}x Max Heat win` : "Cluster win"
      };
    case "tumble_remove":
      return {
        ...next,
        state: "tumble",
        highlighted: event.positions,
        lastMessage: "Loot clears"
      };
    case "tumble_drop":
      return {
        ...next,
        state: "tumble",
        board: event.board,
        lastMessage: "New symbols drop"
      };
    case "heat_advance":
      return {
        ...next,
        state: "heat_advance",
        heatLevel: event.to,
        lastMessage: heatMessage(event.to)
      };
    case "heat_transform":
      return {
        ...next,
        state: "heat_feature_transform",
        board: event.board,
        transformed: event.positions,
        lastMessage: "Bust the Stash"
      };
    case "mega_wild_place":
      return {
        ...next,
        state: "heat_feature_transform",
        board: event.board,
        highlighted: event.occupiedPositions,
        lastMessage: "Getaway Driver"
      };
    case "global_multiplier_apply":
      return {
        ...next,
        state: "heat_feature_transform",
        globalMultiplier: event.value,
        lastMessage: `Max Heat ${event.value}x`
      };
    case "bonus_trigger":
      return {
        ...next,
        state: "bonus_intro",
        scatterPositions: event.scatterPositions,
        lastMessage: event.mode === "super_getaway" ? "Super Getaway triggered" : "The Getaway triggered"
      };
    case "bonus_spin":
      return {
        ...next,
        state: "bonus_respin",
        bonusGrid: event.lockedGrid,
        respins: event.respinsAfter,
        highlighted: event.landedSymbols.map((symbol) => symbol.position),
        lastMessage: event.landedSymbols.length ? "Vault symbols locked" : "No new lock"
      };
    case "safe_lock":
      return {
        ...next,
        state: "bonus_collect",
        highlighted: [event.position],
        lastMessage: `Safe locked ${event.value}x`
      };
    case "master_key_crack":
      return {
        ...next,
        state: "bonus_key_crack",
        highlighted: [event.keyPosition],
        cracked: event.affectedSafes.map((safe) => safe.position),
        bonusGrid: updateCrackedSafes(snapshot.bonusGrid, event.affectedSafes),
        lastMessage: "Master Key cracked a safe"
      };
    case "bonus_end":
      return {
        ...next,
        state: event.filledScreen ? "big_win" : "bonus_collect",
        roundWin: Number((snapshot.roundWin + event.totalPayout).toFixed(2)),
        lastWin: event.totalPayout,
        lastMessage: event.filledScreen ? "Grand Escape" : "Getaway collected"
      };
    case "round_end":
      return {
        ...next,
        state: event.payoutMultiplier === 0 ? "idle"
             : event.payoutMultiplier >= 100 ? "big_win"
             : "round_complete",
        roundWin: record.payoutMultiplier,
        lastWin: 0,
        capApplied: event.capApplied,
        lastMessage: event.payoutMultiplier === 0 ? ""
                   : event.capApplied ? "Max win paid"
                   : "Round complete"
      };
    default:
      return next;
  }
}

export function eventDelay(event: GameEvent, turbo: boolean): number {
  if (turbo) {
    if (event.type === "round_start") return 80;
    if (event.type === "round_end") return 220;
    return 180;
  }

  switch (event.type) {
    case "round_start":
      return 450;
    case "board_settle":
      return 650;
    case "cluster_win":
      return 850;
    case "heat_transform":
    case "mega_wild_place":
    case "global_multiplier_apply":
      return 1050;
    case "bonus_trigger":
      return 1200;
    case "master_key_crack":
      return 1050;
    case "round_end":
      return 900;
    default:
      return 620;
  }
}

export function symbolTone(symbol: SymbolId): string {
  if (symbol === "BRASS" || symbol === "KNIFE") return "low";
  if (symbol === "CASH" || symbol === "DIAMOND" || symbol === "BIKE") return "premium";
  if (symbol === "CAR_WILD" || symbol === "WILD") return "wild";
  if (symbol === "PHONE_SCATTER") return "scatter";
  if (symbol === "SAFE" || symbol === "MASTER_KEY") return "bonus";
  return "mid";
}

function heatMessage(level: number): string {
  if (level === 3) return "Heat 3: Bust the Stash armed";
  if (level === 4) return "Heat 4: Driver inbound";
  if (level >= 5) return "Heat 5: Max Heat";
  return `Heat ${level}`;
}

function updateCrackedSafes(
  grid: BonusCell[][] | null,
  updates: Array<{ position: Position; oldValue: number; newValue: number }>
): BonusCell[][] | null {
  if (!grid) return grid;
  const next = grid.map((column) => column.map((cell) => ({ ...cell })));
  for (const update of updates) {
    const [column, row] = update.position;
    next[column][row] = { symbol: "SAFE", value: update.newValue };
  }
  return next;
}
