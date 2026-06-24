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

export type Criteria = "zero" | "basegame" | "basebig" | "freegame" | "wincap";

/**
 * Non-bonus wins at or above this multiplier are bucketed into `basebig`
 * instead of `basegame`. This is what lets a fat cascade tail coexist with a
 * high base hit-rate: the frequent small wins (`basegame`) keep their own high
 * probability, while the rare laddered monsters (`basebig`) get their own tiny
 * probability. Without the split, the tail poisons the base frequency and the
 * game drowns in dead spins (measured 91% before the split).
 */
export const BASEBIG_THRESHOLD = 5;

/**
 * Tumble-multiplier ladder. Climbs one rung per cascade and multiplies every
 * win from that rung on, so a LONG chain of modest clusters compounds into the
 * big win — not a single fat cluster. Index = cascade number (0 = first board
 * evaluation, ×1). Front-loaded because the 5x4 grid only sustains short chains.
 */
export const CASCADE_LADDER = [1, 2, 4, 7, 12, 20, 30, 45, 65];

export function cascadeMultiplier(cascadeIndex: number): number {
  return CASCADE_LADDER[Math.min(cascadeIndex, CASCADE_LADDER.length - 1)]!;
}

/**
 * How the 96% RTP is split across bands for the cash-play modes (fractions of
 * the total RTP). Bonus carries most of it -> high volatility. The optimizer
 * derives each band's published probability from these fractions and the
 * engine's measured per-band mean, then exact-solves the residual.
 */
export interface RtpSplit {
  basegame: number;
  basebig: number;
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
    // Coverage quotas (NOT final frequency). basebig gets generous COVERAGE so
    // the rare big-cascade tail is well sampled; its real probability is tiny.
    criteria: { zero: 0.22, basegame: 0.46, basebig: 0.10, freegame: 0.20, wincap: 0.02 },
    // basegame carries the FREQUENT small wins (high hit-rate); basebig carries
    // the rare laddered monsters. Splitting them is what defeats the dead-spin
    // problem at a fixed 96% RTP.
    rtpSplit: { basegame: 0.22, basebig: 0.10, freegame: 0.62, wincap: 0.06 },
    reelWeights: baseReels(),
    safeValues: safeTable(1)
  },
  ante: {
    cost: 1.5,
    isFeature: true,
    isBuyBonus: false,
    sims: 40_000,
    criteria: { zero: 0.20, basegame: 0.46, basebig: 0.10, freegame: 0.22, wincap: 0.02 },
    rtpSplit: { basegame: 0.21, basebig: 0.10, freegame: 0.63, wincap: 0.06 },
    reelWeights: anteReels(),
    safeValues: safeTable(1)
  },
  buy: {
    cost: 100,
    isFeature: false,
    isBuyBonus: true,
    sims: 18_000,
    criteria: { zero: 0, basegame: 0, basebig: 0, freegame: 0.88, wincap: 0.12 },
    reelWeights: baseReels(),
    safeValues: safeTable(1.15)
  },
  super_buy: {
    cost: 500,
    isFeature: false,
    isBuyBonus: true,
    sims: 18_000,
    criteria: { zero: 0, basegame: 0, basebig: 0, freegame: 0.80, wincap: 0.20 },
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

/**
 * Size scaling — deliberately FLAT. Cluster size barely matters now; the big
 * win is built by chain LENGTH via the cascade multiplier ladder, not by one
 * fat cluster. A 20-cluster pays ~18x the base (was 185x); the difference is
 * carried by the ladder when chains run long.
 */
export function clusterSizeFactor(size: number): number {
  if (size < 5) return 0;
  const table = [
    /* 5 */ 0.4, /* 6 */ 0.7, /* 7 */ 1.0, /* 8 */ 1.4, /* 9 */ 1.9,
    /* 10 */ 2.5, /* 11 */ 3.2, /* 12 */ 4.0, /* 13 */ 5.0, /* 14 */ 6.2,
    /* 15 */ 7.6, /* 16 */ 9.2, /* 17 */ 11, /* 18 */ 13, /* 19 */ 15.5,
    /* 20 */ 18
  ];
  return table[Math.min(size, 20) - 5] ?? 0.4;
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

export const SCATTER_TRIGGER_COUNT = 3;
/**
 * Share of forced bonus COVERAGE generated as the classic 3-scatter land (the
 * rare surprise). The rest (~85%) is seeded as a deep Wanted-path cascade, so
 * the served Getaways are mostly Heat-5 / Wanted-triggered, not random scatters.
 */
export const SCATTER_TRIGGER_SHARE = 0.15;
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
    WILD: 3, // RARE: the collection symbol — one WILD reveals one girl body part
    DIAMOND: 40,
    BIKE: 26,
    CAR_WILD: 12,
    PHONE_SCATTER: 3, // thinned: scatters are now a rare surprise, not the main route
    SAFE: 0,
    MASTER_KEY: 0,
    EMPTY: 0
  };
}

// Ante boosts the WANTED path: more wilds -> chains continue deeper -> Heat 5 /
// the Getaway lands more often (that is the value of paying the ante).
function anteReels(): Record<SymbolId, number> {
  // Ante also fills the collection a bit faster (WILD 3 -> 5) as a perk.
  return { ...baseReels(), PHONE_SCATTER: 5, CAR_WILD: 18, WILD: 5 };
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
