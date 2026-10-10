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
    // Legacy id/filename ("CAR_WILD" / cyan_car_wild.webp) kept because the math
    // books reference the id string; the artwork is body armor, so the
    // player-facing label matches the art.
    id: "CAR_WILD",
    label: "Body Armor",
    shortLabel: "AR",
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
  maxWin: "Win up to 5,000x your play amount",
  buy: "The Getaway",
  superBuy: "Super Getaway",
  ante: "Ante",
  anteHelp: "Scatter chance increased",
  spin: "Spin",
  auto: "Auto",
  credit: "BALANCE",
  bet: "Play",
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
  /** DRIVE-BY: the getaway car drops Body Armor wilds (CAR_WILD) at `positions`; `board` is the result. */
  | { type: "drive_by"; positions: Position[]; board: Board }
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
 * DISPLAY copies of the authoritative math model in stake-math/src/model.ts
 * (PAYTABLE / CASCADE_LADDER / gold-bar tables). They exist so the game info
 * shows EXACTLY what the engine pays: every cluster win in the books is
 * `PAYTABLE_X[symbol][size - 5] × cascade multiplier`, with no rescaling.
 * __tests__/mathMirror.test.ts asserts they stay identical — never edit one
 * side without the other.
 */
export const MIN_CLUSTER = 5;
export const MAX_CLUSTER = 20;

/** Pay of one cluster (x of the base bet) per cluster size 5..20, before the cascade multiplier. */
export const PAYTABLE_X: Partial<Record<SymbolId, readonly number[]>> = {
  //        5     6     7     8     9     10    11    12    13     14     15     16     17     18     19     20
  BRASS:   [0.05, 0.08, 0.12, 0.17, 0.23, 0.30, 0.38, 0.48, 0.60,  0.74,  0.91,  1.10,  1.32,  1.56,  1.86,  2.16],
  KNIFE:   [0.06, 0.11, 0.15, 0.21, 0.29, 0.38, 0.48, 0.60, 0.75,  0.93,  1.14,  1.38,  1.65,  1.95,  2.33,  2.70],
  PISTOL:  [0.09, 0.15, 0.22, 0.31, 0.42, 0.55, 0.70, 0.88, 1.10,  1.36,  1.67,  2.02,  2.42,  2.86,  3.41,  3.96],
  AMMO:    [0.11, 0.20, 0.28, 0.39, 0.53, 0.70, 0.90, 1.12, 1.40,  1.74,  2.13,  2.58,  3.08,  3.64,  4.34,  5.04],
  DUFFEL:  [0.14, 0.25, 0.36, 0.50, 0.68, 0.90, 1.15, 1.44, 1.80,  2.23,  2.74,  3.31,  3.96,  4.68,  5.58,  6.48],
  CASH:    [0.32, 0.56, 0.80, 1.12, 1.52, 2.00, 2.56, 3.20, 4.00,  4.96,  6.08,  7.36,  8.80, 10.40, 12.40, 14.40],
  DIAMOND: [0.60, 1.05, 1.50, 2.10, 2.85, 3.75, 4.80, 6.00, 7.50,  9.30, 11.40, 13.80, 16.50, 19.50, 23.25, 27.00],
  BIKE:    [0.84, 1.47, 2.10, 2.94, 3.99, 5.25, 6.72, 8.40, 10.50, 13.02, 15.96, 19.32, 23.10, 27.30, 32.55, 37.80]
};

/** Pay of one `size`-cluster of `symbol` (x of base bet, before the cascade multiplier). */
export function clusterPay(symbol: SymbolId, size: number): number {
  if (size < MIN_CLUSTER) return 0;
  return PAYTABLE_X[symbol]?.[Math.min(size, MAX_CLUSTER) - MIN_CLUSTER] ?? 0;
}

/** Every Gold Bar value (x of the base bet) each mode can land in The Getaway. */
export const GOLD_BAR_VALUES: Record<BetMode, readonly number[]> = {
  base: [1, 2, 3, 5, 10, 25, 75, 250, 750],
  ante: [1, 2, 3, 5, 10, 25, 75, 250, 750],
  base_tier1: [1, 2, 3, 5, 10, 25, 75, 250, 750],
  base_tier2: [1, 2, 3, 5, 10, 25, 75, 250, 750],
  base_tier3: [1, 2, 3, 5, 10, 25, 75, 250, 750],
  getaway: [1.15, 2.3, 3.45, 5.75, 11.5, 28.75, 86.25, 287.5, 862.5],
  super_getaway: [11, 16, 22, 30, 41, 55, 77, 110]
};

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
export const BONUS_START_RESPINS = 5;
export const BONUS_CELLS = 20;

/**
 * Social-casino (stake.us) terminology. Every player-facing string that may
 * contain a restricted word (bet / buy / pay / cost / cash …) must come from
 * here so the whole game flips with `jurisdiction.socialCasino` / `social=true`.
 */
export interface UiStrings {
  betLabel: string;         // "Bet"  → "Play"
  creditLabel: string;      // "BALANCE" (never "CREDIT")
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
  totalWinLabel: string;    // "Total Win" (allowed in both)
  paytableTab: string;      // game-info tab: "Paytable" → "Symbols"
  payoutsHeading: string;   // "Symbol Payouts" → "Symbol Wins"
  maxWinLine: string;
}

export function uiStrings(social: boolean): UiStrings {
  return social
    ? {
        betLabel: "Play",
        creditLabel: "BALANCE",
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
        totalWinLabel: "Total Win",
        paytableTab: "Symbols",
        payoutsHeading: "Symbol Wins",
        maxWinLine: "Win up to 5,000x your play"
      }
    : {
        betLabel: "Bet",
        creditLabel: "BALANCE",
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
        totalWinLabel: "Total Win",
        paytableTab: "Paytable",
        payoutsHeading: "Symbol Payouts",
        maxWinLine: "Win up to 5,000x your bet"
      };
}

/** Player-facing symbol name. "Cash" is a restricted social word → "Loot". */
export function symbolLabel(id: SymbolId, social: boolean): string {
  if (social && id === "CASH") return "Loot";
  return SYMBOLS[id].label;
}

/**
 * Engine's stake.us restricted terms (Approval Guidelines → Jurisdiction
 * Requirements). Social-mode text must never match. Used by the tests and by
 * the DEV-only on-screen audit.
 */
export const SOCIAL_RESTRICTED =
  /\b(bet|bets|betting|rebet|stake|stakes|cash|pay|pays|paid|payer|payout|payouts|paytable|money|buy|bought|purchase|purchased|cost|costs|credit|credited|gamble|wager|deposit|withdraw|currency|fund|funds)\b|win feature|bonus buy|place your bets/i;

/** Social currencies arrive as XGC / XSC / XEC and display as GC / SC / SC. */
export function displayCurrency(code: string): string {
  if (code === "XGC") return "GC";
  if (code === "XSC" || code === "XEC") return "SC";
  return code;
}

export function isSocialCurrency(code: string): boolean {
  return code === "XGC" || code === "XSC" || code === "XEC";
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
    if (event.type === "board_settle" || event.type === "tumble_drop" || event.type === "heat_transform" || event.type === "mega_wild_place" || event.type === "drive_by") {
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
    case "drive_by":
      return event.positions;
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
