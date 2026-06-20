import type { BetMode, SymbolId } from "./domain";

/**
 * Game model configuration. All RTP / volatility tuning lives here so the
 * engine stays mechanical and the numbers stay auditable.
 *
 * Generation quotas (`criteria`) only control COVERAGE — how many distinct
 * sims we sample in each band so the tail is well represented. The real
 * published frequency of each band is set by `freq` (the volatility model);
 * the optimizer then solves the remaining mass so weighted RTP == 0.96
 * EXACTLY for every mode (see optimize.ts).
 */

export const TARGET_RTP = 0.96;
/** Max allowed |RTP - 0.96| and max cross-mode spread, in RTP points. */
export const RTP_TOLERANCE = 0.005;
export const MAX_WIN_X = 5000;
/** Stake books store payout as integer hundredths and require payout % 10 == 0. */
export const PAYOUT_QUANTUM_X = 0.1;

export type Criteria = "zero" | "basegame" | "freegame" | "wincap";

/**
 * How the 96% RTP is split across bands for the cash-play modes (fractions of
 * the total RTP). Bonus carries most of it -> high volatility. The optimizer
 * derives each band's published probability from these fractions and the
 * engine's measured per-band mean, then exact-solves the residual.
 */
export interface RtpSplit {
  basegame: number;
  freegame: number;
  wincap: number;
}

export interface ModeConfig {
  /** Bet-mode cost multiplier; the RGS debits betAmount * cost. */
  cost: number;
  /** Stake `is_feature` (kept selected) / `is_buybonus` (bought) flags. */
  isFeature: boolean;
  isBuyBonus: boolean;
  /** How many simulations to generate (coverage, not frequency). */
  sims: number;
  /** Generation coverage quotas (NOT final probabilities). */
  criteria: Record<Criteria, number>;
  /**
   * Cash modes (base/ante): RTP-split volatility model; remaining mass = zero.
   * Buy modes: bonus is guaranteed, so RTP is solved via the wincap rate.
   */
  rtpSplit?: RtpSplit;
  reelWeights: Record<SymbolId, number>;
  safeValues: { value: number; weight: number }[];
}

export const MODES: Record<BetMode, ModeConfig> = {
  base: {
    cost: 1,
    isFeature: false,
    isBuyBonus: false,
    sims: 40_000,
    criteria: { zero: 0.30, basegame: 0.45, freegame: 0.22, wincap: 0.03 },
    rtpSplit: { basegame: 0.22, freegame: 0.72, wincap: 0.06 },
    reelWeights: baseReels(),
    safeValues: safeTable(1)
  },
  ante: {
    cost: 1.5,
    isFeature: true,
    isBuyBonus: false,
    sims: 40_000,
    criteria: { zero: 0.28, basegame: 0.45, freegame: 0.24, wincap: 0.03 },
    rtpSplit: { basegame: 0.2, freegame: 0.74, wincap: 0.06 },
    reelWeights: anteReels(),
    safeValues: safeTable(1)
  },
  buy: {
    cost: 100,
    isFeature: false,
    isBuyBonus: true,
    sims: 18_000,
    criteria: { zero: 0, basegame: 0, freegame: 0.88, wincap: 0.12 },
    reelWeights: baseReels(),
    safeValues: safeTable(1.15)
  },
  super_buy: {
    cost: 500,
    isFeature: false,
    isBuyBonus: true,
    sims: 18_000,
    criteria: { zero: 0, basegame: 0, freegame: 0.80, wincap: 0.20 },
    reelWeights: baseReels(),
    safeValues: safeTable(1.45)
  }
};

/** Cluster pays: payout (x of base bet) = clusterPay[symbol] * sizeFactor(size). */
export const CLUSTER_PAY: Record<SymbolId, number> = {
  BRASS: 0.12,
  KNIFE: 0.15,
  PISTOL: 0.22,
  AMMO: 0.28,
  DUFFEL: 0.36,
  CASH: 0.8,
  WILD: 0,
  DIAMOND: 1.5,
  BIKE: 2.1,
  CAR_WILD: 0,
  PHONE_SCATTER: 0,
  SAFE: 0,
  MASTER_KEY: 0,
  EMPTY: 0
};

/** Size scaling — steep enough for a high-volatility feel, not explosive. */
export function clusterSizeFactor(size: number): number {
  if (size < 5) return 0;
  const table = [
    /* 5 */ 0.6, /* 6 */ 1.1, /* 7 */ 1.8, /* 8 */ 2.8, /* 9 */ 4.2,
    /* 10 */ 6.2, /* 11 */ 9, /* 12 */ 13, /* 13 */ 19, /* 14 */ 27,
    /* 15 */ 38, /* 16 */ 54, /* 17 */ 74, /* 18 */ 100, /* 19 */ 135,
    /* 20 */ 185
  ];
  return table[Math.min(size, 20) - 5] ?? 0.6;
}

export const PAYABLE_SYMBOLS: SymbolId[] = [
  "BRASS",
  "KNIFE",
  "PISTOL",
  "AMMO",
  "DUFFEL",
  "CASH",
  "DIAMOND",
  "BIKE"
];

export const LOW_SYMBOLS: SymbolId[] = ["BRASS", "KNIFE"];

/** Heat 5 global multiplier set. */
export const HEAT5_MULTIPLIERS = [
  { value: 2, weight: 44 },
  { value: 3, weight: 28 },
  { value: 5, weight: 16 },
  { value: 8, weight: 8 },
  { value: 12, weight: 4 }
];

export const SCATTER_TRIGGER_COUNT = 3;
/** Hold & Spin starts with this many spins; resets on any land. Bust after this
 *  many consecutive dead spins (4 = baseline + 3 escalating heat levels). */
export const BONUS_RESPINS = 4;
export const BONUS_CELLS = 20;
/** Hard guards to keep event streams (and memory) bounded. */
export const MAX_TUMBLES = 16;
export const MAX_BONUS_SPINS = 40;

function baseReels(): Record<SymbolId, number> {
  return {
    BRASS: 200,
    KNIFE: 190,
    PISTOL: 155,
    AMMO: 145,
    DUFFEL: 125,
    CASH: 70,
    WILD: 55,
    DIAMOND: 40,
    BIKE: 26,
    CAR_WILD: 12,
    PHONE_SCATTER: 8,
    SAFE: 0,
    MASTER_KEY: 0,
    EMPTY: 0
  };
}

function anteReels(): Record<SymbolId, number> {
  return { ...baseReels(), PHONE_SCATTER: 14, CAR_WILD: 14 };
}

function safeTable(scale: number): { value: number; weight: number }[] {
  // Fat-tailed gold-bar values: most bars are tiny (1–3x) so a short bonus is a
  // real loss, but a rare big bar (250–750x) can make a single spin explode.
  // This skew is what gives the feature a high-variance, exciting payout curve.
  return [
    { value: 1 * scale, weight: 420 },
    { value: 2 * scale, weight: 250 },
    { value: 3 * scale, weight: 130 },
    { value: 5 * scale, weight: 70 },
    { value: 10 * scale, weight: 34 },
    { value: 25 * scale, weight: 14 },
    { value: 75 * scale, weight: 5 },
    { value: 250 * scale, weight: 1.6 },
    { value: 750 * scale, weight: 0.5 }
  ];
}
