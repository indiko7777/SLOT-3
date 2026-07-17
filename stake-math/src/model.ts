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
export const CASCADE_LADDER = [1, 2, 4, 7, 12, 20, 32, 50, 80];

export function cascadeMultiplier(cascadeIndex: number): number {
  return CASCADE_LADDER[Math.min(cascadeIndex, CASCADE_LADDER.length - 1)]!;
}

/**
 * basegame "Wanted-tease" depth mix: how an ordinary base-cost winning spin is
 * shaped, as weights over [stay at Heat 1, climb to 2, climb to 3, climb to 4].
 * A tease climbs by planting a MINIMUM low-symbol cluster each tumble, so the
 * payout stays under BASEBIG_THRESHOLD and the book stays a frequent basegame
 * book — this is the visible "almost!" 2★ near-miss that makes the chase toward
 * the rare Getaway feel alive.
 *
 * NOTE on the structural cap: reaching Heat 3 fires the Mega Wild, which near-
 * guarantees the chain runs on to Heat 5 = the Getaway trigger. So a book CANNOT
 * rest at 3★/4★ — those are transient states on the way to the bonus, and 3★ =
 * 4★ = 5★ = the (deliberately rare, huge) Getaway rate. We therefore pour the
 * tease budget into Heat 2 (the reachable near-miss) and leave the 3/4 weights
 * at 0 so they don't just manufacture cheap bonus triggers. The optimizer holds
 * every mode at exactly 96% RTP, so this reshapes VARIANCE only — never EV.
 */
export const BASEGAME_TEASE_WEIGHTS = [62, 38, 0, 0];

/**
 * basebig "Wanted-tease" depth mix: weights over [classic monster cluster,
 * climb to Heat 3, climb to Heat 4]. Monster-dominant so the rare big-cascade
 * tail stays intact; a minority climb visibly through 3-4 stars before they pay
 * (or, occasionally, run on into the Getaway via the thematic Wanted path),
 * enriching the mid-game without cheapening the rare jackpot. Variance only —
 * the optimizer keeps every mode at exactly 96% RTP.
 */
export const BASEBIG_TEASE_WEIGHTS = [62, 22, 16];

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
  /**
   * Collection Power-Level head-start (0 = normal). For the `base_tierN` tables:
   * the Getaway is reached SOONER / more often (the published `freegame` share
   * climbs with the tier while `basegame` shrinks to compensate), and the client
   * pre-lights `headStart` of the 5 WANTED stars. The optimizer still solves the
   * mode to EXACTLY 96%, so the head-start is purely variance reshaping — a feel
   * advantage, never extra EV (see docs/MATH_DESIGN.md §8).
   */
  headStart?: number;
}

/**
 * Build a base-cost cash mode at the given Power-Level head-start. tier 0 is the
 * normal game; tiers 1–3 shift RTP mass from frequent small base wins into a
 * more frequent Getaway, so a higher tier *feels* like an advantage while every
 * tier still verifies to exactly 96%.
 */
function baseTier(headStart: number, rtpSplit: RtpSplit): ModeConfig {
  return {
    cost: 1,
    isFeature: false,
    isBuyBonus: false,
    sims: 100_000,
    criteria: { zero: 0.22, basegame: 0.46, basebig: 0.1, freegame: 0.2, wincap: 0.02 },
    rtpSplit,
    reelWeights: baseReels(),
    safeValues: safeTable(1),
    headStart
  };
}

export const MODES: Record<BetMode, ModeConfig> = {
  base: {
    cost: 1,
    isFeature: false,
    isBuyBonus: false,
    sims: 100_000,
    // Coverage quotas (NOT final frequency). basebig gets generous COVERAGE so
    // the rare big-cascade tail is well sampled; its real probability is tiny.
    criteria: { zero: 0.20, basegame: 0.46, basebig: 0.12, freegame: 0.20, wincap: 0.02 },
    // basegame carries the FREQUENT small wins (high hit-rate) AND the cheap
    // heat-2 "almost!" teases (lower mean than before -> smaller basegame share);
    // basebig carries the rare laddered monsters; freegame the rare, huge Getaway.
    rtpSplit: { basegame: 0.23, basebig: 0.11, freegame: 0.60, wincap: 0.06 },
    reelWeights: baseReels(),
    safeValues: safeTable(1)
  },
  ante: {
    cost: 1.5,
    isFeature: true,
    isBuyBonus: false,
    sims: 100_000,
    criteria: { zero: 0.18, basegame: 0.46, basebig: 0.12, freegame: 0.22, wincap: 0.02 },
    rtpSplit: { basegame: 0.22, basebig: 0.11, freegame: 0.61, wincap: 0.06 },
    reelWeights: anteReels(),
    safeValues: safeTable(1)
  },
  // NOTE — buy-mode `sims` is capped at 25k ON PURPOSE (do NOT raise to 100k).
  // Every buy book is a full Hold & Spin, and the classic reset mechanic
  // (BONUS_START_RESPINS) averages ~16 spins, each event embedding a whole
  // 20-cell lockedGrid → ~11 KB/book. publish.ts compresses the ENTIRE books
  // file in ONE zstd-wasm call, and the wasm heap dies ("memory access out of
  // bounds") around the 1 GB that 100k books produce. 25k ≈ 260 MB, matching the
  // long-standing known-good size. Coverage stays ample (22k freegame + 3k
  // wincap outcomes) and RTP is still solved EXACTLY by the optimizer.
  getaway: {
    cost: 100,
    isFeature: false,
    isBuyBonus: true,
    sims: 25_000,
    criteria: { zero: 0, basegame: 0, basebig: 0, freegame: 0.88, wincap: 0.12 },
    reelWeights: baseReels(),
    safeValues: safeTable(1.15)
  },
  super_getaway: {
    cost: 500,
    isFeature: false,
    isBuyBonus: true,
    sims: 25_000,
    criteria: { zero: 0, basegame: 0, basebig: 0, freegame: 0.80, wincap: 0.20 },
    reelWeights: baseReels(),
    safeValues: safeTable(1.45)
  },
  // ---- Collection Power-Level head-start tables (RTP-neutral, 1x cost) -------
  // base.freegame is 0.62; each tier shifts mass out of `basegame` (frequent
  // small wins) into `freegame` (the Getaway) so the bonus lands progressively
  // more often. basebig + wincap are held constant so the big-cascade and
  // max-win feel are unchanged. All three still solve to exactly 96%.
  base_tier1: baseTier(1, { basegame: 0.17, basebig: 0.1, freegame: 0.67, wincap: 0.06 }),
  base_tier2: baseTier(2, { basegame: 0.12, basebig: 0.1, freegame: 0.72, wincap: 0.06 }),
  base_tier3: baseTier(3, { basegame: 0.08, basebig: 0.1, freegame: 0.76, wincap: 0.06 })
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
/** Hold & Spin respin budget. Classic reset mechanic: the meter STARTS here,
 *  every lock RESETS it back to this value, and each dead spin spends one — so
 *  the feature busts only after this many CONSECUTIVE dead spins.
 *  3 = the industry-standard "3 lives". Do NOT raise to 4: with 20 open cells a
 *  dead spin is ~(1-landP)^20, so a 4-deep budget makes busting ~4x rarer, the
 *  grid fills far too often and the 5000x wincap tail alone pushes E_freegame
 *  past the solvable ceiling (measured: mean 142x vs the ~96x cost target). */
export const BONUS_START_RESPINS = 3;
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
    { value: 250 * scale, weight: 2.2 },
    { value: 750 * scale, weight: 0.7 }
  ];
}
