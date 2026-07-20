export const GAME_ID = "heat-chase-grand-escape";
export const GRID_COLUMNS = 5;
export const GRID_ROWS = 4;
export const MAX_WIN_MULTIPLIER = 5000;

// Mode names must never contain restricted words (buy/bet/pay): Stake's social
// jurisdictions forbid them in mode naming across the game, replay window AND
// math files. Names align with the on-screen feature names.
export type BetMode =
  | "base"
  | "ante"
  | "getaway"
  | "super_getaway"
  // Collection Power-Level head-start tables (RTP-neutral; client-routed).
  | "base_tier1"
  | "base_tier2"
  | "base_tier3";

export type SymbolId =
  | "BRASS"
  | "KNIFE"
  | "PISTOL"
  | "AMMO"
  | "DUFFEL"
  | "CASH"
  | "WILD"
  | "DIAMOND"
  | "BIKE"
  | "CAR_WILD"
  | "PHONE_SCATTER"
  | "SAFE"
  | "MASTER_KEY"
  | "EMPTY";

export type Position = [column: number, row: number];
export type Board = SymbolId[][];

export interface SymbolDefinition {
  id: SymbolId;
  label: string;
  shortLabel: string;
  tier: "low" | "mid" | "premium" | "special" | "bonus" | "empty";
  role: string;
  baseClusterPay?: number;
}

export const SYMBOLS: Record<SymbolId, SymbolDefinition> = {
  BRASS: {
    id: "BRASS",
    label: "Brass Knuckles",
    shortLabel: "BK",
    tier: "low",
    role: "Low cluster pay; transforms at Heat 2",
    baseClusterPay: 0.12
  },
  KNIFE: {
    id: "KNIFE",
    label: "Knife",
    shortLabel: "KN",
    tier: "low",
    role: "Low cluster pay; transforms at Heat 2",
    baseClusterPay: 0.15
  },
  PISTOL: {
    id: "PISTOL",
    label: "Pistol",
    shortLabel: "PI",
    tier: "mid",
    role: "Medium cluster pay",
    baseClusterPay: 0.22
  },
  AMMO: {
    id: "AMMO",
    label: "Ammo",
    shortLabel: "AM",
    tier: "mid",
    role: "Medium cluster pay",
    baseClusterPay: 0.28
  },
  DUFFEL: {
    id: "DUFFEL",
    label: "Duffel Bag",
    shortLabel: "DB",
    tier: "mid",
    role: "Medium cluster pay",
    baseClusterPay: 0.36
  },
  CASH: {
    id: "CASH",
    label: "Cash",
    shortLabel: "$$",
    tier: "premium",
    role: "Highest transformation target",
    baseClusterPay: 0.8
  },
  WILD: {
    id: "WILD",
    label: "Wild Symbol",
    shortLabel: "WD",
    tier: "special",
    role: "Wild symbol triggering collection"
  },
  DIAMOND: {
    id: "DIAMOND",
    label: "Diamond",
    shortLabel: "DI",
    tier: "premium",
    role: "Premium cluster pay",
    baseClusterPay: 1.5
  },
  BIKE: {
    id: "BIKE",
    label: "Sports Bike",
    shortLabel: "SB",
    tier: "premium",
    role: "Premium cluster pay",
    baseClusterPay: 2.1
  },
  CAR_WILD: {
    id: "CAR_WILD",
    label: "Cyan Sports Car",
    shortLabel: "W",
    tier: "special",
    role: "Wild substitute and Heat 4 mega-wild"
  },
  PHONE_SCATTER: {
    id: "PHONE_SCATTER",
    label: "Armored Truck",
    shortLabel: "BT",
    tier: "special",
    role: "3+ trigger The Getaway bonus"
  },
  SAFE: {
    id: "SAFE",
    label: "Locked Safe",
    shortLabel: "SF",
    tier: "bonus",
    role: "Hold & Spin multiplier value"
  },
  MASTER_KEY: {
    id: "MASTER_KEY",
    label: "Master Key",
    shortLabel: "KY",
    tier: "bonus",
    role: "Doubles adjacent Safe values"
  },
  EMPTY: {
    id: "EMPTY",
    label: "Empty",
    shortLabel: "",
    tier: "empty",
    role: "Unoccupied bonus cell"
  }
};

export const TEXT = {
  title: "Heat Chase",
  subtitle: "Grand Escape",
  maxWin: "Win up to 5,000x your bet",
  buy: "The Getaway",
  superBuy: "Super Getaway",
  ante: "Ante",
  anteHelp: "Scatter chance increased",
  spin: "Spin",
  auto: "Auto",
  credit: "Credit",
  bet: "Bet",
  turboHint: "Hold space for turbo",
  normalWin: "Cluster Win",
  bust: "Bust the Stash",
  driver: "Getaway Driver",
  maxHeat: "Max Heat",
  bonus: "The Getaway",
  grand: "Grand Escape"
} as const;

export type GameEvent =
  | { type: "round_start"; mode: BetMode; boardSeedLabel: string; turboProfile: "normal" | "turbo" }
  | { type: "board_settle"; board: Board }
  | { type: "scatter_tease"; count: number; positions: Position[] }
  | {
      type: "cluster_win";
      winId: string;
      symbol: SymbolId;
      positions: Position[];
      baseMultiplier: number;
      heatLevel: number;
      appliedGlobalMultiplier: number;
      payout: number;
    }
  | { type: "tumble_remove"; positions: Position[] }
  | { type: "tumble_drop"; board: Board }
  | { type: "heat_advance"; from: number; to: number; reason: "win_tumble" }
  | { type: "heat_transform"; sourceSymbols: SymbolId[]; targetSymbol: SymbolId; positions: Position[]; board: Board }
  | { type: "mega_wild_place"; topLeft: Position; occupiedPositions: Position[]; board: Board }
  | { type: "global_multiplier_apply"; value: number; affectedWinIds: string[] }
  | { type: "bonus_trigger"; mode: "getaway" | "super_getaway"; scatterPositions: Position[] }
  | {
      type: "bonus_spin";
      respinsBefore: number;
      respinsAfter: number;
      landedSymbols: Array<{ symbol: "SAFE" | "MASTER_KEY"; position: Position; value?: number }>;
      lockedGrid: BonusCell[][];
    }
  | { type: "safe_lock"; position: Position; value: number }
  | { type: "master_key_crack"; keyPosition: Position; affectedSafes: Array<{ position: Position; oldValue: number; newValue: number }> }
  | { type: "bonus_end"; totalPayout: number; filledScreen: boolean }
  | { type: "round_end"; payoutMultiplier: number; capApplied: boolean };

export interface BonusCell {
  symbol: "EMPTY" | "SAFE" | "MASTER_KEY";
  value?: number;
}

export interface RoundRecord {
  id: number;
  payoutMultiplier: number;
  events: GameEvent[];
}

export const BET_MODES: Record<BetMode, { label: string; priceMultiplier: number; rtpTarget: number }> = {
  base: { label: "Base Game", priceMultiplier: 1, rtpTarget: 0.96 },
  ante: { label: "Ante", priceMultiplier: 1.5, rtpTarget: 0.96 },
  getaway: { label: "The Getaway", priceMultiplier: 100, rtpTarget: 0.96 },
  super_getaway: { label: "Super Getaway", priceMultiplier: 500, rtpTarget: 0.96 },
  base_tier1: { label: "Head-Start I", priceMultiplier: 1, rtpTarget: 0.96 },
  base_tier2: { label: "Head-Start II", priceMultiplier: 1, rtpTarget: 0.96 },
  base_tier3: { label: "Head-Start III", priceMultiplier: 1, rtpTarget: 0.96 }
};

/**
 * ── Math mirror ──────────────────────────────────────────────────────────────
 * The values below are DISPLAY copies of the authoritative math model in
 * stake-math/src/model.ts (CLUSTER_PAY / clusterSizeFactor / CASCADE_LADDER).
 * They exist so the in-game paytable shows EXACTLY what the engine pays.
 * tests/mathMirror.test.ts asserts they stay identical — never edit one side
 * without the other.
 */
export const CLUSTER_PAY_X: Partial<Record<SymbolId, number>> = {
  BRASS: 0.12,
  KNIFE: 0.15,
  PISTOL: 0.22,
  AMMO: 0.28,
  DUFFEL: 0.36,
  CASH: 0.8,
  DIAMOND: 1.5,
  BIKE: 2.1
};

/** Size factor per cluster size (index 0 = size 5 … index 15 = size 20). */
export const CLUSTER_SIZE_FACTORS = [
  0.4, 0.7, 1.0, 1.4, 1.9, 2.5, 3.2, 4.0, 5.0, 6.2, 7.6, 9.2, 11, 13, 15.5, 18
] as const;

export function clusterSizeFactor(size: number): number {
  if (size < 5) return 0;
  return CLUSTER_SIZE_FACTORS[Math.min(size, 20) - 5] ?? 0.4;
}

/** Tumble-multiplier ladder: rung = cascade number within one spin. */
export const CASCADE_LADDER = [1, 2, 4, 7, 12, 20, 32, 50, 80] as const;

/** Getaway Hold & Spin constants (mirror of stake-math/src/model.ts).
 *
 * COUNTDOWN rule, and the ONLY rule the player needs: you get
 * BONUS_START_RESPINS spins; a spin that lands nothing spends one; a spin that
 * locks anything is free (the meter HOLDS — it never goes back up). The
 * feature ends at 0, or when all BONUS_CELLS are filled.
 *
 * This must equal stake-math's value — the engine decides the real numbers and
 * the books carry them, so a mismatch here shows the player a starting count
 * the feature never actually had (mathMirror.test.ts guards this). */
export const BONUS_START_RESPINS = 3;
export const BONUS_CELLS = 20;

/**
 * Social-casino (Stake.US) terminology. Every player-facing string that may
 * contain a restricted word (bet / buy / pay / cost …) must come from here so
 * the whole game flips with `jurisdiction.socialCasino`.
 */
export interface UiStrings {
  betLabel: string;         // "Bet"  → "Play"
  idlePrompt: string;       // "PLACE YOUR BET" → social-safe prompt
  featureKicker: string;    // "BUY" panel kicker → "FEATURE"
  costWord: string;         // "COST" → "CAN BE PLAYED FOR"
  betWord: string;          // "BET" → "PLAY" (unit suffix, e.g. "100x BET")
  confirmTitleLead: string; // "BUY" → "THE"
  confirmKicker: string;
  confirmButton: string;    // "Confirm Buy" → "Confirm"
  baseBetLabel: string;     // replay: "Base Bet" → "Base Play"
  costMultLabel: string;    // replay: "Cost Multiplier" → "Feature Multiplier"
  finalMultLabel: string;   // replay: "Payout Multiplier" → "Final Multiplier"
  totalCostLabel: string;   // replay: "Total Cost" → "Play Amount"
  maxWinLine: string;
}

export function uiStrings(social: boolean): UiStrings {
  return social
    ? {
        betLabel: "Play",
        idlePrompt: "PRESS SPIN TO PLAY",
        featureKicker: "FEATURE",
        costWord: "CAN BE PLAYED FOR",
        betWord: "PLAY",
        confirmTitleLead: "THE",
        confirmKicker: "HEIST BRIEFING · FEATURE PLAY",
        confirmButton: "Confirm",
        baseBetLabel: "Base Play",
        costMultLabel: "Feature Multiplier",
        finalMultLabel: "Final Multiplier",
        totalCostLabel: "Play Amount",
        maxWinLine: "Win up to 5,000x your play"
      }
    : {
        betLabel: "Bet",
        idlePrompt: "PLACE YOUR BET",
        featureKicker: "BUY",
        costWord: "COST",
        betWord: "BET",
        confirmTitleLead: "BUY",
        confirmKicker: "HEIST BRIEFING · BUY FEATURE",
        confirmButton: "Confirm Buy",
        baseBetLabel: "Base Bet",
        costMultLabel: "Cost Multiplier",
        finalMultLabel: "Payout Multiplier",
        totalCostLabel: "Total Cost",
        maxWinLine: "Win up to 5,000x your bet"
      };
}

/** Social currencies arrive as XGC / XSC and must display as GC / SC. */
export function displayCurrency(code: string): string {
  if (code === "XGC") return "GC";
  if (code === "XSC") return "SC";
  return code;
}

export function assertBoard(board: Board): void {
  if (board.length !== GRID_COLUMNS) {
    throw new Error(`Board must have ${GRID_COLUMNS} columns`);
  }

  board.forEach((column, columnIndex) => {
    if (column.length !== GRID_ROWS) {
      throw new Error(`Board column ${columnIndex} must have ${GRID_ROWS} rows`);
    }

    column.forEach((symbol) => {
      if (!SYMBOLS[symbol]) {
        throw new Error(`Unknown symbol ${symbol}`);
      }
    });
  });
}

export function validateRoundRecord(record: RoundRecord): void {
  if (!Number.isInteger(record.id)) {
    throw new Error("Round id must be an integer");
  }
  if (record.payoutMultiplier < 0 || record.payoutMultiplier > MAX_WIN_MULTIPLIER) {
    throw new Error(`Invalid payout multiplier ${record.payoutMultiplier}`);
  }
  if (!record.events.length) {
    throw new Error(`Round ${record.id} has no events`);
  }

  let ended = false;
  for (const event of record.events) {
    if (event.type === "board_settle" || event.type === "tumble_drop" || event.type === "heat_transform" || event.type === "mega_wild_place") {
      assertBoard(event.board);
    }
    if (event.type === "round_end") {
      ended = true;
      if (Math.abs(event.payoutMultiplier - record.payoutMultiplier) > 0.0001) {
        throw new Error(`Round ${record.id} payout mismatch`);
      }
    }
    for (const position of eventPositions(event)) {
      assertPosition(position);
    }
  }

  if (!ended) {
    throw new Error(`Round ${record.id} is missing round_end`);
  }
}

function assertPosition([column, row]: Position): void {
  if (column < 0 || column >= GRID_COLUMNS || row < 0 || row >= GRID_ROWS) {
    throw new Error(`Position ${column}:${row} is outside ${GRID_COLUMNS}x${GRID_ROWS}`);
  }
}

function eventPositions(event: GameEvent): Position[] {
  switch (event.type) {
    case "scatter_tease":
      return event.positions;
    case "cluster_win":
      return event.positions;
    case "tumble_remove":
      return event.positions;
    case "heat_transform":
      return event.positions;
    case "mega_wild_place":
      return [event.topLeft, ...event.occupiedPositions];
    case "bonus_trigger":
      return event.scatterPositions;
    case "bonus_spin":
      return event.landedSymbols.map((symbol) => symbol.position);
    case "safe_lock":
      return [event.position];
    case "master_key_crack":
      return [event.keyPosition, ...event.affectedSafes.map((safe) => safe.position)];
    default:
      return [];
  }
}

export function sumEventPayouts(record: RoundRecord): number {
  return Number(
    record.events
      .reduce((total, event) => {
        if (event.type === "cluster_win") return total + event.payout;
        if (event.type === "bonus_end") return total + event.totalPayout;
        return total;
      }, 0)
      .toFixed(4)
  );
}

export function positionsKey(positions: Position[]): string {
  return positions.map(([column, row]) => `${column}:${row}`).join("|");
}
